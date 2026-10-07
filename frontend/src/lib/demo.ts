// Portfolio demo: answers the app's /api/* calls from a small mock dataset kept
// in this browser only. Nothing here talks to the real backend or database.

import type {
  AgentRun,
  Analysis,
  Feedback,
  Finding,
  KnowledgeSource,
  Meeting,
  Preferences,
  Report,
  Repository,
  Severity,
  User,
} from "./types";

const FLAG_KEY = "devintel_demo";
const STATE_KEY = "devintel_demo_state";
const STATE_VERSION = 1;

function detectDemo(): boolean {
  const onDemoPath = window.location.pathname.replace(/\/+$/, "") === "/demo";
  try {
    if (onDemoPath) sessionStorage.setItem(FLAG_KEY, "1");
    return sessionStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return onDemoPath;
  }
}

let demoActive = detectDemo();

export function isDemo(): boolean {
  return demoActive;
}

export function exitDemo() {
  demoActive = false;
  try {
    sessionStorage.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
}

export class DemoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface DemoFile {
  id: string;
  repository_id: string;
  path: string;
  language: string;
  content: string;
}

interface DemoState {
  version: number;
  user: User;
  preferences: Preferences;
  repositories: Repository[];
  files: DemoFile[];
  analyses: Analysis[];
  findings: Finding[];
  feedback: Feedback[];
  meetings: Meeting[];
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

function iso(daysFromNow = 0, hour?: number): string {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  if (hour !== undefined) date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

const SESSION_PY = [
  "import hashlib",
  "import sqlite3",
  "",
  'JWT_SECRET = "EXAMPLE-not-a-real-secret"',
  "",
  "",
  "def find_user(conn: sqlite3.Connection, email: str):",
  "    query = f\"SELECT id, email, password_hash FROM users WHERE email = '{email}'\"",
  "    return conn.execute(query).fetchone()",
  "",
  "",
  "def hash_password(password: str) -> str:",
  "    return hashlib.md5(password.encode()).hexdigest()",
  "",
  "",
  "def login(conn, email, password):",
  "    user = find_user(conn, email)",
  "    try:",
  "        if user[2] == hash_password(password):",
  '            return {"user_id": user[0]}',
  "    except Exception:",
  "        pass",
  "    return None",
].join("\n");

const RETRY_PY = [
  "import time",
  "",
  "",
  "def retry(operation, attempts=3, delay=1, history=[]):",
  "    for attempt in range(attempts):",
  "        try:",
  "            return operation()",
  "        except Exception as error:",
  "            history.append(str(error))",
  "            time.sleep(delay)",
  "    return None",
].join("\n");

const CHARGE_PY = [
  "import os",
  "import subprocess",
  "",
  "import requests",
  "",
  "",
  'def charge(card_token, amount, currency="usd"):',
  "    total = amount * 1.17",
  "    response = requests.post(",
  '        os.environ["GATEWAY_URL"],',
  '        json={"token": card_token, "amount": total, "currency": currency},',
  "        verify=False,",
  "    )",
  "    return response.json()",
  "",
  "",
  "def export_invoice(invoice_id):",
  '    subprocess.run(f"./bin/export-invoice {invoice_id}", shell=True)',
].join("\n");

const USER_CARD_TSX = [
  'import { useEffect, useState } from "react";',
  "",
  "export function UserCard({ userId }: { userId: string }) {",
  "  const [user, setUser] = useState<any>(null);",
  "",
  "  useEffect(() => {",
  "    fetch(`/api/users/${userId}`)",
  "      .then((res) => res.json())",
  "      .then(setUser);",
  "  }, []);",
  "",
  "  if (!user) return null;",
  "",
  "  return (",
  '    <div className="user-card">',
  "      <h3>{user.name}</h3>",
  "      <div dangerouslySetInnerHTML={{ __html: user.bio }} />",
  "    </div>",
  "  );",
  "}",
].join("\n");

function seedFinding(
  id: string,
  repositoryId: string,
  filePath: string,
  line: number,
  severity: Severity,
  domain: Finding["domain"],
  category: string,
  confidence: number,
  title: string,
  description: string,
  whyItMatters: string,
  recommendation: string,
  suggestedFix: string
): Finding {
  return {
    id,
    analysis_id: "",
    repository_id: repositoryId,
    repository_name: null,
    agent_type: domain === "security" ? "security" : "code_analysis",
    rule_id: `${domain}.${category}`,
    title,
    description,
    explanation: description,
    why_it_matters: whyItMatters,
    recommendation,
    suggested_fix: suggestedFix,
    severity,
    category,
    domain,
    confidence,
    file_path: filePath,
    line_number: line,
    code_start_line: Math.max(1, line - 2),
    code_end_line: line + 2,
    related_file_path: null,
    related_line_number: null,
    status: "open",
    status_note: null,
    status_changed_at: null,
    reviewed: true,
    review_verdict: "Confirmed by the Review Agent.",
    review_priority: SEVERITIES.indexOf(severity) + 1,
    original_severity: severity,
    original_confidence: confidence,
    merged_count: 1,
    corroborated_by: null,
    group_key: `${category}:${filePath}`,
    created_at: iso(-1),
    feedback_count: 0,
    feedback_verdict: null,
    feedback_considered_at: null,
    pre_feedback_severity: null,
    pre_feedback_confidence: null,
  };
}

function seedAnalysis(id: string, repositoryId: string, daysAgo: number): Analysis {
  return {
    id,
    repository_id: repositoryId,
    repository_name: null,
    repository_language: null,
    status: "completed",
    current_stage: "report",
    summary: null,
    error_message: null,
    files_analyzed: 0,
    loc_analyzed: 0,
    duration_ms: 6400,
    engine: "heuristic",
    created_at: iso(-daysAgo),
    started_at: iso(-daysAgo),
    completed_at: iso(-daysAgo),
    findings_count: 0,
    has_report: true,
  };
}

function seedRepository(
  id: string,
  name: string,
  language: string,
  description: string
): Repository {
  return {
    id,
    name,
    owner: "acme",
    github_url: `https://github.com/acme/${name}`,
    description,
    language,
    branch: "main",
    is_demo: true,
    health_score: null,
    file_count: 0,
    loc_count: 0,
    created_at: iso(-7),
    last_analyzed_at: null,
  };
}

function seedState(): DemoState {
  const auth = "app/auth/session.py";
  const retry = "app/utils/retry.py";
  const charge = "payments/charge.py";
  const card = "src/components/UserCard.tsx";

  return {
    version: STATE_VERSION,
    user: {
      id: "demo-user",
      name: "Demo Visitor",
      email: "demo@devintel.dev",
      created_at: iso(-7),
    },
    preferences: {
      theme: "dark",
      direction: "ltr",
      language: "en",
      run_code_analysis: true,
      run_security: true,
      min_severity: "low",
      min_confidence: 0.5,
      max_files_per_analysis: 40,
      notify_on_complete: true,
      notify_on_critical: true,
      notify_weekly_digest: false,
      updated_at: iso(),
    },
    repositories: [
      seedRepository("r1", "acme-auth-service", "Python", "Login and session service."),
      seedRepository("r2", "acme-payments-api", "Python", "Card charging and invoicing API."),
      seedRepository(
        "r3",
        "acme-web-dashboard",
        "TypeScript",
        "Customer dashboard. Not analyzed yet — run an analysis to see the pipeline."
      ),
    ],
    files: [
      { id: "f1", repository_id: "r1", path: auth, language: "python", content: SESSION_PY },
      { id: "f2", repository_id: "r1", path: retry, language: "python", content: RETRY_PY },
      { id: "f3", repository_id: "r2", path: charge, language: "python", content: CHARGE_PY },
      { id: "f4", repository_id: "r3", path: card, language: "tsx", content: USER_CARD_TSX },
    ],
    analyses: [seedAnalysis("a1", "r1", 3), seedAnalysis("a2", "r2", 1)],
    findings: [
      seedFinding(
        "fd1", "r1", auth, 8, "critical", "security", "injection", 0.95,
        "SQL injection in user lookup",
        "The email value is interpolated straight into the SQL string.",
        "An attacker can read or modify any row in the users table by crafting the email field.",
        "Use a parameterized query instead of string formatting.",
        'conn.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,))'
      ),
      seedFinding(
        "fd2", "r1", auth, 4, "high", "security", "secrets", 0.9,
        "Hardcoded signing secret",
        "The JWT signing secret is a string literal in source code.",
        "Anyone with read access to the repository can forge session tokens.",
        "Load the secret from an environment variable and rotate the current value.",
        'JWT_SECRET = os.environ["JWT_SECRET"]'
      ),
      seedFinding(
        "fd3", "r1", auth, 13, "high", "security", "cryptography", 0.92,
        "Passwords hashed with MD5",
        "MD5 is fast and unsalted, so stored hashes can be cracked offline.",
        "A database leak would expose most user passwords within hours.",
        "Use a slow, salted password hash such as PBKDF2, bcrypt or argon2.",
        'hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 240_000)'
      ),
      seedFinding(
        "fd4", "r1", auth, 21, "medium", "bug", "error_handling", 0.8,
        "Exception swallowed during login",
        "A bare except hides every error, including a missing user row.",
        "Real failures look like a wrong password, which makes outages hard to diagnose.",
        "Check for a missing user explicitly and let unexpected errors surface.",
        "if user is None:\n    return None"
      ),
      seedFinding(
        "fd5", "r1", retry, 4, "medium", "bug", "bug_risk", 0.85,
        "Mutable default argument",
        "The history list is created once and shared by every call to retry().",
        "Errors from unrelated calls accumulate in the same list and leak memory.",
        "Default to None and create the list inside the function.",
        "def retry(operation, attempts=3, delay=1, history=None):\n    history = history if history is not None else []"
      ),
      seedFinding(
        "fd6", "r1", retry, 11, "low", "quality", "maintainability", 0.7,
        "Retry failure returns None silently",
        "After the last attempt the function returns None instead of raising.",
        "Callers cannot tell a failed operation from one that legitimately returned None.",
        "Re-raise the last error once all attempts are used.",
        "raise RuntimeError(history[-1])"
      ),
      seedFinding(
        "fd7", "r2", charge, 18, "critical", "security", "injection", 0.94,
        "Command injection in invoice export",
        "invoice_id is placed into a shell command run with shell=True.",
        "A crafted invoice id runs arbitrary commands on the payments server.",
        "Pass the arguments as a list and drop shell=True.",
        'subprocess.run(["./bin/export-invoice", str(invoice_id)], check=True)'
      ),
      seedFinding(
        "fd8", "r2", charge, 12, "high", "security", "transport_security", 0.93,
        "TLS certificate verification disabled",
        "verify=False turns off certificate checks for the payment gateway call.",
        "Card tokens can be intercepted by anyone able to sit between the API and the gateway.",
        "Remove verify=False so certificates are validated.",
        "requests.post(url, json=payload, timeout=10)"
      ),
      seedFinding(
        "fd9", "r2", charge, 8, "medium", "bug", "bug_risk", 0.82,
        "Money calculated with floating point",
        "Multiplying the amount by 1.17 as a float introduces rounding errors.",
        "Charged totals can differ from invoiced totals by a cent.",
        "Use Decimal, or integer minor units, for all money arithmetic.",
        'total = (Decimal(amount) * Decimal("1.17")).quantize(Decimal("0.01"))'
      ),
      seedFinding(
        "fd10", "r2", charge, 9, "low", "quality", "reliability", 0.75,
        "HTTP request has no timeout",
        "requests.post is called without a timeout.",
        "A slow gateway can hang the worker indefinitely.",
        "Pass an explicit timeout.",
        "requests.post(url, json=payload, timeout=10)"
      ),
      seedFinding(
        "fd11", "r3", card, 17, "high", "security", "xss", 0.9,
        "Unsanitized HTML rendered from user data",
        "user.bio is injected with dangerouslySetInnerHTML.",
        "A user can store a script in their bio that runs in other users' sessions.",
        "Render the bio as text, or sanitize it before injecting.",
        "<p>{user.bio}</p>"
      ),
      seedFinding(
        "fd12", "r3", card, 10, "medium", "bug", "react_hooks", 0.85,
        "Effect is missing the userId dependency",
        "The effect reads userId but its dependency list is empty.",
        "The card keeps showing the first user when the prop changes.",
        "Add userId to the dependency array.",
        "}, [userId]);"
      ),
      seedFinding(
        "fd13", "r3", card, 4, "low", "quality", "type_safety", 0.7,
        "Component state typed as any",
        "useState<any> removes type checking for every field read from user.",
        "Typos and missing fields are only found at runtime.",
        "Declare a User type and use it for the state.",
        "const [user, setUser] = useState<User | null>(null);"
      ),
    ],
    feedback: [],
    meetings: [
      {
        id: "m1",
        title: "Review: SQL injection in user lookup",
        repository_id: "r1",
        repository_name: "acme-auth-service",
        finding_id: "fd1",
        finding_title: "SQL injection in user lookup",
        report_id: null,
        report_title: null,
        scheduled_at: iso(2, 10),
        timezone: "UTC",
        participants: "Backend team",
        notes: "Agree on the parameterized-query fix and a regression test.",
        status: "scheduled",
        created_at: iso(),
        updated_at: iso(),
      },
    ],
  };
}

const SOURCES: KnowledgeSource[] = [
  {
    id: "s1",
    name: "OWASP Top 10 — Injection",
    type: "security_guideline",
    url: "https://owasp.org/Top10/",
    description: "How injection flaws arise and how to prevent them.",
    category: "Security",
    tags: ["owasp", "injection", "sql"],
    body: "Never build queries or shell commands by concatenating untrusted input. Use parameterized queries and argument lists.",
    order_index: 1,
  },
  {
    id: "s2",
    name: "OWASP Top 10 — Cryptographic Failures",
    type: "security_guideline",
    url: "https://owasp.org/Top10/",
    description: "Weak hashing, missing TLS validation and exposed secrets.",
    category: "Security",
    tags: ["owasp", "crypto", "secrets"],
    body: "Store passwords with a slow, salted hash. Keep secrets out of source code. Always validate TLS certificates.",
    order_index: 2,
  },
  {
    id: "s3",
    name: "Error handling guidelines",
    type: "guide",
    url: null,
    description: "When to catch, when to re-raise.",
    category: "Code Quality",
    tags: ["errors", "reliability"],
    body: "Catch only the exceptions you can handle. A bare except that passes hides real failures.",
    order_index: 3,
  },
  {
    id: "s4",
    name: "React hooks dependency rules",
    type: "docs",
    url: "https://react.dev/reference/react/useEffect",
    description: "Why every value an effect reads belongs in its dependency list.",
    category: "Code Quality",
    tags: ["react", "hooks"],
    body: "An effect that reads a prop or state value must list it as a dependency, or it will keep using a stale value.",
    order_index: 4,
  },
  {
    id: "s5",
    name: "How the health score is calculated",
    type: "docs",
    url: null,
    description: "Scoring used by the Review Agent.",
    category: "Platform",
    tags: ["health", "scoring"],
    body: "The score starts at 100 and is reduced for each open finding, weighted by severity.",
    order_index: 5,
  },
];

let cached: DemoState | null = null;

function load(): DemoState {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as DemoState) : null;
    if (parsed && parsed.version === STATE_VERSION) {
      cached = parsed;
      return cached;
    }
  } catch {
    /* fall through to a fresh dataset */
  }
  cached = seedState();
  return cached;
}

function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(cached));
  } catch {
    /* storage unavailable — demo state stays in memory only */
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const k = key(item);
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

function severityCounts(findings: Finding[]): Record<Severity, number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  findings.forEach((f) => (counts[f.severity] += 1));
  return counts;
}

function lineCount(content: string): number {
  return content.split("\n").length;
}

function analysesOf(state: DemoState, repositoryId: string): Analysis[] {
  return state.analyses
    .filter((a) => a.repository_id === repositoryId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

// A repository's findings only become visible once it has been analyzed.
function findingsOf(state: DemoState, repositoryId: string): Finding[] {
  const latest = analysesOf(state, repositoryId)[0];
  if (!latest) return [];
  const repository = state.repositories.find((r) => r.id === repositoryId);
  return state.findings
    .filter((f) => f.repository_id === repositoryId)
    .map((f) => ({
      ...f,
      analysis_id: latest.id,
      repository_name: repository ? repository.name : null,
      feedback: state.feedback.filter((fb) => fb.finding_id === f.id),
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

function allFindings(state: DemoState): Finding[] {
  return state.repositories.flatMap((r) => findingsOf(state, r.id));
}

function healthScore(findings: Finding[]): number {
  const weights: Record<Severity, number> = { critical: 15, high: 8, medium: 4, low: 1 };
  const penalty = findings
    .filter((f) => f.status === "open" || f.status === "review_later")
    .reduce((sum, f) => sum + weights[f.severity], 0);
  return Math.max(20, 100 - penalty);
}

function repositoryOut(state: DemoState, repository: Repository): Repository {
  const findings = findingsOf(state, repository.id);
  const runs = analysesOf(state, repository.id);
  const files = state.files.filter((f) => f.repository_id === repository.id);
  return {
    ...repository,
    health_score: runs.length ? healthScore(findings) : null,
    file_count: files.length,
    loc_count: files.reduce((sum, f) => sum + lineCount(f.content), 0),
    last_analyzed_at: runs[0] ? runs[0].completed_at : null,
    open_findings: findings.filter((f) => f.status === "open").length,
    critical_findings: findings.filter((f) => f.status === "open" && f.severity === "critical")
      .length,
    resolved_findings: findings.filter((f) => f.status === "resolved").length,
    total_findings: findings.length,
    analysis_count: runs.length,
    latest_analysis_id: runs[0] ? runs[0].id : null,
    latest_analysis_status: runs[0] ? runs[0].status : null,
  };
}

function stagesOf(analysis: Analysis, findings: Finding[]): AgentRun[] {
  const security = findings.filter((f) => f.agent_type === "security").length;
  const rows: [AgentRun["agent_type"], string, string, number][] = [
    ["preparation", "Repository Preparation", "Files prioritized for analysis", 0],
    ["code_analysis", "Code Analysis Agent", "Bugs and quality issues", findings.length - security],
    ["security", "Security Agent", "Security issues", security],
    ["review", "Review Agent", "Findings deduplicated and prioritized", findings.length],
    ["report", "Final Report", "Report written", 0],
  ];
  return rows.map(([agentType, label, output, count], index) => ({
    id: `${analysis.id}-s${index}`,
    analysis_id: analysis.id,
    agent_type: agentType,
    label,
    order_index: index,
    status: "completed",
    input_summary: null,
    output_summary: output,
    error_message: null,
    findings_count: count,
    duration_ms: 900 + index * 350,
    started_at: analysis.started_at,
    completed_at: analysis.completed_at,
  }));
}

function analysisOut(state: DemoState, analysis: Analysis): Analysis {
  const repository = state.repositories.find((r) => r.id === analysis.repository_id);
  const findings = findingsOf(state, analysis.repository_id);
  const files = state.files.filter((f) => f.repository_id === analysis.repository_id);
  return {
    ...analysis,
    repository_name: repository ? repository.name : null,
    repository_language: repository ? repository.language : null,
    summary: `Simulated demo run: ${findings.length} findings across ${files.length} files.`,
    files_analyzed: files.length,
    loc_analyzed: files.reduce((sum, f) => sum + lineCount(f.content), 0),
    findings_count: findings.length,
    stages: stagesOf(analysis, findings),
    severity_counts: severityCounts(findings),
  };
}

function reportOut(state: DemoState, analysis: Analysis): Report {
  const run = analysisOut(state, analysis);
  const findings = findingsOf(state, analysis.repository_id);
  const counts = severityCounts(findings);
  return {
    id: `rep-${analysis.id}`,
    analysis_id: analysis.id,
    repository_id: analysis.repository_id,
    repository_name: run.repository_name,
    title: `${run.repository_name} — Developer Intelligence Report`,
    summary: findings.length
      ? `${findings.length} findings: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low. Address the critical and high items first.`
      : "No findings. This repository was added inside the browser demo, so no code was fetched or analyzed.",
    recommendations: findings.slice(0, 4).map((f) => f.recommendation),
    top_issues: findings.slice(0, 3).map((f) => f.title),
    category_breakdown: countBy(findings, (f) => f.category),
    severity_breakdown: counts,
    metadata: {
      files_analyzed: run.files_analyzed,
      loc_analyzed: run.loc_analyzed,
      files_skipped: 0,
      raw_findings: findings.length,
      merged_findings: 0,
      adjusted_findings: 0,
      test_files_found: 0,
      prescan_secret_hits: findings.filter((f) => f.category === "secrets").length,
      has_readme: true,
      has_dependency_manifest: true,
      agents_succeeded: ["code_analysis", "security"],
      engine: "heuristic",
    },
    health_score: healthScore(findings),
    total_findings: findings.length,
    created_at: analysis.completed_at,
    analysis_status: analysis.status,
    analysis_completed_at: analysis.completed_at,
    engine: analysis.engine,
  };
}

function fileSummary(state: DemoState, file: DemoFile) {
  const findings = findingsOf(state, file.repository_id).filter((f) => f.file_path === file.path);
  return {
    id: file.id,
    path: file.path,
    language: file.language,
    line_count: lineCount(file.content),
    size_bytes: file.content.length,
    is_test: false,
    priority_score: findings.length,
    finding_counts: { total: findings.length, ...severityCounts(findings) },
  };
}

function codeOf(file: DemoFile | undefined) {
  if (!file) return null;
  return {
    file_id: file.id,
    path: file.path,
    language: file.language,
    content: file.content,
    line_count: lineCount(file.content),
  };
}

function scheduledAt(date: string, time: string, timezone: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const inZone = new Date(guess.toLocaleString("en-US", { timeZone: timezone }));
  const inUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (inZone.getTime() - inUtc.getTime())).toISOString();
}

function notFound(what: string): never {
  throw new DemoError(`${what} not found.`, 404);
}

function handle(method: string, segments: string[], query: URLSearchParams, body: any): unknown {
  const state = load();
  const [resource, id, action, subId] = segments;
  const session = { user: state.user, preferences: state.preferences };

  if (resource === "auth") {
    if (id === "demo-credentials") return { email: state.user.email, password: "demo1234" };
    if (id === "me" && method === "PATCH") {
      Object.assign(state.user, body);
      save();
      return { user: state.user };
    }
    if (id === "me") return session;
    return { token: "demo", ...session };
  }

  if (resource === "settings") {
    if (method === "PATCH") {
      Object.assign(state.preferences, body, { updated_at: iso() });
      save();
    }
    return {
      preferences: state.preferences,
      system: {
        llm_enabled: false,
        llm_model: null,
        analysis_engine: "Local analyzers (simulated)",
        database: "Browser demo — mock data in localStorage",
        max_files_per_analysis: state.preferences.max_files_per_analysis,
        secrets_source: "None required in the demo",
      },
    };
  }

  if (resource === "knowledge") {
    return { sources: SOURCES, categories: [...new Set(SOURCES.map((s) => s.category))] };
  }

  if (resource === "dashboard") {
    const findings = allFindings(state);
    const repositories = state.repositories.map((r) => repositoryOut(state, r));
    const scored = repositories.filter((r) => r.health_score !== null);
    const byStatus = countBy(findings, (f) => f.status);
    const open = findings.filter((f) => f.status === "open");
    return {
      stats: {
        repository_count: repositories.length,
        analyses_in_progress: 0,
        critical_findings: open.filter((f) => f.severity === "critical").length,
        open_findings: open.length,
        resolved_findings: byStatus.resolved || 0,
        false_positive_findings: byStatus.false_positive || 0,
        review_later_findings: byStatus.review_later || 0,
        total_findings: findings.length,
        average_health: scored.length
          ? Math.round(scored.reduce((sum, r) => sum + (r.health_score || 0), 0) / scored.length)
          : null,
        analyses_completed: state.analyses.length,
      },
      repository_health: repositories.map((r) => ({
        id: r.id,
        name: r.name,
        language: r.language,
        health_score: r.health_score,
        last_analyzed_at: r.last_analyzed_at,
        open_findings: r.open_findings || 0,
        critical_findings: r.critical_findings || 0,
      })),
      recent_insights: open
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
        .slice(0, 6),
      recent_runs: [...state.analyses]
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .slice(0, 5)
        .map((a) => analysisOut(state, a)),
      severity_breakdown: severityCounts(open),
      domain_breakdown: countBy(open, (f) => f.domain),
    };
  }

  if (resource === "repositories") {
    if (!id) {
      if (method === "POST") {
        const match = /github\.com\/([^/\s]+)\/([^/\s#?]+)/.exec(String(body?.github_url || ""));
        if (!match) throw new DemoError("Enter a valid GitHub repository URL.", 400);
        const repository: Repository = {
          ...seedRepository(newId("r"), match[2].replace(/\.git$/, ""), "", ""),
          owner: match[1],
          github_url: `https://github.com/${match[1]}/${match[2]}`,
          description: "Added in the browser demo. No code is fetched from GitHub here.",
          language: null,
          branch: body?.branch || "main",
          is_demo: false,
          created_at: iso(),
        };
        state.repositories.unshift(repository);
        save();
        return repositoryOut(state, repository);
      }
      return state.repositories.map((r) => repositoryOut(state, r));
    }

    const repository = state.repositories.find((r) => r.id === id) || notFound("Repository");

    if (action === "analyze") {
      const analysis = { ...seedAnalysis(newId("a"), repository.id, 0), duration_ms: 4200 };
      state.analyses.push(analysis);
      save();
      return analysisOut(state, analysis);
    }

    if (action === "files") {
      const files = state.files.filter((f) => f.repository_id === repository.id);
      if (!subId) return files.map((f) => fileSummary(state, f));
      const file = files.find((f) => f.id === subId) || notFound("File");
      return {
        ...fileSummary(state, file),
        content: file.content,
        findings: findingsOf(state, repository.id).filter((f) => f.file_path === file.path),
      };
    }

    if (method === "PATCH") {
      Object.assign(repository, body);
      save();
      return repositoryOut(state, repository);
    }

    if (method === "DELETE") {
      state.repositories = state.repositories.filter((r) => r.id !== id);
      state.analyses = state.analyses.filter((a) => a.repository_id !== id);
      state.findings = state.findings.filter((f) => f.repository_id !== id);
      state.files = state.files.filter((f) => f.repository_id !== id);
      save();
      return undefined;
    }

    return {
      repository: repositoryOut(state, repository),
      analyses: analysesOf(state, repository.id).map((a) => analysisOut(state, a)),
    };
  }

  if (resource === "analyses") {
    if (!id) {
      return [...state.analyses]
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .map((a) => analysisOut(state, a));
    }
    const analysis = state.analyses.find((a) => a.id === id) || notFound("Analysis run");
    return {
      analysis: analysisOut(state, analysis),
      findings: findingsOf(state, analysis.repository_id),
      report: reportOut(state, analysis),
    };
  }

  if (resource === "reports") {
    if (!id) {
      const repositoryId = query.get("repository_id");
      return [...state.analyses]
        .filter((a) => !repositoryId || a.repository_id === repositoryId)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .map((a) => reportOut(state, a));
    }
    const analysis = state.analyses.find((a) => `rep-${a.id}` === id) || notFound("Report");
    return {
      report: reportOut(state, analysis),
      findings: findingsOf(state, analysis.repository_id),
      analysis: analysisOut(state, analysis),
    };
  }

  if (resource === "findings") {
    const findings = allFindings(state);
    if (!id) {
      const search = (query.get("search") || "").toLowerCase();
      const matches = findings.filter(
        (f) =>
          (["severity", "status", "domain", "category", "repository_id", "agent_type"] as const).every(
            (key) => !query.get(key) || f[key] === query.get(key)
          ) &&
          (!search || `${f.title} ${f.description} ${f.file_path}`.toLowerCase().includes(search))
      );
      return {
        findings: matches,
        facets: {
          severity: countBy(findings, (f) => f.severity),
          category: countBy(findings, (f) => f.category),
          domain: countBy(findings, (f) => f.domain),
          agent_type: countBy(findings, (f) => f.agent_type),
          status: countBy(findings, (f) => f.status),
        },
        total: matches.length,
      };
    }

    const stored = state.findings.find((f) => f.id === id) || notFound("Finding");
    const current = () => allFindings(state).find((f) => f.id === id) || notFound("Finding");

    if (action === "status") {
      stored.status = body.status;
      stored.status_note = body.note ?? null;
      stored.status_changed_at = iso();
      save();
      return current();
    }

    if (action === "feedback") {
      const feedback: Feedback = {
        id: newId("fb"),
        finding_id: stored.id,
        text: String(body?.text || ""),
        author_name: state.user.name,
        considered: true,
        considered_at: iso(),
        created_at: iso(),
      };
      state.feedback.push(feedback);
      stored.pre_feedback_severity = stored.pre_feedback_severity || stored.severity;
      stored.pre_feedback_confidence = stored.pre_feedback_confidence ?? stored.confidence;
      stored.feedback_count += 1;
      stored.feedback_considered_at = iso();
      stored.feedback_verdict =
        "Demo mode: feedback recorded. In the full application the Review Agent re-evaluates severity and confidence using this context.";
      save();
      return { feedback, finding: current() };
    }

    const finding = current();
    const sameRepository = findings.filter(
      (f) => f.repository_id === finding.repository_id && f.id !== finding.id
    );
    const analysis = state.analyses.find((a) => a.id === finding.analysis_id);
    return {
      finding,
      related_findings: sameRepository.filter((f) => f.file_path !== finding.file_path),
      same_file_findings: sameRepository.filter((f) => f.file_path === finding.file_path),
      code: codeOf(
        state.files.find(
          (f) => f.repository_id === finding.repository_id && f.path === finding.file_path
        )
      ),
      related_code: null,
      analysis: analysis ? analysisOut(state, analysis) : null,
    };
  }

  if (resource === "meetings") {
    if (!id) {
      if (method !== "POST") return { meetings: state.meetings };
      const repository = state.repositories.find((r) => r.id === body.repository_id);
      const finding = state.findings.find((f) => f.id === body.finding_id);
      const analysis = state.analyses.find((a) => `rep-${a.id}` === body.report_id);
      const meeting: Meeting = {
        id: newId("m"),
        title: body.title,
        repository_id: repository ? repository.id : null,
        repository_name: repository ? repository.name : null,
        finding_id: finding ? finding.id : null,
        finding_title: finding ? finding.title : null,
        report_id: analysis ? body.report_id : null,
        report_title: analysis ? reportOut(state, analysis).title : null,
        scheduled_at: scheduledAt(body.date, body.time, body.timezone),
        timezone: body.timezone,
        participants: body.participants ?? null,
        notes: body.notes ?? null,
        status: "scheduled",
        created_at: iso(),
        updated_at: iso(),
      };
      state.meetings.push(meeting);
      save();
      return meeting;
    }

    const meeting = state.meetings.find((m) => m.id === id) || notFound("Meeting");
    if (action === "cancel") {
      meeting.status = "cancelled";
    } else {
      meeting.title = body.title;
      meeting.timezone = body.timezone;
      meeting.scheduled_at = scheduledAt(body.date, body.time, body.timezone);
      meeting.participants = body.participants ?? null;
      meeting.notes = body.notes ?? null;
    }
    meeting.updated_at = iso();
    save();
    return meeting;
  }

  throw new DemoError("This action is not available in the browser demo.", 404);
}

export async function demoRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const result = handle((options.method || "GET").toUpperCase(), segments, url.searchParams, body);
  return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
}
