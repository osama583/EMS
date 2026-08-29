"""The authorization half of Text-to-SQL: which ROWS may this caller's query touch.

Two separate questions, both of which must pass, and neither of which is the model's to decide:

  1. "May this caller ask about this TOPIC at all?"  -> topic_access.py, unchanged. Page
     Visibility (nav_page_grants) grants a page; a topic's pages grant the topic. Already the
     app's single source of truth for the sidebar, require_page(), and the old chat - reused
     here exactly as-is rather than re-derived.

  2. "WHICH ROWS of that topic may they see?"  -> this module. Page access answers "can you
     reach Clubs"; it emphatically does not answer "may you see who is in Falcons Club". The
     old chat answered question 2 by hand-writing one scoped SQL function per case
     (own_memberships, own_event_registrants, user_status_for, ...), each embedding its
     ownership check in its own WHERE clause. Text-to-SQL removes those functions, so their
     rules have to live somewhere - here, as REQUIRED PREDICATES the generated SQL must
     contain, verified by sql_guard.py before execution rather than trusted from the model.

WHERE EACH RULE CAME FROM (nothing here is invented; every predicate mirrors code that already
enforces it for the equivalent REST endpoint):

  events visibility    api/events.py _published_clause / _GUEST_VISIBLE / _INTERNAL_VISIBLE:
                       guest -> Public, Club Only; signed-in -> + Internal; the event's own
                       owner -> + Private, but only for their OWN events. 'Private' has no
                       discovery surface for anybody else.
  event published      api/events.py: every discovery query requires
                       status = 'completed_approved'. A proposal in review is not an event.
  event ownership      api/events.py my_organized_events / services/workflow/authorization.py
                       is_proposal_owner: applicant_user_id, OR a co_owners row matched by
                       staff_id or by lower(trim(staff_email)) = the caller's email.
  registrant lists     ai/retrieval.py own_event_registrants: only for events the caller owns.
  own registrations    api/events.py GET /events/me/registrations: event_registration.user_id
                       = caller.
  club presidency      ai/club_retrieval.py presidencies_of: PUBLIC to any signed-in user, the
                       same fact a club's page already shows. Deliberately not gated further.
  club membership      ai/club_retrieval.py user_status_for: self, or a Club Admin (which here
                       means the clubs_admin TOPIC passed, i.e. Page Visibility granted Manage
                       Clubs - never the hardcoded role name; see topic_access.py's docstring
                       on why the role check was removed).
  join requests        ai/club_retrieval.py own_join_requests / inbound_join_requests_from:
                       the requester themselves, the president of the club requested, or a
                       Club Admin.
  president changes    ai/club_retrieval.py own_president_change_requests /
                       pending_president_change_requests: the outgoing president, or a Club
                       Admin.
  club active          ai/club_retrieval.py: active AND archived_at IS NULL everywhere.

A predicate is expressed as literal SQL text with the caller's real ids already substituted as
NUMBERS by the backend - never as a placeholder the model fills in, and never as an instruction
the model is asked to honour. The model is TOLD the predicate and sql_guard.py then CHECKS the
emitted SQL actually contains it; failing that check rejects the query outright.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# The "you may aggregate but not identify" marker, proved by sql_guard's rule 7b. Module-level
# because two unrelated topic blocks below now grant it (event registrations and club members) and
# a question about only one of them must not depend on the other block having run.
_COUNT_ONLY = "PUBLIC_COUNT_ONLY"


@dataclass(frozen=True)
class Scope:
    """One caller's complete data scope for one question.

    `required_predicates` maps a table to SQL fragments, ANY ONE of which must appear (verbatim,
    whitespace-normalised) in the generated SQL whenever that table is queried. `notes` is the
    human-readable version handed to the model so it writes conforming SQL first time instead of
    being rejected and retried.
    """

    user_id: int | None
    is_student: bool
    is_club_admin: bool  # the clubs_admin TOPIC passed Page Visibility - not a role name
    required_predicates: dict[str, tuple[str, ...]] = field(default_factory=dict)
    notes: tuple[str, ...] = ()

    def predicates_for(self, table: str) -> tuple[str, ...]:
        return self.required_predicates.get(table, ())


def _sql_literal(value: str) -> str:
    """A single-quoted SQL string literal. Only ever applied to values that came from the
    AUTHENTICATED principal (the caller's own email), never to anything from the question - but
    quotes are still doubled, because a predicate built by naive concatenation is the one place
    this design could reintroduce injection, and "the input is trusted" is exactly the assumption
    that stops being true when someone later reuses the helper."""
    return "'" + value.replace("'", "''") + "'"


def _owner_clause(alias: str, request_ref: str, user_id: int, email: str) -> str:
    """The "this caller owns that event" test - applicant, or a co_owners row matched by staff_id
    or by email, exactly as services/workflow/authorization.is_proposal_owner does it.

    The caller's email is substituted as a LITERAL rather than looked up with a
    `SELECT email FROM users` subquery. Two reasons, and the second is the important one: the
    backend already knows it (it is on the authenticated principal), so the lookup was pure
    overhead; and users.email is now an EXCLUDED column, so a predicate that reads it would be
    rejected by the guard on the bare word - the required condition itself would have made every
    valid query unrunnable."""
    return (
        f"{alias}.applicant_user_id = {user_id}"
        f" OR EXISTS (SELECT 1 FROM co_owners co_{alias} LEFT JOIN staff s_{alias}"
        f" ON s_{alias}.staff_id = co_{alias}.staff_id"
        f" WHERE co_{alias}.request_id = {request_ref} AND (s_{alias}.user_id = {user_id}"
        f" OR lower(trim(co_{alias}.staff_email)) = {_sql_literal(email.strip().lower())}))"
    )


def _event_visibility_predicates(user_id: int | None, email: str | None) -> tuple[str, ...]:
    """Mirrors api/events.py _published_clause exactly. Both halves - published status AND
    visibility - are required together, because either alone is a leak: visibility without
    status exposes proposals still in review, and status without visibility exposes Private
    events to everyone."""
    if user_id is None:
        return (
            "request.status = 'completed_approved' AND request.event_visibility = 'Public'",
        )
    # A signed-in caller: the shared tiers, OR a 'Club Only' event addressed to a club they
    # are a MEMBER of, OR their own event at any visibility (including Private) - the
    # my_organized_events owner_clause. The Club Only branch is a membership test, not a
    # tier: without it the assistant would answer questions about events the asker cannot
    # see in the UI, which is the same leak _published_clause closes.
    owned = _owner_clause("request", "request.request_id", user_id, email or "")
    club_member = (
        "(request.event_visibility = 'Club Only' AND EXISTS ("
        "SELECT 1 FROM request_clubs rc JOIN club_members cm ON cm.club_id = rc.club_id "
        f"WHERE rc.request_id = request.request_id AND cm.user_id = {int(user_id)}))"
    )
    return (
        "request.status = 'completed_approved' AND (request.event_visibility IN "
        f"('Public', 'Internal') OR {club_member} OR ({owned}))",
    )


def build_scope(principal, topics: set[str]) -> Scope:
    """The caller's row-level scope for THIS question's topics.

    Called AFTER topic_access.denied_topics() has already stripped every topic Page Visibility
    refuses, so `topics` here is only what the caller may reach at all - this narrows further,
    to which rows within it.
    """
    user_id = principal.user_id if principal is not None else None
    email = getattr(principal, "email", None) if principal is not None else None
    is_student = principal is not None and principal.has_role("student")
    # "Club admin" here means the clubs_admin topic survived the page gate, i.e. Page Visibility
    # grants Manage Clubs / Club Category. Never principal.has_role("club-admin"): that is the
    # exact drift topic_access.py was written to remove (a custom role granted the page was
    # refused; a club-admin whose page was revoked was still answered).
    is_club_admin = "clubs_admin" in topics

    predicates: dict[str, tuple[str, ...]] = {}
    notes: list[str] = []

    if topics & {"events", "my_registrations", "event_organiser", "event_organiser_decisions"}:
        predicates["request"] = _event_visibility_predicates(user_id, email)
        if user_id is None:
            notes.append(
                "The asker is a GUEST (not signed in). Events: only published Public and Club Only "
                "events exist for them. They have no registrations, no organised events, and no "
                "club data whatsoever."
            )
        else:
            notes.append(
                f"The asker is user_id = {user_id}. Every query on `request` MUST carry the "
                "published-and-visible condition given in REQUIRED CONDITIONS below - it already "
                "includes their own events at any visibility, so do not widen it."
            )

        # Registrations split into a PUBLIC half and a PRIVATE half, and conflating them was a real
        # bug: the whole table was treated as private, so "how many people registered for the
        # hackathon" answered 0 for a caller who organises nothing - while the Explore Events page
        # was displaying "5 registered" on the card for that very event, to that very user.
        #
        # HOW MANY is public. api/events.py's _event_select ships confirmedRegistrationCount and
        # pendingRegistrationCount on EVERY published event to EVERY viewer, guests included (it is
        # also what enforces the max_pax "full" badge). Refusing to count is therefore not a privacy
        # win - it withholds a number already printed on the page and makes the assistant look
        # broken.
        #
        # WHO is private, and stays exactly as private as it was. Names, emails, reasons for
        # attending, payment state - those are the caller's own rows, or the roster of an event the
        # caller organises, and nothing else.
        #
        # The split is enforced by COLUMN, not by trusting the query's shape: PUBLIC_COUNT_ONLY
        # below is checked in sql_guard, which rejects any query using that predicate while
        # selecting an identifying column. A predicate cannot express "you may aggregate but not
        # project", so the guard does that half.
        count_only = _COUNT_ONLY
        if user_id is not None:
            owner_of_event = (
                "EXISTS (SELECT 1 FROM request r_own WHERE r_own.request_id = "
                "event_registration.request_id AND ("
                + _owner_clause("r_own", "r_own.request_id", user_id, email or "")
                + "))"
            )
            predicates["event_registration"] = (
                f"event_registration.user_id = {user_id}",
                owner_of_event,
                _COUNT_ONLY,
            )
            predicates["saved_event"] = (f"saved_event.user_id = {user_id}",)
        else:
            predicates["event_registration"] = (count_only,)
            # A guest has no saved events; forbid the table rather than emit a predicate that could
            # never match.
            predicates["saved_event"] = ()
        notes.append(
            "Registrations, and the difference matters:\n"
            "    HOW MANY people registered for a published event is PUBLIC - the same number the "
            "event's own card shows everyone. To answer a count question, write an aggregate "
            "(COUNT) query and add the marker condition PUBLIC_COUNT_ONLY to its WHERE clause. "
            "Such a query may return counts, event titles and dates, and NOTHING that identifies a "
            "person - no names, no emails, no per-person rows.\n"
            "    WHO registered is PRIVATE. Registrant names and details are available only for "
            + (
                f"the asker's own registrations (event_registration.user_id = {user_id}) or the "
                "roster of an event the asker themselves organises."
                if user_id is not None
                else "a signed-in caller, and never for a guest."
            )
        )

    if topics & {"clubs", "clubs_mine", "clubs_admin", "president_change"}:
        # A club row itself is public catalogue data; only ACTIVE, non-archived clubs are real.
        predicates["clubs"] = ("clubs.active AND clubs.archived_at IS NULL",)
        notes.append(
            "Clubs: the club list, descriptions, categories and the club's PRESIDENT "
            "(clubs.user_id -> users.full_name) are public information for any signed-in asker."
        )
        if user_id is None:
            # No public tier for clubs at all (api/ai.py's module docstring).
            predicates["clubs"] = ()
            predicates["club_members"] = ()
            predicates["club_join_requests"] = ()
            predicates["club_president_change_requests"] = ()
            notes.append("The asker is a guest, and clubs have no guest tier - refuse club questions.")
        elif is_club_admin:
            # Club Admin (by page grant) sees membership/requests across every club - the same
            # breadth club_retrieval's caller_is_admin=True functions already allow.
            notes.append(
                "The asker has Club Administration access, so they may see membership, join "
                "requests and president-change requests for ANY club."
            )
        else:
            # Self, or the president of the club in question. Exactly user_status_for's and
            # inbound_join_requests_from's rules.
            president_of = (
                f"EXISTS (SELECT 1 FROM clubs c_pres WHERE c_pres.user_id = {user_id}"
                " AND c_pres.club_id = {table}.club_id)"
            )
            # Same split as event_registration above, for the same reason: HOW MANY members a club
            # has is public - `GET /clubs` is @require_auth and returns "memberCount" for every
            # club to any signed-in caller, and the Discover Clubs UI even sorts by it. Restricting
            # club_members to self/president made the assistant refuse a number the asker can read
            # on screen ("I don't have access to club membership details"), which is the
            # over-refusal half of the same bug as leaking a roster. WHO is in a club stays private;
            # sql_guard's rule 7b enforces the count/identify split by column.
            predicates["club_members"] = (
                f"club_members.user_id = {user_id}",
                president_of.format(table="club_members"),
                _COUNT_ONLY,
            )
            predicates["club_join_requests"] = (
                f"club_join_requests.requester_user_id = {user_id}",
                president_of.format(table="club_join_requests"),
            )
            predicates["club_president_change_requests"] = (
                f"club_president_change_requests.current_president_user_id = {user_id}",
                f"club_president_change_requests.requested_president_user_id = {user_id}",
                president_of.format(table="club_president_change_requests"),
            )
            notes.append(
                "The asker is NOT a club administrator. They may see WHO is in a club, and JOIN "
                "REQUESTS and PRESIDENT-CHANGE REQUESTS, only for themselves or for a club they "
                "are the President of. Never for anyone else.\n"
                "    HOW MANY members a club has is different, and is PUBLIC - the same number "
                "Discover Clubs shows every signed-in user. To answer a member-count question "
                "(\"which club has the most members\", \"any club under 20\"), write an aggregate "
                "(COUNT) query over club_members and add the marker condition PUBLIC_COUNT_ONLY to "
                "its WHERE clause. Such a query may return counts and club names, and NOTHING that "
                "identifies a person. Never refuse a member-COUNT question for lack of access."
            )
            if not is_student:
                notes.append(
                    "The asker is not a student, so they cannot join or be a member of any club. "
                    "Do not write a query that looks for their memberships or eligible clubs."
                )

    # `users` is readable for NAMES only, and only as a JOIN target - never as the subject of a
    # query. "List every user", "who has role X", "what is someone's email" is the admin directory,
    # which this assistant does not cover (api/ai.py's scope statement).
    #
    # This needs a real predicate, not just an instruction. `users` was originally left
    # unconstrained on the reasoning that it is only ever joined - but "only ever joined" was a
    # hope, not a rule, and `SELECT users.full_name, users.email FROM users` passed the guard
    # cleanly: no other table was touched, so no other table's predicate applied, and users had
    # none of its own. That is the entire staff-and-student directory, from a guest account.
    #
    # The predicate below forces every users row to be REACHED THROUGH something the caller is
    # already authorised to see - an event they can see, a club, or (signed in) themselves. It
    # cannot be satisfied by a bare enumeration, because a bare enumeration is exactly what it
    # excludes. users.email is additionally excluded outright further down for anyone but the
    # asker, since a name is all an answer ever needs.
    # Satisfiable in exactly two ways, both of which mean "this person was reached THROUGH
    # something already authorised" rather than enumerated:
    #
    #   a JOIN condition tying users.user_id to a column on an authorised row. This is what an
    #   ordinary "who organises this event" / "who is the president" question produces naturally,
    #   and it is the reason the predicate is written as the join itself rather than as a
    #   correlated EXISTS: requiring an EXISTS would reject every legitimate join, forcing the
    #   model into a strictly worse query shape to satisfy a rule that was meant to constrain
    #   nothing it was already doing.
    #
    #   the asker themselves, for a signed-in caller.
    #
    # What NONE of them permit is `FROM users` with no join at all - which is the directory dump
    # this predicate exists to stop. A bare SELECT/COUNT over users matches no option and is
    # rejected.
    # Only the joins whose OTHER table this question can actually reach: advertising a club join
    # in an events-only question would offer the model a route the table allow-list then rejects.
    # `predicates` at this point already has an entry for every table the topics above put in play,
    # so its keys ARE this question's reachable set.
    joins_by_table = {
        "request": "users.user_id = request.applicant_user_id",
        "event_registration": "users.user_id = event_registration.user_id",
        "clubs": "users.user_id = clubs.user_id",
        "club_members": "users.user_id = club_members.user_id",
        "club_join_requests": "users.user_id = club_join_requests.requester_user_id",
    }
    users_predicates = [
        join for table, join in joins_by_table.items()
        # A table with an EMPTY predicate tuple is forbidden outright for this caller (a guest and
        # club_members), so a join through it is not a route either.
        if predicates.get(table)
    ]
    if user_id is not None:
        users_predicates.insert(0, f"users.user_id = {user_id}")
    predicates["users"] = tuple(users_predicates)
    notes.append(
        "The `users` table may ONLY be used to resolve a NAME for a row you are already authorised "
        "to return (an event's organiser, a club's president, the asker themselves). Never SELECT "
        "from users as the main subject of a query, never list or count users, and never return "
        "users.email for anyone other than the asker. Reaching users requires one of its REQUIRED "
        "CONDITIONS below, which is satisfied by joining through the event or club that made the "
        "person visible in the first place."
    )

    return Scope(
        user_id=user_id,
        is_student=is_student,
        is_club_admin=is_club_admin,
        required_predicates=predicates,
        notes=tuple(notes),
    )


def document(scope: Scope) -> str:
    """The SCOPE section of the SQL-generation prompt: what this caller may see, and the exact
    conditions their SQL must carry. Written as requirements, not suggestions - sql_guard.py
    rejects SQL that omits them, so a model that ignores this simply gets no answer."""
    lines = ["ACCESS SCOPE for this asker (enforced by the backend - SQL violating it is rejected):"]
    lines += [f"  - {note}" for note in scope.notes]

    required = {t: p for t, p in scope.required_predicates.items() if p}
    forbidden = [t for t, p in scope.required_predicates.items() if not p]
    if required:
        lines.append(
            "\nREQUIRED CONDITIONS. If your query reads a table listed here, its WHERE clause must "
            "include one of that table's conditions EXACTLY as written (copy it verbatim):"
        )
        for table, options in sorted(required.items()):
            lines.append(f"  {table}:")
            lines += [f"      {predicate}" for predicate in options]
    if forbidden:
        lines.append(
            "\nFORBIDDEN TABLES for this asker (they have no access to any row): "
            + ", ".join(sorted(forbidden))
        )
    return "\n".join(lines)
