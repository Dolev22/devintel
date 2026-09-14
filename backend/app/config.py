"""Application configuration.

Every secret is read from the environment (loaded from a local .env file that is
git-ignored). Nothing sensitive is hardcoded here or exposed through the API/UI.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")
load_dotenv(PROJECT_DIR / ".env")


class Settings:
    def __init__(self) -> None:
        self.app_name: str = "AI Developer Intelligence"

        # SQLite by default so the MVP runs with zero infrastructure.
        # Set DATABASE_URL to a Postgres DSN to use the production target.
        default_db = f"sqlite:///{BACKEND_DIR / 'devintel.db'}"
        self.database_url: str = os.getenv("DATABASE_URL") or default_db

        self.jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-insecure-secret")
        self.jwt_algorithm: str = "HS256"
        self.jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))

        # Optional. When absent, the agents fall back to deterministic local
        # analyzers so the whole pipeline still runs end to end.
        self.anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY") or None
        # Haiku 4.5 is the current cost-efficient model, well suited to structured
        # code-review output. Override with a stronger model via ANTHROPIC_MODEL
        # if quality matters more than cost for a given deployment.
        self.anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")

        # Optional, only used to read public repo metadata / issue titles.
        self.github_token: str | None = os.getenv("GITHUB_TOKEN") or None

        self.cors_origins: list[str] = [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if o.strip()
        ]

        self.max_files_per_analysis: int = int(os.getenv("MAX_FILES_PER_ANALYSIS", "40"))
        self.max_file_bytes: int = int(os.getenv("MAX_FILE_BYTES", "120000"))
        self.clone_timeout_seconds: int = int(os.getenv("CLONE_TIMEOUT_SECONDS", "90"))
        self.agent_timeout_seconds: int = int(os.getenv("AGENT_TIMEOUT_SECONDS", "180"))

        self.demo_email: str = os.getenv("DEMO_EMAIL", "demo@devintel.dev")
        self.demo_password: str = os.getenv("DEMO_PASSWORD", "demo1234")

    # --- Anthropic kill switch --------------------------------------------
    # Explicitly disabled by request: no agent may call the Anthropic API
    # while this is True, even if a valid ANTHROPIC_API_KEY is present in
    # .env. All agents already gate every Claude call behind
    # `llm_enabled()` (see app/agents/llm.py), so flipping this one flag is
    # enough to force the entire pipeline onto the local deterministic
    # analyzers. The Anthropic integration code itself is left in place —
    # to re-enable it, set this back to `bool(self.anthropic_api_key)`.
    ANTHROPIC_DISABLED: bool = True

    @property
    def llm_enabled(self) -> bool:
        if self.ANTHROPIC_DISABLED:
            return False
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
