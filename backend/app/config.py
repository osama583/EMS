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

    ratelimit_default: str = os.getenv("RATELIMIT_DEFAULT", "300 per minute")
    ratelimit_auth: str = os.getenv("RATELIMIT_AUTH", "10 per minute")
    ratelimit_storage_uri: str = os.getenv("RATELIMIT_STORAGE_URI", "").strip() or "memory://"

    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    log_format: str = os.getenv("LOG_FORMAT", "console").lower()

    # --- Demo login picker (TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)) ---
    # Gates GET /auth/dev-users. Off by default; a deployed environment that
    # never sets DEMO_MODE serves nothing from that route regardless of what
    # else is misconfigured.
    demo_mode: bool = os.getenv("DEMO_MODE", "").strip().lower() == "true"
    demo_password: str = os.getenv("DEMO_PASSWORD", "")

    @property
    def is_development(self) -> bool:
        return self.env == "development"

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
