"""Vercel serverless entry point (project-root api/ — Vercel's zero-config
Python Functions convention).

Vercel auto-detects an ASGI app named `app` in any api/*.py file. This
re-exports the existing FastAPI app from backend/app/main.py unchanged — no
application code is modified. vercel.json rewrites every /api/* request to
this one function; FastAPI's own router then dispatches by the full path,
exactly as it already does when run locally with uvicorn.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
