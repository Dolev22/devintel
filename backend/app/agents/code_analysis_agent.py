"""Code Analysis Agent — bugs and code quality."""

from __future__ import annotations

import logging

from app.agents.base import AgentFinding, AnalysisContext, clamp_confidence
from app.agents.llm import LLMUnavailable, complete_json, format_files_for_prompt, llm_enabled
from app.agents.rules_quality import QUALITY_RULES, detect_duplicate_blocks

logger = logging.getLogger(__name__)

AGENT_TYPE = "code_analysis"

SYSTEM_PROMPT = """You are the Code Analysis Agent in a multi-agent code review system.
You review source code for LOGIC BUGS and CODE QUALITY problems. Another agent
handles security, so do not report security vulnerabilities.

Look for: probable logic errors, suspicious conditions, incorrect assumptions,
unhandled edge cases, null/undefined dereferences, code smells, excessive
complexity, duplicated logic, and maintainability problems.

Rules:
- Only report issues you can point at a specific line for.
- Line numbers are shown in the left gutter of each file. Use those exact numbers.
- Prefer a few high-value findings over many trivial ones. Maximum 12.
- Do not report formatting or naming preferences.

Reply with ONLY a JSON array. Each element:
{
  "rule_id": "snake_case_identifier",
  "title": "short specific title",
  "description": "one or two sentences",
  "explanation": "what the code actually does and why it is wrong",
  "why_it_matters": "the concrete consequence for users or the team",
  "recommendation": "what to do about it",
  "suggested_fix": "a short corrected code snippet",
  "severity": "critical" | "high" | "medium" | "low",
  "category": "human readable category, e.g. Possible Null Reference",
  "domain": "bug" | "quality",
  "confidence": 0.0-1.0,
  "file_path": "exact path as shown",
  "line_number": 42,
  "code_start_line": 40,
  "code_end_line": 46
}"""


def _run_heuristics(context: AnalysisContext) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for file in context.files:
        if file.language == "markdown":
            continue
        lines = file.content.splitlines()
        for rule in QUALITY_RULES:
            try:
                findings.extend(rule(file, lines))
            except Exception:  # a broken rule must not fail the agent
                logger.exception("quality rule %s failed on %s", rule.__name__, file.path)

    try:
        findings.extend(detect_duplicate_blocks([f for f in context.files if not f.is_test]))
    except Exception:
        logger.exception("duplicate detection failed")

    if not context.has_tests and findings:
        for finding in findings:
            if finding.domain == "bug":
                finding.why_it_matters += (
                    " No test files were found in this repository, so there is no "
                    "automated check that would catch this regressing."
                )

    return findings


def _run_llm(context: AnalysisContext) -> list[AgentFinding]:
    files = [f for f in context.files if f.language != "markdown"][:12]
    if not files:
        return []

    prompt = (
        f"Repository: {context.repository_name}\n"
        f"Primary language: {context.primary_language or 'unknown'}\n"
        f"Test files present: {'yes' if context.has_tests else 'no'}\n\n"
        f"{format_files_for_prompt(files)}"
    )

    raw = complete_json(SYSTEM_PROMPT, prompt, label="code_analysis")
    return [_from_llm(item) for item in raw if item.get("file_path")]


def _from_llm(item: dict) -> AgentFinding:
    severity = str(item.get("severity", "medium")).lower()
    if severity not in ("critical", "high", "medium", "low"):
        severity = "medium"

    domain = str(item.get("domain", "quality")).lower()
    if domain not in ("bug", "quality"):
        domain = "quality"

    try:
        confidence = clamp_confidence(float(item.get("confidence", 0.6)))
    except (TypeError, ValueError):
        confidence = 0.6

    def as_int(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return AgentFinding(
        rule_id=str(item.get("rule_id") or "llm_finding")[:64],
        title=str(item.get("title") or "Code quality issue")[:200],
        description=str(item.get("description") or ""),
        explanation=item.get("explanation"),
        why_it_matters=item.get("why_it_matters"),
        recommendation=str(item.get("recommendation") or "Review this code."),
        suggested_fix=item.get("suggested_fix"),
        severity=severity,
        category=str(item.get("category") or "Code Quality")[:64],
        domain=domain,
        confidence=confidence,
        agent_type=AGENT_TYPE,
        file_path=str(item.get("file_path")),
        line_number=as_int(item.get("line_number")),
        code_start_line=as_int(item.get("code_start_line")),
        code_end_line=as_int(item.get("code_end_line")),
    )


def run(context: AnalysisContext) -> tuple[list[AgentFinding], str]:
    """Returns (findings, engine_used)."""

    if llm_enabled():
        try:
            findings = _run_llm(context)
            if findings:
                return findings, "llm"
            logger.info("Code Analysis Agent: LLM returned no findings, using heuristics")
        except LLMUnavailable as exc:
            logger.warning("Code Analysis Agent falling back to heuristics: %s", exc)

    return _run_heuristics(context), "heuristic"
