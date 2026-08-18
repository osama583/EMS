"""Connection check. Reports outcome without ever echoing the DSN or password."""
from __future__ import annotations

import pathlib
import sys
from urllib.parse import urlparse

# Runnable directly (scripts/check_db.py) as well as via -m, so put the project
# root on the path rather than depending on the caller's cwd.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import config


def main() -> int:
    try:
        config.validate()
    except RuntimeError as exc:
        print(f"CONFIG FAIL: {exc}")
        return 1

    parsed = urlparse(config.database_url)
    if parsed.password and parsed.password.upper().strip("[]") in {"YOUR-PASSWORD", "PASSWORD"}:
        print("CONFIG FAIL: DATABASE_URL still contains the [YOUR-PASSWORD] placeholder.")
        return 1

    print(f"target: {parsed.hostname}:{parsed.port}  db={(parsed.path or '').lstrip('/')}  user={parsed.username}")
    print(f"supabase service key present: {bool(config.supabase_service_key)}")

    try:
        import psycopg2

        conn = psycopg2.connect(config.database_url, connect_timeout=15)
    except Exception as exc:
        # Print the exception type and message only; psycopg2 never puts the
        # password in either.
        print(f"CONNECT FAIL: {type(exc).__name__}: {str(exc).strip()}")
        return 1

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT version(), current_database(), current_user")
            version, database, user = cur.fetchone()
            cur.execute(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
            )
            table_count = cur.fetchone()[0]
            cur.execute("SELECT has_schema_privilege('public', 'CREATE')")
            can_create = cur.fetchone()[0]
    finally:
        conn.close()

    print("CONNECT OK")
    print(f"  server        : {version.split(' on ')[0]}")
    print(f"  database/user : {database} / {user}")
    print(f"  public tables : {table_count}")
    print(f"  can CREATE    : {can_create}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
