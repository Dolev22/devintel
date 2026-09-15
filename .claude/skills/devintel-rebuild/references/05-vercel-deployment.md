# Deploying to Vercel (FastAPI + Vite, one project)

This is the stage with the most non-obvious failure modes in the whole
rebuild. Follow the working configuration below directly — an earlier
attempt at this exact deployment used a different, seemingly-reasonable
approach that **deployed successfully with no errors** and was still
completely broken. Read the "What doesn't work" section so you recognize the
symptom if you hit it anyway.

## The working configuration

**1. Root-level `api/index.py`** (not nested under `backend/`):

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
```

Vercel's zero-config Python Functions convention auto-detects an ASGI app
named `app` in any `api/*.py` file — but it does **not** add `backend/` to
`sys.path` for you, so `from app.main import app` fails with
`ModuleNotFoundError: No module named 'app'` unless you insert the path
yourself first, exactly as above.

**2. `api/requirements.txt`** — a copy of `backend/requirements.txt`:

Vercel's Python builder looks for `requirements.txt` at the **project root
or next to the entry file**, not in an arbitrary subdirectory like
`backend/`. If your real dependency list lives in `backend/requirements.txt`
only, the Vercel build will "succeed" while silently installing nothing
extra, and the function will fail at import/runtime. Mirror the file (with a
comment pointing back to the source of truth) rather than moving the
original — local development still needs `backend/requirements.txt` in
place.

**3. `vercel.json`** at the project root:

```json
{
  "buildCommand": "cd frontend && npm run build",
  "installCommand": "cd frontend && npm install",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

- The first rewrite sends **every** `/api/*` request to the one Python
  function; FastAPI's own router then dispatches by the full request path,
  exactly like it does locally under `uvicorn`. Vercel's filesystem-based
  routing only maps `api/index.py` to literally `/api` by default — without
  this rewrite, `/api/auth/login` or `/api/health` would 404.
- The second rewrite is the SPA fallback for client-side routing
  (React Router). Modern Vercel rewrites check the filesystem for a real
  static asset *first* and only fall through to this rule when nothing
  matches — so it doesn't break serving the actual JS/CSS bundles.

## What doesn't work (and why it looks like it worked)

An earlier attempt used the **legacy** `builds`/`routes` array format:

```json
{
  "builds": [
    { "src": "frontend/package.json", "use": "@vercel/static-build", "config": {"distDir": "dist"} },
    { "src": "backend/api/index.py", "use": "@vercel/python" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "backend/api/index.py" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

This build **completed with no errors**, and `vercel inspect` on the
resulting deployment showed the Python function present — but the static
frontend build's output was silently dropped entirely. Every request to the
site root returned a generic `404 NOT_FOUND`. There was no error message
pointing at the cause; the only way to notice was that `vercel inspect`'s
Builds list showed just the one Python function and nothing for the static
site. If you see a Vercel deployment that reports success but serves a bare
404 for `/`, suspect exactly this: a legacy multi-`builds` config whose
static-build entry produced no visible output. The fix is to abandon the
legacy format entirely for a mixed Python+static project, in favor of the
`buildCommand`/`outputDirectory`/`rewrites` config shown above.

Separately, before that, the very first working-looking deploy used
`backend/api/index.py` (nested) with `from app.main import app` and no
`sys.path` fix — that one failed at *runtime* with a clear
`ModuleNotFoundError`, caught by hitting `/api/health` and checking
`vercel logs`. Always hit the deployed health endpoint after a deploy;
"build succeeded" is not the same as "the app works."

## Required environment variables

Set these in the Vercel project (dashboard, or `vercel env add <NAME>
production` run by the project owner in their own terminal — never paste
secret values into an AI assistant's chat or have it type them):

| Variable | Required? | Why |
|---|---|---|
| `DATABASE_URL` | **Yes** | Without it, the app falls back to a local SQLite path baked into the deployed bundle — that path is on a read-only filesystem in a Vercel Function (except `/tmp`), so the app fails to even start (`OperationalError: unable to open database file`) on the very first request that touches the DB. |
| `JWT_SECRET` | **Yes** | Falls back to an insecure hardcoded dev default otherwise — fine for local dev, not for a public deployment. |
| `ANTHROPIC_API_KEY` | No | Leave unset. The kill switch (`03-anthropic-config.md`) disables Claude regardless of whether this is set, so setting it accomplishes nothing except giving a false impression that Anthropic is "on." |

Verify what's actually set without ever printing values:
`vercel env ls production` shows names and types (`Secret`/`Plain`), never
the value itself.

## Known limitations of this deployment shape (don't try to "fix" these — they're inherent to serverless)

- **Triggering a *new* repo analysis** (the `git clone` step) is unlikely to
  complete reliably on Vercel: the `git` binary may not exist in the Python
  serverless runtime, and a background `threading.Thread` kicked off to run
  the analysis after the HTTP response returns can be frozen or killed once
  that response is sent, since serverless functions don't guarantee
  continued execution after they respond. **Reading existing data** (already
  in Postgres) works fully regardless — dashboards, reports, insights, the
  calendar are all unaffected.
- **GitHub auto-deploy on push** requires authorizing Vercel's GitHub App
  for the (possibly private) repo in a browser — this is a one-time
  account-level action only the repo owner can do; a CLI/agent can create
  and deploy the Vercel project without it, just not wire up
  push-to-deploy.
