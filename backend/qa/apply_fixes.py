"""Re-applies the QA-discovered fixes to the AI module. Idempotent - safe to re-run.

Each fix is anchored on a distinctive line of the current source, so it survives ordinary edits
around it and reports loudly if an anchor is gone. Run from backend/:  python qa/apply_fixes.py

Fixes, and the defect each closes (see qa/DEFECTS.md):
  D1  sql_llm     the SQL generator was never told today's date, so "October" resolved to a year
                  guessed from training data and matched nothing.
  D2  sql_guard   EXTRACT(MONTH FROM x.date) made the table-reference regex read the column's
                  qualifier as a table, rejecting every valid date-part query.
  D6  sql_runner  the result block carried column names but not what the query MEANT, so the
                  model answered "you are not president of any club" while holding the rows.
  D7  sql_runner  a scoped PARTIAL result was presented as complete ("Daniel Wong registered"
                  for a five-person roster).
  D8  sql_runner  + sql_llm: an invented membership relationship, and silent truncation of the
                  asker's own multi-row data.
"""
from __future__ import annotations

import io
import sys

APPLIED, MISSING = [], []


def edit(path: str, old: str, new: str, label: str, marker: str) -> None:
    src = io.open(path, encoding="utf-8").read()
    if marker in src:
        print(f"  = {label}: already present")
        return
    if old not in src:
        print(f"  ! {label}: ANCHOR NOT FOUND - fix NOT applied")
        MISSING.append(label)
        return
    io.open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
    print(f"  + {label}: applied")
    APPLIED.append(label)


SQL_LLM = "app/ai/sql_llm.py"
GUARD = "app/ai/sql_guard.py"
RUNNER = "app/ai/sql_runner.py"

DATES_RULE = """- DATES: you do not know what year it is from your own training, and guessing one is how a question
  about "October" became `es.date BETWEEN '2024-10-01' AND '2024-10-31'` against a table whose rows
  are all in 2026 - zero rows, and the assistant then reported a confident, WRONG "there are no
  events in October". A wrong date filter reads as an empty result, not as an error, which is the
  same trap as the title rule below. Never write a year you inferred rather than one you were
  given. Build every relative or partial date from CURRENT_DATE (and the TODAY line in the prompt):
      "in October"       -> EXTRACT(MONTH FROM es.date) = 10 AND es.date >= CURRENT_DATE
      "tomorrow"         -> es.date = CURRENT_DATE + 1
      "this week"        -> es.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      "next month"       -> es.date BETWEEN CURRENT_DATE AND CURRENT_DATE + 31
      "upcoming"/"soon"  -> es.date >= CURRENT_DATE
  Write a literal date ONLY when the asker stated it in full themselves ("on 2026-10-16")."""

ORDER_LINE = "- Order results sensibly: dates ascending for upcoming events, most recent first for history."
edit(SQL_LLM, ORDER_LINE, ORDER_LINE + "\n" + DATES_RULE, "D1 DATES rule", "- DATES: you do not know what year")

edit(
    SQL_LLM,
    "import json\nimport logging\nimport re\nimport time",
    "import json\nimport logging\nimport re\nimport time\nfrom datetime import date",
    "D1 date import",
    "from datetime import date",
)

PROMPT_OLD = '    prompt = f"{schema_document}\\n\\n{scope_document}\\n\\n{prior}QUESTION:\\n{question}{correction}"'
PROMPT_NEW = (
    "    # The model has no clock, and a year guessed from training data produces an empty result\n"
    "    # rather than an error (see the DATES rule in the system instruction above).\n"
    '    today = f"TODAY IS {date.today().isoformat()}.\\n\\n"\n'
    '    prompt = f"{today}{schema_document}\\n\\n{scope_document}\\n\\n{prior}QUESTION:\\n{question}{correction}"'
)
edit(SQL_LLM, PROMPT_OLD, PROMPT_NEW, "D1 TODAY injection", "TODAY IS {date.today()")

NEVER_DUMP = """they ask something broad, give the few most relevant and offer to show more - the complete list is
only appropriate when they explicitly ask for all of them."""
OWN_DATA = NEVER_DUMP + """
  THIS DOES NOT APPLY TO THE ASKER'S OWN DATA. "Which clubs am I a member of", "what am I
  registered for", "which clubs do I run" are not browse questions: the set is theirs, it is small,
  and completeness is the entire point. Name EVERY row you were given, whether or not they said
  "all" - answering "you are a member of the APU Photography Club" when three rows came back is a
  wrong answer, not a concise one."""
edit(SQL_LLM, NEVER_DUMP, OWN_DATA, "D8b own-data completeness", "THIS DOES NOT APPLY TO THE ASKER'S OWN DATA")

TABLE_REF = '_TABLE_REF = re.compile(r"\\b(?:from|join)\\s+([a-zA-Z_][a-zA-Z0-9_]*)", re.IGNORECASE)'
FUNCTION_FROM = TABLE_REF + """
# EXTRACT / SUBSTRING / TRIM / OVERLAY take FROM as an ARGUMENT SEPARATOR, not as a table clause.
# These four are the whole set in PostgreSQL, which is what makes blanking them safe to enumerate.
_FUNCTION_FROM = re.compile(
    r"\\b(?:extract|substring|trim|overlay)\\s*\\([^()]*?\\bfrom\\b", re.IGNORECASE
)"""
edit(GUARD, TABLE_REF, FUNCTION_FROM, "D2 function-FROM regex", "_FUNCTION_FROM = re.compile")

BLANKER = '''def _blank_function_from(sql: str) -> str:
    """Blank the FROM that EXTRACT/SUBSTRING/TRIM/OVERLAY use as an argument separator.

    `EXTRACT(MONTH FROM event_schedule.date)` made _TABLE_REF capture the column's qualifier as a
    table name, rejecting every "which events are in October" query three times over and answering
    a confident, wrong "there are no events in October". Replaces only the four-letter keyword,
    with four spaces, so every other rule keeps working on the same offsets. The column reference
    is left intact, so rule 5 still validates it - this removes a false table reference, never a
    real check."""
    return _FUNCTION_FROM.sub(lambda m: m.group(0)[:-4] + "    ", sql)


def _alias_map(sql: str) -> dict[str, str]:'''
edit(GUARD, "def _alias_map(sql: str) -> dict[str, str]:", BLANKER, "D2 blanking helper", "def _blank_function_from")

STRUCTURAL = """    structural = _STRING_LITERAL.sub(lambda m: "'" + " " * (len(m.group(0)) - 2) + "'", cleaned)"""
edit(
    GUARD,
    STRUCTURAL,
    STRUCTURAL + """
    # ...and with the argument-separator FROM blanked, so a date-part expression is not read as a
    # table clause (see _blank_function_from).
    structural = _blank_function_from(structural)""",
    "D2 blanking call",
    "structural = _blank_function_from(structural)",
)

SCOPED_INLINE = '        scoped = any(marker in (sql or "").lower() for marker in ("user_id =", "applicant_user_id", "requester_user_id"))\n        if scoped:'
SCOPED_HOISTED = """    # Did the query have to carry a personal ownership condition to run at all? Computed once and
    # used by BOTH branches: an access-scoped result misleads whether it comes back empty (below)
    # or partial (further down), and only the empty half of that was ever handled.
    scoped = any(
        marker in (sql or "").lower()
        for marker in ("user_id =", "applicant_user_id", "requester_user_id")
    )

    if not rows:"""
edit(RUNNER, "    if not rows:", SCOPED_HOISTED, "D7 hoist scoped", "used by BOTH branches")
edit(RUNNER, SCOPED_INLINE, "        if scoped:", "D7 drop duplicate", "no-op-marker-never-present")

LINES_OLD = """    columns = list(rows[0].keys())
    lines = [f"DATABASE RESULT ({len(rows)} row{'s' if len(rows) != 1 else ''}):"]"""
LINES_NEW = '''    columns = list(rows[0].keys())
    # WHAT the rows mean lives in the query's conditions, not its column names, and only the column
    # names survive into this block. Asked "am I president of any club?", the model was handed
    # `club_name: APU Coding Society` - a bare name with nothing saying the asker presides over it -
    # and answered "No, you are not listed as the president of any club" while holding the rows that
    # prove otherwise. Generalises to every question whose answer is in the WHERE clause.
    lines = [
        f"DATABASE RESULT ({len(rows)} row{'s' if len(rows) != 1 else ''}):",
        "  These rows ARE the answer to this question - the conditions the question asked for have"
        " ALREADY been applied in selecting them. If the asker asked which clubs they are President"
        " of, these are exactly those clubs; if they asked what they are registered for, these are"
        " exactly those registrations. Do not re-judge whether a row qualifies, and never answer"
        " negatively ('you are not', 'you have none') while rows are present just because no column"
        " restates the question's wording."
        " The converse is equally binding: they answer the question ACTUALLY asked and nothing"
        " more. Never attach a personal relationship the question did not ask about - rows returned"
        " for 'which clubs have under 20 members' are club SIZES, and calling them 'clubs you are a"
        " member of' invents a membership fact about the asker.",
    ]
    if scoped:
        # The partial twin of the scoped-empty case above. Asked "who registered for the Career
        # Fair?" about an event he does NOT organise, the asker got back the one row that was his
        # to see - his own registration - and was told "Daniel Wong registered for the AI & Data
        # Science Career Fair", which reads as the complete roster when five people are on it.
        # Nothing leaked; the answer was still false.
        lines.append(
            "  SCOPE: these rows were RESTRICTED TO WHAT THIS ASKER MAY SEE, so they may be only"
            " their own slice of a larger set. If the question asked about OTHER people or about"
            " everyone ('who registered', 'who is in this club'), do NOT present these rows as the"
            " full answer or imply the list is complete - say you can only show them their own."
        )'''
edit(RUNNER, LINES_OLD, LINES_NEW, "D6+D7+D8a row semantics", "These rows ARE the answer to this question")

print(f"\napplied={len(APPLIED)} missing={len(MISSING)}")
if MISSING:
    print("MISSING ANCHORS:", ", ".join(MISSING))
    sys.exit(1)
