"""Configuration, loaded from the environment (never hardcoded).

Every secret arrives via .env (see .env.example). Config.validate() is called
during app creation so a missing SECRET_KEY or DATABASE_URL fails loudly at
boot instead of surfacing as a confusing 500 on the first request.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, "").strip() or default
    return [item.strip() for item in raw.split(",") if item.strip()]


def _bool(name: str) -> bool:
    """Only the literal "true" enables a flag; unset or anything else is off."""
    return os.getenv(name, "").strip().lower() == "true"


@dataclass(frozen=True)
class Config:
    env: str = os.getenv("FLASK_ENV", "production")
    secret_key: str = os.getenv("SECRET_KEY", "")

    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    database_url: str = os.getenv("DATABASE_URL", "")
    db_pool_min: int = _int("DB_POOL_MIN", 1)
    db_pool_max: int = _int("DB_POOL_MAX", 10)

    access_token_ttl_minutes: int = _int("ACCESS_TOKEN_TTL_MINUTES", 30)
    refresh_token_ttl_days: int = _int("REFRESH_TOKEN_TTL_DAYS", 14)
    bcrypt_rounds: int = _int("BCRYPT_ROUNDS", 12)

    cors_origins: list[str] = field(default_factory=lambda: _csv("CORS_ORIGINS", "http://localhost:4200"))
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:4200").rstrip("/")

    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = _int("SMTP_PORT", 587)
    smtp_username: str = os.getenv("SMTP_USERNAME", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    email_from: str = os.getenv("EMAIL_FROM", "")
    email_cc: list[str] = field(default_factory=lambda: _csv("EMAIL_CC", ""))

    ratelimit_default: str = os.getenv("RATELIMIT_DEFAULT", "300 per minute")
    ratelimit_auth: str = os.getenv("RATELIMIT_AUTH", "10 per minute")
    ratelimit_storage_uri: str = os.getenv("RATELIMIT_STORAGE_URI", "").strip() or "memory://"

    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    log_format: str = os.getenv("LOG_FORMAT", "console").lower()

    # --- AI assistant (the ai-orb widget, POST /ai/ask) ---
    # There is no AI_DATABASE_URL: the Text-to-SQL refactor removed the separate pgvector store, and
    # structured answers now come from the primary database through the normal pool.
    # The failover chain, in the order it is tried: GEMINI_API_KEY, then _2, _3, _4, ... Numbered
    # rather than comma-separated so a key can be rotated or dropped one line at a time, and read
    # by DISCOVERY rather than by a fixed list of fields - adding GEMINI_API_KEY_4 to .env is the
    # whole of the change, with nothing here or in ai/gemini.py to remember to widen. The scan
    # stops at the first gap, so a commented-out _3 does not silently orphan a live _4.
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_api_key_2: str = os.getenv("GEMINI_API_KEY_2", "")
    gemini_api_key_3: str = os.getenv("GEMINI_API_KEY_3", "")

    # --- Demo login picker (TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)) ---
    # Gates GET /auth/dev-users. Off by default; a deployed environment that never sets DEMO_MODE
    # serves nothing from that route regardless of what else is misconfigured.
    demo_mode: bool = _bool("DEMO_MODE")
    demo_password: str = os.getenv("DEMO_PASSWORD", "")

    @property
    def is_development(self) -> bool:
        return self.env == "development"

    @property
    def gemini_api_keys(self) -> tuple[str, ...]:
        """Every configured key, primary first - the exact order ai/gemini.py fails over in.

        Discovered from the environment rather than assembled from the fields above, so a fourth
        key needs no code change at all. Blanks are skipped and the scan stops at the first gap, so
        `GEMINI_API_KEY_3` commented out while `_4` is live reads as "two keys", not as a silent
        third that nobody notices is missing. Duplicates are dropped: the same key twice is not a
        failover, it is one exhausted quota tried twice."""
        keys: list[str] = []
        index = 1
        while True:
            suffix = "" if index == 1 else f"_{index}"
            value = os.getenv(f"GEMINI_API_KEY{suffix}", "").strip()
            if not value:
                break
            if value not in keys:
                keys.append(value)
            index += 1
        return tuple(keys)

    @property
    def ai_enabled(self) -> bool:
        """The assistant is available iff a Gemini key is configured. Deliberately a derived
        property rather than its own AI_ENABLED flag: a deployment with the flag on and no key
        would fail on the first question instead of at the endpoint's own guard, which is a
        confusing 500 rather than the clear "not configured on this server" it should be."""
        return bool(self.gemini_api_key)

    def validate(self) -> None:
        missing = [
            name
            for name, value in (("SECRET_KEY", self.secret_key), ("DATABASE_URL", self.database_url))
            if not value
        ]
        if missing:
            raise RuntimeError(
                f"Missing required environment variable(s): {', '.join(missing)}. "
                "Copy backend/.env.example to backend/.env and fill them in."
            )
        if len(self.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must be at least 32 characters.")


config = Config()
