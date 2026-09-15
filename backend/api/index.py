"""Vercel serverless entry point.

Vercel's Python runtime auto-detects an ASGI/WSGI app named `app` in this file
and wraps it as a serverless function. This re-exports the existing FastAPI
app from app/main.py unchanged — no application code is modified.
"""

from app.main import app  # noqa: F401
