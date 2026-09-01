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


# Guard markers are instructions to sql_guard, not SQL.
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


# NOTHING THIS ASSISTANT READS BELONGS TO ONE PERSON ANY MORE, and the two "is this result only
# the asker's slice" tests that used to live here are gone with it.
#
# They existed because a query could be narrowed to the caller's own registrations, memberships or
# join requests, and an empty result then meant "none of YOURS" rather than "none exist" - a
# distinction worth a whole paragraph, because getting it backwards told someone "nobody has
# registered" for an event whose own card showed five.
#
# The scope no longer has that shape. Every row the assistant can read is catalogue data - what the
# event card and the club card show everyone - and the only conditions on the two people-tables are
# count-only markers (see scope_rules.py). So an empty result now means one thing, and saying so
# once is more honest than keeping a branch that can never be reached.


def rows_to_document(rows: list[dict], *, sql: str, scope=None) -> str:
    """The DATABASE RESULT block handed to the answering model.

    An EMPTY result gets an explicit "the query returned no rows" line rather than an omitted
    block: an absent block reads to the model as "no data was retrieved", which it conflates with
    "not allowed to answer" and refuses - whereas a real zero IS the complete, correct answer to
    plenty of questions ("are there any free events next week?"). That distinction is spelled out
    again in the answer prompt; this is the half that makes it possible to honour.

    `scope` is accepted and unused. It used to decide whether "no rows" meant "none of yours"; it
    cannot mean that any more (see the note above this function), and the parameter stays only so
    the caller does not have to know that.
    """
    if not rows:
        return (
            "DATABASE RESULT: the query ran successfully and returned NO ROWS over the published "
            "events and clubs this asker can see. This is a real, final, correct answer - state "
            "plainly that there are none, or none matching what they asked for, and offer to widen "
            "the search. Do NOT say you lack access, and do NOT say you could not look it up."
        )
    columns = list(rows[0].keys())
    # WHAT the rows mean lives in the query's conditions, not in its column names, and only the column
    # names survive into this block.
    lines = [
        f"DATABASE RESULT ({len(rows)} row{'s' if len(rows) != 1 else ''}):",
        "  These rows ARE the answer to this question - the conditions the question asked for have"
        " ALREADY been applied in selecting them. Do not re-judge whether a row qualifies, and"
        " never answer negatively ('there aren't any') while rows are present just because no"
        " column restates the question's wording."
        " The converse is equally binding: they answer the question ACTUALLY asked and nothing"
        " more. NEVER ATTACH A RELATIONSHIP TO THE ASKER THAT THE QUESTION DID NOT ASK ABOUT."
        " Rows returned for 'which clubs have under 20 members' are club SIZES, and calling them"
        " 'clubs you are a member of' invents a membership fact. Rows returned for 'show me events"
        " in October' are the EVENT LIST, and opening with 'you are registered for these' asserts"
        " six registrations the asker does not have. The asker's own NAME appearing in a row does"
        " not make the row about them either - a club listed beside its president, who happens to"
        " be them, is still an entry in the club list. Describe each row by the column it is"
        " actually in: 'here are the events', 'here are the clubs'.",
    ]
    for row in rows:
        lines.append("  - " + "; ".join(f"{col}: {row.get(col)}" for col in columns))
    if len(rows) >= MAX_ROWS:
        lines.append(
            f"  (truncated at {MAX_ROWS} rows - say the list is partial if you enumerate it)"
        )
    return "\n".join(lines)
