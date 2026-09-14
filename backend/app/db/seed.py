"""Idempotent seed data: the demo account, demo repositories and the knowledge base."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.config import settings
from app.db.session import SessionLocal
from app.github.demo_repos import DEMO_REPOSITORIES
from app.models import Repository, Source, User, UserPreference

logger = logging.getLogger(__name__)


KNOWLEDGE_SOURCES = [
    {
        "name": "OWASP Top 10 (2021)",
        "type": "security_guideline",
        "category": "Security",
        "url": "https://owasp.org/Top10/",
        "description": "The ten most critical web application security risks, and the reference the Security Agent reasons against.",
        "tags": "owasp,security,vulnerabilities,reference",
        "order_index": 1,
        "body": (
            "The Security Agent maps every finding it raises to one of these categories, "
            "which is why severity language in this product matches OWASP terminology.\n\n"
            "A01 Broken Access Control — authorisation that can be bypassed or is missing.\n"
            "A02 Cryptographic Failures — weak hashing, disabled TLS verification, secrets in transit.\n"
            "A03 Injection — SQL, command and LDAP injection, plus cross-site scripting.\n"
            "A04 Insecure Design — missing rate limits and unsafe trust boundaries.\n"
            "A05 Security Misconfiguration — debug flags, permissive defaults, exposed config.\n"
            "A06 Vulnerable and Outdated Components — known-vulnerable dependencies.\n"
            "A07 Identification and Authentication Failures — weak password storage, unverified tokens.\n"
            "A08 Software and Data Integrity Failures — unsafe deserialisation, eval of input.\n"
            "A09 Security Logging and Monitoring Failures — secrets in logs, no audit trail.\n"
            "A10 Server-Side Request Forgery — unvalidated outbound requests."
        ),
    },
    {
        "name": "OWASP SQL Injection Prevention Cheat Sheet",
        "type": "security_guideline",
        "category": "Security",
        "url": "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
        "description": "How to stop SQL injection properly: parameterised queries first, everything else second.",
        "tags": "sql,injection,database,a03",
        "order_index": 2,
        "body": (
            "The only reliable defence is to stop building SQL from strings.\n\n"
            "1. Use parameterised (prepared) statements everywhere. The driver sends the "
            "query and the values separately, so a value can never become syntax.\n"
            "2. Use an ORM's query builder rather than raw SQL where practical.\n"
            "3. If dynamic table or column names are unavoidable, validate them against a "
            "hardcoded allowlist — they cannot be parameterised.\n"
            "4. Input escaping and WAF rules are defence in depth, never the primary control.\n"
            "5. Apply least privilege to the database user so an exploited query cannot drop tables."
        ),
    },
    {
        "name": "OWASP Secrets Management Cheat Sheet",
        "type": "security_guideline",
        "category": "Security",
        "url": "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
        "description": "Keeping credentials out of source control, and what to do when one leaks.",
        "tags": "secrets,credentials,env,rotation",
        "order_index": 3,
        "body": (
            "A credential committed to git is compromised from the moment it lands, because "
            "it stays in history even after the line is deleted.\n\n"
            "Practices this product checks for:\n"
            "• Load secrets from environment variables, injected at runtime.\n"
            "• Keep a git-ignored .env for local development and commit only a .env.example "
            "containing placeholder names.\n"
            "• Use a managed secret store in production rather than environment files.\n"
            "• Run a secret scanner in CI so a leak is blocked before merge.\n\n"
            "If a secret does leak: rotate it first, then purge history. Rotation is the "
            "control that actually matters; history rewriting alone does not revoke access."
        ),
    },
    {
        "name": "OWASP Cross-Site Scripting Prevention",
        "type": "security_guideline",
        "category": "Security",
        "url": "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html",
        "description": "Why escaping is contextual, and when a framework's protections get switched off.",
        "tags": "xss,frontend,react,escaping",
        "order_index": 4,
        "body": (
            "Modern frameworks escape interpolated values by default. Most real XSS in "
            "React codebases comes from deliberately opting out of that protection.\n\n"
            "• dangerouslySetInnerHTML and direct .innerHTML assignment parse the string as "
            "HTML. Anything user-influenced in that string becomes markup.\n"
            "• If raw HTML is genuinely required, sanitise with a maintained library such as "
            "DOMPurify before rendering.\n"
            "• Escaping is context-sensitive: HTML body, attribute, URL and JavaScript "
            "contexts each need different treatment.\n"
            "• A Content-Security-Policy limits the damage but does not replace escaping."
        ),
    },
    {
        "name": "OWASP Password Storage Cheat Sheet",
        "type": "security_guideline",
        "category": "Security",
        "url": "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html",
        "description": "Why MD5 and SHA-1 are the wrong tool, and what to use instead.",
        "tags": "passwords,hashing,bcrypt,argon2",
        "order_index": 5,
        "body": (
            "Password hashes must be slow on purpose. General-purpose digests are fast, "
            "which is exactly what an attacker with a leaked table wants.\n\n"
            "Recommended, in order: Argon2id, scrypt, bcrypt. All three salt automatically "
            "and expose a tunable work factor.\n\n"
            "Never use MD5, SHA-1 or a bare SHA-256 for passwords. Commodity GPUs compute "
            "billions of those per second, so common passwords fall instantly.\n\n"
            "Migrating legacy hashes: re-hash each password with the new algorithm on the "
            "user's next successful login, and drop the legacy column once coverage is complete."
        ),
    },
    {
        "name": "GitHub Docs — About repositories",
        "type": "docs",
        "category": "GitHub",
        "url": "https://docs.github.com/en/repositories",
        "description": "Repository structure, branches and the metadata this system reads when preparing an analysis.",
        "tags": "github,repositories,branches",
        "order_index": 10,
        "body": (
            "Repository Preparation reads a shallow clone (depth 1) of the default or "
            "selected branch, then keeps only analysable source files.\n\n"
            "What is read: source files, README, and a dependency manifest such as "
            "requirements.txt, package.json, go.mod or pom.xml.\n\n"
            "What is skipped: node_modules, dist, build, vendor, virtualenvs, lock files, "
            "minified bundles and binary assets — they add tokens without adding signal."
        ),
    },
    {
        "name": "GitHub Docs — Secret scanning",
        "type": "docs",
        "category": "GitHub",
        "url": "https://docs.github.com/en/code-security/secret-scanning",
        "description": "GitHub's native secret scanning and push protection, complementary to this tool's pre-scan.",
        "tags": "github,secrets,scanning,ci",
        "order_index": 11,
        "body": (
            "This product's pre-scan catches credentials at analysis time. GitHub's push "
            "protection catches them earlier — at the moment of the push — which is "
            "strictly better.\n\n"
            "Enable both: push protection to block new leaks, and scheduled analysis to "
            "find the ones already in the tree. Partner patterns (Stripe, AWS, Slack and "
            "others) are also reported directly to the issuing provider for revocation."
        ),
    },
    {
        "name": "Python Docs — sqlite3 placeholders",
        "type": "docs",
        "category": "Frameworks",
        "url": "https://docs.python.org/3/library/sqlite3.html#sqlite3-placeholders",
        "description": "The official example of parameter binding, the fix for most SQL injection findings.",
        "tags": "python,sql,parameters,dbapi",
        "order_index": 20,
        "body": (
            "Python's DB-API defines placeholders so values never touch the SQL string.\n\n"
            "    cursor.execute(\n"
            "        \"SELECT id, amount FROM payments WHERE customer_id = ?\",\n"
            "        (customer_id,),\n"
            "    )\n\n"
            "Note the trailing comma — the second argument must be a sequence. psycopg "
            "and MySQL drivers use %s instead of ?, but the principle is identical: pass "
            "values as parameters, never format them into the query."
        ),
    },
    {
        "name": "React Docs — dangerouslySetInnerHTML",
        "type": "docs",
        "category": "Frameworks",
        "url": "https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html",
        "description": "React's own warning about the escape hatch that causes most React XSS.",
        "tags": "react,xss,frontend,jsx",
        "order_index": 21,
        "body": (
            "React names this prop `dangerously` deliberately. Passing a string here skips "
            "escaping entirely.\n\n"
            "Prefer composing JSX elements:\n\n"
            "    <p><strong>{count}</strong> results for <em>{term}</em></p>\n\n"
            "That renders the same output while keeping `term` as text. Reach for "
            "dangerouslySetInnerHTML only for trusted, sanitised HTML such as rendered "
            "Markdown, and sanitise it first."
        ),
    },
    {
        "name": "FastAPI — Security and dependencies",
        "type": "docs",
        "category": "Frameworks",
        "url": "https://fastapi.tiangolo.com/tutorial/security/",
        "description": "Dependency-injected auth, the pattern that keeps authorisation checks off individual handlers.",
        "tags": "fastapi,python,auth,dependencies",
        "order_index": 22,
        "body": (
            "FastAPI's dependency system lets one verified-user dependency guard every "
            "route, rather than each handler repeating its own check.\n\n"
            "This matters for the Broken Access Control findings this product raises: "
            "duplicated, hand-rolled permission logic in individual handlers is where "
            "checks get forgotten or drift apart. A single dependency is one place to "
            "audit and one place to fix."
        ),
    },
    {
        "name": "Refactoring Guru — Code Smells",
        "type": "guide",
        "category": "Code Quality",
        "url": "https://refactoring.guru/refactoring/smells",
        "description": "A catalogue of the smells the Code Analysis Agent reports, with named refactorings for each.",
        "tags": "refactoring,code-smells,maintainability",
        "order_index": 30,
        "body": (
            "Findings in the Code Quality domain map onto this catalogue:\n\n"
            "• Long Method → Extract Method. Split a function once it does more than one thing.\n"
            "• Long Parameter List → Introduce Parameter Object. Group related arguments.\n"
            "• Duplicate Code → Extract Method / Pull Up Method. One rule, one home.\n"
            "• Complex Conditional → Replace Conditional with Polymorphism, or a lookup table.\n\n"
            "The smell is a signal, not a verdict. The question to ask is whether the code "
            "will be hard to change safely — if it will not, leave it alone."
        ),
    },
    {
        "name": "Cyclomatic Complexity — what the number means",
        "type": "guide",
        "category": "Code Quality",
        "url": "https://en.wikipedia.org/wiki/Cyclomatic_complexity",
        "description": "How the complexity score in these findings is calculated and how to read it.",
        "tags": "complexity,testing,metrics",
        "order_index": 31,
        "body": (
            "Cyclomatic complexity counts the independent paths through a function: one, "
            "plus one for each branch point (if, elif, for, while, case, catch, and each "
            "&& or || in a condition).\n\n"
            "Rules of thumb used by the Code Analysis Agent:\n"
            "• 1–10 — straightforward, testable.\n"
            "• 11–20 — flagged as medium: worth splitting.\n"
            "• 20+ — flagged as high: hard to test exhaustively and a common source of regressions.\n\n"
            "The practical consequence is test count: full branch coverage needs at least "
            "as many test cases as the complexity number, so high-complexity functions are "
            "almost always under-tested."
        ),
    },
    {
        "name": "Writing meaningful error handling",
        "type": "guide",
        "category": "Code Quality",
        "url": None,
        "description": "Why a bare except is reported as a bug rather than a style issue.",
        "tags": "errors,exceptions,reliability",
        "order_index": 32,
        "body": (
            "A bare `except:` or `except Exception: pass` converts a failure into a silent "
            "success. The caller receives None, nothing is logged, and the incident is "
            "invisible until a user reports it.\n\n"
            "A handler should do at least one of: recover meaningfully, add context and "
            "re-raise, or log with enough detail to debug. If it does none of those, it "
            "should not exist — let the exception propagate.\n\n"
            "    try:\n"
            "        ...\n"
            "    except DatabaseError:\n"
            "        conn.rollback()\n"
            "        logger.exception(\"refund failed payment_id=%s\", payment_id)\n"
            "        raise"
        ),
    },
    {
        "name": "The Twelve-Factor App — Config",
        "type": "guide",
        "category": "Security",
        "url": "https://12factor.net/config",
        "description": "The principle behind storing configuration and credentials in the environment.",
        "tags": "config,env,twelve-factor,deployment",
        "order_index": 6,
        "body": (
            "Strict separation of config from code: anything that varies between "
            "deployments — credentials, connection strings, per-environment toggles — "
            "belongs in the environment, not in a committed file.\n\n"
            "The litmus test: could this repository be made public right now without "
            "leaking anything? If not, something is in the code that should be in the "
            "environment.\n\n"
            "This product follows the same rule — its own Claude API key, database URL and "
            "JWT secret are read from a git-ignored .env and are never exposed through the UI."
        ),
    },
]


def seed_knowledge(db: Session) -> int:
    created = 0
    for entry in KNOWLEDGE_SOURCES:
        existing = db.query(Source).filter(Source.name == entry["name"]).first()
        if existing:
            # Keep copy fresh without creating duplicates.
            for key, value in entry.items():
                setattr(existing, key, value)
            continue
        db.add(Source(**entry))
        created += 1
    db.commit()
    return created


def seed_demo_user(db: Session) -> User:
    user = db.query(User).filter(User.email == settings.demo_email).first()
    if user is None:
        user = User(
            name="Demo Developer",
            email=settings.demo_email,
            password_hash=hash_password(settings.demo_password),
        )
        db.add(user)
        db.flush()
        db.add(UserPreference(user_id=user.id))
        db.commit()
        logger.info("seeded demo user %s", settings.demo_email)
    elif user.preference is None:
        db.add(UserPreference(user_id=user.id))
        db.commit()
    return user


def seed_demo_repositories(db: Session, user: User) -> int:
    created = 0
    for fixture in DEMO_REPOSITORIES:
        existing = (
            db.query(Repository)
            .filter(Repository.user_id == user.id, Repository.name == fixture["name"])
            .first()
        )
        if existing:
            continue

        db.add(
            Repository(
                user_id=user.id,
                name=fixture["name"],
                owner=fixture["owner"],
                github_url=fixture["github_url"],
                description=fixture["description"],
                language=fixture["language"],
                branch=fixture["branch"],
                is_demo=True,
            )
        )
        created += 1

    db.commit()
    return created


def seed_initial_analyses(db: Session, user: User) -> int:
    """Run a real analysis for some demo repositories on first boot.

    This is the same Orchestrator the UI calls - nothing is faked. It means the
    workspace opens with populated dashboards and reports, while one repository
    is deliberately left unanalysed so the full workflow can be run by hand.
    """

    from app.models import Analysis
    from app.orchestrator import orchestrator

    if db.query(Analysis).first() is not None:
        return 0

    pre_analyzed = ("acme-payments-api", "acme-web-dashboard")
    repositories = (
        db.query(Repository)
        .filter(Repository.user_id == user.id, Repository.name.in_(pre_analyzed))
        .all()
    )

    original_pacing = orchestrator.STAGE_PACING_SECONDS
    orchestrator.STAGE_PACING_SECONDS = 0.0
    created = 0

    try:
        for repository in repositories:
            analysis = Analysis(repository_id=repository.id, status="pending")
            db.add(analysis)
            db.commit()
            try:
                orchestrator.run_analysis(analysis.id)
                created += 1
            except Exception:
                logger.exception("seed analysis failed for %s", repository.name)
    finally:
        orchestrator.STAGE_PACING_SECONDS = original_pacing

    return created


def run_seed() -> None:
    db = SessionLocal()
    try:
        knowledge_count = seed_knowledge(db)
        user = seed_demo_user(db)
        repository_count = seed_demo_repositories(db, user)
        analysis_count = seed_initial_analyses(db, user)
        if knowledge_count or repository_count or analysis_count:
            logger.info(
                "seed complete: %s knowledge sources, %s demo repositories, "
                "%s initial analyses",
                knowledge_count,
                repository_count,
                analysis_count,
            )
    finally:
        db.close()
