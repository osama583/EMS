"""Executes guard-approved SQL against the PRIMARY database, read-only, and classifies failures.

Three independent read-only guarantees, because any one of them could have a hole:
  1. sql_guard.validate() rejects anything that is not a bare SELECT/WITH (before we get here);
  2. the transaction below is opened READ ONLY, so the database itself refuses a write even if
     a payload somehow reached it;
  3. statement_timeout caps a runaway query, so a pathological join cannot hold a pooled
     connection open indefinitely.

The connection comes from the app's normal pool (db.py). The separate AI/vector database is
gone - structured answers now come from the real tables, so there is no second store to keep in
sync and nothing that can be stale.

ERROR CLASSIFICATION exists because the two failure modes need opposite responses. A
schema-shaped error (undefined table/column) means the cached data dictionary may be describing
a database that has since migrated - so the cache is dropped and the model regenerates against
freshly introspected structure. Any other error (syntax, type mismatch, ambiguity) is the
model's own mistake, and regenerating with the SAME schema plus the error text is what fixes it.
Both paths are bounded by MAX_ATTEMPTS; there is no unbounded retry loop.
"""
from __future__ import annotations

import logging
import re

import psycopg2

from ..db import get_connection
from . import schema_catalog

log = logging.getLogger(__name__)

# One generation, plus at most two corrective regenerations. Beyond that the model is not
# converging and another call only adds latency to an answer that is going to be a refusal.
MAX_ATTEMPTS = 3
STATEMENT_TIMEOUT_MS = 5000
# Rows handed to the answering model. A chat reply summarises; it never prints 500 rows, and a
# large result would crowd out the instructions in the prompt.
MAX_ROWS = 50

# psycopg2 SQLSTATEs that mean "the schema is not what we thought it was".
_SCHEMA_ERROR_CODES = {
    "42P01",  # undefined_table
    "42703",  # undefined_column
    "42P10",  # invalid_column_reference
    "42883",  # undefined_function
}


class SqlExecutionError(Exception):
    def __init__(self, message: str, *, schema_related: bool) -> None:
        super().__init__(message)
        self.message = message
        self.schema_related = schema_related


def _append_limit(sql: str) -> str:
    """Guarantees a bounded result set. A query the model wrote without LIMIT is not wrong, just
    unbounded - so this adds one rather than rejecting, which would cost a whole regeneration
    round-trip for a purely mechanical fault."""
    if re.search(r"\blimit\s+\d+\s*$", sql.strip(), re.IGNORECASE):
        return sql
    return f"{sql.rstrip().rstrip(';')} LIMIT {MAX_ROWS}"


# Guard markers are instructions to sql_guard, not SQL. PUBLIC_COUNT_ONLY tells the guard "this
# query is claiming the public-registration-count exemption"; Postgres has no idea what it means,
# so it is rewritten to TRUE once the guard has finished proving the claim was honest. Replaced
# rather than deleted so the surrounding AND/OR structure stays valid whatever shape the model
# wrote it in.
_MARKERS = re.compile(r"\bPUBLIC_COUNT_ONLY\b", re.IGNORECASE)


def _strip_markers(sql: str) -> str:
    return _MARKERS.sub("TRUE", sql)


def execute(sql: str) -> list[dict]:
    """Runs guard-approved SQL in a read-only, time-limited transaction. Raises
    SqlExecutionError (already classified) on any database failure."""
    bounded = _append_limit(_strip_markers(sql))
    with get_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = %s", (STATEMENT_TIMEOUT_MS,))
                cur.execute("SET TRANSACTION READ ONLY")
                cur.execute(bounded)
                rows = [dict(row) for row in cur.fetchall()]
            conn.rollback()
            return rows[:MAX_ROWS]
        except psycopg2.Error as exc:
            conn.rollback()
            code = getattr(exc, "pgcode", None)
            schema_related = code in _SCHEMA_ERROR_CODES
            message = (getattr(exc, "diag", None) and exc.diag.message_primary) or str(exc)
            log.warning(
                "ai.sql.execution_failed",
                extra={"pgcode": code, "schema_related": schema_related, "error": message},
            )
            if schema_related:
                # The cached dictionary may be describing a pre-migration database. Drop it so the
                # next generation attempt introspects afresh (requirement 2 of the cache's
                # invalidation rules - see schema_catalog.py's docstring).
                schema_catalog.invalidate()
            raise SqlExecutionError(message, schema_related=schema_related) from exc


def rows_to_document(rows: list[dict], *, sql: str) -> str:
    """The DATABASE RESULT block handed to the answering model.

    An EMPTY result gets an explicit "the query returned no rows" line rather than an omitted
    block, for the same reason the old retrieval layer emitted "you have none" documents: an
    absent block reads to the model as "no data was retrieved", which it conflates with "not
    allowed to answer" and refuses - whereas a real zero IS the complete, correct answer to
    plenty of questions ("do I have any pending registrations?"). That distinction is spelled
    out again in the answer prompt; this is the half that makes it possible to honour.
    """
    if not rows:
        # WHY the result is empty changes what the honest answer is, and conflating the two
        # produced a false statement: "who registered for the Career Fair?" returned no rows
        # (correctly - that roster is not this caller's to read) and the assistant answered "No one
        # has registered", while the event's own card showed 5 registered. An empty SCOPED result
        # says nothing about the world; it says something about the asker's access.
        #
        # The distinction is drawn from the query itself rather than guessed. A query that had to
        # carry a personal ownership condition to run at all ("= <my id>", "events I organise") is
        # scoped-empty; a query over publicly visible rows is genuinely empty.
        scoped = any(marker in (sql or "").lower() for marker in ("user_id =", "applicant_user_id", "requester_user_id"))
        if scoped:
            return (
                "DATABASE RESULT: the query ran successfully and returned NO ROWS, but the query "
                "was RESTRICTED TO WHAT THIS ASKER MAY SEE. So this means 'none that you have "
                "access to', NOT 'none exist'. Never state or imply that there are none in the "
                "system, that nobody has registered, or that nothing happened - you do not know "
                "that and it may well be false. Say plainly that you don't have any to show them "
                "for their own account, or that you can't see that information, whichever fits "
                "the question."
            )
        return (
            "DATABASE RESULT: the query ran successfully and returned NO ROWS over data this asker "
            "is allowed to see. This is a real, final, correct answer - state plainly that there "
            "are none/none found. Do NOT say you lack access or could not look it up."
        )
    columns = list(rows[0].keys())
    lines = [f"DATABASE RESULT ({len(rows)} row{'s' if len(rows) != 1 else ''}):"]
    for row in rows:
        lines.append("  - " + "; ".join(f"{col}: {row.get(col)}" for col in columns))
    if len(rows) >= MAX_ROWS:
        lines.append(
            f"  (truncated at {MAX_ROWS} rows - say the list is partial if you enumerate it)"
        )
    return "\n".join(lines)
