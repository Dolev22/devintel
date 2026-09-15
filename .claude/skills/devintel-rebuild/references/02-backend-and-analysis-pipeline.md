# Backend & the Multi-Agent Analysis Pipeline

## Pipeline shape (fixed — don't redesign this)

```
Repository Preparation → Code Analysis Agent + Security Agent (parallel)
                       → Review / Developer Intelligence Agent
                       → Final Report → Database
```

- **Orchestrator** coordinates only — it never analyzes code itself.
- **Code Analysis Agent** — bugs, code smells, complexity, duplication,
  maintainability.
- **Security Agent** — injection, hardcoded secrets, auth flaws, insecure
  patterns (OWASP Top 10 grounded).
- **Review / Developer Intelligence Agent** — deduplicates raw findings,
  validates/adjusts severity & confidence, prioritizes, computes a health
  score, writes the report summary + recommendations, and incorporates
  developer feedback on individual findings.

Both Code Analysis and Security agents check an `llm_enabled()` flag and
either call Claude or fall back to local deterministic rule engines
(`rules_quality.py`, `rules_security.py`). **Both paths must coexist behind
the same function signature** — `run(context) -> (findings, engine)` — so
nothing has to change when Anthropic is toggled on/off (see
`03-anthropic-config.md`). Don't build the LLM path as the only path; the
heuristic path is what makes the whole system usable with zero API cost.

## Backend module layout

```
backend/app/
  main.py                  FastAPI app entrypoint, CORS, startup seed
  config.py                Settings (env vars), Anthropic kill switch
  models/__init__.py       All SQLAlchemy models, single file
  db/session.py            Engine + session factory
  db/seed.py               Idempotent demo user/repos/knowledge seeding
  auth/security.py         Password hashing, JWT create/decode
  auth/deps.py             get_current_user FastAPI dependency
  orchestrator/            The pipeline coordinator
  agents/
    base.py                AgentFinding, AnalysisContext dataclasses
    llm.py                 Claude API wrapper (complete_json, usage logging)
    code_analysis_agent.py, security_agent.py, review_agent.py
    rules_quality.py, rules_security.py   local heuristic rules
  github/
    fetcher.py             git clone wrapper (public repos, no token needed)
    prescan.py             File prioritization + secret regex pre-scan
    demo_repos.py           Fictional demo repo fixtures
  api/                     One router file per resource area, prefix="/api/..."
```

## GitHub fetch & prescan

- Plain `git clone --depth 1 <url> <temp_dir>` over HTTPS — no token needed
  for public repos. Clone into a temp dir, read files into memory, delete
  the clone immediately.
- Prescan ranks files by a complexity/risk heuristic, caps how many are sent
  to the agents (`MAX_FILES_PER_ANALYSIS`), and runs a regex pass for likely
  hardcoded secrets — **mask before storage**, never persist a full secret
  value even from a scanned target repo.
- Demo repos (fictional fixtures with deliberately planted issues) let the
  product be explored end-to-end without network access or a real GitHub
  repo. Flag them `is_demo=true`. Nothing in the agents is special-cased for
  them — they run through the exact same analyzers as a real clone.

## API layer conventions — follow this pattern for every new resource

Every ownership-scoped endpoint follows the same shape. Copy it exactly when
adding new resources (this is what the Code Review Calendar's `meetings.py`
router does):

```python
def _owned_thing(thing_id: str, user: User, db: Session) -> Thing:
    thing = db.get(Thing, thing_id)
    if thing is None or thing.user_id != user.id:
        raise HTTPException(status_code=404, detail="Thing not found.")
    return thing
```

Use **404**, not 403, when the resource exists but isn't owned by the
caller — this project consistently avoids leaking existence information.

For resources owned via another entity's ownership chain (e.g. a Finding
belongs to a Repository, which has `user_id`), resolve the owner through
that chain rather than adding a redundant, potentially-inconsistent
`user_id` column to the child table — unless the resource is *directly*
user-scoped independent of any parent (like `scheduled_meetings`), in which
case give it its own `user_id` column.

## Local heuristic engine vs. Claude API

Every `Analysis` row records which engine produced it (`engine` column:
`"llm"` or `"heuristic"`). This is how you can tell, after the fact, whether
a given historical analysis used real Claude calls or the deterministic
fallback — useful for auditing cost and for not being surprised when older
rows show `"llm"` after the kill switch was added (that's expected history,
not a bug to "fix").
