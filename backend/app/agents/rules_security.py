"""Detection rules used by the Security Agent.

Each rule returns AgentFinding objects anchored to real line numbers in the
analysed source. Guidance text is grounded in OWASP Top 10 categories.
"""

from __future__ import annotations

import re

from app.agents.base import AgentFinding

AGENT = "security"
DOMAIN = "security"

SQL_KEYWORD_RE = re.compile(
    r"(?i)\b(select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|where\s+)"
)
PY_INTERPOLATION_RE = re.compile(r"""f["'].*\{.*\}""")
CONCAT_RE = re.compile(r"""["']\s*\+\s*\w|\w\s*\+\s*["']""")
PERCENT_FORMAT_RE = re.compile(r"""["']\s*%\s*[\w(]""")
JS_TEMPLATE_RE = re.compile(r"`[^`]*\$\{[^}]+\}[^`]*`")

LOG_CALL_RE = re.compile(r"(?i)\b(logger|logging|console)\.\w+\(")
SENSITIVE_WORD_RE = re.compile(r"(?i)\b(password|passwd|secret|token|api[_-]?key|credential)\b")

SECRET_COMPARE_RE = re.compile(
    r"(?i)\b(\w*(?:token|secret|signature|password|passwd|hash|api[_-]?key)\w*)\s*==="
    r"?\s*[\w\[\]().\"']+"
)


def _line_snippet(line: str) -> str:
    return line.strip()[:200]


def _find(lines: list[str], predicate) -> list[tuple[int, str]]:
    return [(i, line) for i, line in enumerate(lines, start=1) if predicate(line)]


def rule_sql_injection(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        if not SQL_KEYWORD_RE.search(line):
            continue

        interpolated = bool(
            PY_INTERPOLATION_RE.search(line)
            or JS_TEMPLATE_RE.search(line)
            or CONCAT_RE.search(line)
            or PERCENT_FORMAT_RE.search(line)
        )
        if not interpolated:
            continue

        findings.append(
            AgentFinding(
                rule_id="sql_injection",
                title="SQL injection risk from string-built query",
                description=(
                    "A SQL statement is assembled with string interpolation or "
                    "concatenation that includes request-controlled data."
                ),
                explanation=(
                    "The query on this line is built by inserting a variable directly "
                    "into the SQL text instead of passing it as a bound parameter. The "
                    "database driver therefore cannot tell the difference between the "
                    "query the developer wrote and input supplied by the caller."
                ),
                why_it_matters=(
                    "An attacker who controls that value can close the quoted literal "
                    "and append their own SQL - reading other customers' rows, "
                    "modifying records, or dropping tables. This is OWASP A03:2021 "
                    "Injection, consistently one of the most exploited web weaknesses."
                ),
                recommendation=(
                    "Use parameterised queries and let the driver bind the values. "
                    "Never build SQL with f-strings, %, .format() or + concatenation."
                ),
                suggested_fix=(
                    'cursor.execute(\n'
                    '    "SELECT id, amount FROM payments WHERE customer_id = %s",\n'
                    '    (customer_id,),\n'
                    ')'
                ),
                severity="critical",
                category="SQL Injection",
                domain=DOMAIN,
                confidence=0.92,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_hardcoded_secret(file, lines: list[str], secret_hits) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for hit in secret_hits:
        if hit.file_path != file.path:
            continue

        specific = hit.rule_id != "generic_assignment"
        findings.append(
            AgentFinding(
                rule_id="hardcoded_secret",
                title=f"Hardcoded credential detected ({hit.label})",
                description=(
                    f"{hit.label} appears to be committed directly in the source at "
                    f"{hit.file_path}:{hit.line_number}."
                ),
                explanation=(
                    "A credential is assigned as a literal string in the source file "
                    "rather than being read from the environment or a secret manager. "
                    "Anyone with read access to the repository - including its full git "
                    "history, forks and CI logs - can recover this value."
                ),
                why_it_matters=(
                    "Committed secrets are routinely harvested by automated scanners "
                    "within minutes of a repository becoming public. Because the value "
                    "stays in git history, deleting the line in a later commit does not "
                    "revoke it. This maps to OWASP A07:2021 Identification and "
                    "Authentication Failures and A05:2021 Security Misconfiguration."
                ),
                recommendation=(
                    "Rotate this credential immediately, then load it from an "
                    "environment variable via a git-ignored .env file (or a managed "
                    "secret store in production). Add a secret scanner to CI so the "
                    "next one is caught before merge."
                ),
                suggested_fix=(
                    "import os\n\n"
                    'STRIPE_SECRET_KEY = os.environ["STRIPE_SECRET_KEY"]'
                ),
                severity="critical" if specific else "high",
                category="Hardcoded Secret",
                domain=DOMAIN,
                confidence=0.95 if specific else 0.72,
                agent_type=AGENT,
                file_path=hit.file_path,
                line_number=hit.line_number,
                code_start_line=hit.line_number,
                code_end_line=hit.line_number,
            )
        )

    return findings


def rule_command_injection(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        is_os_system = "os.system(" in stripped
        is_shell_true = "shell=True" in stripped
        is_popen = "subprocess.Popen(" in stripped and "shell=True" in stripped

        if not (is_os_system or is_shell_true or is_popen):
            continue

        # A literal-only command is far less interesting than a built one.
        dynamic = bool(CONCAT_RE.search(stripped) or PY_INTERPOLATION_RE.search(stripped))
        if is_os_system and not dynamic:
            # The command may have been built on a previous line.
            window = " ".join(lines[max(0, index - 6) : index])
            dynamic = bool(CONCAT_RE.search(window) or PY_INTERPOLATION_RE.search(window))

        findings.append(
            AgentFinding(
                rule_id="command_injection",
                title="Shell command built from untrusted input",
                description=(
                    "A shell command is executed with a dynamically assembled string, "
                    "which allows shell metacharacters to be injected."
                ),
                explanation=(
                    "This line hands a command string to the system shell. Because the "
                    "string is concatenated from variables, any shell metacharacter in "
                    "those values (;, &&, |, $(), backticks) is interpreted as part of "
                    "the command rather than as data."
                ),
                why_it_matters=(
                    "A value such as `foo; rm -rf /var/acme` would execute as a second "
                    "command with the service account's privileges, giving an attacker "
                    "arbitrary code execution on the host. OWASP A03:2021 Injection."
                ),
                recommendation=(
                    "Pass the command as an argument list and avoid the shell entirely: "
                    "subprocess.run([...], shell=False). Validate any path segment "
                    "against an allowlist before use."
                ),
                suggested_fix=(
                    "subprocess.run(\n"
                    '    ["tar", "-czf", destination, f"/var/acme/sessions/{user_id}"],\n'
                    "    shell=False,\n"
                    "    check=True,\n"
                    ")"
                ),
                severity="critical" if dynamic else "high",
                category="Command Injection",
                domain=DOMAIN,
                confidence=0.88 if dynamic else 0.6,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_unsafe_eval(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []
    pattern = re.compile(r"\b(eval|exec)\s*\(|pickle\.loads\s*\(|yaml\.load\s*\(")

    for index, line in enumerate(lines, start=1):
        if not pattern.search(line):
            continue
        if "yaml.load(" in line and "SafeLoader" in line:
            continue

        findings.append(
            AgentFinding(
                rule_id="unsafe_deserialization",
                title="Unsafe dynamic evaluation of input",
                description=(
                    "Input is evaluated or deserialised with a mechanism that can "
                    "execute arbitrary code."
                ),
                explanation=(
                    "eval, exec, pickle.loads and yaml.load all turn data into running "
                    "code. If the value reaching this line can be influenced by a user, "
                    "the process will execute whatever they supply."
                ),
                why_it_matters=(
                    "This is a direct remote code execution path - the most severe class "
                    "of web vulnerability. OWASP A08:2021 Software and Data Integrity "
                    "Failures."
                ),
                recommendation=(
                    "Replace with a safe parser: json.loads for data, yaml.safe_load for "
                    "YAML, and an explicit dispatch table instead of eval/exec."
                ),
                suggested_fix="import json\n\ndata = json.loads(raw_payload)",
                severity="critical",
                category="Unsafe Input Handling",
                domain=DOMAIN,
                confidence=0.85,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_xss(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        if "dangerouslySetInnerHTML" not in line and ".innerHTML" not in line:
            continue
        if ".innerHTML" in line and "=" not in line:
            continue

        findings.append(
            AgentFinding(
                rule_id="xss_injection",
                title="Unescaped HTML rendered from user input",
                description=(
                    "A value is injected into the DOM as raw HTML, bypassing the "
                    "framework's automatic escaping."
                ),
                explanation=(
                    "React escapes interpolated text by default, which is what stops "
                    "user content from becoming markup. dangerouslySetInnerHTML (and a "
                    "direct .innerHTML assignment) switches that protection off and "
                    "parses the string as HTML."
                ),
                why_it_matters=(
                    "If any part of that string originates from a search box, URL or API "
                    "response, an attacker can inject a script tag or event handler that "
                    "runs with the victim's session - stealing tokens or acting on their "
                    "behalf. OWASP A03:2021 Injection (Cross-Site Scripting)."
                ),
                recommendation=(
                    "Render the value as text and build the emphasis with JSX elements. "
                    "If raw HTML genuinely is required, sanitise it with a library such "
                    "as DOMPurify first."
                ),
                suggested_fix=(
                    "<p>\n"
                    "  <strong>{data.users.length}</strong> results for <em>{term}</em>\n"
                    "</p>"
                ),
                severity="high",
                category="Cross-Site Scripting",
                domain=DOMAIN,
                confidence=0.87,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_weak_crypto(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []
    pattern = re.compile(r"(?i)hashlib\.(md5|sha1)\s*\(|createHash\(\s*[\"'](md5|sha1)[\"']")

    for index, line in enumerate(lines, start=1):
        if not pattern.search(line):
            continue

        window = " ".join(lines[max(0, index - 5) : index + 4]).lower()
        password_related = any(
            word in window for word in ("password", "passwd", "secret", "token", "credential")
        )

        findings.append(
            AgentFinding(
                rule_id="weak_password_hash",
                title="Weak hash algorithm used for credentials"
                if password_related
                else "Weak hash algorithm in use",
                description=(
                    "MD5/SHA-1 is used where a modern, deliberately slow password hash "
                    "is required."
                ),
                explanation=(
                    "MD5 and SHA-1 are fast, general-purpose digests with practical "
                    "collision attacks. Being fast is exactly the wrong property for "
                    "password storage: commodity hardware computes billions of these "
                    "hashes per second."
                ),
                why_it_matters=(
                    "If the user table leaks, unsalted MD5 hashes of common passwords "
                    "are recovered essentially instantly from rainbow tables. OWASP "
                    "A02:2021 Cryptographic Failures."
                ),
                recommendation=(
                    "Migrate to bcrypt, scrypt or Argon2id with a per-user salt. Re-hash "
                    "each legacy password on the user's next successful login."
                ),
                suggested_fix=(
                    "import bcrypt\n\n"
                    "def hash_password(password: str) -> str:\n"
                    "    return bcrypt.hashpw(\n"
                    "        password.encode(), bcrypt.gensalt()\n"
                    "    ).decode()"
                ),
                severity="high" if password_related else "medium",
                category="Weak Cryptography",
                domain=DOMAIN,
                confidence=0.9 if password_related else 0.65,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_disabled_verification(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        tls_off = "verify=False" in stripped.replace(" ", "") or "rejectUnauthorized:false" in stripped.replace(" ", "")
        jwt_off = (
            "verify_signature" in stripped and "False" in stripped
        ) or 'algorithms=["none"]' in stripped.replace(" ", "")

        if not (tls_off or jwt_off):
            continue

        if jwt_off:
            findings.append(
                AgentFinding(
                    rule_id="jwt_signature_not_verified",
                    title="JWT accepted without verifying its signature",
                    description=(
                        "A JSON Web Token is decoded with signature verification "
                        "explicitly disabled."
                    ),
                    explanation=(
                        "Decoding a JWT without verification only base64-decodes the "
                        "payload. The claims inside - including the user id and role - "
                        "are read as-is, with no proof that this service issued them."
                    ),
                    why_it_matters=(
                        "Anyone can craft a token with any `sub` and `role` they like and "
                        "be trusted as that user, including as an administrator. This is "
                        "a complete authentication bypass. OWASP A07:2021."
                    ),
                    recommendation=(
                        "Always verify the signature with the expected algorithm and "
                        "issuer. Never ship verify_signature=False outside a unit test."
                    ),
                    suggested_fix=(
                        "jwt.decode(\n"
                        "    token,\n"
                        "    SIGNING_KEY,\n"
                        '    algorithms=["HS256"],\n'
                        ")"
                    ),
                    severity="critical",
                    category="Broken Authentication",
                    domain=DOMAIN,
                    confidence=0.94,
                    agent_type=AGENT,
                    file_path=file.path,
                    line_number=index,
                    code_start_line=index,
                    code_end_line=index,
                )
            )
        else:
            findings.append(
                AgentFinding(
                    rule_id="tls_verification_disabled",
                    title="TLS certificate verification disabled",
                    description=(
                        "An outbound HTTPS request is made with certificate validation "
                        "turned off."
                    ),
                    explanation=(
                        "Passing verify=False tells the HTTP client to accept any "
                        "certificate, including one presented by a machine in the middle "
                        "of the connection."
                    ),
                    why_it_matters=(
                        "The encryption still happens, but there is no longer any proof "
                        "of who is on the other end, so credentials and profile data in "
                        "this request can be intercepted and modified. OWASP A02:2021."
                    ),
                    recommendation=(
                        "Remove verify=False. If the internal service uses a private CA, "
                        "point the client at that CA bundle instead of disabling checks."
                    ),
                    suggested_fix=(
                        "requests.get(\n"
                        '    f"https://internal.acme.dev/profiles/{user_id}",\n'
                        '    verify="/etc/ssl/acme-internal-ca.pem",\n'
                        "    timeout=10,\n"
                        ")"
                    ),
                    severity="high",
                    category="Insecure Transport",
                    domain=DOMAIN,
                    confidence=0.9,
                    agent_type=AGENT,
                    file_path=file.path,
                    line_number=index,
                    code_start_line=index,
                    code_end_line=index,
                )
            )

    return findings


def rule_sensitive_logging(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        if not LOG_CALL_RE.search(line):
            continue
        if not SENSITIVE_WORD_RE.search(line):
            continue

        findings.append(
            AgentFinding(
                rule_id="sensitive_data_logged",
                title="Credential written to application logs",
                description="A log statement includes a password, token or secret value.",
                explanation=(
                    "This log call interpolates a sensitive value into the log message. "
                    "Application logs are typically shipped to a central aggregator and "
                    "retained for months, and are readable by a much wider group than "
                    "the production database."
                ),
                why_it_matters=(
                    "Plaintext credentials in logs turn a routine log export, a support "
                    "screenshot or a compromised logging account into a full credential "
                    "breach. OWASP A09:2021 Security Logging and Monitoring Failures."
                ),
                recommendation=(
                    "Log the identifier and the outcome only, never the credential. "
                    "Add a log filter that redacts known sensitive field names."
                ),
                suggested_fix='logger.info("login attempt email=%s outcome=%s", email, outcome)',
                severity="high",
                category="Sensitive Data Exposure",
                domain=DOMAIN,
                confidence=0.86,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


def rule_timing_unsafe_compare(file, lines: list[str]) -> list[AgentFinding]:
    findings: list[AgentFinding] = []

    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if "==" not in stripped or "!=" in stripped:
            continue
        if not SENSITIVE_WORD_RE.search(stripped):
            continue
        if stripped.startswith(("#", "//", "*")):
            continue
        if "hashlib" in stripped or "compare_digest" in stripped:
            continue

        findings.append(
            AgentFinding(
                rule_id="timing_unsafe_comparison",
                title="Secret compared with a non-constant-time operator",
                description=(
                    "A token, signature or password is compared using ==, which returns "
                    "as soon as the first differing byte is found."
                ),
                explanation=(
                    "String equality short-circuits: comparing a wrong value that shares "
                    "a longer prefix with the real secret takes measurably more time. "
                    "Repeated timing measurements let an attacker recover the secret one "
                    "byte at a time."
                ),
                why_it_matters=(
                    "For a webhook signature or session token this converts an "
                    "unguessable secret into one that can be derived with a few thousand "
                    "requests, defeating the check entirely. OWASP A02:2021."
                ),
                recommendation=(
                    "Compare secrets with a constant-time function such as "
                    "hmac.compare_digest (Python) or crypto.timingSafeEqual (Node)."
                ),
                suggested_fix=(
                    "import hmac\n\n"
                    "if hmac.compare_digest(signature, settings.webhook_token):\n"
                    "    ..."
                ),
                severity="medium",
                category="Broken Authentication",
                domain=DOMAIN,
                confidence=0.68,
                agent_type=AGENT,
                file_path=file.path,
                line_number=index,
                code_start_line=index,
                code_end_line=index,
            )
        )

    return findings


SECURITY_RULES = (
    rule_sql_injection,
    rule_command_injection,
    rule_unsafe_eval,
    rule_xss,
    rule_weak_crypto,
    rule_disabled_verification,
    rule_sensitive_logging,
    rule_timing_unsafe_compare,
)
