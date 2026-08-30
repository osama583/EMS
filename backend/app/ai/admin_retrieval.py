"""System-Admin-only live facts: config thresholds, user/role headcounts, and
event category/format active-status - the facts a System Admin actually
manages at /app/admin/settings/policies, /app/admin/directory, and
/app/admin/(categories|formats), none of which existed anywhere in the AI
layer before. The transcript that prompted this module showed the model
either refusing ("I don't have information...") or guessing a plausible-
looking number instead of reading the real config row - both are worse than
an honest empty result, so every fact here is a live query, never a
hardcoded/prompt-text value (see knowledge_base.py's module docstring for why
STATIC text is fine for narrative capability answers but would be actively
wrong here: an admin who changes HIGH_PAX_THRESHOLD needs the very next
question about it to reflect that, not a value frozen at deploy time).

Every function is unguarded by role here - the SAME admin-only boundary
api/ai.py's is_admin gate already uses for club-admin/cafeteria-admin
analytics (see ai.py's `is_club_admin`/`is_cafeteria_admin` checks) is
applied at the call site, not duplicated per-function, since there is only
one caller (ask()) and one admin role these facts are ever relevant to.
"""
from __future__ import annotations

from ..db import query, query_one
from ..services import identity

_CONFIG_LABEL: dict[str, str] = {
    "HIGH_PAX_THRESHOLD": "High Pax Threshold (attendee count above which an event also needs F&B and CFO approval)",
    "CANCELLATION_DEADLINE_DAYS": "Application Cancellation Deadline (days before the event date after which a proposal/event can no longer be cancelled)",
    "MAX_EVENT_CATEGORIES": "Maximum Event Categories (how many categories a single event can be tagged with)",
    "MIN_EVENT_LEAD_DAYS": "Minimum Event Lead Time (days of notice required between today and the event start date)",
}


def config_document() -> str:
    """All three admin-tunable thresholds, read live from the config table (see
    catalog.py's CONFIG_FIELDS - this mirrors the exact same three rows the
    real /app/admin/settings/policies page edits). Always returns all three
    together rather than trying to guess which one a paraphrased question
    meant - cheap enough to just hand the model every value and let it pick
    the one the question actually asked about."""
    rows = {r["code"]: r["number"] for r in query("SELECT code, number FROM config")}
    lines = ["Current system configuration values (admin-tunable, live from /app/admin/settings/policies):"]
    for code, label in _CONFIG_LABEL.items():
        if code in rows:
            lines.append(f"- {label}: {int(rows[code])}")
    return "\n".join(lines)


def user_headcount_document() -> str:
    """Total active user count, plus how many have zero active role assignment
    at all - both come up as "how many users" / "any user without a role" in
    the transcript this module was written for, and neither existed as a
    retrievable fact before (the model either refused or, worse, invented a
    number)."""
    total = query_one("SELECT COUNT(*) AS n FROM users WHERE is_active AND archived_at IS NULL")["n"]
    unassigned_rows = query(
        """
        SELECT u.full_name AS "fullName", u.email
          FROM users u
         WHERE u.is_active AND u.archived_at IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM user_unit_roles uur
                WHERE uur.user_id = u.user_id AND uur.is_active AND uur.archived_at IS NULL
           )
         ORDER BY u.full_name
        """
    )
    lines = [f"Total active users in the system: {total}."]
    if unassigned_rows:
        names = ", ".join(f"{r['fullName']} ({r['email']})" for r in unassigned_rows)
        lines.append(f"{len(unassigned_rows)} active user(s) have no role assignment at all: {names}.")
    else:
        lines.append("Every active user has at least one role assignment - none are unassigned.")
    return "\n".join(lines)


def category_format_status_document() -> str:
    """Active/inactive status for every event category and event format - the
    admin-managed catalogues behind /app/admin/categories and
    /app/admin/formats. Lists ALL rows with their status rather than just the
    inactive ones, since a question can ask either direction ("what's NOT
    active" vs "what IS active") and the model should never have to infer the
    complement of a partial list."""
    categories = query(
        "SELECT name, active FROM event_category WHERE archived_at IS NULL ORDER BY name"
    )
    formats = query(
        "SELECT name, active FROM event_format WHERE archived_at IS NULL ORDER BY name"
    )
    def _section(label: str, rows: list) -> list[str]:
        """One catalogue, with an explicit completeness tally.

        The bare list alone was observed producing a self-contradicting answer: asked "are all the
        event formats switched on right now" with every format active, the model replied "No, not
        all ... are currently active" and then listed all five as active, hedging with "there may be
        others not listed". A list with no closing statement reads as possibly-partial, so an
        all-or-nothing question cannot be answered from it with confidence. The tally below states
        the totals outright so "are they all on" has a direct, checkable answer."""
        out = [f"{label} (this list is complete - every one in the system is shown):"]
        out += [f"- {r['name']}: {'active' if r['active'] else 'inactive'}" for r in rows] or ["(none defined)"]
        active = sum(1 for r in rows if r["active"])
        inactive = len(rows) - active
        if rows:
            if not inactive:
                out.append(f"All {len(rows)} are active; none are inactive.")
            elif not active:
                out.append(f"None are active; all {len(rows)} are inactive.")
            else:
                out.append(f"{active} of {len(rows)} are active; {inactive} are inactive.")
        return out

    lines = _section("Event categories and their active status", categories)
    lines += _section("Event formats and their active status", formats)
    return "\n".join(lines)


def roles_document() -> str:
    """Every role that actually exists in the `role` table - the live data behind /app/roles.
    Written because "how many roles"/"what are they" was observed answered ENTIRELY from
    hallucination (no retrieval backed it at all): the model invented a count, invented a role
    called "General User" that does not exist anywhere in the schema, and gave contradictory
    answers about Staff across turns. Every role name/description here comes straight from the
    `role` table - the exact same rows knowledge_base._ROLE_LABEL hand-maintains a display-name
    subset of, so a real answer here can also be immediately cross-checked against
    role_capability_document() for what a specific one of these can actually do."""
    rows = query(
        "SELECT role_name, description, is_active FROM role WHERE archived_at IS NULL ORDER BY role_name"
    )
    if not rows:
        return "There are no roles defined in the system."
    lines = [f"The system has {len(rows)} role(s):"]
    lines += [f"- {r['role_name']}: {r['description'] or 'no description'}" + ("" if r["is_active"] else " [inactive]") for r in rows]
    return "\n".join(lines)


def units_document() -> str:
    """Every operational unit/department - the live data behind /app/units, a System-Admin-only
    page (see nav_page's admin-units row). Gated exactly like config_document/
    user_headcount_document/page_visibility_document - only ever added to CONTEXT for an admin
    caller (see api/ai.py's admin_settings dispatch). Written to close the exact gap a "what unit
    handles photography" question fell into: with no `units` class at all, that question had
    nowhere correct to route to, so the LLM classification fallback guessed the closest wrong
    bucket (clubs) and the model hallucinated a club to match."""
    rows = query(
        "SELECT description AS name, code, is_active AS active FROM unit WHERE archived_at IS NULL ORDER BY description"
    )
    if not rows:
        return "There are no units defined in the system."
    lines = ["Operational units/departments in the system:"]
    lines += [f"- {r['name']} (code={r['code']})" + ("" if r["active"] else " [inactive]") for r in rows]
    return "\n".join(lines)


def user_directory_document(limit: int = 60) -> str:
    """Every active user and every role/unit they hold - the live data behind
    /app/admin/directory. Capped at `limit` rows so a "list all users" question
    on a large system doesn't blow the context budget; a question naming ONE
    specific person should go through find_users_by_partial_name() below
    instead (this is for breadth - "who are the Cafeteria Managers", "how many
    students do we have" - not a single lookup, which this cannot safely
    disambiguate: a name here matches whichever row happens to read first)."""
    rows = query(
        """
        SELECT u.user_id, u.full_name AS "fullName", u.email,
               COALESCE(
                   string_agg(DISTINCT r.role_name || COALESCE(' (' || un.description || ')', ''), ', '),
                   'no role assigned'
               ) AS roles
          FROM users u
     LEFT JOIN user_unit_roles uur ON uur.user_id = u.user_id AND uur.is_active AND uur.archived_at IS NULL
     LEFT JOIN role r ON r.role_code = uur.role_code AND r.archived_at IS NULL
     LEFT JOIN unit un ON un.code = uur.unit_code
         WHERE u.is_active AND u.archived_at IS NULL
      GROUP BY u.user_id, u.full_name, u.email
      ORDER BY u.full_name
         LIMIT %s
        """,
        (limit,),
    )
    if not rows:
        return "There are no active users in the system."
    lines = [f"Active users and their roles (showing up to {limit}):"]
    lines += [f"- {r['fullName']} ({r['email']}): {r['roles']}" for r in rows]
    return "\n".join(lines)


def find_users_by_partial_name(name: str, *, limit: int = 8) -> list[dict]:
    """Every active user whose full name CONTAINS `name` (case-insensitive) - a first-name-only
    or partial lookup ("ahmed", "Farah"), unlike club_retrieval.find_user_by_name's exact-full-name
    match. Deliberately returns every match rather than picking one: with two "Osamah Al-Naggar"
    accounts and unrelated "Farah Aziz" alongside any other Farah, silently answering about
    whichever row the query happens to return first would be confidently wrong for the other
    person(s) - the caller (api/ai.py) is expected to ask the asker to disambiguate whenever this
    returns more than one row, never to guess."""
    stripped = name.strip()
    if not stripped:
        return []
    return query(
        """
        SELECT u.user_id, u.full_name AS "fullName", u.email,
               COALESCE(
                   string_agg(DISTINCT r.role_name || COALESCE(' (' || un.description || ')', ''), ', '),
                   'no role assigned'
               ) AS roles
          FROM users u
     LEFT JOIN user_unit_roles uur ON uur.user_id = u.user_id AND uur.is_active AND uur.archived_at IS NULL
     LEFT JOIN role r ON r.role_code = uur.role_code AND r.archived_at IS NULL
     LEFT JOIN unit un ON un.code = uur.unit_code
         WHERE u.is_active AND u.archived_at IS NULL AND u.full_name ILIKE %s
      GROUP BY u.user_id, u.full_name, u.email
      ORDER BY u.full_name
         LIMIT %s
        """,
        (f"%{stripped}%", limit),
    )


def person_lookup_document(name: str) -> str | None:
    """CONTEXT block for an admin_settings question naming ONE specific person by (possibly
    partial) name - None means no name-shaped token was worth looking up, so the caller falls
    back to the general admin_settings documents instead. Three outcomes, each phrased so the
    model has no room to guess past this function's own finding:
      0 matches  - explicit "no such person" fact, not silence (silence lets the model invent one).
      1 match    - that person's own row, the only case where a specific fact is handed over.
      2+ matches - every candidate's name AND email, with an explicit instruction to ask which one
                   before answering - the exact gap that let "which department does Farah work at"
                   answer about one of several Farahs with no acknowledgement another one exists.
    """
    matches = find_users_by_partial_name(name)
    if not matches:
        return f"No active user matches the name \"{name}\". Say plainly that no one by that name was found - do not guess a similar name instead."
    if len(matches) == 1:
        row = matches[0]
        return f"The person named \"{name}\" is: {row['fullName']} ({row['email']}): {row['roles']}."
    listed = "\n".join(f"- {r['fullName']} ({r['email']}): {r['roles']}" for r in matches)
    return (
        f"More than one active user matches the name \"{name}\":\n{listed}\n"
        "Do NOT pick one of these and answer as if only one exists. Ask the asker which specific "
        "person they mean (their full name or email is enough to tell them apart), and wait for "
        "them to say which one before stating any fact about a specific person."
    )


def users_by_role_document(role_code: str, role_label: str) -> str:
    """CONTEXT block for "who holds ROLE X" ("who has the Cafeteria Admin role", "which staff are
    Cafeteria Admin") - a different question from role_capability_document's "what CAN Cafeteria
    Admin do", which has no user list behind it at all. Written after this exact question was
    observed answered with "I don't have access to a list of which specific users hold the
    Cafeteria Admin role" - query_router.classify() routed it to role_capability (matched the role
    NAME, same as any "what can X do" question) and nothing downstream ever tried a membership
    lookup, even though user_directory_document's underlying join already has this data per-user;
    it was just never filtered by role. `role_label` is the human-readable name (e.g. "Cafeteria
    Admin") purely for the reply text - `role_code` (e.g. "cafeteria-admin") is what's actually
    queried against user_unit_roles.role_code."""
    rows = query(
        """
        SELECT u.full_name AS "fullName", u.email, un.description AS unit
          FROM user_unit_roles uur
          JOIN users u ON u.user_id = uur.user_id AND u.is_active AND u.archived_at IS NULL
     LEFT JOIN unit un ON un.code = uur.unit_code
         WHERE uur.role_code = %s AND uur.is_active AND uur.archived_at IS NULL
      ORDER BY u.full_name
        """,
        (role_code,),
    )
    if not rows:
        return f"No active user currently holds the {role_label} role. This is a complete, real answer - state it plainly, not as a sign of missing access."
    lines = [f"Active users holding the {role_label} role:"]
    lines += [f"- {r['fullName']} ({r['email']})" + (f" - {r['unit']}" if r["unit"] else "") for r in rows]
    return "\n".join(lines)


def page_visibility_document() -> str:
    """Every nav page and which roles/units currently grant access to it - the
    live data behind /app/admin/page-visibility. Lets a System Admin ask "who
    can see the Proposal Form" or "what pages does Cafeteria Staff have" and
    get today's actual grant configuration, not a hand-written guess of what
    the app was designed to allow (that hand-written version is
    knowledge_base.role_capability_document - this is the ground truth it
    approximates when a page isn't tied to a known static capability line).

    Each line also states the page's PARENT FOLDER, because that is part of
    whether someone can actually reach it: identity.has_page_access() requires
    access to every ancestor folder as well as the page itself (a folder the
    caller cannot see hides all of its children). Questions like "what is the
    parent folder of Ongoing" previously had no data behind them at all - the
    folder relationship was in nav_page but never surfaced here."""
    pages = {p["page_code"]: p for p in identity.all_nav_pages()}
    grants_by_page: dict[str, list[dict]] = {}
    for grant in identity.all_nav_grants():
        grants_by_page.setdefault(grant["page_code"], []).append(grant)

    def describe(page: dict) -> str:
        parent_code = page.get("parent_page_code")
        parent = pages.get(parent_code) if parent_code else None
        where = f" [inside the '{parent['label']}' folder]" if parent else " [top level, no parent folder]"
        kind = "folder" if page.get("entry_type") == "folder" else "page"
        return f"- {page['label']} ({page['page_code']}, {kind}){where}"

    lines = [
        "Page Visibility - every page/folder, its parent folder, and which roles/units grant "
        "access to it. Reaching a page requires access to the page AND to every folder above it:"
    ]
    for page_code, page in pages.items():
        grants = grants_by_page.get(page_code, [])
        if not grants:
            lines.append(f"{describe(page)}: no active grants - nobody can access this.")
            continue
        parts = []
        for g in grants:
            roles = ", ".join(g["role_codes"] or ()) or "none"
            if g["grant_type"] == "role":
                parts.append(f"role(s) {roles}")
            elif g["grant_type"] == "unit":
                units = ", ".join(g["unit_codes"] or ()) or "none"
                parts.append(f"anyone in unit(s) {units}")
            else:
                units = ", ".join(g["unit_codes"] or ()) or "none"
                parts.append(f"role(s) {roles} within unit(s) {units}")
        lines.append(f"{describe(page)}: " + "; ".join(parts))
    return "\n".join(lines)


def ai_denials_document(limit: int = 20) -> str:
    """Has the AI ASSISTANT ITSELF refused to answer any question, and why - the live data behind
    /app/admin/ai-access-log (the ai_access_denial table, written by topic_access.log_denials()
    whenever a question is refused for lacking a Page Visibility grant). Capped at `limit`, newest
    first, same reasoning as user_directory_document's cap - a System Admin asking "has anyone been
    refused" wants to know THAT it happened and roughly what/who, not every historical row.

    Deliberately answers from THIS table only, not from "did the assistant get any question wrong
    generally" - a wrong or unhelpful answer that was never actually a Page-Visibility denial (e.g.
    the assistant answering from empty retrieved data) does not appear here, and this function must
    not imply otherwise; see this table's own module comment in topic_access.py for why a denial and
    a merely-unhelpful answer are two different things."""
    rows = query(
        """
        SELECT user_email AS "userEmail", topic_label AS "topicLabel", question, created_at AS "createdAt"
          FROM ai_access_denial
      ORDER BY created_at DESC, denial_id DESC
         LIMIT %s
        """,
        (limit,),
    )
    if not rows:
        return "The AI access log is empty - the assistant has not refused any question yet."
    lines = [
        f"The assistant HAS refused questions before - {len(rows)} most recent refusal(s) "
        f"from the AI access log (newest first):"
    ]
    lines += [
        f"- {r['userEmail'] or 'a guest'} asked about {r['topicLabel']} (\"{r['question']}\") "
        f"on {r['createdAt']:%d %b %Y, %H:%M} - refused for lacking page access to that topic"
        for r in rows
    ]
    return "\n".join(lines)
