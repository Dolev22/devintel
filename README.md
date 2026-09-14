# DevIntel — AI Developer Intelligence Engineering

A Multi-Agent Team system that analyzes a GitHub repository and produces a structured
developer intelligence report covering **bug detection**, **code quality** and **security**.

This is the MVP implementation of the approved architecture plan.

---

## Running it

Two processes. Both must be running.

**1. Backend (port 8000)**

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

**2. Frontend (port 5173)**

```bash
cd frontend && npm run dev
```

Then open <http://localhost:5173> and sign in with the seeded demo account
(the fields are prefilled): `demo@devintel.dev` / `demo1234`.

First boot creates the SQLite database, seeds the knowledge base, adds three sample
repositories and runs two real analyses so the workspace opens with data. A third
repository is left unanalyzed so the full workflow can be run by hand.

### Fresh install

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ../frontend && npm install
```

---

## Configuration

All secrets come from environment variables loaded from a git-ignored `.env`.
Copy `backend/.env.example` to `backend/.env` and fill in what you need.
Nothing sensitive is ever hardcoded, committed, or exposed through the UI.

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | No | Runs the agents on the Claude API. Without it they use local deterministic analyzers and the pipeline still works end to end. |
| `JWT_SECRET` | Recommended | Signing key for session tokens. |
| `DATABASE_URL` | No | Defaults to local SQLite. Point at Postgres for a hosted deployment. |
| `STAGE_PACING_SECONDS` | No | Deliberate delay between pipeline stages so the Analysis Run screen is readable. Set to `0` for full speed. |

---

## The Multi-Agent pipeline

```
Repository Preparation → ┌ Code Analysis Agent ┐ → Review / Developer      → Final Report
                         └ Security Agent      ┘   Intelligence Agent
```

- **Orchestrator** (`app/orchestrator/orchestrator.py`) — coordinates only; it does not
  analyze code. Prepares context, runs the two specialised agents concurrently, hands
  their findings to the Review Agent, persists everything, tracks status.
- **Code Analysis Agent** (`app/agents/code_analysis_agent.py`) — probable bugs, complexity,
  duplication, maintainability.
- **Security Agent** (`app/agents/security_agent.py`) — injection, hardcoded secrets, auth
  flaws, insecure patterns. Carries a condensed OWASP Top 10 reference.
- **Review / Developer Intelligence Agent** (`app/agents/review_agent.py`) — deduplicates,
  validates severity and confidence, groups, prioritises, computes the health score, and
  writes the report summary and recommendations.

### Failure policy

- Repository problems fail fast, before any agent runs (no wasted LLM calls).
- One failing specialised agent does **not** fail the analysis — the Review Agent proceeds
  with the surviving findings and the report notes the partial coverage.
- If the Review Agent itself fails, raw agent findings are still persisted rather than lost.
- Per-agent and overall timeouts prevent a run from hanging.

### Two execution engines

Every agent has a Claude path and a local deterministic path behind the same interface.
With `ANTHROPIC_API_KEY` set, findings come from Claude. Without it, they come from the
rule engines in `app/agents/rules_security.py` and `app/agents/rules_quality.py`. Either
way the same Orchestrator, the same Review Agent, and the same schema are used — the
analysis records which engine produced it, and the UI shows it.

---

## Sections

| Section | Purpose |
|---|---|
| Dashboard | Repository count, analyses in progress, critical/open/resolved findings, repository health, recent insights and runs |
| Repositories | Cards or table; add, edit, delete, start an analysis, open code review |
| Developer Insights | Every finding, filterable by severity, status, domain and category |
| Analysis Runs | The five-stage pipeline visualised, with per-agent input/output |
| Reports | Health, summary, severity and category breakdown, prioritised recommendations, metadata |
| Knowledge | OWASP, GitHub docs, framework docs and code-quality guidance the agents reason against |
| Settings | Profile, theme, RTL, analysis preferences, notifications |

Dark/light themes and full RTL are supported. Code blocks stay left-to-right in RTL, since
source code is direction-independent.

---

## Sample repositories

The three `acme-*` repositories are fictional codebases with deliberately planted issues
(`backend/app/github/demo_repos.py`). They are **not** special-cased: the same analyzers
that run against a real cloned GitHub repository run against them, and every finding's
line number is computed from the code. All credentials in them are obvious fakes.

Adding a real public GitHub URL works the same way — the repository is shallow-cloned,
analyzed, and the clone is deleted immediately afterwards.

---

## Project layout

```
backend/app/
  orchestrator/   the Multi-Agent coordinator
  agents/         the four agents, their rule engines and the Claude client
  github/         clone, static pre-scan, demo fixtures
  models/         SQLAlchemy entities
  api/            FastAPI routers
frontend/src/
  pages/          one file per product section
  components/     Layout, CodeViewer, Pipeline, shared UI
```
