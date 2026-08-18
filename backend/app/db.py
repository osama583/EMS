"""PostgreSQL access: a threaded connection pool plus small query helpers.

Every statement goes through psycopg2's parameter binding (``%s`` placeholders,
never string interpolation), which is the project's primary SQL-injection
defence. Helpers deliberately take a SQL string + params tuple rather than
building SQL from caller-supplied fragments.

Transactions: a request that only reads can use query()/query_one() directly.
Anything that writes must run inside transaction(), which commits on clean exit
and rolls back on any exception, so a half-applied workflow transition can
never be left behind.
"""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool

from .config import config

log = logging.getLogger(__name__)

_pool: pg_pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def init_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            return
        _pool = pg_pool.ThreadedConnectionPool(
            minconn=config.db_pool_min,
            maxconn=config.db_pool_max,
            dsn=config.database_url,
            connect_timeout=10,
            # Supabase's pooler terminates idle connections; keepalives stop us
            # handing a dead socket to a request.
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        log.info("db.pool.initialised", extra={"minconn": config.db_pool_min, "maxconn": config.db_pool_max})


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.closeall()
            _pool = None


@contextmanager
def get_connection() -> Iterator[psycopg2.extensions.connection]:
    if _pool is None:
        init_pool()
    assert _pool is not None
    conn = _pool.getconn()
    try:
        yield conn
    finally:
        _pool.putconn(conn)


@contextmanager
def transaction() -> Iterator[psycopg2.extensions.cursor]:
    """Yield a cursor inside a transaction. Commits on success, rolls back on error."""
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise


@contextmanager
def read_cursor() -> Iterator[psycopg2.extensions.cursor]:
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                yield cur
        finally:
            # Reads still open a transaction in Postgres; end it so the pooled
            # connection does not sit "idle in transaction".
            conn.rollback()


def query(sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
    with read_cursor() as cur:
        cur.execute(sql, params or ())
        return [dict(row) for row in cur.fetchall()]


def query_one(sql: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
    with read_cursor() as cur:
        cur.execute(sql, params or ())
        row = cur.fetchone()
        return dict(row) if row else None


def fetch_all(cur: psycopg2.extensions.cursor, sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
    """Same as query() but on a caller-supplied cursor, so it joins their transaction."""
    cur.execute(sql, params or ())
    return [dict(row) for row in cur.fetchall()]


def fetch_one(cur: psycopg2.extensions.cursor, sql: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return dict(row) if row else None


def health_check() -> bool:
    try:
        return query_one("SELECT 1 AS ok") is not None
    except Exception:
        log.exception("db.health_check.failed")
        return False
