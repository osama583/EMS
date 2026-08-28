"""Static, hand-curated reference content for the AI assistant: what the SYSTEM
can do (system_capability), how to do specific things (how_to_guides), and what
THIS SPECIFIC CALLER can do given their actual role(s) (self_capability).

Unlike every other ai/*.py module, none of this is retrieved from a live query -
these are facts about the app's own structure/workflow, which change only when
the app itself changes, not per-request. Writing them once, by hand, and having
the model quote them verbatim as CONTEXT (same mechanism as every other domain)
is deliberately more reliable than letting the model reconstruct "how does the
approval process work" or "what can a Cafeteria Admin do" from the system
prompt's general instructions alone - see api/ai.py's module comment and the
deterministic _try_answer_*() short-circuits in api/ai.py for the same
reasoning applied to single facts instead of narrative content.

self_capability answers by UI/nav VISIBILITY (seed/nav.py's grants - what a role
actually sees and can reach in the app), matching what security.decorators.require_page()
now also enforces server-side on the write endpoints a page's own action calls
(proposals.py's create_proposal/save_draft, clubs.py's request_to_join/
request_president_change) - the two used to be able to drift (a role not REJECTED
by POST /proposals even with its Forms>Proposal page revoked in
/app/admin/page-visibility) before require_page() closed that gap; this module's
job is the separate, still-necessary half - never TELLING someone they have a
capability an admin has since revoked, even though the API would now correctly
refuse it too. self_capability_document() checks each capability's backing
page_code LIVE (identity.has_page_access) rather than trusting a hand-written
role->capability list frozen at code-deploy time, so a Page Visibility edit is
reflected in the very next answer, not just in the API's own enforcement.

A real account can hold MULTIPLE role_codes at once (see security/principal.py's
Principal.assignments - a tuple, not a single value; nothing in the app collapses
a user to one role). self_capability_for() reflects that: it unions every held
role's capabilities and labels each capability with WHICH role grants it, so a
System Admin who is ALSO a Student is correctly told they cannot manage clubs as
an admin but CAN join one as a student - never a single flattened "as a X" answer
that silently drops a second role's real capabilities.
"""
from __future__ import annotations

from ..services import identity

# --- system_capability: what the platform itself does, independent of caller --

SYSTEM_CAPABILITY = """This platform (APU Events) has four areas:
1. EVENTS - browse/search published events (Explore Events), see event details, save events,
   register to attend (guests can register too, no account needed for a Public event).
2. PROPOSALS - internal staff/students/lecturers submit a proposal to run an event; it is
   reviewed through a workflow (Head of School/Department, then F&B and/or CFO for high-pax or
   paid events, then the departments providing logistics/transport/sound/photography/campus
   tours/catering), and becomes a published event once fully approved.
3. CLUBS - students and lecturers can discover clubs, join them, and (students only) become a
   club President; a President reviews join requests for their own club and can hand the role
   to another student via a president-change request, decided by a Club Admin.
4. CAFETERIAS - each cafeteria has a menu, staff, and an order queue for catering requests tied
   to approved events; a Cafeteria Admin runs the whole cafeteria system, a Cafeteria Manager
   runs one outlet, and Cafeteria Staff fulfil that outlet's orders.
Every account also has "My Requests" (Ongoing/History/Drafts) to track their own proposals, and
an Inbox for whatever currently needs their action (a reviewer's pending decision, a manual-
approval registration awaiting the organiser, etc.)."""


# --- how_to_guides: step-by-step procedures, independent of caller -------------

HOW_TO_GUIDES: dict[str, str] = {
    "submit_proposal": (
        "How to submit an event proposal: open Forms > Proposal, fill in the event details "
        "(title, description, schedule, expected attendance, visibility) and choose which "
        "department services you need (logistics, transport, sound/light, photography, campus "
        "tour, catering). Submitting routes it to your Head of School/Department first; large "
        "(high-pax) or paid events also go through F&B and/or the CFO before reaching the "
        "departments providing the services you asked for. You can track it under My Requests > "
        "Ongoing, and it lands in History once approved, rejected, or cancelled. If a reviewer "
        "sends it back for changes, it appears in your Inbox for you to resubmit."
    ),
    "join_club": (
        "How to join a club: open Clubs > Discover Clubs, find one you're interested in, and "
        "submit a join request. The club's President reviews it and approves or rejects it - "
        "you can see the outcome under Clubs > My Clubs. Only students and lecturers can join "
        "clubs; only a student who is already a member can be promoted to President."
    ),
    "become_president": (
        "How to become a club President: presidency is student-only, and is not something you "
        "apply for directly. A Club Admin assigns the first President when a club is created, "
        "or a sitting President can request to hand the role to another eligible student member "
        "via a president-change request - a Club Admin then approves or rejects that request."
    ),
    "register_event": (
        "How to register for an event: open Explore Events, pick an event, and register from its "
        "details. If the event's registration is Automatic, you're confirmed immediately; if it's "
        "Manual approval, your request goes to the event's organiser and you'll see the outcome "
        "under My Events. Guests can register for Public events without an account."
    ),
    "review_proposal": (
        "How to review a proposal you're responsible for: it appears in your Inbox once it "
        "reaches your stage (Head of School/Department, F&B, CFO, or your department's task "
        "queue). Open it to approve, reject, or send it back to the applicant with a comment "
        "explaining what needs to change."
    ),
    "resubmit_proposal": (
        "How to resubmit a proposal sent back for changes: it shows up in your Inbox with the "
        "reviewer's comment explaining what to fix. Open it, make the changes, and resubmit - it "
        "resumes the workflow from where it left off, it does not restart from the beginning."
    ),
    "cancel_proposal": (
        "How to cancel a proposal or published event: open it from My Requests (Ongoing) or your "
        "organiser view and choose Cancel. This is only available up to a configured number of "
        "days before the event date, and cancels any in-progress department tasks/cafeteria "
        "orders tied to it too."
    ),
}


# The PAGE each how-to's action actually happens on - the machine-readable half of the prose above
# ("open Forms > Proposal" -> "proposal-form"), and the thing that makes a how-to answer subject to
# Page Visibility like every other answer.
#
# Why this exists: `how_to` used to be UNGATED (absent from topic_access.TOPIC_PAGES), so the only
# thing standing between a caller and a set of instructions was the router. But "how do I join a
# club" also classifies as {clubs, clubs_mine}, which ARE gated - so an ungranted caller got their
# club topics denied, two rows written to ai_access_denial, and a degraded answer, for a question
# that never asked for club data. The guide is now gated on its OWN page instead, and the router
# stops emitting the incidental data classes (see query_router.classify's how-to suppression).
#
# SINGLE-PAGE TUPLES ARE DELIBERATE. TOPIC_PAGES uses ANY-of lists because a topic legitimately
# spans several pages; a how-to describes ONE action on ONE page. An ANY-of list here would let an
# unrelated grant unlock instructions for a page the caller cannot actually open - exactly the gap
# this closes. The tuple type is kept only for shape-consistency with TOPIC_PAGES.
#
# `created-by-me` is deliberately NOT used for cancel_proposal even though that guide's prose says
# "or your organiser view": seed/nav.py never creates that page, so has_page_access fails closed on
# it forever. A page_code that can never pass is invisible dead weight a future reader would trust.
HOW_TO_PAGES: dict[str, tuple[str, ...]] = {
    "submit_proposal": ("proposal-form",),
    "join_club": ("clubs-discover",),
    "become_president": ("clubs-my",),
    "register_event": ("explore-events",),
    "review_proposal": ("inbox",),
    "resubmit_proposal": ("inbox",),
    "cancel_proposal": ("ongoing",),
}

# How a guide is NAMED in a refusal message and in the ai_access_denial row - "you cannot reach the
# page where submitting an event proposal happens" reads as an explanation; the raw key does not.
HOW_TO_LABEL: dict[str, str] = {
    "submit_proposal": "submitting an event proposal",
    "join_club": "joining a club",
    "become_president": "becoming a club President",
    "register_event": "registering for an event",
    "review_proposal": "reviewing a proposal",
    "resubmit_proposal": "resubmitting a proposal",
    "cancel_proposal": "cancelling a proposal or event",
}


# --- self_capability: per-role facts, unioned per caller -----------------------

# One entry per role_code: (capability text, backing page_code). EVERY line carries a real
# page_code, checked LIVE against nav_page_grants (see self_capability_document) before it is ever
# shown - so a capability whose page an admin revoked in /app/admin/page-visibility disappears from
# the answer immediately, and a capability the role never had cannot be asserted at all.
#
# Rewritten because the previous version allowed page_code=None for "stable" lines, and those 12
# ungated lines were the ones that went wrong - they printed unconditionally, so the assistant
# stated things that were simply false for the account asking:
#   - Cafeteria Manager was told "cannot submit an event proposal", while that account actually
#     reaches my-requests/inbox/ongoing/history and can discuss proposals throughout.
#   - Staff was told "submit an event proposal"; staff has NO proposal-form grant at all.
#   - Club Admin and Cafeteria Admin were both told "browse and register for events"; neither holds
#     explore-events.
# Verified against the live grant table rather than written from memory, then re-checked per role
# by the accuracy test below (see tests/test_role_capabilities.py).
#
# TABS matter as much as pages. Several capabilities live in a TAB of a shared page, not on a page
# of their own, so the backing page_code is the page that actually hosts the tab:
#   - Club join requests and their outcomes are NOT under clubs-my; the club tabs were folded into
#     the shared Ongoing/History pages (see app.routes.ts: clubs/pending -> ongoing/clubs,
#     clubs/history -> history/clubs), so those lines hang off `ongoing`/`history`.
#   - My Events is one page with Saved/Pending/Registered/History tabs, all under `my-events`.
#   - Drafts is its own grant (`drafts`), separate from submitting (`proposal-form`) - a role can
#     hold one without the other, and staff does exactly that.
#
# NEGATIVE claims ("cannot X") are deliberately gone. They were the least reliable lines - a
# statement about the absence of a grant goes stale the moment an admin adds it, and it is never
# needed: a capability that is not listed is not claimed, which already says it.
_ROLE_CAPABILITIES: dict[str, list[tuple[str, str]]] = {
    "student": [
        ("submit an event proposal", "proposal-form"),
        ("save proposal drafts before submitting", "drafts"),
        ("track your submitted proposals and act on anything sent back to you",
         "my-requests"),
        ("discover clubs and ask to join one", "clubs-discover"),
        ("see the clubs you belong to, and the ones you preside over", "clubs-my"),
        ("follow your pending club join requests (Ongoing > Clubs tab)", "ongoing"),
        ("look back at decided club requests and finished proposals (History)", "history"),
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
        ("see the events you created", "created-by-me"),
    ],
    "lecturer": [
        ("submit an event proposal", "proposal-form"),
        ("save proposal drafts before submitting", "drafts"),
        ("track your submitted proposals and act on anything sent back to you",
         "my-requests"),
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
        ("see the events you created", "created-by-me"),
        ("read the How It Works guide", "how-it-works"),
    ],
    "staff": [
        # No proposal-form grant: staff can hold DRAFTS but cannot submit. The old text claimed
        # "submit an event proposal", which was false for every staff account.
        ("save proposal drafts", "drafts"),
        ("track requests that need your attention and their outcomes", "my-requests"),
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
    ],
    "head-of-school": [
        ("submit an event proposal", "proposal-form"),
        ("save proposal drafts before submitting", "drafts"),
        ("review and decide proposals from your School at the Head of School/Department stage, "
         "from your Inbox", "inbox"),
        ("track proposals in progress and their outcomes", "my-requests"),
        ("see an overview of activity for the unit you head", "dashboard"),
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
        ("see the events you created", "created-by-me"),
    ],
    "head-of-department": [
        ("submit an event proposal", "proposal-form"),
        ("save proposal drafts before submitting", "drafts"),
        ("review and decide proposals routed to the department you head, from your Inbox",
         "inbox"),
        ("track proposals in progress and their outcomes", "my-requests"),
        ("see an overview of activity for the unit you head", "dashboard"),
        ("manage your department's dropdown options (the choices applicants pick from)",
         "dropdown-settings"),
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
        ("see the events you created", "created-by-me"),
    ],
    "cfo": [
        ("review and decide high-pax or paid proposals at the CFO stage, from your Inbox",
         "inbox"),
        ("track proposals in progress and their outcomes", "my-requests"),
        ("manage the Funding dropdown options", "dropdown-fundingMain"),
        ("browse and register for published events", "explore-events"),
    ],
    "cafeteria-admin": [
        ("create and manage every cafeteria outlet", "cafeteria-manage"),
        ("oversee every outlet's menu", "cafeteria-menu-oversight"),
        ("assign and manage staff across all outlets", "cafeteria-staff-assignments"),
        ("review the full staff-action history", "cafeteria-staff-requests-history"),
        ("view operational reports", "reports"),
    ],
    "cafeteria-manager": [
        ("manage your own outlet's menu", "menu"),
        ("add, suspend, and manage staff at your own outlet", "cafeteria-my-staff"),
        ("review your outlet's staff-action history", "cafeteria-staff-requests-history"),
        ("approve or send back catering orders for your outlet, from your Inbox", "inbox"),
        ("track catering orders in progress and their outcomes", "my-requests"),
    ],
    "cafeteria-staff": [
        ("claim, prepare, and fulfil catering orders assigned to your outlet, from your Inbox",
         "inbox"),
        ("track the orders you are working on and the ones you have completed", "my-requests"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
    ],
    "system-admin": [
        ("create and manage every user account", "admin-users"),
        ("manage units and departments", "admin-units"),
        ("manage roles", "admin-roles"),
        ("control which roles and units can see each page (Page Visibility)",
         "admin-page-visibility"),
        ("configure approval workflows and policies, including the high-pax threshold, "
         "cancellation deadline, and maximum event categories", "admin-settings-policies"),
        ("manage event categories", "admin-settings-categories"),
        ("manage event formats", "admin-settings-formats"),
        ("review questions the assistant refused for lack of access (AI Access Log)",
         "admin-ai-access-log"),
    ],
    "club-admin": [
        ("create, edit, deactivate, and delete clubs", "clubs-manage"),
        ("manage club categories", "club-category"),
        ("approve or reject president-change requests, from your Inbox", "inbox"),
        ("look back at decided club requests (History)", "history"),
    ],
    "external-user": [
        # External accounts hold no nav grants at all (verified against the live grant table), so
        # there is no page-backed capability to list. self_capability_document() falls back to its
        # "no capabilities" message for them rather than asserting anything.
    ],
}

# Roles actually granted "My Requests" (Inbox/Ongoing/History/Drafts) and Forms>Proposal in the
# nav catalogue - see seed/nav.py's ALL_UNIT_ROLES/cafeteria_manager_grant(). A Cafeteria Manager
# gets Inbox/Ongoing/History (for order review) but never Drafts/Forms - they review, they don't
# submit - so they are in the request-tracking set but not the submit set. Kept here, next to
# _ROLE_CAPABILITIES, as the one place this nav fact is hand-encoded for the AI layer; ai.py's
# proposals/event-organiser retrieval gates on these instead of running a live "0 rows" query for
# a role that was never going to have any rows, which used to read to the asker as "you have zero
# proposals right now" when the true fact is "this feature isn't part of your account at all".
ROLES_CAN_SUBMIT_PROPOSALS = frozenset({"head-of-school", "head-of-department", "lecturer", "staff", "student"})
ROLES_CAN_TRACK_REQUESTS = ROLES_CAN_SUBMIT_PROPOSALS | {"cfo", "cafeteria-manager"}

_ROLE_LABEL: dict[str, str] = {
    "student": "Student", "lecturer": "Lecturer", "staff": "Staff",
    "head-of-school": "Head of School", "head-of-department": "Head of Department",
    "cfo": "CFO", "cafeteria-admin": "Cafeteria Admin", "cafeteria-manager": "Cafeteria Manager",
    "cafeteria-staff": "Cafeteria Staff", "system-admin": "System Admin", "club-admin": "Club Admin",
    "external-user": "External User",
}


def self_capability_document(assignments: tuple[tuple[str, str | None], ...]) -> str:
    """Assembles ONE caller's real capabilities from every role they actually hold - never a
    single role's answer for a multi-role account. `assignments` is Principal.assignments
    verbatim ((role_code, unit_code) pairs, exactly as held - unit-scoping doesn't change WHICH
    capabilities apply, but is needed here to run the live has_page_access() check below).

    EVERY capability is checked LIVE against nav_page_grants (via identity.has_page_access) before
    being included - there are no ungated lines any more. That check also enforces folder gating, so
    a capability whose page sits inside a folder the caller cannot see is correctly dropped even
    though the page's own grant would pass.

    Returns a "no capabilities" message when nothing survives the check, rather than a header
    followed by an empty list - a role whose every page has been revoked genuinely has nothing to
    state, and printing the promise without the content reads as though the answer was truncated."""
    if not assignments:
        return (
            "The asker is a GUEST - not signed in, holds no account in this system at all. This is "
            "the ordinary, expected state for a visitor, not a broken or misconfigured account: say "
            "plainly that they're not signed in, and never suggest contacting an administrator or "
            "imply anything is wrong with an account - they don't have one to be wrong. If sign-up/"
            "sign-in is something you can point them to, do that instead."
        )
    role_codes = [role_code for role_code, _ in assignments]
    known = [r for r in dict.fromkeys(role_codes) if r in _ROLE_CAPABILITIES]
    granted: list[str] = []
    for role in known:
        for capability, page_code in _ROLE_CAPABILITIES[role]:
            if identity.has_page_access(assignments, page_code):
                granted.append(f"- As {_ROLE_LABEL[role]}: {capability}")
    if not granted:
        return (
            "This account currently has no capabilities in this app - it holds no recognised role, "
            "or an administrator has not granted its role(s) any page. Say that plainly and "
            "suggest contacting an administrator; do not guess at what they might be able to do."
        )
    header = (
        "This asker's roles and what each one lets them do. This list is computed from their LIVE "
        "page access and is COMPLETE - state only what is listed, and never add, generalise, or "
        "imply any other capability (anything missing is something they genuinely cannot do). A "
        "multi-role account holds the UNION of every line below, all at once:"
    )
    return "\n".join([header, *granted])


def resolve_role_name(text: str) -> str | None:
    """Best-effort role_code for a role NAMED in a question ('what can Club Admin access',
    'is Cafeteria Staff able to...') - matched against _ROLE_LABEL's known display names,
    case-insensitively, longest label first so 'Head of Department' isn't shadowed by a
    hypothetical shorter overlapping label. Returns None on no match - the caller falls back to
    ordinary retrieval/generation rather than guessing which role was meant."""
    lowered = text.lower()
    for role_code, label in sorted(_ROLE_LABEL.items(), key=lambda item: -len(item[1])):
        if label.lower() in lowered:
            return role_code
    return None


def role_label(role_code: str) -> str:
    """The human-readable display name for a role_code (e.g. "cafeteria-admin" ->
    "Cafeteria Admin") - exposed so callers building a reply about a specific role (e.g.
    admin_retrieval.users_by_role_document's "who holds this role" text) use the SAME label
    resolve_role_name() itself matches against, rather than reformatting role_code by hand and
    risking a mismatch. Falls back to role_code itself for a code with no known label."""
    return _ROLE_LABEL.get(role_code, role_code)


def role_capability_document(role_code: str) -> str:
    """What a NAMED role (not the asker themselves) can generally do - answers 'what pages/
    capabilities does {role} have' as a role overview, not a specific person's live access.
    Deliberately distinct from self_capability_document(): there is no single asker to check
    has_page_access() against for a unit-scoped grant (which unit would that even be?), so a
    page-tied capability line is included whenever the role is named in ANY grant for that page
    at all (identity.role_has_page_grant) - an overview of what the role is designed to reach,
    not a specific account's current, unit-scoped reality."""
    if role_code not in _ROLE_CAPABILITIES:
        return f"'{role_code}' is not a recognised role in this app."
    granted = [
        f"- {capability}"
        for capability, page_code in _ROLE_CAPABILITIES[role_code]
        if identity.role_has_page_grant(role_code, page_code)
    ]
    if not granted:
        return (
            f"The {_ROLE_LABEL[role_code]} role has not been granted any page in this app, so it "
            f"cannot reach anything on its own. Say that plainly rather than guessing at what the "
            f"role might be for."
        )
    return "\n".join([
        f"What the {_ROLE_LABEL[role_code]} role can do in this app. This list is complete - state "
        f"only what is listed and do not add or imply any other capability:",
        *granted,
    ])
