"""Migration runner.

Applies every ``NNN_*.sql`` in this directory in filename order, once, inside a
transaction each, recording what ran in ``schema_migrations``. Re-running is a
no-op, so it is safe on every deploy.

    python -m migrations.run           # apply pending
    python -m migrations.run --status  # show what would run
    python -m migrations.run --reset   # DROP the public schema, then re-apply

--reset destroys all data and refuses to run unless FLASK_ENV=development.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import config  # noqa: E402
from app.db import get_connection, init_pool  # noqa: E402
from app.logging_setup import configure_logging  # noqa: E402

log = logging.getLogger("migrations")
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent

_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    VARCHAR(255) PRIMARY KEY,
    checksum    VARCHAR(64)  NOT NULL,
    applied_at  TIMESTAMP    NOT NULL DEFAULT now()
)
"""


def _files() -> list[pathlib.Path]:
    return sorted(p for p in MIGRATIONS_DIR.glob("*.sql") if p.stem[:3].isdigit())


def _checksum(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _applied(cur) -> dict[str, str]:
    cur.execute("SELECT filename, checksum FROM schema_migrations")
    return {row["filename"]: row["checksum"] for row in cur.fetchall()}


def status() -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(_TRACKING_TABLE)
            conn.commit()
            applied = _applied(cur)
    pending = 0
    for path in _files():
        recorded = applied.get(path.name)
        if recorded is None:
            print(f"  PENDING   {path.name}")
            pending += 1
        elif recorded != _checksum(path):
            # An applied file that has since been edited. Editing history is
            # how two environments silently diverge, so this is loud.
            print(f"  MODIFIED  {path.name}  (applied checksum differs - add a new migration instead)")
        else:
            print(f"  applied   {path.name}")
    print(f"\n{pending} pending migration(s).")
    return pending


def migrate() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(_TRACKING_TABLE)
        conn.commit()

        with conn.cursor() as cur:
            applied = _applied(cur)

        for path in _files():
            if path.name in applied:
                if applied[path.name] != _checksum(path):
                    log.warning("migration.modified_after_apply", extra={"file": path.name})
                continue
            log.info("migration.applying", extra={"file": path.name})
            try:
                with conn.cursor() as cur:
                    cur.execute(path.read_text(encoding="utf-8"))
                    cur.execute(
                        "INSERT INTO schema_migrations (filename, checksum) VALUES (%s, %s)",
                        (path.name, _checksum(path)),
                    )
                conn.commit()
                log.info("migration.applied", extra={"file": path.name})
            except Exception:
                conn.rollback()
                log.exception("migration.failed", extra={"file": path.name})
                raise


def reset() -> None:
    if not config.is_development:
        raise SystemExit("--reset is refused unless FLASK_ENV=development. This drops every table.")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        conn.commit()
    log.warning("migration.schema_reset")
    migrate()


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply EMS database migrations.")
    parser.add_argument("--status", action="store_true", help="list applied and pending migrations")
    parser.add_argument("--reset", action="store_true", help="drop and recreate the schema (development only)")
    args = parser.parse_args()

    configure_logging(config.log_level, config.log_format)
    config.validate()
    init_pool()

    if args.status:
        status()
    elif args.reset:
        reset()
    else:
        migrate()
        print("Migrations up to date.")


if __name__ == "__main__":
    main()
