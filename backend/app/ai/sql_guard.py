"""Validates model-generated SQL BEFORE it reaches the database. Nothing here trusts the model.

This is the layer that makes Text-to-SQL safe enough to run at all, so it is deliberately
paranoid and deliberately DUMB: every rule is a mechanical check on the statement text, not a
judgement about intent. A query that fails any check is rejected outright - never "fixed up",
because silently rewriting a query the model got wrong would mean executing something nobody
authored.

WHAT IS CHECKED, and why each one exists:

  1. SINGLE STATEMENT. A stray `;` is the whole of SQL injection's classic payload
     (`SELECT 1; DROP TABLE users`). Trailing semicolons are stripped first, then any remaining
     one means a second statement.
  2. READ-ONLY. Must start with SELECT or WITH; any write/DDL/DCL keyword anywhere is fatal.
     Belt and braces with the read-only transaction sql_runner.py opens - if either fails, the
     other still holds.
  3. NO DANGEROUS CONSTRUCTS. Comments (a classic way to hide a payload past a naive scanner),
     `pg_sleep` and friends, `COPY`, `pg_read_file`, `dblink`, `set_config`, and any reference
     to pg_catalog/information_schema (the schema is served from schema_catalog.py; a query
     asking the database to describe itself is either confused or probing).
  4. TABLE ALLOW-LIST. Every table referenced must be in the set this QUESTION's topics allow
     (schema_catalog.tables_for_topics) - narrower than the global allow-list, so a club
     question cannot read event registrations.
  5. COLUMN ALLOW-LIST. Every `table.column` reference must exist in the introspected catalog,
     which already has EXCLUDED_COLUMNS (users.password) stripped. Bare, unqualified columns
     are not checked here - they cannot be resolved without a full parser, which is exactly why
     the prompt requires qualified names and why an unqualified reference to an excluded column
     is separately caught by rule 6.
  6. EXCLUDED COLUMNS. `password` and friends are rejected on the bare word, qualified or not.
  7. REQUIRED SCOPE PREDICATES. For each table scope_rules.py demands a predicate on, the SQL
     must contain one of that table's predicates verbatim (whitespace-normalised). This is the
     row-level authorization check, and it is the reason the model cannot "retrieve everything
     and filter later" - a query without the predicate never runs.
  8. FORBIDDEN TABLES. A table scope_rules gave an EMPTY predicate tuple for is one the caller
     has no rows in at all (a guest and club_members); referencing it is a hard reject.
  9. LIMIT. Enforced by sql_runner.py rather than here (it appends one when absent), since a
     missing LIMIT is a resource concern, not an authorization one.

STRING LITERALS are blanked before rules 4, 5, 7 and 8 run - the ones that read identifiers. Those
rules treat a dot as qualification, and a literal is full of dots that are not: an email in a WHERE
clause ('student.computing@demo.apu.edu.my') parses as student.computing, and rule 5 then rejects a
valid query for a column "computing" on a table "student". Rules 2, 3 and 6 (keywords, constructs,
excluded columns) deliberately still see the literals, since nothing legitimate hides a keyword or
a credential column name inside a string anyway.

Returns a reason string on rejection so the caller can log it and, for a repairable fault, feed
it back to the model for one bounded retry (see sql_runner.py).
"""
from __future__ import annotations

import logging
import re

from . import schema_catalog

log = logging.getLogger(__name__)

# Any of these appearing as a word means the statement is not read-only. Checked against the
# comment-stripped text, so a keyword hidden behind `--` cannot slip through.
_FORBIDDEN_KEYWORDS = (
    "insert", "update", "delete", "drop", "alter", "truncate", "create", "grant", "revoke",
    "merge", "replace", "upsert", "vacuum", "analyze", "reindex", "cluster", "comment",
    "call", "do", "execute", "prepare", "listen", "notify", "lock", "copy", "refresh",
    "begin", "commit", "rollback", "savepoint", "set", "reset", "discard", "import",
)

# Constructs with no legitimate use in a generated read query, and a clear abuse case each.
_FORBIDDEN_CONSTRUCTS = (
    "pg_sleep", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file",
    "lo_import", "lo_export", "dblink", "postgres_fdw", "set_config", "current_setting",
    "pg_catalog", "information_schema", "pg_shadow", "pg_authid", "pg_user",
    "into outfile", "\\g", "\\copy",
)

# Rule 7 checks that a required predicate is PRESENT. Present is not the same as effective: a
# query can contain the predicate verbatim and still neutralise it, which is the one way a purely
# textual check can be satisfied without being obeyed. Found by adversarial testing of the finished
# guard, not in theory - `WHERE CASE WHEN 1=1 THEN true ELSE (<predicate>) END` passed cleanly.
#
# Rather than try to prove a boolean expression's effect (which needs a real parser and an
# evaluator, and would still be arguable), these reject the CONSTRUCTS that make neutralisation
# possible at all. None of them has any place in a generated read query:
#   - a tautology (1=1, true or ...) short-circuits any condition OR'd with it;
#   - CASE in a WHERE clause makes a predicate conditional on something else;
#   - OFFSET/FETCH tricks and `WHERE false` are not neutralisation but are equally never generated.
# The model is not told about these because it never writes them; a query that contains one is
# either confused or hostile, and both are worth rejecting.
_NEUTRALISING_CONSTRUCTS = (
    (re.compile(r"\bcase\s+when\b", re.IGNORECASE), "CASE in a query condition"),
    (re.compile(r"\b(\d+)\s*=\s*\1\b"), "a tautology (n = n)"),
    (re.compile(r"\btrue\s+or\b|\bor\s+true\b", re.IGNORECASE), "OR TRUE"),
    (re.compile(r"\bor\s+1\s*=\s*1\b", re.IGNORECASE), "OR 1=1"),
    (re.compile(r"\bor\s+'[^']*'\s*=\s*'[^']*'", re.IGNORECASE), "a constant string comparison in an OR"),
)

# The marker scope_rules emits for "counting registrations is public, identifying registrants is
# not" (see its event_registration block). It is a required PREDICATE like any other, so rule 7
# proves it is present; rule 7b then proves the query it appears in is genuinely a count. Rewritten
# to TRUE before execution (sql_runner._strip_markers) - it is an instruction to this guard, not a
# condition the database has any way to evaluate.
_COUNT_ONLY_MARKER = "PUBLIC_COUNT_ONLY"

# Columns that turn a count into a disclosure. A registration COUNT is on every event card already;
# these say WHO, which is the part that is actually private.
_IDENTIFYING_REGISTRATION_COLUMNS = (
    "registrant_name", "registrant_email", "reason_for_attending",
    "payment_proof_url", "payment_proof_file_name", "payment_status",
    "decided_by_user_id", "full_name",
)

_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.DOTALL)
_COMMENT_LINE = re.compile(r"--[^\n]*")
# Single-quoted string literals, doubled '' handled as an escaped quote inside one. Blanked out
# before the TABLE and COLUMN rules run, because those rules read dots as qualification and a
# literal is full of dots that are nothing of the kind: an email in a WHERE clause
# ('student.computing@demo.apu.edu.my') parses as student.computing, demo.apu and edu.my, and the
# column rule then rejects a perfectly valid query for referencing a column named "computing" on a
# table named "student". That was a live false rejection, not a hypothetical - it burned all three
# retry attempts on two of the first real questions put through the pipeline.
#
# Blanked, NOT deleted, so offsets and word boundaries either side stay intact. The keyword and
# construct rules deliberately still run against the text WITH literals present: a literal
# containing "DROP TABLE" is harmless on its own, but it is also not something any legitimate
# generated query contains, and rejecting it costs nothing.
_STRING_LITERAL = re.compile(r"'(?:[^']|'')*'")
# Table references: the name following FROM / JOIN / UPDATE-style clauses. Deliberately broad -
# over-matching produces a false rejection (safe), under-matching would let a table past (unsafe).
_TABLE_REF = re.compile(r"\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)", re.IGNORECASE)
# EXTRACT / SUBSTRING / TRIM / OVERLAY take FROM as an ARGUMENT SEPARATOR, not as a table clause.
# These four are the whole set in PostgreSQL, which is what makes blanking them safe to enumerate.
_FUNCTION_FROM = re.compile(
    r"\b(?:extract|substring|trim|overlay)\s*\([^()]*?\bfrom\b", re.IGNORECASE
)
_QUALIFIED_COLUMN = re.compile(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b")
# Aliases, so `FROM request r` / `JOIN users u ON` resolves r.x and u.y to their real tables
# before the column check runs. Without this every aliased query would fail rule 5.
_ALIAS = re.compile(
    r"\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*)",
    re.IGNORECASE,
)
# Words that follow a table name but are clauses, not aliases.
_NOT_AN_ALIAS = {
    "on", "where", "group", "order", "limit", "having", "join", "inner", "left", "right",
    "full", "cross", "union", "except", "intersect", "using", "and", "or", "as", "offset",
    "fetch", "for", "window", "lateral",
}


class SqlRejected(Exception):
    """Raised with a human/model-readable reason. Carries `repairable`: a malformed or
    wrong-column query is worth one regeneration attempt; an authorization violation is not -
    re-asking the model to try again after it attempted to read someone else's rows is exactly
    the retry loop an attacker wants."""

    def __init__(self, reason: str, *, repairable: bool = False) -> None:
        super().__init__(reason)
        self.reason = reason
        self.repairable = repairable


def _strip_comments(sql: str) -> str:
    return _COMMENT_LINE.sub(" ", _COMMENT_BLOCK.sub(" ", sql))


def _normalise(text: str) -> str:
    """Whitespace-collapsed, lowercased - the form predicate matching compares in, so the model
    reformatting a required predicate across two lines does not fail an otherwise valid query."""
    return re.sub(r"\s+", " ", text).strip().lower()


def _blank_function_from(sql: str) -> str:
    """Blank the FROM that EXTRACT/SUBSTRING/TRIM/OVERLAY use as an argument separator.

    Replaces only the four-letter keyword, with four spaces, so the string keeps its length and
    every other identifier rule sees the same offsets. The column reference itself is left intact,
    so rule 5 still validates `event_schedule.date` exactly as before - this removes a false table
    reference, never a real check."""
    return _FUNCTION_FROM.sub(lambda m: m.group(0)[:-4] + "    ", sql)


def _alias_map(sql: str) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for table, alias in _ALIAS.findall(sql):
        if alias.lower() not in _NOT_AN_ALIAS:
            aliases[alias.lower()] = table.lower()
    return aliases


def _expand_aliases(sql: str, aliases: dict[str, str]) -> str:
    """Rewrites `r.status` back to `request.status` so a predicate written with real table names
    still matches a query that aliased them (see rule 7's comment).

    An alias that is ALREADY a real table name is skipped - `FROM request request` is a no-op, and
    rewriting it would be too. Only qualifier positions are touched (a name immediately followed by
    a dot), so a column or literal that happens to share an alias's spelling is unaffected."""
    if not aliases:
        return sql

    def replace(match: re.Match) -> str:
        qualifier = match.group(1)
        table = aliases.get(qualifier.lower())
        return f"{table}." if table and table != qualifier.lower() else match.group(0)

    return re.sub(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\.", replace, sql)


def validate(sql: str, *, allowed_tables: tuple[str, ...], scope) -> str:
    """Returns the cleaned, single-statement SQL, or raises SqlRejected.

    `scope` is a scope_rules.Scope; `allowed_tables` is this question's narrowed table set.
    """
    if not sql or not sql.strip():
        raise SqlRejected("Empty SQL.", repairable=True)

    cleaned = _strip_comments(sql).strip().rstrip(";").strip()
    lowered = cleaned.lower()

    # 1. single statement
    if ";" in cleaned:
        raise SqlRejected("Multiple SQL statements are not allowed.")

    # 3a. comments were stripped above; if the original had any, that is itself suspicious in a
    # generated single-purpose query, but not fatal on its own - the stripped text is what every
    # other rule sees, so a hidden payload cannot survive. No separate check needed.

    # 2. read-only
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise SqlRejected("Only SELECT queries are allowed.")
    for keyword in _FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", lowered):
            raise SqlRejected(f"Disallowed SQL operation: {keyword.upper()}.")

    # 3. dangerous constructs
    for construct in _FORBIDDEN_CONSTRUCTS:
        if construct in lowered:
            raise SqlRejected(f"Disallowed SQL construct: {construct}.")

    # 3b. neutralising constructs - a required predicate that is present but inert (see
    #     _NEUTRALISING_CONSTRUCTS). Not repairable: a query built to defeat its own access
    #     condition is an authorization violation, not a mistake to hand back for another go.
    for pattern, description in _NEUTRALISING_CONSTRUCTS:
        if pattern.search(cleaned):
            raise SqlRejected(f"Disallowed SQL construct: {description}.")

    # 6. excluded columns, qualified or bare
    for table, columns in schema_catalog.EXCLUDED_COLUMNS.items():
        for column in columns:
            if re.search(rf"\b{re.escape(column)}\b", lowered):
                raise SqlRejected(f"Column {table}.{column} is not readable.")

    # Structure-only view: string literals blanked so their contents cannot be read as table or
    # column references (see _STRING_LITERAL). Every identifier rule below works from this; the
    # predicate check further down deliberately keeps the original, since a required predicate
    # contains literals of its own that must match verbatim.
    structural = _STRING_LITERAL.sub(lambda m: "'" + " " * (len(m.group(0)) - 2) + "'", cleaned)
    # ...and with the argument-separator FROM blanked, so a date-part expression is not read as a
    # table clause. `EXTRACT(MONTH FROM event_schedule.date)` made _TABLE_REF capture the column's
    # qualifier as a table, which rejected every "which events are in October" query (three
    # attempts, all correct) and answered a confident, wrong "there are no events in October".
    # Length-preserving, so every rule below still works on the same offsets, and narrow enough
    # that a FROM in any other position is still a real table reference and still checked.
    structural = _blank_function_from(structural)

    allowed = {t.lower() for t in allowed_tables}
    aliases = _alias_map(structural)

    # 4. table allow-list. A name that is a CTE defined in this same query is fine; collect those
    # first so `WITH x AS (...) SELECT * FROM x` is not mistaken for an unknown table.
    structural_lower = structural.lower()
    ctes = {name.lower() for name in re.findall(r"\bwith\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+as\b", structural_lower)}
    ctes |= {name.lower() for name in re.findall(r",\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(", structural_lower)}
    for table in _TABLE_REF.findall(structural):
        name = table.lower()
        if name in ctes:
            continue
        if name not in allowed:
            raise SqlRejected(
                f"Table '{table}' is not available for this question. Allowed tables: "
                + ", ".join(sorted(allowed)),
                repairable=True,
            )

    # 8. forbidden tables (empty predicate tuple = no rows at all for this caller)
    for table, predicates in scope.required_predicates.items():
        if not predicates and re.search(rf"\b{re.escape(table)}\b", structural_lower):
            raise SqlRejected(f"This asker has no access to any row of '{table}'.")

    # 5. column allow-list for qualified references
    catalog_columns = schema_catalog.allowed_columns()
    for qualifier, column in _QUALIFIED_COLUMN.findall(structural):
        table = aliases.get(qualifier.lower(), qualifier.lower())
        if table in ctes or table not in catalog_columns:
            # Not a known base table (a CTE, a subquery alias, or a function call's qualifier) -
            # the table rule above already rejected genuinely unknown TABLES, so there is nothing
            # left to verify here.
            continue
        if column.lower() not in {c.lower() for c in catalog_columns[table]}:
            raise SqlRejected(
                f"Column '{column}' does not exist on table '{table}'.", repairable=True
            )

    # 7. required scope predicates - the row-level authorization check
    #
    # Compared against an ALIAS-EXPANDED form of the query, not the raw text. Predicates are
    # written with real table names (`request.status = ...`), but a model naturally writes
    # `FROM request r ... WHERE r.status = ...`, which is the same condition and was being
    # rejected as a missing one - the model then burned every retry attempt rewriting a query that
    # was correct the first time. Requiring the literal string would have meant forbidding aliases
    # outright, which is a worse constraint than resolving them.
    #
    # Expansion uses the alias map already built for rule 5, so a query cannot smuggle a different
    # table in under an alias the guard resolved differently to the database: rule 4 has already
    # confirmed every aliased table is one this question allows.
    # Expanded from `cleaned`, NOT from `structural`: a required predicate contains string literals
    # of its own ('completed_approved', 'Public'), and matching against the blanked form would
    # compare a predicate that has them to a query that no longer does - failing every time.
    normalised_sql = _normalise(_expand_aliases(cleaned, aliases))
    for table, predicates in scope.required_predicates.items():
        if not predicates:
            continue  # handled by rule 8
        # Structural, so a table NAME appearing inside a string literal ("the APU Coding Society
        # club_members list") does not make this demand a predicate for a table the query never
        # actually reads.
        if not re.search(rf"\b{re.escape(table)}\b", structural_lower):
            continue  # table not used by this query
        # The PREDICATE is alias-expanded too, with the same map. It carries aliases of its own
        # (co_request/s_request, from scope_rules._owner_clause), and those names appear in the
        # query's own FROM/JOIN clauses - so the query-side expansion rewrites them, and comparing
        # against an unexpanded predicate compares two texts that were normalised differently.
        # That mismatch failed EVERY event query, which is a total outage rather than a leak, but
        # it is exactly the kind of thing "compare the two sides the same way" prevents.
        if not any(
            _normalise(_expand_aliases(predicate, aliases)) in normalised_sql
            for predicate in predicates
        ):
            raise SqlRejected(
                f"The query reads '{table}' without the required access condition. It must include "
                "one of these exactly as written: " + " | ".join(predicates),
                repairable=True,
            )

    # 7b. PUBLIC_COUNT_ONLY means exactly that - aggregate, never identify.
    #
    # A predicate is a row filter, and no row filter can express "you may COUNT these rows but not
    # PROJECT them". That is a column-level rule, so it is enforced here instead. The marker lets a
    # caller answer "how many people registered for the hackathon" - a number the event's own card
    # already shows everyone - without it becoming a way to read the attendee list of an event they
    # have nothing to do with.
    if _COUNT_ONLY_MARKER.lower() in normalised_sql:
        if not re.search(r"\bcount\s*\(", structural_lower):
            raise SqlRejected(
                f"{_COUNT_ONLY_MARKER} may only be used on an aggregate query. Use COUNT(*), or "
                "query only the registrations you are otherwise authorised to read.",
                repairable=True,
            )
        for column in _IDENTIFYING_REGISTRATION_COLUMNS:
            if re.search(rf"\b{re.escape(column)}\b", structural_lower):
                raise SqlRejected(
                    f"A {_COUNT_ONLY_MARKER} query may not reference '{column}' - registration "
                    "COUNTS are public, but who registered is not.",
                    repairable=True,
                )

    return cleaned
