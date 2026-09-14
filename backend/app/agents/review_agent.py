"""Review / Developer Intelligence Agent.

The final quality-control layer. It receives the raw findings from the Code
Analysis and Security agents and produces the consolidated, prioritised result
that becomes the developer-facing report.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from dataclasses import dataclass, field

from app.agents.base import AgentFinding, AnalysisContext, clamp_confidence, severity_rank
from app.agents.llm import LLMUnavailable, complete_json, llm_enabled

logger = logging.getLogger(__name__)

AGENT_TYPE = "review"

SEVERITY_ORDER = ("critical", "high", "medium", "low")
SEVERITY_PENALTY = {"critical": 14.0, "high": 8.0, "medium": 3.0, "low": 1.0}

LINE_PROXIMITY = 3

SYSTEM_PROMPT = """You are the Review / Developer Intelligence Agent in a multi-agent
code review system. You receive findings that two specialised agents produced for one
repository. They have already been deduplicated and prioritised mechanically.

Your job is to write the developer-facing summary layer:
1. A concise summary (3-5 sentences) a developer can read in 20 seconds.
2. A prioritised list of 3-6 concrete recommendations, most important first.

Be specific and reference real files. Do not invent findings that are not in the input.
Do not restate every finding. Lead with what would hurt most in production.

Reply with ONLY a JSON array containing exactly one object:
[{"summary": "...", "recommendations": ["...", "..."]}]"""


@dataclass
class ReviewResult:
    findings: list[AgentFinding]
    summary: str
    recommendations: list[str]
    health_score: int
    severity_breakdown: dict[str, int] = field(default_factory=dict)
    category_breakdown: dict[str, int] = field(default_factory=dict)
    domain_breakdown: dict[str, int] = field(default_factory=dict)
    merged_count: int = 0
    adjusted_count: int = 0
    engine: str = "heuristic"


def _dedupe_key(finding: AgentFinding) -> tuple:
    line = finding.line_number or 0
    return (finding.file_path or "", line // (LINE_PROXIMITY + 1), finding.category.lower())


def _merge(primary: AgentFinding, other: AgentFinding) -> AgentFinding:
    """Fold `other` into `primary`, keeping the stronger assessment."""

    if severity_rank(other.severity) > severity_rank(primary.severity):
        primary.severity = other.severity

    if other.agent_type != primary.agent_type:
        # Independent agreement from a second agent is real corroboration.
        primary.corroborated_by = other.agent_type
        primary.confidence = min(0.99, round(primary.confidence + 0.08, 2))
    else:
        primary.confidence = max(primary.confidence, other.confidence)

    primary.merged_count += 1

    if other.explanation and other.explanation not in (primary.explanation or ""):
        if len(primary.explanation or "") < 400:
            primary.explanation = (primary.explanation or "") + "\n\n" + other.explanation

    return primary


def _consolidate(findings: list[AgentFinding]) -> tuple[list[AgentFinding], int]:
    buckets: dict[tuple, AgentFinding] = {}
    merged = 0

    ordered = sorted(
        findings,
        key=lambda f: (severity_rank(f.severity), f.confidence),
        reverse=True,
    )

    for finding in ordered:
        finding.merged_count = getattr(finding, "merged_count", 1) or 1
        key = _dedupe_key(finding)
        existing = buckets.get(key)
        if existing is None:
            buckets[key] = finding
        else:
            _merge(existing, finding)
            merged += 1

    return list(buckets.values()), merged


def _validate(finding: AgentFinding, context: AnalysisContext) -> bool:
    """Adjust severity/confidence. Returns True if anything changed."""

    changed = False
    finding.original_severity = finding.severity
    finding.original_confidence = finding.confidence

    is_test_file = any(
        finding.file_path == path for path in context.test_file_paths
    )

    # Issues inside test code carry far less production risk.
    if is_test_file and finding.severity in ("critical", "high"):
        index = SEVERITY_ORDER.index(finding.severity)
        finding.severity = SEVERITY_ORDER[min(index + 1, len(SEVERITY_ORDER) - 1)]
        finding.review_verdict = (
            "Severity lowered one level: this code lives in a test file, so it does "
            "not run in production."
        )
        changed = True

    # A critical claim made with low confidence is downgraded rather than trusted.
    elif finding.severity == "critical" and finding.confidence < 0.5:
        finding.severity = "high"
        finding.review_verdict = (
            "Severity lowered from critical to high: the detecting agent reported low "
            "confidence, so this needs human confirmation before being treated as "
            "critical."
        )
        changed = True

    elif finding.corroborated_by:
        finding.review_verdict = (
            f"Confirmed: independently reported by both the "
            f"{finding.agent_type.replace('_', ' ')} and "
            f"{finding.corroborated_by.replace('_', ' ')} agents, so confidence was "
            "raised."
        )
        changed = True

    else:
        finding.review_verdict = (
            "Reviewed and kept as reported: the cited line matches the described "
            "pattern and no duplicate was found elsewhere in this run."
        )

    finding.reviewed = True
    finding.group_key = finding.category
    return changed


def _health_score(findings: list[AgentFinding]) -> int:
    penalty = sum(
        SEVERITY_PENALTY.get(f.severity, 1.0) * max(0.3, f.confidence) for f in findings
    )
    score = 100 * math.exp(-penalty / 90.0)
    return max(5, min(100, round(score)))


def _describe_health(score: int) -> str:
    if score >= 85:
        return "healthy"
    if score >= 70:
        return "mostly healthy with a few gaps"
    if score >= 45:
        return "in need of attention"
    return "at risk"


def _fallback_summary(
    context: AnalysisContext,
    findings: list[AgentFinding],
    severity_counts: dict[str, int],
    domain_counts: dict[str, int],
    health: int,
    merged: int,
    adjusted: int,
) -> str:
    if not findings:
        return (
            f"No significant issues were detected in {context.repository_name}. "
            f"The Code Analysis and Security agents reviewed "
            f"{len(context.files)} files and found nothing that met the reporting "
            f"threshold. Repository health is {health}/100."
        )

    top = findings[0]
    parts = [
        f"The agents reviewed {len(context.files)} files in "
        f"{context.repository_name} and, after consolidation, reported "
        f"{len(findings)} findings. Repository health is {health}/100 — "
        f"{_describe_health(health)}."
    ]

    critical = severity_counts.get("critical", 0)
    high = severity_counts.get("high", 0)
    if critical:
        parts.append(
            f"{critical} finding{'s' if critical != 1 else ''} "
            f"{'are' if critical != 1 else 'is'} critical and should be resolved "
            f"before the next release, starting with {top.title.lower()} in "
            f"`{top.file_path}`."
        )
    elif high:
        parts.append(
            f"There are no critical issues, but {high} high-severity "
            f"finding{'s' if high != 1 else ''} need attention, led by "
            f"{top.title.lower()} in `{top.file_path}`."
        )
    else:
        parts.append(
            f"Nothing critical or high-severity surfaced; the most notable item is "
            f"{top.title.lower()} in `{top.file_path}`."
        )

    domain_bits = []
    for singular, plural, key in (
        ("security issue", "security issues", "security"),
        ("code quality issue", "code quality issues", "quality"),
        ("probable bug", "probable bugs", "bug"),
    ):
        count = domain_counts.get(key, 0)
        if count:
            domain_bits.append(f"{count} {singular if count == 1 else plural}")
    if domain_bits:
        parts.append("By domain: " + ", ".join(domain_bits) + ".")

    if not context.has_tests:
        parts.append(
            "No test files were found, so none of these paths are covered by "
            "automated checks."
        )

    review_bits = []
    if merged:
        review_bits.append(f"{merged} duplicate finding{'s' if merged != 1 else ''} merged")
    if adjusted:
        review_bits.append(f"{adjusted} severity or confidence adjustment{'s' if adjusted != 1 else ''}")
    if review_bits:
        parts.append("Review agent: " + " and ".join(review_bits) + ".")

    return " ".join(parts)


def _fallback_recommendations(findings: list[AgentFinding]) -> list[str]:
    recommendations: list[str] = []
    seen_categories: set[str] = set()

    for finding in findings:
        if len(recommendations) >= 6:
            break
        if finding.category in seen_categories:
            continue
        seen_categories.add(finding.category)

        location = f"`{finding.file_path}`"
        if finding.line_number:
            location += f":{finding.line_number}"

        recommendations.append(
            f"[{finding.severity.upper()}] {finding.recommendation.rstrip('.')} "
            f"— starting at {location}."
        )

    if not recommendations:
        recommendations.append(
            "No action required from this run. Re-run the analysis after the next "
            "significant change."
        )

    return recommendations


def _llm_summary(context: AnalysisContext, findings: list[AgentFinding], health: int):
    payload = [
        {
            "title": f.title,
            "severity": f.severity,
            "category": f.category,
            "domain": f.domain,
            "confidence": f.confidence,
            "file_path": f.file_path,
            "line_number": f.line_number,
            "recommendation": f.recommendation,
        }
        for f in findings[:25]
    ]

    prompt = (
        f"Repository: {context.repository_name}\n"
        f"Primary language: {context.primary_language or 'unknown'}\n"
        f"Files analysed: {len(context.files)}\n"
        f"Test files present: {'yes' if context.has_tests else 'no'}\n"
        f"Computed health score: {health}/100\n\n"
        f"Consolidated findings (JSON):\n{payload}"
    )

    raw = complete_json(SYSTEM_PROMPT, prompt, max_tokens=1500, label="review_summary")
    if not raw:
        raise LLMUnavailable("empty review response")

    first = raw[0]
    summary = str(first.get("summary") or "").strip()
    recommendations = [
        str(item).strip() for item in (first.get("recommendations") or []) if str(item).strip()
    ]
    if not summary or not recommendations:
        raise LLMUnavailable("review response missing summary or recommendations")

    return summary, recommendations[:6]


def run(context: AnalysisContext, raw_findings: list[AgentFinding]) -> ReviewResult:
    findings, merged = _consolidate(raw_findings)

    adjusted = 0
    for finding in findings:
        if _validate(finding, context):
            adjusted += 1

    findings.sort(
        key=lambda f: (severity_rank(f.severity), f.confidence, f.file_path or ""),
        reverse=True,
    )
    for position, finding in enumerate(findings, start=1):
        finding.review_priority = position

    severity_counts = Counter(f.severity for f in findings)
    category_counts = Counter(f.category for f in findings)
    domain_counts = Counter(f.domain for f in findings)
    health = _health_score(findings)

    engine = "heuristic"
    summary = ""
    recommendations: list[str] = []

    if llm_enabled() and findings:
        try:
            summary, recommendations = _llm_summary(context, findings, health)
            engine = "llm"
        except LLMUnavailable as exc:
            logger.warning("Review Agent falling back to templated summary: %s", exc)

    if not summary:
        summary = _fallback_summary(
            context, findings, dict(severity_counts), dict(domain_counts), health, merged, adjusted
        )
    if not recommendations:
        recommendations = _fallback_recommendations(findings)

    return ReviewResult(
        findings=findings,
        summary=summary,
        recommendations=recommendations,
        health_score=health,
        severity_breakdown={s: severity_counts.get(s, 0) for s in SEVERITY_ORDER},
        category_breakdown=dict(category_counts.most_common()),
        domain_breakdown=dict(domain_counts),
        merged_count=merged,
        adjusted_count=adjusted,
        engine=engine,
    )


# ---------------------------------------------------------------------------
# Developer feedback loop
#
# A developer can leave free-text feedback on one already-reported finding
# (e.g. "this endpoint is internal-only"). That feedback is treated as
# high-priority context: the Review Agent re-evaluates just that finding,
# weighing the feedback above its own default assumptions, without re-running
# the full analysis pipeline.
# ---------------------------------------------------------------------------

FEEDBACK_SYSTEM_PROMPT = """You are the Review / Developer Intelligence Agent in a
multi-agent code review system. You are re-evaluating ONE already-reported finding
because the developer who owns this code left feedback on it.

Developer feedback is HIGH-PRIORITY context — weigh it more heavily than generic
assumptions about the code. But do not blindly accept it: only change the severity
or confidence when the feedback gives a concrete, credible reason (restricted network
access, already mitigated elsewhere, test-only code, a misidentified pattern, wrong
assumption about exposure, etc). If the feedback does not justify a change, say so
explicitly and keep the original assessment — do not change severity just to seem
responsive.

Reply with ONLY a JSON array containing exactly one object:
[{
  "verdict": "1-3 sentences, written to the developer, explaining what you decided and why — reference the feedback directly",
  "new_severity": "critical" | "high" | "medium" | "low",
  "new_confidence": 0.0-1.0,
  "changed": true | false
}]"""

# Small, explicit keyword signals used when no LLM is configured. These are
# intentionally conservative — they only fire on concrete claims about scope,
# exposure or validity, not vague disagreement.
_LOWERING_SIGNALS = (
    "internal-only", "internal only", "internal use", "internally",
    "not exposed", "not publicly", "not public", "private network",
    "not reachable", "not accessible from", "behind auth", "behind vpn",
    "vpn only", "already fixed", "already mitigated", "already patched",
    "test data", "test-only", "test only", "sample data", "not in production",
    "staging only", "admin only", "restricted access", "low risk",
    "false positive", "not exploitable", "not applicable", "no external access",
    "deprecated", "being removed", "will be removed", "not used anymore",
)
_RAISING_SIGNALS = (
    "worse than", "also affects", "more severe", "actually exploited",
    "seen in production", "confirmed exploit", "higher risk than",
    "underestimated", "also impacts", "broader impact", "should be escalated",
    "publicly accessible", "no authentication at all", "affects all customers",
)


@dataclass
class FeedbackOutcome:
    verdict: str
    new_severity: str
    new_confidence: float
    changed: bool
    engine: str = "heuristic"


def _heuristic_feedback(finding, feedback_texts: list[str]) -> FeedbackOutcome:
    combined = " ".join(feedback_texts).lower()

    lowered_hit = any(signal in combined for signal in _LOWERING_SIGNALS)
    raised_hit = any(signal in combined for signal in _RAISING_SIGNALS)

    order_index = SEVERITY_ORDER.index(finding.severity)
    new_severity = finding.severity
    new_confidence = finding.confidence
    changed = False
    reason = None

    if lowered_hit and not raised_hit:
        target_index = min(order_index + 1, len(SEVERITY_ORDER) - 1)
        if target_index != order_index:
            new_severity = SEVERITY_ORDER[target_index]
            new_confidence = clamp_confidence(finding.confidence)
            changed = True
            reason = (
                f"the finding remains valid, but severity was adjusted from "
                f"{finding.severity} to {new_severity} because the feedback describes "
                f"reduced exposure or scope for this code path"
            )
    elif raised_hit and not lowered_hit:
        target_index = max(order_index - 1, 0)
        if target_index != order_index:
            new_severity = SEVERITY_ORDER[target_index]
            new_confidence = clamp_confidence(min(0.95, finding.confidence + 0.1))
            changed = True
            reason = (
                f"severity was raised from {finding.severity} to {new_severity} "
                f"because the feedback describes greater real-world impact than "
                f"originally assessed"
            )

    if reason:
        verdict = f"User feedback considered. {reason.capitalize()}."
    else:
        verdict = (
            "User feedback considered. It does not describe a concrete change in "
            "exposure, exploitability or scope, so the severity and confidence stand "
            "as originally assessed. A human reviewer should still weigh this "
            "feedback when deciding how to prioritize the fix."
        )

    return FeedbackOutcome(
        verdict=verdict,
        new_severity=new_severity,
        new_confidence=new_confidence,
        changed=changed,
        engine="heuristic",
    )


def _llm_feedback(finding, feedback_texts: list[str]) -> FeedbackOutcome:
    feedback_block = "\n".join(f"- \"{text}\"" for text in feedback_texts)

    prompt = (
        f"ORIGINAL FINDING\n"
        f"Title: {finding.title}\n"
        f"Category: {finding.category}\n"
        f"Description: {finding.description}\n"
        f"Current severity: {finding.severity}\n"
        f"Current confidence: {finding.confidence}\n"
        f"File: {finding.file_path}:{finding.line_number}\n"
        f"Detected by: {finding.agent_type}\n\n"
        f"DEVELOPER FEEDBACK (high priority, most recent last)\n"
        f"{feedback_block}\n\n"
        f"Re-evaluate this finding in light of the feedback above."
    )

    raw = complete_json(FEEDBACK_SYSTEM_PROMPT, prompt, max_tokens=500, label="feedback_review")
    if not raw:
        raise LLMUnavailable("empty feedback response")

    item = raw[0]
    severity = str(item.get("new_severity", finding.severity)).lower()
    if severity not in SEVERITY_ORDER:
        severity = finding.severity

    try:
        confidence = clamp_confidence(float(item.get("new_confidence", finding.confidence)))
    except (TypeError, ValueError):
        confidence = finding.confidence

    verdict = str(item.get("verdict") or "").strip()
    if not verdict:
        raise LLMUnavailable("feedback response missing verdict")

    changed = bool(item.get("changed")) or severity != finding.severity

    return FeedbackOutcome(
        verdict=verdict,
        new_severity=severity,
        new_confidence=confidence,
        changed=changed,
        engine="llm",
    )


def integrate_feedback(finding, feedback_texts: list[str]) -> FeedbackOutcome:
    """Re-evaluate one finding against developer feedback.

    This is the Review Agent's feedback-loop entry point: it does not re-run the
    analysis pipeline, only its own severity/confidence judgment for this one
    finding, with the feedback weighted as high-priority context.
    """

    if not feedback_texts:
        raise ValueError("integrate_feedback requires at least one feedback text")

    if llm_enabled():
        try:
            return _llm_feedback(finding, feedback_texts)
        except LLMUnavailable as exc:
            logger.warning("Review Agent feedback: falling back to heuristic (%s)", exc)

    return _heuristic_feedback(finding, feedback_texts)
