"""The Text-to-SQL pipeline: question in, executed rows out - or a clean, honest failure.

    classify (already done)  ->  scope  ->  schema  ->  generate  ->  GUARD  ->  execute
                                                            ^                        |
                                                            +----- bounded retry -----+

Every step's ordering is load-bearing:

  SCOPE BEFORE SCHEMA      the caller's row-level scope determines which tables are even
                           describable for this question, so an unauthorised table is never
                           mentioned to the model in the first place. Cheaper and safer than
                           describing everything and hoping the guard catches the misuse.
  SCHEMA BEFORE GENERATE   the model writes SQL against introspected structure, never remembered
                           structure.
  GUARD BEFORE EXECUTE     absolute. Generated SQL is never executed unvalidated - see
                           sql_guard.py for the checks and why each exists.
  RETRY IS BOUNDED         MAX_ATTEMPTS total. A repairable fault (bad column, missing required
                           predicate, syntax error) is fed back to the model with the exact
                           reason. An AUTHORIZATION violation is NOT retried: re-asking a model
                           that just tried to read someone else's rows is precisely the loop an
                           attacker would want to drive.

The result is deliberately a small dataclass rather than an exception-per-outcome, because the
caller (api/ai.py) needs to distinguish "no rows" (a real answer) from "could not answer" (a
refusal) from "not supported" (a log entry) - three different replies, none of them an error.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from . import schema_catalog, scope_rules, sql_guard, sql_llm, sql_runner

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SqlOutcome:
    """What the pipeline produced.

    ok=True             `rows` is the answer's grounding (possibly empty - an empty result is a
                        real answer, see sql_runner.rows_to_document).
    ok=False, impossible=True
                        the model judged the question unanswerable from the available schema.
                        Not a failure: it is an out-of-scope/unsupported signal worth logging so
                        an admin can see what people are asking for.
    ok=False, impossible=False
                        generation or validation never converged. The answer is a refusal, and
                        `failure_reason` says why for the log (never for the user - it can name
                        tables and columns).
    """

    ok: bool
    rows: list[dict] | None = None
    sql: str | None = None
    impossible: bool = False
    failure_reason: str | None = None
    attempts: int = 0


def run(
    question: str,
    principal,
    topics: set[str],
    history: list[dict] | None = None,
    *,
    broad_candidates: bool = False,
) -> SqlOutcome:
    """Answer `question` from the database, within `principal`'s scope.

    `topics` must already have been filtered by topic_access.denied_topics() - this function
    assumes every topic in it is one the caller may reach, and narrows from there to which ROWS.

    `broad_candidates` marks a RECOMMENDATION: retrieve the candidate set rather than trying to
    match the asker's stated interests in SQL. "I like coding and hands-on things" matches no
    literal column value, so a narrow query returns nothing and the assistant reports there is
    nothing for them while a hackathon sits in the table - observed exactly that way. Matching
    meaning is the answering step's job; this step's job is to fetch the candidates.
    """
    scope = scope_rules.build_scope(principal, topics)
    allowed_tables = schema_catalog.tables_for_topics(topics)
    if not allowed_tables:
        return SqlOutcome(ok=False, failure_reason="No queryable tables for this question's topics.")

    scope_document = scope_rules.document(scope)
    if broad_candidates:
        scope_document += (
            "\n\nTHIS IS A RECOMMENDATION QUESTION. Return the CANDIDATE SET, not a filtered "
            "match: upcoming rows with their titles, dates, descriptions and categories, LIMIT 20. "
            "Do NOT filter on the asker's stated interests with LIKE or a category condition - "
            "their wording will not match any literal value, and the query would come back empty."
        )
    previous_sql: str | None = None
    error: str | None = None

    for attempt in range(1, sql_runner.MAX_ATTEMPTS + 1):
        # Rebuilt each attempt, not hoisted: a schema-shaped execution failure invalidates the
        # cache (sql_runner.execute), and this is the call that picks the fresh structure up. The
        # cache makes the repeat cost ~0 when nothing was invalidated.
        schema_document = schema_catalog.document_for_topics(topics)

        try:
            sql = sql_llm.generate_sql(
                question,
                schema_document=schema_document,
                scope_document=scope_document,
                history=history,
                previous_sql=previous_sql,
                error=error,
            )
        except Exception as exc:  # noqa: BLE001 - an API failure here is a refusal, never a 500
            log.warning("ai.text_to_sql.generation_failed", extra={"error": str(exc)})
            return SqlOutcome(ok=False, failure_reason=f"SQL generation failed: {exc}", attempts=attempt)

        if sql.strip().upper().startswith("IMPOSSIBLE"):
            log.info("ai.text_to_sql.impossible", extra={"attempt": attempt})
            return SqlOutcome(ok=False, impossible=True, attempts=attempt)

        try:
            validated = sql_guard.validate(sql, allowed_tables=allowed_tables, scope=scope)
        except sql_guard.SqlRejected as rejection:
            log.warning(
                "ai.text_to_sql.rejected",
                extra={"attempt": attempt, "repairable": rejection.repairable, "reason": rejection.reason},
            )
            if not rejection.repairable:
                # An authorization violation. Not retried - see the module docstring.
                return SqlOutcome(
                    ok=False, sql=sql, failure_reason=f"Rejected: {rejection.reason}", attempts=attempt
                )
            previous_sql, error = sql, rejection.reason
            continue

        try:
            rows = sql_runner.execute(validated)
        except sql_runner.SqlExecutionError as failure:
            previous_sql = validated
            error = (
                f"The database rejected the query: {failure.message}"
                + (
                    " The schema description has been refreshed - re-check your table and column "
                    "names against the schema given above."
                    if failure.schema_related
                    else ""
                )
            )
            continue

        log.info("ai.text_to_sql.ok", extra={"attempt": attempt, "rows": len(rows)})
        return SqlOutcome(ok=True, rows=rows, sql=validated, attempts=attempt)

    return SqlOutcome(
        ok=False,
        sql=previous_sql,
        failure_reason=f"Did not converge in {sql_runner.MAX_ATTEMPTS} attempts. Last error: {error}",
        attempts=sql_runner.MAX_ATTEMPTS,
    )
