"""Security Agent — vulnerabilities, secrets and insecure patterns."""

from __future__ import annotations

import logging

from app.agents.base import AgentFinding, AnalysisContext, clamp_confidence
from app.agents.llm import LLMUnavailable, complete_json, format_files_for_prompt, llm_enabled
from app.agents.rules_security import SECURITY_RULES, rule_hardcoded_secret

logger = logging.getLogger(__name__)

AGENT_TYPE = "security"

OWASP_REFERENCE = """OWASP Top 10 (2021) reference:
A01 Broken Access Control - missing or bypassable authorisation checks.
A02 Cryptographic Failures - weak hashes, disabled TLS verification, secrets in transit.
A03 Injection - SQL/command/LDAP injection and cross-site scripting.
A04 Insecure Design - missing rate limits, unsafe trust boundaries.
A05 Security Misconfiguration - debug enabled, permissive defaults, exposed config.
A06 Vulnerable and Outdated Components - known-vulnerable dependencies.
A07 Identification and Authentication Failures - weak password storage, unverified tokens.
A08 Software and Data Integrity Failures - unsafe deserialisation, eval of input.
A09 Security Logging and Monitoring Failures - secrets in logs, no audit trail.
A10 Server-Side Request Forgery - unvalidated outbound URLs."""

SYSTEM_PROMPT = f"""You are the Security Agent in a multi-agent code review system.
You review source code for SECURITY vulnerabilities only. Another agent handles
general code quality, so do not report style or maintainability issues.

Look for: injection (SQL, command, XSS), hardcoded secrets and credentials,
unsafe handling of user input, authentication and authorisation flaws, weak
cryptography, disabled certificate/signature verification, unsafe
deserialisation, and sensitive data exposure.

{OWASP_REFERENCE}

Rules:
- Only report issues you can point at a specific line for.
- Line numbers are shown in the left gutter of each file. Use those exact numbers.
- Prioritise exploitable issues over theoretical ones. Maximum 12 findings.
- NEVER reproduce a full credential value in your output. Mask it.

Reply with ONLY a JSON array. Each element:
{{
  "rule_id": "snake_case_identifier",
  "title": "short specific title",
  "description": "one or two sentences",
  "explanation": "what the code does and why it is insecure",
  "why_it_matters": "how it would be exploited and the impact",
  "recommendation": "the remediation",
  "suggested_fix": "a short corrected code snippet",
  "severity": "critical" | "high" | "medium" | "low",
  "category": "human readable category, e.g. SQL Injection",
  "confidence": 0.0-1.0,
  "file_path": "exact path as shown",
  "line_number": 42,
  "code_start_line": 40,
  "code_end_line": 44
}}"""


def _run_heuristics(context: AnalysisContext) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for file in context.files:
        if file.language == "markdown":
            continue
        lines = file.content.splitlines()

        try:
            findings.extend(rule_hardcoded_secret(file, lines, context.secret_hits))
        except Exception:
            logger.exception("secret rule failed on %s", file.path)

        for rule in SECURITY_RULES:
            try:
                findings.extend(rule(file, lines))
            except Exception:
                logger.exception("security rule %s failed on %s", rule.__name__, file.path)

    return findings


def _run_llm(context: AnalysisContext) -> list[AgentFinding]:
    files = [f for f in context.files if f.language != "markdown"][:12]
    if not files:
        return []

    hint_lines = [
        f"- {hit.file_path}:{hit.line_number} — {hit.label}"
        for hit in context.secret_hits[:20]
    ]
    hints = (
        "A deterministic pre-scan already flagged these possible secrets "
        "(verify each, they may be false positives):\n" + "\n".join(hint_lines)
        if hint_lines
        else "The pre-scan found no obvious hardcoded secrets."
    )

    prompt = (
        f"Repository: {context.repository_name}\n"
        f"Primary language: {context.primary_language or 'unknown'}\n\n"
        f"{hints}\n\n"
        f"{format_files_for_prompt(files)}"
    )

    raw = complete_json(SYSTEM_PROMPT, prompt, label="security")
    return [_from_llm(item) for item in raw if item.get("file_path")]


def _from_llm(item: dict) -> AgentFinding:
    severity = str(item.get("severity", "medium")).lower()
    if severity not in ("critical", "high", "medium", "low"):
        severity = "medium"

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
        rule_id=str(item.get("rule_id") or "llm_security_finding")[:64],
        title=str(item.get("title") or "Security issue")[:200],
        description=str(item.get("description") or ""),
        explanation=item.get("explanation"),
        why_it_matters=item.get("why_it_matters"),
        recommendation=str(item.get("recommendation") or "Review this code."),
        suggested_fix=item.get("suggested_fix"),
        severity=severity,
        category=str(item.get("category") or "Security")[:64],
        domain="security",
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
            logger.info("Security Agent: LLM returned no findings, using heuristics")
        except LLMUnavailable as exc:
            logger.warning("Security Agent falling back to heuristics: %s", exc)

    return _run_heuristics(context), "heuristic"
