"""Deterministic static pre-scan.

Runs before any LLM call. It keeps token usage bounded by ranking files, and it
hands the Security Agent a head start by regex-scanning for likely secrets.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

SECRET_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    (
        "stripe_secret_key",
        re.compile(r"sk_(?:live|test)_[A-Za-z0-9]{16,}"),
        "Stripe secret key",
    ),
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}"), "AWS access key id"),
    (
        "github_token",
        re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
        "GitHub personal access token",
    ),
    ("slack_token", re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (
        "private_key_block",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"),
        "Private key block",
    ),
    (
        "webhook_secret",
        re.compile(r"whsec_[A-Za-z0-9]{12,}"),
        "Webhook signing secret",
    ),
    (
        "generic_assignment",
        re.compile(
            r"""(?ix)
            \b(api[_-]?key|apikey|secret[_-]?key|secret|token|password|passwd|
               access[_-]?key|private[_-]?key|signing[_-]?key|client[_-]?secret)
            \b\s*[:=]\s*
            ["'`]([^"'`\n]{8,})["'`]
            """
        ),
        "Hardcoded credential assignment",
    ),
]

# Values that look like credentials but are clearly placeholders.
PLACEHOLDER_RE = re.compile(
    r"(?i)^(your|my|the)?[-_ ]?(api|secret|access|private)?[-_ ]?"
    r"(key|token|secret|password|value|here|xxx+|placeholder|changeme|example|"
    r"todo|none|null|undefined|test|dummy|sample|\*+|<.+>|\$\{.*\}|process\.env.*|"
    r"os\.environ.*|os\.getenv.*)$"
)

ENV_LOOKUP_RE = re.compile(
    r"(?i)(os\.getenv|os\.environ|process\.env|getenv|config\.get|settings\.)"
)


@dataclass
class SecretHit:
    file_path: str
    line_number: int
    rule_id: str
    label: str
    snippet: str


@dataclass
class PreScanResult:
    primary_language: str | None
    language_breakdown: dict[str, int] = field(default_factory=dict)
    selected_files: list = field(default_factory=list)
    skipped_file_count: int = 0
    total_loc: int = 0
    test_file_count: int = 0
    test_file_paths: list[str] = field(default_factory=list)
    secret_hits: list[SecretHit] = field(default_factory=list)
    has_readme: bool = False
    has_dependency_manifest: bool = False


def _priority_score(file) -> float:
    """Rank files by how likely they are to contain something worth reporting."""

    content = file.content
    lines = content.splitlines()
    score = 0.0

    score += min(len(lines), 600) / 60.0

    # Branch density is a cheap proxy for complexity.
    branch_tokens = (
        " if ",
        " elif ",
        " else",
        " for ",
        " while ",
        " case ",
        " catch",
        "&&",
        "||",
    )
    score += sum(content.count(token) for token in branch_tokens) / 12.0

    # Files that touch risky surfaces are worth prioritising.
    risky_tokens = (
        "execute(",
        "query(",
        "eval(",
        "exec(",
        "password",
        "token",
        "secret",
        "auth",
        "login",
        "admin",
        "innerHTML",
        "subprocess",
        "os.system",
        "request",
        "fetch(",
    )
    lowered = content.lower()
    score += sum(2.0 for token in risky_tokens if token in lowered)

    # Deep nesting.
    max_indent = 0
    for line in lines:
        if line.strip():
            max_indent = max(max_indent, (len(line) - len(line.lstrip())) // 2)
    score += max_indent

    if file.is_test:
        score *= 0.35

    return round(score, 2)


def _is_placeholder(value: str) -> bool:
    stripped = value.strip()
    if not stripped or len(stripped) < 8:
        return True
    if PLACEHOLDER_RE.match(stripped):
        return True
    if ENV_LOOKUP_RE.search(stripped):
        return True
    # Low-entropy repeats such as "aaaaaaaa" or "12345678".
    if len(set(stripped)) <= 3:
        return True
    return False


def scan_for_secrets(files) -> list[SecretHit]:
    hits: list[SecretHit] = []
    seen: set[tuple[str, int, str]] = set()

    for file in files:
        for index, line in enumerate(file.content.splitlines(), start=1):
            if len(line) > 400:
                continue
            for rule_id, pattern, label in SECRET_PATTERNS:
                match = pattern.search(line)
                if not match:
                    continue

                if rule_id == "generic_assignment":
                    value = match.group(2)
                    if _is_placeholder(value):
                        continue

                key = (file.path, index, rule_id)
                if key in seen:
                    continue
                seen.add(key)

                hits.append(
                    SecretHit(
                        file_path=file.path,
                        line_number=index,
                        rule_id=rule_id,
                        label=label,
                        snippet=_redact(line.strip()),
                    )
                )
                break

    return hits


def _redact(line: str) -> str:
    """Mask credential-looking values so the database never stores a live secret."""

    def mask(match: re.Match[str]) -> str:
        value = match.group(0)
        if len(value) <= 8:
            return "*" * len(value)
        return f"{value[:4]}{'*' * 8}{value[-2:]}"

    redacted = line
    for rule_id, pattern, _ in SECRET_PATTERNS:
        if rule_id == "generic_assignment":
            continue
        redacted = pattern.sub(mask, redacted)

    generic = SECRET_PATTERNS[-1][1]
    match = generic.search(redacted)
    if match:
        value = match.group(2)
        if not _is_placeholder(value):
            masked = (
                f"{value[:3]}{'*' * 8}{value[-2:]}" if len(value) > 8 else "*" * len(value)
            )
            redacted = redacted.replace(value, masked)

    return redacted[:240]


def run_prescan(fetched, max_files: int) -> PreScanResult:
    files = list(fetched.files)

    breakdown = Counter(f.language for f in files)
    primary = breakdown.most_common(1)[0][0] if breakdown else None

    for file in files:
        file.priority_score = _priority_score(file)

    ranked = sorted(files, key=lambda f: f.priority_score, reverse=True)
    selected = ranked[:max_files]

    tests = [f.path for f in files if f.is_test]

    return PreScanResult(
        primary_language=primary,
        language_breakdown=dict(breakdown),
        selected_files=selected,
        skipped_file_count=max(0, len(files) - len(selected)),
        total_loc=sum(f.line_count for f in selected),
        test_file_count=len(tests),
        test_file_paths=tests[:25],
        secret_hits=scan_for_secrets(selected),
        has_readme=bool(fetched.readme),
        has_dependency_manifest=bool(fetched.dependency_manifest),
    )
