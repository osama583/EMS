"""ROW SCOPE: which rows a generated query may touch, once page visibility has already said the
topic itself is answerable.

Two separate questions, both of which must pass, and neither of which is the model's to decide:

  1. "May this caller ask about this TOPIC at all?"  -> topic_access.py. Page visibility, live.
  2. "Which ROWS within it may they see?"            -> here.

The second is not implied by the first. Reaching Explore Events says you may ask about events; it
does not say you may see a Private one. So every table this assistant can read carries a REQUIRED
PREDICATE - a SQL fragment the generated query must contain verbatim before sql_guard.py will let
it run. The model is told the predicates so it writes conforming SQL first time, but the backend
VERIFIES rather than trusts: a query missing its predicate never executes, so "retrieve broadly and
filter afterwards" is not a thing the model can do even by accident.

EVERY PREDICATE MIRRORS THE PAGE IT COMES FROM. The event condition is api/events.py's
_published_clause, character for character in meaning: published, and Public or Internal, or a Club
Only event addressed to a club the asker actually belongs to. If the Explore Events page would not
show the row, the assistant does not see it either - which is exactly what the assistant's scope
says ("only what the event card and the Explore Events details show").

Note what is NOT in the event condition any more: the organiser's own-events branch. Explore Events
does not carry it (my_organized_events is a different endpoint, on a different page), so neither
does this. The assistant answers about the catalogue, not about anyone's private copy of it.

COUNTS ARE PUBLIC, IDENTITIES ARE NOT, and that distinction is the whole of the registration and
membership rules. "N registered" is printed on every event card and "N members" on every club card,
so refusing to count them would contradict a page the asker is looking at. WHO those people are is
not something this assistant answers for anybody - not for an organiser, not for a president, not
for an administrator - so both tables carry the PUBLIC_COUNT_ONLY marker as their ONLY permitted
condition. A row filter cannot express "you may COUNT these but not PROJECT them", which is why the
marker exists and why sql_guard rule 7b enforces the aggregate-and-no-identifying-columns half of
it. There is no caller for whom that marker is replaced by a roster predicate; that is the change
that took rosters out of scope, and it is one line rather than a permission tier.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# The "you may aggregate but not identify" marker, proved by sql_guard's rule 7b. The only
# condition either people-table ever gets.
_COUNT_ONLY = "PUBLIC_COUNT_ONLY"


@dataclass(frozen=True)
class Scope:
    """One caller's complete row scope for one question.

    `required_predicates` maps a table to SQL fragments, ANY ONE of which must appear (verbatim,
    whitespace-normalised) in the generated SQL whenever that table is queried. An EMPTY tuple means
    the table is forbidden outright for this caller. `notes` is the human-readable version handed to
    the model so it writes conforming SQL first time instead of being rejected and retried.
    """

    user_id: int | None
    required_predicates: dict[str, tuple[str, ...]] = field(default_factory=dict)
    notes: tuple[str, ...] = ()

    def predicates_for(self, table: str) -> tuple[str, ...]:
        return self.required_predicates.get(table, ())


def _event_visibility_predicates(user_id: int | None) -> tuple[str, ...]:
    """Mirrors api/events.py _published_clause exactly, for the Explore Events listing.

    Both halves - published status AND visibility - are required together, because either alone is a
    leak: visibility without status exposes proposals still in review, and status without visibility
    exposes Private events to everyone.
    """
    if user_id is None:
        return ("request.status = 'completed_approved' AND request.event_visibility = 'Public'",)
    # ALIASES ARE SUFFIXED, and that is not cosmetic. `rc` and `cm` are the obvious short names for
    # request_categories and club_members, and the model reaches for them in the OUTER query - a
    # suggestion joins request_categories as `rc` every time. It then has to rename this clause's
    # `rc` to keep the SQL valid, which produced a semantically identical condition the guard
    # rejected three times over. The guard now compares real table names rather than aliases, so a
    # rename no longer breaks it - but not handing the model a collision in the first place is the
    # half of the fix that stops it having to rename at all.
    club_member = (
        "(request.event_visibility = 'Club Only' AND EXISTS ("
        "SELECT 1 FROM request_clubs rc_request JOIN club_members cm_request "
        "ON cm_request.club_id = rc_request.club_id "
        f"WHERE rc_request.request_id = request.request_id AND cm_request.user_id = {int(user_id)}))"
    )
    return (
        "request.status = 'completed_approved' AND (request.event_visibility IN "
        f"('Public', 'Internal') OR {club_member})",
    )


def build_scope(principal, topics: set[str]) -> Scope:
    """The caller's row scope for THIS question's topics.

    Called AFTER topic_access.denied_topics() has stripped every topic page visibility refuses, so
    `topics` here is only what the caller may reach at all - this narrows further, to which rows.
    """
    user_id = principal.user_id if principal is not None else None
    predicates: dict[str, tuple[str, ...]] = {}
    notes: list[str] = []

    if "events" in topics:
        predicates["request"] = _event_visibility_predicates(user_id)
        if user_id is None:
            notes.append(
                "The asker is a GUEST (not signed in). Only published PUBLIC events exist for them "
                "- exactly what the public Explore Events section shows."
            )
        else:
            notes.append(
                f"The asker is user_id = {user_id}. Every query on `request` MUST carry the "
                "published-and-visible condition given in REQUIRED CONDITIONS below, which is the "
                "same condition the Explore Events page itself uses. Do not widen it, and do not "
                "narrow it to their own events - they are asking about the catalogue."
            )

        # THE TWO TABLES THE `request` CONDITION ITSELF REACHES THROUGH. Its 'Club Only' branch is a
        # live membership test (a Club Only event names its audience in request_clubs, and who may
        # see it resolves against club_members), so any query carrying that condition - which is
        # every event query - necessarily touches both. They therefore need conditions of their own,
        # or they arrive on the guard's allow-list with nothing restricting what may be read FROM
        # them.
        #
        # Both are written to be satisfied BY THE MANDATORY CONDITION ITSELF, alias-expanded: the
        # `rc.request_id = request.request_id` and `cm.user_id = <id>` already inside it normalise
        # to exactly these. So a query that simply copies the required condition verbatim - what the
        # model is told to do - passes without writing a second thing, while a query that reaches
        # for either table on its own terms does not.
        if user_id is None:
            # A guest's visibility condition has no membership branch at all, so neither table has
            # any legitimate use in their query. Forbid both outright.
            predicates["request_clubs"] = ()
            predicates["club_members"] = ()
        else:
            predicates["request_clubs"] = ("request_clubs.request_id = request.request_id",)
            predicates["club_members"] = (f"club_members.user_id = {user_id}", _COUNT_ONLY)

        # Registrations: the public COUNT, plus the asker's OWN row - and nothing else, ever.
        # The own-row half is not a widening: the event card prints "Registered" / "Pending
        # Approval" to the viewer on their own card, so whether THEY are signed up is card data
        # exactly like the date and the venue. Without it the assistant recommends an event to
        # somebody already registered for it, which is the club version of the same bug.
        predicates["event_registration"] = (
            (f"event_registration.user_id = {user_id}", _COUNT_ONLY) if user_id is not None
            else (_COUNT_ONLY,)
        )
        notes.append(
            "Registrations, and there are exactly two things you may read:\n"
            "    HOW MANY people have registered is PUBLIC - the same number printed on the "
            "event's own card. Answer a count question with an aggregate (COUNT) query carrying "
            "the marker condition PUBLIC_COUNT_ONLY in its WHERE clause; such a query may return "
            "counts, event titles and dates, and NOTHING that identifies a person.\n"
            + (
                f"    WHETHER THE ASKER THEMSELVES is registered, via "
                f"event_registration.user_id = {user_id}. Their own card shows them this, so it is "
                "theirs to see. Use it to say 'you are already registered for this' rather than "
                "recommending it to them again.\n"
                if user_id is not None else ""
            )
            + "    WHO ELSE registered is not something this assistant answers for anyone, so "
              "there is no condition available for it and no query that returns it will run."
        )

    if "clubs" in topics:
        if user_id is None:
            # Clubs have no visitor tier at all - Discover Clubs is an internal page.
            predicates["clubs"] = ()
            predicates["club_members"] = ()
            notes.append(
                "The asker is a guest and clubs have no signed-out tier, so club questions cannot "
                "be answered for them at all."
            )
        else:
            # A club row is the public catalogue Discover Clubs shows; only ACTIVE, non-archived
            # clubs appear on it.
            predicates["clubs"] = ("clubs.active AND clubs.archived_at IS NULL",)
            # Merged rather than overwritten: an events question in the same turn needs the own-row
            # option for the Club Only visibility branch, and dropping it here would make the
            # mandatory event condition itself unsatisfiable. The own-row option is also wanted in
            # its own right here - see the note below.
            predicates["club_members"] = tuple(dict.fromkeys((
                f"club_members.user_id = {user_id}",
                *predicates.get("club_members", ()),
                _COUNT_ONLY,
            )))
            notes.append(
                "Clubs: a club's name, description, categories, current PRESIDENT and MEMBER COUNT "
                "are all printed on its card on Discover Clubs, so all of them are answerable. "
                "Answer a member-count question with an aggregate (COUNT) query over club_members "
                "carrying the marker condition PUBLIC_COUNT_ONLY; it may return counts and club "
                "names and NOTHING that identifies a person. WHO the members are is not something "
                "this assistant answers for anyone.\n"
                f"    WHETHER THE ASKER THEMSELVES is a member is different, and IS theirs to see: "
                f"club_members.user_id = {user_id}. Discover Clubs computes exactly this flag for "
                "every card and HIDES the clubs they are already in, so a suggestion that ignores "
                "it offers them a club the page would not even have shown them. Read it as a flag "
                f"per club - EXISTS (... AND cm.user_id = {user_id}) - never as a list of members.\n"
                f"    PRESIDENCY is on the club row itself: (clubs.user_id = {user_id}) says the "
                "asker presides over it, which Discover Clubs also hides."
            )

    # `users` is readable for NAMES only, and only as a JOIN target - never as the subject of a
    # query. The two names on a card are the event's organiser and the club's president.
    joins_by_table = {
        "request": "users.user_id = request.applicant_user_id",
        "clubs": "users.user_id = clubs.user_id",
    }
    predicates["users"] = tuple(
        join for table, join in joins_by_table.items()
        # A table with an EMPTY predicate tuple is forbidden outright for this caller, so a join
        # through it is not a route either.
        if predicates.get(table)
    )
    notes.append(
        "The `users` table may ONLY resolve a NAME for a row you are already authorised to return - "
        "an event's organiser, or a club's president. Never SELECT from users as the main subject "
        "of a query, never list or count users, and never return anyone's email. Reaching users "
        "requires one of its REQUIRED CONDITIONS below, which is satisfied by joining through the "
        "event or club that made the person visible in the first place."
    )

    return Scope(user_id=user_id, required_predicates=predicates, notes=tuple(notes))


def document(scope: Scope) -> str:
    """The SCOPE section of the SQL-generation prompt: what this caller may see, and the exact
    conditions their SQL must carry. Written as requirements, not suggestions - sql_guard.py rejects
    SQL that omits them, so a model that ignores this simply gets no answer."""
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
