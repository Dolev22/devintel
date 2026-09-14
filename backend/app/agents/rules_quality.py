"""Detection rules used by the Code Analysis Agent (bugs + code quality)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.agents.base import AgentFinding

AGENT = "code_analysis"

PY_KEYWORDS = {
    "def", "class", "if", "elif", "else", "for", "while", "return", "import",
    "from", "try", "except", "finally", "with", "as", "in", "not", "and", "or",
    "is", "none", "true", "false", "lambda", "yield", "raise", "pass", "break",
    "continue", "global", "nonlocal", "assert", "del", "async", "await", "self",
}
JS_KEYWORDS = {
    "function", "const", "let", "var", "if", "else", "for", "while", "return",
    "import", "export", "from", "try", "catch", "finally", "switch", "case",
    "default", "new", "this", "typeof", "instanceof", "null", "undefined",
    "true", "false", "class", "extends", "async", "await", "yield", "throw",
    "break", "continue", "delete", "in", "of",
}
ALL_KEYWORDS = PY_KEYWORDS | JS_KEYWORDS

BRANCH_TOKENS = re.compile(
    r"(?:\bif\b|\belif\b|\belse\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b|\bexcept\b|"
    r"\band\b|\bor\b|&&|\|\||\?)"
)

IDENTIFIER_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
STRING_RE = re.compile(r"""(["'`])(?:\\.|(?!\1).)*\1""")
COMMENT_RE = re.compile(r"(#.*$)|(//.*$)")

PY_LANGS = {"python"}
JS_LANGS = {"javascript", "jsx", "typescript", "tsx"}


@dataclass
class FunctionBlock:
    name: str
    start_line: int
    end_line: int
    params: list[str]
    lines: list[str]

    @property
    def length(self) -> int:
        return self.end_line - self.start_line + 1


def _balanced_signature(lines: list[str], start_index: int) -> tuple[str, int]:
    """Collect a (possibly multi-line) signature starting at start_index."""
    buffer = ""
    depth = 0
    index = start_index
    while index < len(lines):
        line = lines[index]
        buffer += line
        depth += line.count("(") - line.count(")")
        if depth <= 0 and "(" in buffer:
            break
        index += 1
        if index - start_index > 12:
            break
    return buffer, index


def _split_params(signature: str) -> list[str]:
    match = re.search(r"\((.*)\)", signature, re.DOTALL)
    if not match:
        return []
    inner = match.group(1)
    if not inner.strip():
        return []

    params: list[str] = []
    depth = 0
    current = ""
    for char in inner:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        if char == "," and depth == 0:
            params.append(current.strip())
            current = ""
        else:
            current += char
    if current.strip():
        params.append(current.strip())

    return [p for p in params if p and p not in ("self", "cls")]


def extract_python_functions(lines: list[str]) -> list[FunctionBlock]:
    blocks: list[FunctionBlock] = []
    pattern = re.compile(r"^(\s*)(?:async\s+)?def\s+(\w+)\s*\(")

    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue

        indent = len(match.group(1))
        name = match.group(2)
        signature, sig_end_index = _balanced_signature(lines, index)

        end_index = sig_end_index
        cursor = sig_end_index + 1
        while cursor < len(lines):
            current = lines[cursor]
            if current.strip():
                current_indent = len(current) - len(current.lstrip())
                if current_indent <= indent:
                    break
                end_index = cursor
            cursor += 1

        blocks.append(
            FunctionBlock(
                name=name,
                start_line=index + 1,
                end_line=end_index + 1,
                params=_split_params(signature),
                lines=lines[index : end_index + 1],
            )
        )

    return blocks


def extract_js_functions(lines: list[str]) -> list[FunctionBlock]:
    blocks: list[FunctionBlock] = []
    patterns = [
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\("),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\("),
        re.compile(r"^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{\s*$"),
    ]

    for index, line in enumerate(lines):
        name = None
        for pattern in patterns:
            match = pattern.match(line)
            if match:
                name = match.group(1)
                break
        if not name or name in JS_KEYWORDS:
            continue

        signature, sig_end_index = _balanced_signature(lines, index)

        # Walk braces to find the end of the body.
        depth = 0
        opened = False
        end_index = sig_end_index
        cursor = index
        while cursor < len(lines):
            stripped = COMMENT_RE.sub("", lines[cursor])
            stripped = STRING_RE.sub('""', stripped)
            depth += stripped.count("{") - stripped.count("}")
            if "{" in stripped:
                opened = True
            if opened and depth <= 0:
                end_index = cursor
                break
            cursor += 1
            if cursor - index > 400:
                end_index = min(cursor, len(lines) - 1)
                break

        if end_index <= index:
            continue

        blocks.append(
            FunctionBlock(
                name=name,
                start_line=index + 1,
                end_line=end_index + 1,
                params=_split_params(signature),
                lines=lines[index : end_index + 1],
            )
        )

    return blocks


def extract_functions(file, lines: list[str]) -> list[FunctionBlock]:
    if file.language in PY_LANGS:
        return extract_python_functions(lines)
    if file.language in JS_LANGS:
        return extract_js_functions(lines)
    return []


def _decision_points(block: FunctionBlock) -> int:
    body = "\n".join(block.lines)
    body = COMMENT_RE.sub("", body)
    body = STRING_RE.sub('""', body)
    return len(BRANCH_TOKENS.findall(body))


def _max_nesting(block: FunctionBlock, language: str) -> int:
    if language in PY_LANGS:
        base = None
        deepest = 0
        for line in block.lines:
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip())
            if base is None:
                base = indent
                continue
            deepest = max(deepest, (indent - base) // 4)
        return deepest

    depth = 0
    deepest = 0
    for line in block.lines:
        stripped = STRING_RE.sub('""', COMMENT_RE.sub("", line))
        for char in stripped:
            if char == "{":
                depth += 1
                deepest = max(deepest, depth)
            elif char == "}":
                depth = max(0, depth - 1)
    return max(0, deepest - 1)


def rule_complexity(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for block in extract_functions(file, lines):
        complexity = _decision_points(block)
        nesting = _max_nesting(block, file.language)
        length = block.length

        if complexity < 12 and nesting < 4 and length < 45:
            continue

        if complexity >= 20 or (complexity >= 14 and nesting >= 4):
            severity, confidence = "high", 0.84
        elif complexity >= 12 or nesting >= 4:
            severity, confidence = "medium", 0.78
        else:
            severity, confidence = "low", 0.7

        reasons = []
        if complexity >= 12:
            reasons.append(f"{complexity} decision points")
        if nesting >= 4:
            reasons.append(f"{nesting} levels of nesting")
        if length >= 45:
            reasons.append(f"{length} lines long")

        findings.append(
            AgentFinding(
                rule_id="high_complexity",
                title=f"High complexity in `{block.name}()`",
                description=(
                    f"`{block.name}()` has {', '.join(reasons)}, which makes it hard to "
                    "read, test and change safely."
                ),
                explanation=(
                    f"This function contains {complexity} branch points across "
                    f"{length} lines, nested up to {nesting} levels deep. Each "
                    "independent branch multiplies the number of paths through the "
                    "code, and deeply nested conditionals force a reader to hold "
                    "several conditions in mind at once to understand any single line."
                ),
                why_it_matters=(
                    "Complexity at this level is where regressions concentrate: the "
                    "number of test cases needed for full coverage grows with the branch "
                    "count, so in practice most paths stay untested and a change to one "
                    "branch silently breaks another."
                ),
                recommendation=(
                    "Extract the distinct responsibilities into named helper functions "
                    "and replace the conditional ladder with a lookup table or strategy "
                    "map. Aim for fewer than 10 decision points per function."
                ),
                suggested_fix=(
                    "COUPON_STRATEGIES = {\n"
                    '    "percent": apply_percent_coupon,\n'
                    '    "fixed": apply_fixed_coupon,\n'
                    '    "bogo": apply_bogo_coupon,\n'
                    "}\n\n"
                    "def apply_coupon(total, coupon):\n"
                    '    strategy = COUPON_STRATEGIES.get(coupon.get("type"))\n'
                    "    return strategy(total, coupon) if strategy else total"
                ),
                severity=severity,
                category="High Complexity",
                domain="quality",
                confidence=confidence,
                agent_type=AGENT,
                file_path=file.path,
                line_number=block.start_line,
                code_start_line=block.start_line,
                code_end_line=min(block.end_line, block.start_line + 45),
            )
        )

    return findings


def rule_long_parameter_list(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for block in extract_functions(file, lines):
        if len(block.params) <= 5:
            continue

        findings.append(
            AgentFinding(
                rule_id="long_parameter_list",
                title=f"`{block.name}()` takes {len(block.params)} parameters",
                description=(
                    "A long positional parameter list makes call sites hard to read and "
                    "easy to get wrong."
                ),
                explanation=(
                    f"`{block.name}()` accepts {len(block.params)} parameters. Callers "
                    "must remember the exact order, and several of them are booleans, "
                    "which produce call sites like `calculate_total(100, \"USD\", None, "
                    "\"US\", False, True)` where the meaning of each argument is invisible."
                ),
                why_it_matters=(
                    "Two parameters of the same type sitting next to each other can be "
                    "swapped without any error - the code runs and silently produces the "
                    "wrong number. In a pricing path that means incorrect charges."
                ),
                recommendation=(
                    "Group related arguments into a small dataclass or options object, "
                    "and make the boolean flags keyword-only so call sites stay readable."
                ),
                suggested_fix=(
                    "@dataclass\n"
                    "class PricingOptions:\n"
                    '    currency: str = "USD"\n'
                    '    region: str = "US"\n'
                    "    include_tax: bool = True\n"
                    "    round_result: bool = True\n\n"
                    "def calculate_total(amount, options: PricingOptions, coupon=None):\n"
                    "    ..."
                ),
                severity="low",
                category="Maintainability",
                domain="quality",
                confidence=0.82,
                agent_type=AGENT,
                file_path=file.path,
                line_number=block.start_line,
                code_start_line=block.start_line,
                code_end_line=min(block.end_line, block.start_line + 8),
            )
        )

    return findings


def rule_bare_except(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        is_bare = stripped in ("except:", "except Exception:", "except BaseException:")
        if not is_bare:
            continue

        following = [l.strip() for l in lines[index : index + 3] if l.strip()]
        swallowed = bool(following) and following[0] in ("pass", "return", "return None")

        findings.append(
            AgentFinding(
                rule_id="swallowed_exception",
                title="Exception caught and silently discarded"
                if swallowed
                else "Overly broad exception handler",
                description=(
                    "A bare except block hides every error, including ones that indicate "
                    "the operation did not complete."
                ),
                explanation=(
                    "This handler catches every exception type and "
                    + (
                        "immediately discards it, so the function returns as if nothing "
                        "went wrong."
                        if swallowed
                        else "does not distinguish between expected and unexpected failures."
                    )
                    + " Callers receive None rather than an error, and nothing is logged."
                ),
                why_it_matters=(
                    "In a refund path this means a failed database write looks identical "
                    "to a successful refund: the customer is told the refund succeeded, "
                    "no money moves, and there is no log entry to investigate later."
                ),
                recommendation=(
                    "Catch the specific exceptions you can handle, log the error with "
                    "context, roll the transaction back, and re-raise anything else."
                ),
                suggested_fix=(
                    "try:\n"
                    "    ...\n"
                    "except DatabaseError:\n"
                    "    conn.rollback()\n"
                    '    logger.exception("refund failed payment_id=%s", payment_id)\n'
                    "    raise"
                ),
                severity="high" if swallowed else "medium",
                category="Error Handling",
                domain="bug",
                confidence=0.88 if swallowed else 0.72,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=max(1, index - 1),
                code_end_line=min(len(lines), index + 2),
            )
        )

    return findings


def rule_mutable_default(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []
    if file.language not in PY_LANGS:
        return findings

    pattern = re.compile(r"def\s+(\w+)\s*\([^)]*?=\s*(\[\]|\{\}|set\(\))")

    for index, line in enumerate(lines, start=1):
        match = pattern.search(line)
        if not match:
            continue

        findings.append(
            AgentFinding(
                rule_id="mutable_default_argument",
                title=f"Mutable default argument in `{match.group(1)}()`",
                description=(
                    "A list/dict/set is used as a default parameter value, so it is "
                    "shared across every call."
                ),
                explanation=(
                    "Python evaluates default arguments once, when the function is "
                    "defined - not on each call. Every invocation that omits this "
                    "argument therefore mutates the same object, and values accumulate "
                    "across unrelated calls for the lifetime of the process."
                ),
                why_it_matters=(
                    "The function appears to work in isolated tests and then behaves "
                    "differently in production as the shared list grows. Bugs of this "
                    "shape are hard to reproduce because they depend on call history."
                ),
                recommendation=(
                    "Default to None and create a fresh container inside the function."
                ),
                suggested_fix=(
                    "def process_refund(payment_id, reason=None):\n"
                    "    reason = [] if reason is None else reason\n"
                    "    ..."
                ),
                severity="medium",
                category="Error-Prone Pattern",
                domain="bug",
                confidence=0.93,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_null_reference(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    if file.language in PY_LANGS:
        assign_re = re.compile(r"^\s*(\w+)\s*=\s*[\w\.\[\]\"']+\.get\(")
        for index, line in enumerate(lines, start=1):
            match = assign_re.match(line)
            if not match:
                continue
            variable = match.group(1)

            guard_re = re.compile(
                rf"\bif\s+(not\s+)?{re.escape(variable)}\b|"
                rf"\b{re.escape(variable)}\s+is\s+(not\s+)?None\b|"
                rf"\b{re.escape(variable)}\s*(or|and)\s"
            )
            use_re = re.compile(rf"\b{re.escape(variable)}\s*(\.\w+|\[)")

            for offset in range(index, min(len(lines), index + 12)):
                candidate = lines[offset]
                if guard_re.search(candidate):
                    break
                if use_re.search(candidate):
                    findings.append(
                        _null_finding(
                            file,
                            offset + 1,
                            variable,
                            index,
                            (
                                f"`{variable}` is assigned from a .get() call on line "
                                f"{index}, which returns None when the key is absent, "
                                f"and is then dereferenced on line {offset + 1} without "
                                "any check in between."
                            ),
                        )
                    )
                    break

    if file.language in JS_LANGS:
        state_re = re.compile(r"const\s*\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*useState\(\s*null\s*\)")
        for index, line in enumerate(lines, start=1):
            match = state_re.search(line)
            if not match:
                continue
            variable = match.group(1)

            guard_re = re.compile(
                rf"\bif\s*\(\s*!?\s*{re.escape(variable)}\b|"
                rf"\b{re.escape(variable)}\s*(\?\.|&&|\|\||\?)|"
                rf"\b{re.escape(variable)}\s*===?\s*null"
            )
            use_re = re.compile(rf"\{{\s*{re.escape(variable)}\.\w+|\b{re.escape(variable)}\.\w+\(")

            guarded = any(guard_re.search(l) for l in lines[index:])
            if guarded:
                continue

            for offset in range(index, len(lines)):
                if use_re.search(lines[offset]):
                    findings.append(
                        _null_finding(
                            file,
                            offset + 1,
                            variable,
                            index,
                            (
                                f"`{variable}` is initialised to null on line {index} and "
                                f"read on line {offset + 1} before the async load "
                                "completes, with no null guard on the render path."
                            ),
                        )
                    )
                    break

        chain_re = re.compile(r"\b(\w+(?:\.\w+){3,})\b")
        for index, line in enumerate(lines, start=1):
            if "?." in line or line.strip().startswith(("//", "*", "import")):
                continue
            match = chain_re.search(line)
            if not match:
                continue
            chain = match.group(1)
            if chain.split(".")[0] in ("console", "window", "document", "process", "React"):
                continue
            if "(" in chain:
                continue

            findings.append(
                _null_finding(
                    file,
                    index,
                    chain,
                    index,
                    (
                        f"`{chain}` walks {chain.count('.')} levels of nested properties "
                        "without optional chaining. Any missing link in that chain throws "
                        "a TypeError at render time."
                    ),
                )
            )

    return findings


def _null_finding(file, line_number: int, variable: str, origin: int, explanation: str) -> AgentFinding:
    return AgentFinding(
        rule_id="possible_null_reference",
        title=f"Possible null reference on `{variable}`",
        description=(
            "A value that can legitimately be null/None is dereferenced without a guard."
        ),
        explanation=explanation,
        why_it_matters=(
            "When the value is absent the request fails with an unhandled TypeError / "
            "AttributeError rather than a meaningful error. On a request path this "
            "surfaces to the user as a 500, and in a React render it blanks the screen."
        ),
        recommendation=(
            "Check for the missing value explicitly and return a clear error or a "
            "loading state before dereferencing it."
        ),
        suggested_fix=(
            "customer = payload.get(\"customer\")\n"
            "if customer is None:\n"
            "    raise HTTPException(status_code=400, detail=\"customer is required\")\n"
            "currency = customer.get(\"preferred_currency\", \"USD\")"
        ),
        severity="high",
        category="Possible Null Reference",
        domain="bug",
        confidence=0.76,
        agent_type=AGENT,
        file_path=file.path,
        line_number=line_number,
        code_start_line=min(origin, line_number),
        code_end_line=line_number,
    )


def rule_debug_statement(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []
    if file.is_test:
        return findings

    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped.startswith("console.log("):
            continue

        findings.append(
            AgentFinding(
                rule_id="debug_statement_left",
                title="Debug logging left in application code",
                description="A console.log call remains in shipped code.",
                explanation=(
                    "This statement was almost certainly added while debugging. It runs "
                    "on every call in production, writing the full payload to the "
                    "browser console."
                ),
                why_it_matters=(
                    "Beyond the noise, printing whole API payloads to the console can "
                    "expose data that was never meant to be visible in a shared or "
                    "recorded browser session."
                ),
                recommendation=(
                    "Remove the statement, or route it through a log helper that is "
                    "disabled outside development."
                ),
                suggested_fix="// removed: console.log(\"report payload\", data);",
                severity="low",
                category="Poor Practice",
                domain="quality",
                confidence=0.9,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_todo_comment(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []
    pattern = re.compile(r"(?i)(?:#|//|/\*)\s*(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)")

    for index, line in enumerate(lines, start=1):
        match = pattern.search(line)
        if not match:
            continue

        note = match.group(2).strip().rstrip("*/").strip() or "no detail given"
        findings.append(
            AgentFinding(
                rule_id="unresolved_todo",
                title=f"Unresolved {match.group(1).upper()} comment",
                description=f"Outstanding work marked in code: “{note[:120]}”",
                explanation=(
                    "A marker comment records work that was deferred. Markers like this "
                    "have no owner or due date, so they tend to outlive the context that "
                    "created them."
                ),
                why_it_matters=(
                    "When the deferred work is security-relevant - as it is here, next to "
                    "a credential - the comment is an accurate description of a live risk "
                    "rather than a style nit."
                ),
                recommendation=(
                    "Convert the marker into a tracked issue with an owner, or resolve it "
                    "and delete the comment."
                ),
                severity="low",
                category="Maintainability",
                domain="quality",
                confidence=0.95,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


# ---------------------------------------------------------------------------
# Cross-file duplicate detection
# ---------------------------------------------------------------------------

WINDOW = 6


def _normalise(line: str) -> str:
    text = COMMENT_RE.sub("", line).strip()
    if not text:
        return ""
    text = STRING_RE.sub("S", text)
    text = NUMBER_RE.sub("N", text)

    def replace_identifier(match: re.Match[str]) -> str:
        word = match.group(0)
        return word if word.lower() in ALL_KEYWORDS else "ID"

    text = IDENTIFIER_RE.sub(replace_identifier, text)
    return re.sub(r"\s+", " ", text)


def _is_trivial(normalised: str) -> bool:
    return normalised in ("", "}", "{", ")", "};", "});", "ID", "return ID", "return", "else")


def detect_duplicate_blocks(files) -> list[AgentFinding]:
    """Hash sliding windows of structurally-normalised lines across all files."""

    index_map: dict[str, list[tuple[object, int, int]]] = {}

    for file in files:
        lines = file.content.splitlines()
        normalised = [(i + 1, _normalise(line)) for i, line in enumerate(lines)]
        meaningful = [(no, text) for no, text in normalised if not _is_trivial(text)]

        for start in range(0, max(0, len(meaningful) - WINDOW + 1)):
            window = meaningful[start : start + WINDOW]
            joined = "\n".join(text for _, text in window)

            if len(BRANCH_TOKENS.findall(joined)) < 2:
                continue

            digest = hashlib.sha1(joined.encode()).hexdigest()
            index_map.setdefault(digest, []).append(
                (file, window[0][0], window[-1][0])
            )

    findings: list[AgentFinding] = []
    reported_pairs: set[tuple[str, str]] = set()

    for occurrences in index_map.values():
        if len(occurrences) < 2:
            continue

        first = occurrences[0]
        for other in occurrences[1:]:
            file_a, start_a, end_a = first
            file_b, start_b, end_b = other

            if file_a.path == file_b.path and abs(start_a - start_b) < WINDOW * 2:
                continue

            pair_key = tuple(sorted([file_a.path, file_b.path]))
            if pair_key in reported_pairs:
                continue
            reported_pairs.add(pair_key)

            same_file = file_a.path == file_b.path
            findings.append(
                AgentFinding(
                    rule_id="duplicate_code",
                    title="Duplicated logic across two locations",
                    description=(
                        f"A structurally identical block appears in `{file_a.path}` "
                        f"(lines {start_a}-{end_a}) and `{file_b.path}` "
                        f"(lines {start_b}-{end_b})."
                    ),
                    explanation=(
                        "These two blocks differ only in identifier names - the control "
                        "flow, branch order and conditions are the same. That is a copy "
                        "of one rule living in two places rather than two independent "
                        "rules that happen to look alike."
                    ),
                    why_it_matters=(
                        "Duplicated rules drift. A fix or policy change applied to one "
                        "copy leaves the other on the old behaviour, and because both "
                        "look correct in isolation the divergence is usually found only "
                        "when the two disagree in production."
                        if not same_file
                        else "The same logic is repeated within one file, doubling the "
                        "places any change must be applied."
                    ),
                    recommendation=(
                        "Extract the shared logic into a single function and import it "
                        "in both places, keeping one source of truth for the rule."
                    ),
                    suggested_fix=(
                        "// shared/access.js\n"
                        "export function canAccessResource(user, resource) {\n"
                        "  if (!user) return false;\n"
                        '  if (user.role === "admin" || user.role === "owner") return true;\n'
                        "  if (resource.ownerId === user.id) return true;\n"
                        "  return Boolean(resource.sharedWith?.includes(user.id));\n"
                        "}"
                    ),
                    severity="medium",
                    category="Duplicated Code",
                    domain="quality",
                    confidence=0.8,
                    agent_type=AGENT,
                    file_path=file_a.path,
                    line_number=start_a,
                    code_start_line=start_a,
                    code_end_line=end_a,
                    related_file_path=file_b.path,
                    related_line_number=start_b,
                )
            )
            break

    return findings


QUALITY_RULES = (
    rule_complexity,
    rule_long_parameter_list,
    rule_bare_except,
    rule_mutable_default,
    rule_null_reference,
    rule_debug_statement,
    rule_todo_comment,
)
