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


# Tables whose rows belong to ONE person. A query restricted to the asker's rows in one of these
# cannot answer a question about everybody, however complete its result looks.
_PERSONAL_TABLES = (
    "event_registration", "club_members", "club_join_requests", "club_president_change_requests",
)
# A user-id equality, with or without a table alias in front of it - the model writes
# `er.user_id = 37` as readily as `event_registration.user_id = 37`, and a literal-substring check
# missed the aliased form entirely.
_USER_FILTER = re.compile(
    r"\b(?:(\w+)\.)?(applicant_user_id|requester_user_id|user_id)\s*=\s*\d+", re.IGNORECASE
)


def _restricted_to_one_person(sql: str) -> bool:
    """Was this query narrowed to a single person's rows in a personal table?

    Deliberately NOT "does the SQL mention a user id". The events visibility predicate always
    carries `applicant_user_id = <id>`, and the staff/co-owner join inside it carries
    `s_request.user_id = <id>` - that whole clause is how an OWNER sees their own Private event,
    not a narrowing of the result to one person. Counting it flagged every signed-in event query,
    and "Show me events in October" came back as "You are registered for these events in October"
    for six events the asker is not registered for.

    So: the query must touch a personal table AND carry a user-id filter that is not part of that
    ownership clause - identified by the `applicant_` column and the `s_`/`co_` alias prefixes
    scope_rules._owner_clause generates.
    """
    lowered = sql.lower()
    if not any(table in lowered for table in _PERSONAL_TABLES):
        return False
    for qualifier, column in _USER_FILTER.findall(sql):
        if column.lower() == "applicant_user_id":
            continue
        if (qualifier or "").lower().startswith(("s_", "co_")):
            continue
        return True
    return False


def rows_to_document(rows: list[dict], *, sql: str) -> str:
    """The DATABASE RESULT block handed to the answering model.

    An EMPTY result gets an explicit "the query returned no rows" line rather than an omitted
    block, for the same reason the old retrieval layer emitted "you have none" documents: an
    absent block reads to the model as "no data was retrieved", which it conflates with "not
    allowed to answer" and refuses - whereas a real zero IS the complete, correct answer to
    plenty of questions ("do I have any pending registrations?"). That distinction is spelled
    out again in the answer prompt; this is the half that makes it possible to honour.
    """
    # Did the query have to carry a personal ownership condition to run at all? An access-scoped
    # result misleads whether it comes back empty or partial, but the two branches need DIFFERENT
    # sensitivities, so they get different marker sets.
    lowered = (sql or "").lower()

    # EMPTY: deliberately broad, and errs toward caution. Saying "you have none to show" when the
    # rows were merely public-and-absent is a small loss; saying "nobody has registered" when the
    # roster was simply not yours to read is a false statement about the world.
    #
    # The visibility clause counts too, and it is the only marker a GUEST query ever carries: with
    # no user id anywhere in their SQL, every empty guest result was being reported as a fact about
    # the world. Asked "show me the private events", a signed-out visitor was told "there are no
    # private events" - there are three; they are simply not a guest's to see.
    scoped_empty = any(
        marker in lowered for marker in ("user_id =", "applicant_user_id", "requester_user_id")
    ) or "event_visibility in" in lowered

    scoped_partial = _restricted_to_one_person(sql or "")

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
        if scoped_empty:
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
    # WHAT the rows mean lives in the query's conditions, not in its column names, and only the
    # column names survive into this block. Asked "am I president of any club?", the model was
    # handed `club_name: APU Coding Society` - a bare club name with nothing saying the asker
    # presides over it - and answered "No, you are not listed as the president of any club" while
    # holding the two rows that prove otherwise. It was following ANSWER ONLY FROM THE DATABASE
    # RESULT correctly; the block simply did not carry the fact that the filter had already been
    # applied. Generalises past presidency to every question whose answer is in the WHERE clause
    # ("clubs I'm in", "events I organise"), where the columns look identical either way.
    lines = [
        f"DATABASE RESULT ({len(rows)} row{'s' if len(rows) != 1 else ''}):",
        "  These rows ARE the answer to this question - the conditions the question asked for have"
        " ALREADY been applied in selecting them. If the asker asked which clubs they are President"
        " of, these are exactly those clubs; if they asked what they are registered for, these are"
        " exactly those registrations. Do not re-judge whether a row qualifies, and never answer"
        " negatively ('you are not', 'you have none') while rows are present just because no column"
        " restates the question's wording."
        " The converse is equally binding: they answer the question ACTUALLY asked and nothing"
        " more. Never attach a personal relationship the question did not ask about - rows"
        " returned for 'which clubs have under 20 members' are club SIZES, and calling them"
        " 'clubs you are a member of' invents a membership fact about the asker. The asker's OWN"
        " NAME appearing in a row does not make the row about them either: a club listed next to"
        " its president, who happens to be the asker, is still an entry in the club LIST, not a"
        " membership of theirs. Describe each row by the column it is actually in, never by a"
        " relationship you inferred from a name you recognised. The same trap on the events side:"
        " rows returned for 'show me events in October' are the EVENT LIST, and opening with 'you"
        " are registered for these events' asserts six registrations the asker does not have. If a"
        " row does not carry the relationship, do not name one - say 'here are the events', 'here"
        " are the clubs'.",
    ]
    if scoped_partial:
        # The partial twin of the scoped-empty case above. Asked "who registered for the Career
        # Fair?" about an event he does NOT organise, the asker got back the one row that was his
        # to see - his own registration - and was told "Daniel Wong registered for the AI & Data
        # Science Career Fair", which reads as the complete roster when five people are on it.
        # Nothing leaked; the answer was still false. Rows restricted to the asker cannot answer a
        # question about everyone.
        lines.append(
            "  SCOPE: these rows were RESTRICTED TO WHAT THIS ASKER MAY SEE, so they may be only"
            " their own slice of a larger set. If the question asked about OTHER people or about"
            " everyone ('who registered', 'who is in this club'), do NOT present these rows as the"
            " full answer or imply the list is complete - say you can only show them their own."
        )
    for row in rows:
        lines.append("  - " + "; ".join(f"{col}: {row.get(col)}" for col in columns))
    if len(rows) >= MAX_ROWS:
        lines.append(
            f"  (truncated at {MAX_ROWS} rows - say the list is partial if you enumerate it)"
        )
    return "\n".join(lines)
