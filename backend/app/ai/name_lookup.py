"""Name -> user resolution, the one piece of the old club_retrieval.py the refactor still needs.

WHY THIS SURVIVED when the rest of club_retrieval.py did not. Everything else in that module was a
hand-written, pre-scoped SQL query - own_memberships(), eligible_clubs_for(), club_category_stats()
and friends - each embedding its own ownership rule in its own WHERE clause. Text-to-SQL generates
those queries now, and their ownership rules moved to scope_rules.py as REQUIRED PREDICATES that
sql_guard.py verifies, so keeping the functions too would mean two implementations of the same
rules drifting apart. That is the exact failure topic_access.py was written to eliminate, so the
functions were removed rather than kept "just in case".

These two are different in kind: they run BEFORE classification's authorization decisions, feeding
subject_scope.third_party_subject() the answer to "does this question name a real person other than
the asker?" - a question that has to be settled to know whether a privacy refusal applies at all.
That cannot be part of the generated query, because the whole point is to decide whether a query
should be generated.

Neither function ever answers anything. find_user_by_name() resolves a name to an id or refuses;
find_user_by_name_fuzzy() only ever SUGGESTS spellings. No club, membership, or event data is read
here, so neither can disclose anything - they are identity resolution, not retrieval.
"""
from __future__ import annotations

from difflib import SequenceMatcher

from ..db import query

# Below this, a "did you mean" suggestion would be more confusing than helpful - a name that barely
# resembles what was typed is more likely a coincidence than the person meant.
FUZZY_NAME_THRESHOLD = 0.6


def find_user_by_name(name: str) -> dict | None:
    """Best-effort name -> user row resolution. Returns None on no match OR an ambiguous
    (multiple) match - deliberately conservative, since guessing the wrong person here would send
    the privacy check the wrong subject entirely, not merely fail to find one."""
    rows = query(
        "SELECT user_id, full_name FROM users WHERE lower(full_name) = lower(%s) AND archived_at IS NULL",
        [name.strip()],
    )
    return rows[0] if len(rows) == 1 else None


def find_user_by_name_fuzzy(name: str, *, limit: int = 3) -> list[str]:
    """Near-miss full names for a name that did NOT resolve exactly - never used to ANSWER about a
    person (that would be guessing who was meant), only to let the privacy check refuse against the
    closest real name rather than silently finding nothing. Ranked by SequenceMatcher ratio against
    every active user's full name, closest first, above FUZZY_NAME_THRESHOLD only."""
    candidate = name.strip().lower()
    if not candidate:
        return []
    rows = query("SELECT full_name FROM users WHERE archived_at IS NULL")
    scored = sorted(
        ((SequenceMatcher(None, candidate, row["full_name"].lower()).ratio(), row["full_name"]) for row in rows),
        key=lambda pair: pair[0],
        reverse=True,
    )
    return [full_name for score, full_name in scored if score >= FUZZY_NAME_THRESHOLD][:limit]
