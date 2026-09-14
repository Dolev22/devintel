# DevIntel — Session Handoff

**Purpose of this document:** let a fresh Claude session continue this project safely, without any memory of the prior conversation. Read this fully before making changes.

---

## 1. Project Purpose & Architecture

**DevIntel ("AI Developer Intelligence")** is a Multi-Agent Team MVP that analyzes a GitHub repository and produces a structured developer intelligence report covering **bug detection, code quality, and security** — automating the manual first-pass review a senior engineer would do by hand.

Core pipeline (unchanged since design, do not redesign):

```
Repository Preparation → Code Analysis Agent + Security Agent (parallel) → Review / Developer Intelligence Agent → Final Report → Database
```

- **Orchestrator** coordinates only — it never analyzes code itself.
- **Code Analysis Agent** — bugs, code smells, complexity, duplication, maintainability.
- **Security Agent** — injection, hardcoded secrets, auth flaws, insecure patterns (OWASP Top 10 grounded).
- **Review / Developer Intelligence Agent** — deduplicates, validates/adjusts severity & confidence, prioritizes, computes a health score, writes the final report summary + recommendations, and **incorporates user feedback** (see §3).

## 2. Tech Stack & Structure

- **Backend**: Python, FastAPI, SQLAlchemy ORM, JWT auth (PyJWT), PBKDF2-HMAC-SHA256 password hashing (stdlib `hashlib`, no bcrypt dependency).
- **Frontend**: React + Vite + TypeScript, React Router, `prism-react-renderer` for syntax-highlighted code viewing.
- **Database**: PostgreSQL via Supabase (migrated from local SQLite — see §8).

```
backend/app/
  main.py                  FastAPI app entrypoint, CORS, startup seed
  config.py                Settings (env vars), Anthropic kill switch
  models/__init__.py       All 10 SQLAlchemy models (single file)
  db/session.py            Engine + session factory
  db/seed.py               Idempotent demo user/repos/knowledge seeding
  auth/security.py         Password hashing, JWT create/decode
  auth/deps.py             get_current_user FastAPI dependency
  orchestrator/orchestrator.py   The Multi-Agent coordinator
  agents/
    base.py                AgentFinding, AnalysisContext dataclasses
    llm.py                 Claude API wrapper (complete_json, usage logging)
    code_analysis_agent.py
    security_agent.py
    review_agent.py         Consolidation + feedback re-review logic
    rules_quality.py        Local heuristic rules (bugs/quality)
    rules_security.py       Local heuristic rules (security)
  github/
    fetcher.py             git clone wrapper (public repos, no token needed)
    prescan.py             File prioritization + secret regex pre-scan
    demo_repos.py           Fictional demo repo fixtures (acme-*)
  api/
    auth.py, repositories.py, analyses.py, workspace.py
  schemas/__init__.py      Pydantic request models + serializers
frontend/src/
  pages/                   One file per product section (Dashboard, Repositories,
                            RepositoryDetail, CodeReview, Insights, InsightDetail,
                            AnalysisRuns, AnalysisRunDetail, Reports, ReportDetail,
                            Knowledge, Settings, Login)
  components/              Layout, CodeViewer, Pipeline, InsightRow,
                            AddRepositoryModal, FeedbackDialog, ui.tsx (icons/badges)
  context/AppContext.tsx   Auth/theme/direction/toast global state
  lib/api.ts, types.ts, format.ts
```

Run locally (two processes):
```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
cd frontend && npm run dev   # http://localhost:5173
```

## 3. What Has Been Implemented

- Full multi-agent pipeline, both a **Claude API path** and a **local deterministic heuristic path** (see §5).
- Auth: register/login, JWT, per-user data scoping, demo account.
- All 7 UI sections: Dashboard, Repositories, Developer Insights, Analysis Runs, Reports, Knowledge, Settings.
- **Code Review UI**: real source code with syntax highlighting, findings anchored to exact lines, inline explanations/fixes, status actions (resolved/false_positive/review_later).
- **Developer Feedback loop** (Post-MVP feature, fully implemented): every finding has an "Add Feedback" button → free-text dialog → saved to a `feedback` table linked to the finding → immediately re-evaluated by the Review Agent as **high-priority context** → finding's severity/confidence can change, with a stored verdict (e.g., "severity adjusted from Critical to High because..."). Visible in both `InsightRow` (finding list) and `InsightDetail` (full page). This has both an LLM path and a heuristic fallback path (`review_agent.py`, functions `_llm_feedback` / heuristic feedback logic near line ~440-510).
- Real end-to-end test performed once against the real Anthropic API (see §5) — cost ~$0.04, then Anthropic was explicitly disabled per user request.
- Full Supabase/Postgres migration (see §8-11).
- Row Level Security enabled and tested (see §10).

## 4. The Three Agents (detail)

| Agent | File | Input | Output |
|---|---|---|---|
| Code Analysis | `agents/code_analysis_agent.py` | Prioritized source chunks, file tree, README, test-file list | Bugs/quality `AgentFinding` list |
| Security | `agents/security_agent.py` | Same chunks + secret pre-scan hits + OWASP reference | Security `AgentFinding` list |
| Review | `agents/review_agent.py` | Both agents' raw findings | Deduplicated/prioritized findings, health score, summary, recommendations, feedback re-evaluation |

Both Code Analysis and Security agents check `llm_enabled()` (from `agents/llm.py`) and either call Claude or fall back to the rule engines in `rules_quality.py` / `rules_security.py`. **Nothing was deleted** — both paths coexist behind the same function signature (`run(context) -> (findings, engine)`).

## 5. Anthropic API Status — INTENTIONALLY DISABLED

**Current state: Anthropic calls are hard-disabled.** Do not silently re-enable this.

In `backend/app/config.py`:
```python
ANTHROPIC_DISABLED: bool = True   # <-- this line is the entire kill switch

@property
def llm_enabled(self) -> bool:
    if self.ANTHROPIC_DISABLED:
        return False
    return bool(self.anthropic_api_key)
```
This is checked by every agent before any Claude client is constructed. Even though `ANTHROPIC_API_KEY` still exists in `.env` (real key, tested working), it is **ignored** while this flag is `True`. To re-enable Anthropic: change this one line back to `return bool(self.anthropic_api_key)` — nothing else needs touching. **Do not change this unless the user explicitly asks to re-enable Anthropic.**

**Why disabled**: user ran one real, verified test (repo: `kennethreitz/records`, model `claude-haiku-4-5`, ~19.5K input / ~3.8K output tokens, ~$0.04 total, 3 real API calls) to prove real-provider connectivity for a homework requirement, then explicitly asked to stop all further Anthropic usage to avoid further cost.

Current engine in use: **local heuristic analyzers only** (`rules_quality.py`, `rules_security.py` for detection; templated summary logic in `review_agent.py` for the report). Findings from local repo `records` and the demo repos in the DB right now were produced this way (the `analyses.engine` column records `"heuristic"` or `"llm"` per run — check this column to know which engine produced any given historical row; some earlier `records` repo analyses in the DB were run with `engine="llm"` before the kill switch was added — that's expected and fine, it's historical data, not something to "fix").

## 6. GitHub Cloning & Analysis Flow

- `github/fetcher.py`: plain `git clone --depth 1 <url> <temp_dir>` over HTTPS. **No GitHub token needed** for public repos — `GITHUB_TOKEN` env var exists but is currently unused/unwired (placeholder for future private-repo support).
- After cloning: reads files into memory (skips `node_modules`, binaries, lock files, etc.), deletes the temp clone immediately.
- `github/prescan.py`: ranks files by a complexity/risk heuristic, selects top N (`MAX_FILES_PER_ANALYSIS`, default 40) files for the agents, and runs a regex pass for likely hardcoded secrets (masked before storage — full secret values are never persisted).
- Demo repos (`acme-auth-service`, `acme-payments-api`, `acme-web-dashboard`) are **not** cloned from GitHub — they're fictional fixtures in `github/demo_repos.py`, flagged `is_demo=true` in the DB, used to demonstrate realistic findings without network dependency.
- One real repo (`records`, `github.com/kennethreitz/records`) was actually cloned and analyzed for real — `is_demo=false`.

## 7. Authentication & Demo User

- Custom JWT auth (NOT Supabase Auth) — `auth/security.py` + `auth/deps.py`. Passwords hashed with PBKDF2-HMAC-SHA256 (240,000 iterations, salted), never plaintext.
- Register (`POST /api/auth/register`) and Login (`POST /api/auth/login`) both fully functional, save to the real `users` table, wrong-password returns `401 "Incorrect email or password."`.
- **Demo account** (intentionally public/non-secret, exposed via `GET /api/auth/demo-credentials` for UI prefill):
  - Email: `demo@devintel.dev`
  - Password: `demo1234`
  - This is seeded automatically on backend startup if it doesn't exist (`db/seed.py`).
  - The Login page always pre-fills these fields on every visit.
- **Important**: the demo user has **different UUIDs** in local SQLite vs Supabase (each database independently generated its own ID for it when seeded separately) — same email, different `id`. Any future cross-database work must match by email, not by ID, for this user.

## 8. Supabase Migration & Current DB Config

- **Supabase project**: `AI Developer Intelligence_DataBase`, project ref `nexciharocracdixtwxv`, region `ap-northeast-2`, Postgres 17.6.
- The app connects via **the pooler** (session mode), NOT the direct host — the direct host (`db.<ref>.supabase.co`) is **IPv6-only and unreachable** from this dev environment (confirmed: DNS resolves fine, TCP connection is refused). Always use:
  ```
  DATABASE_URL=postgresql+psycopg://postgres.nexciharocracdixtwxv:<PASSWORD>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
  ```
  Scheme **must** be `postgresql+psycopg://` (psycopg3 — `psycopg[binary]` was added to `requirements.txt` and installed; plain `postgresql://` fails with `ModuleNotFoundError: psycopg2`, since psycopg2 was never installed).
- `backend/app/config.py`: `self.database_url = os.getenv("DATABASE_URL") or default_db` — note the `or`, not a plain `getenv(..., default)`. This was a real bug fixed during this session: an **empty-but-set** `DATABASE_URL=` in `.env` does NOT fall through to the SQLite default with plain `getenv(key, default)`; only a fully-unset variable does. Do not revert this to the two-arg form.
- Local SQLite file (`backend/devintel.db`) still exists on disk as historical data but is **no longer what the app uses** once `DATABASE_URL` is set. It's not a live/synced replica — it was a one-time export source (see §11).
- Supabase MCP connector was available and used directly in this session (tools appeared under a namespace like `mcp__<uuid>__list_tables` etc. — the exact UUID is session-specific and will differ in a new session; look for tools named `list_projects`, `list_tables`, `execute_sql`, `apply_migration`, `get_advisors` from a Supabase-labeled MCP server).

## 9. Database Tables & Relationships (10 tables)

All tables live in `backend/app/models/__init__.py`. IDs are **app-generated UUID strings** (Python `uuid.uuid4()`), stored as `varchar(36)` — not native Postgres `uuid` type, and not DB-generated. Ownership chain:

```
users (root)
 ├─ user_preferences.user_id → users.id           (1:1)
 └─ repositories.user_id → users.id                (owner)
     ├─ repository_files.repository_id → repositories.id
     ├─ analyses.repository_id → repositories.id
     │   ├─ agent_runs.analysis_id → analyses.id
     │   └─ reports.analysis_id → analyses.id (unique) + reports.repository_id → repositories.id
     └─ findings.analysis_id → analyses.id  AND  findings.repository_id → repositories.id
         └─ feedback.finding_id → findings.id  +  feedback.user_id → users.id

sources   — standalone, no owner, shared knowledge-base content (OWASP/docs/guides)
```

Key non-obvious columns on `findings`: `reviewed`, `review_verdict`, `review_priority`, `corroborated_by`, `group_key` (Review Agent's consolidation output); `feedback_count`, `feedback_verdict`, `feedback_considered_at`, `pre_feedback_severity`, `pre_feedback_confidence` (feedback-loop state — `pre_feedback_*` preserves what the agents concluded before any human feedback, so the UI can show AI finding → feedback → outcome).

## 10. Row Level Security (RLS)

**Enabled on all 10 tables**, with ~20 ownership-scoped policies (migration name: `enable_rls_and_ownership_policies`, applied via Supabase MCP `apply_migration`). Pattern: `auth.uid()::text = user_id` for directly-owned tables; `EXISTS (SELECT 1 FROM repositories r WHERE r.id = X.repository_id AND r.user_id = auth.uid()::text)` for tables owned via the repository chain. `sources` is `SELECT`-only for any `authenticated` user (no ownership — shared content).

**Critical caveat — do not "fix" this, it's expected**: the app's own backend connects as Postgres role `postgres`, which has `rolbypassrls = true` (confirmed via `pg_roles` query). **Postgres exempts bypass-privileged roles from RLS entirely, by design.** This means:
- The app's actual backend traffic is **not** restricted by these policies (expected/normal for a privileged service connection).
- The policies **are** the real enforcement layer for any other access path (Supabase client SDKs, PostgREST, a future direct end-user connection).
- This was tested and proven correct by simulating the `authenticated` role directly via SQL (`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', ...)`) — a real owner sees their own data, a different/unrelated user ID sees zero rows on private tables (but still sees the shared `sources` table), and the fully-unauthenticated `anon` role sees zero rows everywhere including `sources`.
- Supabase's own security advisor (`get_advisors(type="security")`) shows **no missing-RLS-policy warnings** on any of the 10 application tables. The only advisories relate to a pre-existing Supabase platform function (`rls_auto_enable`) unrelated to this app's schema — not something this project created or should touch.

## 11. Data Migrated from Local SQLite → Supabase

Final Supabase row counts (verified via direct MCP query, matches local SQLite exactly):

| Table | Rows |
|---|---|
| users | 1 |
| user_preferences | 1 |
| repositories | 4 |
| repository_files | 19 |
| analyses | 4 |
| agent_runs | 20 |
| findings | 38 |
| feedback | 2 |
| reports | 4 |
| sources | 14 |

**How the merge worked (important — do not treat this as a simple copy)**: the demo user and the 3 demo repos (`acme-*`) already existed independently in both databases (each seeded separately, so same content but **different auto-generated IDs**). Copying them again would have created duplicates, so they were left as-is; only genuinely-missing data was added:
- The **`records` repository** (real GitHub repo, `is_demo=false`) and its entire tree — 1 repo, 8 files, 2 analyses, 10 agent_runs, 18 findings, 2 reports — copied with original IDs preserved (no collision, since Supabase had none of this).
- The **2 feedback rows** referenced findings that only existed under the *local* copies of the demo repos (different finding IDs than Supabase's independently-seeded equivalents). These were matched to the correct Supabase findings **by content** (title + file_path + line_number, verified unique matches) and their foreign keys remapped accordingly. The corresponding Supabase findings' `severity`/`pre_feedback_severity`/`feedback_verdict`/etc. columns were also updated to reflect the real feedback outcome (critical→high downgrade on both), so the data is *functionally* consistent, not just an orphaned feedback row.
- Zero orphaned foreign keys confirmed afterward via explicit LEFT JOIN checks on every relationship.
- **No data was ever deleted.** The user explicitly changed their mind mid-task and asked to preserve everything, including all demo/seed content — this was honored.

## 12. Environment Variables (names only — no values are recorded here or should ever be)

Located in `backend/.env` (git-ignored; `backend/.env.example` has placeholder names only):

| Variable | Status | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Set (real, tested working) | **Ignored** — see §5, `ANTHROPIC_DISABLED=True` overrides it |
| `ANTHROPIC_MODEL` | Set to `claude-haiku-4-5` | Cost-efficient current model; irrelevant while disabled |
| `DATABASE_URL` | Set (Supabase pooler connection string) | See §8 for exact required format |
| `JWT_SECRET` | Set | Used for session token signing |
| `JWT_EXPIRE_MINUTES` | Set | |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | Set to the public demo credentials | Not secret by design |
| `GITHUB_TOKEN` | Empty/unused | Placeholder for future private-repo support |
| `CORS_ORIGINS` | Set | Frontend origin allowlist |
| `MAX_FILES_PER_ANALYSIS`, `CLONE_TIMEOUT_SECONDS`, `STAGE_PACING_SECONDS` | Set | Tuning knobs, defaults are fine |

**Never write actual values of any of the above into this file or into chat.** If a new session needs to verify connectivity, test it programmatically (mask the password before printing, as was done throughout this session) rather than reading the raw `.env` content aloud.

## 13. Current Verified State

- ✅ Backend runs against Supabase Postgres successfully (`GET /api/health` → `{"status":"ok","llm_enabled":false}`).
- ✅ Login, dashboard, repositories, code review, insights, reports, knowledge — all confirmed working via live API calls after the Supabase migration.
- ✅ RLS enabled + policies tested correct (see §10).
- ✅ All local data present in Supabase, zero orphans.
- ✅ Anthropic fully disabled, confirmed via log inspection (no `POST https://api.anthropic.com` or `Claude usage` lines appear after the kill switch was added).
- ⚠️ The frontend (`npm run dev`, port 5173) was working throughout the session but **was not re-verified against the Supabase-backed backend specifically** in the final steps — a fresh session should do one visual smoke test in the browser before assuming the UI is fully confirmed post-migration (the API-level checks all passed).

## 14. Known Limitations / Do-Not-Change-Accidentally

- **`ANTHROPIC_DISABLED = True`** in `config.py` — do not flip this without an explicit user request; it's a deliberate cost-control decision, not a bug.
- **Direct Supabase host is unreachable** from this environment — always use the pooler host, never "fix" the connection string back to `db.<ref>.supabase.co`.
- **`postgres` role bypasses RLS** — this is normal Postgres behavior, not a security hole to "fix" by changing roles or forcing RLS; changing the app's connection role would be a significant architecture change outside this project's scope.
- **Local SQLite (`backend/devintel.db`) and Supabase are now divergent copies**, not synced. Local has the same data as of the migration snapshot; any *new* activity (new analyses, new feedback, new users) will only land in whichever database `DATABASE_URL` currently points to (Supabase). Do not assume they stay in sync.
- **Demo user has different IDs in each database** (§7) — never join/match it by ID across the two; match by email if ever needed.
- Do not reintroduce Prisma, a second ORM, or any Node-based database layer — the backend is Python/SQLAlchemy only. (This was explicitly rejected earlier when generic Supabase "Connect via Prisma" boilerplate was pasted in by mistake.)
- The three `acme-*` demo repos and their findings are **fixtures**, not real GitHub clones — don't be surprised that `is_demo=true` repos have no real GitHub activity behind them.

## 15. Exact Next Steps

Per the current homework/module flow, immediately after this handoff:
1. **User will verify this HANDOFF.md file manually.**
2. **User will explicitly confirm before any context clear happens** — do not run `/clear` or equivalent until told to.
3. Beyond that, no further task was queued at the time this document was written — check with the user for what Module/Step comes next (this session was mid-"Module 9, Step 8: Context Window Cleanup" homework at the time of writing).
