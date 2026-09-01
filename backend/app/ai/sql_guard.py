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
     question cannot read event registrations - PLUS the tables scope_rules.py's own required
     predicates name (_predicate_tables). That union is not a loosening, it is the only
     self-consistent set: rule 7 below REQUIRES those predicates verbatim, so a table this rule
     forbade while rule 7 demanded it made the query unsatisfiable in both directions at once.
     That is not hypothetical - it is what shipped. Migration 029 gave 'Club Only' events a real
     audience, so the mandated `request` predicate grew an
     `EXISTS (SELECT 1 FROM request_clubs JOIN club_members ...)` membership test, and nobody
     added those two tables to schema_catalog's events group. Every event question from every
     signed-in user then failed: copy the predicate and rule 4 rejected it, drop it and rule 7
     rejected it, three attempts, "I don't have that information available right now" - for
     "show me all events". Guests never saw it, their predicate having no such clause.
     Deriving the set here means a predicate can never again name a table the guard forbids.
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

# Rule 7 checks that a required predicate is PRESENT.
_NEUTRALISING_CONSTRUCTS = (
    (re.compile(r"\bcase\s+when\b", re.IGNORECASE), "CASE in a query condition"),
    (re.compile(r"\b(\d+)\s*=\s*\1\b"), "a tautology (n = n)"),
    (re.compile(r"\btrue\s+or\b|\bor\s+true\b", re.IGNORECASE), "OR TRUE"),
    (re.compile(r"\bor\s+1\s*=\s*1\b", re.IGNORECASE), "OR 1=1"),
    (re.compile(r"\bor\s+'[^']*'\s*=\s*'[^']*'", re.IGNORECASE), "a constant string comparison in an OR"),
)

# The marker scope_rules emits for "counting these rows is public, identifying the people in them
# is not". It is the ONLY condition either people-table gets, for every caller - see scope_rules.
_COUNT_ONLY_MARKER = "PUBLIC_COUNT_ONLY"

# Columns that turn a count into a disclosure. "N registered" is on every event card and "N members"
# on every club card; these say WHO, which is the part the assistant does not answer for anybody.
#
# `full_name` is in the list, which costs one legitimate query shape: a club's president cannot be
# named in the same query as a member count. That is the right trade - grouping a count by a name
# is a roster with a COUNT(*) column bolted on - and the president is still answerable in a query
# that does not carry the marker, since `clubs` itself has no count-only restriction.
_IDENTIFYING_REGISTRATION_COLUMNS = (
    "registrant_name", "registrant_email", "reason_for_attending",
    "payment_proof_url", "payment_proof_file_name", "payment_status",
    "decided_by_user_id", "full_name",
)

_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.DOTALL)
_COMMENT_LINE = re.compile(r"--[^\n]*")
# Single-quoted string literals, doubled '' handled as an escaped quote inside one.
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
# The same shape with the clause keyword captured, so _drop_alias_declarations can rebuild
# `FROM <table>` without it. Kept separate rather than adding a group to _ALIAS, whose two-group
# findall() shape (table, alias) _alias_map depends on.
_ALIAS_DECLARATION = re.compile(
    r"\b(from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*)",
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


def _drop_alias_declarations(sql: str) -> str:
    """`FROM request_clubs rc_request` -> `FROM request_clubs`, for comparison only.

    _expand_aliases rewrites where an alias is USED; this removes where it is DECLARED. Rule 7
    needs both, because the declaration is text too: once uses are expanded, a predicate saying
    `FROM request_clubs rc_request` and a query saying `FROM request_clubs rc_sub` read the same
    tables and the same columns and differ in nothing but the name the model picked - yet compared
    as raw strings they still fail.

    Comparison only. The executed SQL keeps every alias exactly as written."""
    def replace(match: re.Match) -> str:
        clause, table, alias = match.group(1), match.group(2), match.group(3)
        return match.group(0) if alias.lower() in _NOT_AN_ALIAS else f"{clause} {table}"

    return _ALIAS_DECLARATION.sub(replace, sql)


def _comparable(text: str, aliases: dict[str, str]) -> str:
    """The form rule 7 compares: real table names, no alias declarations, whitespace collapsed.

    Both sides go through this, so what is compared is which tables and columns the condition
    actually reads - not which single letters the model happened to reach for."""
    return _normalise(_expand_aliases(_drop_alias_declarations(text), aliases))


def _predicate_tables(scope) -> set[str]:
    """Every table named inside the scope's own required predicates.

    Rule 4 has to admit these, because rule 7 demands the predicate that names them - see the
    module docstring for the outage that proved it. Read off the predicate TEXT rather than
    maintained as a second list, so a predicate that grows a new join (which is exactly how this
    broke) carries its own permission with it and cannot drift again.

    This admits a table to the allow-list ONLY. It grants no rows: a table reachable this way is
    still subject to rule 7's own required predicate and rule 8's forbidden check, and
    scope_rules.py gives club_members an own-row condition for precisely that reason."""
    tables: set[str] = set()
    for predicates in scope.required_predicates.values():
        for predicate in predicates:
            tables |= {name.lower() for name in _TABLE_REF.findall(predicate)}
    return tables


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

    # Structure-only view: string literals blanked so their contents cannot be read as table or column
    # references (see _STRING_LITERAL).
    structural = _STRING_LITERAL.sub(lambda m: "'" + " " * (len(m.group(0)) - 2) + "'", cleaned)
    # ...and with the argument-separator FROM blanked, so a date-part expression is not read as a
    # table clause.
    structural = _blank_function_from(structural)

    # The question's tables, plus the ones its own mandatory conditions reach through (rule 4).
    allowed = {t.lower() for t in allowed_tables} | _predicate_tables(scope)
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

    # 7. required scope predicates - the row-level authorization check Compared against an ALIAS-
    # EXPANDED form of the query, not the raw text.
    normalised_sql = _comparable(cleaned, aliases)
    for table, predicates in scope.required_predicates.items():
        if not predicates:
            continue  # handled by rule 8
        # Structural, so a table NAME appearing inside a string literal ("the APU Coding Society
        # club_members list") does not make this demand a predicate for a table the query never
        # actually reads.
        if not re.search(rf"\b{re.escape(table)}\b", structural_lower):
            continue  # table not used by this query
        # The PREDICATE is alias-expanded too - but with ITS OWN aliases taking precedence over the
        # query's, which is the only way the comparison can survive a rename the model was forced
        # into.
        #
        # A predicate that opens a subquery defines aliases of its own ("FROM request_clubs
        # rc_request"), and the model may legitimately have to rename one: if the outer query
        # already uses that letter-pair for a different table, keeping it would be invalid SQL. It
        # does exactly that. The events visibility predicate used to say `FROM request_clubs rc`,
        # and a recommendation query joins request_categories - the natural alias for which is also
        # `rc` - so the model renamed the inner one to `rc_sub` and wrote a semantically IDENTICAL
        # condition. Expanding the predicate with the query's map alone then rewrote the
        # predicate's own `rc.` into `request_categories.`, compared it against the query's
        # `request_clubs.`, and rejected a correct query three times over.
        #
        # Expanding each side to real TABLE names - the query by its map, the predicate by its own -
        # compares what both actually read rather than what they happened to call it. This loosens
        # nothing: an alias is a local name, and a predicate reading a different TABLE still fails.
        if not any(
            _comparable(predicate, {**aliases, **_alias_map(predicate)}) in normalised_sql
            for predicate in predicates
        ):
            raise SqlRejected(
                f"The query reads '{table}' without the required access condition. It must include "
                "one of these exactly as written: " + " | ".join(predicates),
                repairable=True,
            )

    # 7b. PUBLIC_COUNT_ONLY means exactly that - aggregate, never identify. A predicate is a row
    # filter, and no row filter can express "you may COUNT these rows but not PROJECT them".
    if _COUNT_ONLY_MARKER.lower() in normalised_sql:
        if not re.search(r"\bcount\s*\(", structural_lower):
            raise SqlRejected(
                f"{_COUNT_ONLY_MARKER} may only be used on an aggregate query. Use COUNT(*) - "
                "there is no per-person read of this table available to anyone.",
                repairable=True,
            )
        for column in _IDENTIFYING_REGISTRATION_COLUMNS:
            if re.search(rf"\b{re.escape(column)}\b", structural_lower):
                raise SqlRejected(
                    f"A {_COUNT_ONLY_MARKER} query may not reference '{column}' - the COUNT is "
                    "public, but who those people are is not answerable at all.",
                    repairable=True,
                )

    return cleaned
