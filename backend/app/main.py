from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import analyses, auth, meetings, repositories, workspace
from app.config import settings
from app.db.seed import run_seed
from app.db.session import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    run_seed()
    logger.info(
        "%s ready — analysis engine: %s",
        settings.app_name,
        "Claude API" if settings.llm_enabled else "local analyzers (no ANTHROPIC_API_KEY set)",
    )
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Multi-Agent developer intelligence for GitHub repositories.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(repositories.router)
app.include_router(analyses.router)
app.include_router(workspace.router)
app.include_router(meetings.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our side. Please try again."},
    )


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": settings.app_name,
        "llm_enabled": settings.llm_enabled,
    }
