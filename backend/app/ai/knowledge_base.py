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

from . import scope
from .scope import (  # noqa: F401 - re-exported: defined in scope.py, imported from here
    HOW_TO_GUIDES,
    HOW_TO_LABEL,
    HOW_TO_PAGES,
)
from ..services import identity

# --- system_capability: what the platform itself does, independent of caller --
#
# WHO IT IS FOR is deliberately part of the text. The old version described four internal areas and
# never mentioned that most of the app is reachable only by a university account - so a visitor
# reading "you can join clubs and submit proposals" was being described somebody else's app.

SYSTEM_CAPABILITY = """This platform (APU Events) serves two kinds of user, and the difference
decides what any given person sees:
  VISITORS (not signed in, or signed in with a self-registered visitor account) use the public
  landing page: Happening Soon, Explore Events and the Event Calendar, all showing published
  Public events, plus each event's details dialog with its Register button. A signed-in visitor
  also has My Events, holding the events they saved and registered for. Visitors have no access to
  clubs, proposals, or any internal university page - by design, not by permission.
  UNIVERSITY ACCOUNTS (students, lecturers, staff, heads, admins) additionally reach the internal
  app, and which parts depends on the role each account holds.
The internal app has four areas:
1. EVENTS - browse/search published events (Explore Events), see event details, save events,
   register to attend, and the university-wide Event Calendar.
2. PROPOSALS - internal staff/students/lecturers submit a proposal to run an event; it is
   reviewed through a workflow (Head of School/Department, then F&B and/or CFO for high-pax or
   paid events, then the departments providing logistics/transport/sound/photography/campus
   tours/catering), and becomes a published event once fully approved.
3. CLUBS - students and lecturers can discover clubs, join them, and (students only) become a
   club President; a President reviews join requests for their own club and can hand the role
   to another student via a president-change request, decided by a Club Admin. A Club Admin
   creates and administers the clubs themselves.
4. CAFETERIAS - each cafeteria has a menu, staff, and an order queue for catering requests tied
   to approved events; a Cafeteria Admin runs the whole cafeteria system, a Cafeteria Manager
   runs one outlet, and Cafeteria Staff fulfil that outlet's orders.
Every university account also has "My Requests" (Ongoing/History/Drafts) to track its own
proposals, and an Inbox for whatever currently needs its action."""


# --- how_to_guides: step-by-step procedures, and where each action happens -----
#
# DEFINED IN ai/scope.py, alongside the areas that release them, and re-exported here because this
# module has been their import site for a long time. They moved because a guide and the topic it
# belongs to were being maintained in two files that could disagree - and did: `save_event` had no
# guide at all, so "how do I save an event" resolved nothing and api/ai.py answered it from the
# system overview instead, handing an account with no event access a working procedure.


# --- self_capability: per-role facts, unioned per caller -----------------------

# One entry per role_code: (capability text, the scope.py AREA that backs it).
#
# AREA, not page_code, since 2026-09-01. Every line used to name a nav page, which silently made
# "what can I do here" answerable only for accounts that hold nav pages - i.e. not for the two
# tiers (guest and external) that hold none. An Area covers the public landing sections and the
# visitor's own My Events as well, so a capability can be stated, and checked, for every tier.
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
        ("see who has registered for the events you organise, and decide the registrations "
         "that need manual approval", "proposal-form"),
    ],
    "lecturer": [
        ("submit an event proposal", "proposal-form"),
        ("save proposal drafts before submitting", "drafts"),
        ("track your submitted proposals and act on anything sent back to you",
         "my-requests"),
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
        ("see who has registered for the events you organise, and decide the registrations "
         "that need manual approval", "proposal-form"),
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
        ("browse and register for published events", "explore-events"),
        ("see the events you saved, registered for, or are awaiting approval on (My Events)",
         "my-events"),
        ("see who has registered for the events you organise, and decide the registrations "
         "that need manual approval", "proposal-form"),
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
        ("see who has registered for the events you organise, and decide the registrations "
         "that need manual approval", "proposal-form"),
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
    # A self-registered visitor account. It holds NO nav pages, which is correct and permanent -
    # external accounts never enter the /app shell (fyp-ui's externalUserGuard) - and used to leave
    # this list empty, so the assistant told a working external account that it "doesn't have any
    # assigned roles" and sent it to an administrator. Its capabilities are real; they just live on
    # the visitor surface, which is why these lines name scope.py Areas rather than nav pages.
    "external-user": [
        ("browse the published events on the landing page - Happening Soon, Explore Events and "
         "the Event Calendar", "public-explore-events"),
        ("open any published event to see its full details, schedule and venue",
         "public-event-details"),
        ("register for a published event, uploading proof of payment when it charges a fee",
         "public-event-details"),
        ("save events you are interested in, and see them under My Events", "public-my-events"),
        ("track your registrations - pending, confirmed and past - and cancel one",
         "public-my-events"),
    ],
}

# Roles actually granted "My Requests" (Inbox/Ongoing/History/Drafts) and Forms>Proposal in the nav
# catalogue - see seed/nav.py's ALL_UNIT_ROLES/cafeteria_manager_grant().
ROLES_CAN_SUBMIT_PROPOSALS = frozenset({"head-of-school", "head-of-department", "lecturer", "staff", "student"})
ROLES_CAN_TRACK_REQUESTS = ROLES_CAN_SUBMIT_PROPOSALS | {"cfo", "cafeteria-manager"}

_ROLE_LABEL: dict[str, str] = {
    "student": "Student", "lecturer": "Lecturer", "staff": "Staff",
    "head-of-school": "Head of School", "head-of-department": "Head of Department",
    "cfo": "CFO", "cafeteria-admin": "Cafeteria Admin", "cafeteria-manager": "Cafeteria Manager",
    "cafeteria-staff": "Cafeteria Staff", "system-admin": "System Admin", "club-admin": "Club Admin",
    "external-user": "External User",
}


def self_capability_document(principal) -> str:
    """Assembles ONE caller's real capabilities from every role they actually hold - never a
    single role's answer for a multi-role account.

    EVERY capability is checked LIVE (scope.can_reach) before being included, so there are no
    ungated lines: a Page Visibility edit is reflected in the very next answer rather than at the
    next deploy, and the check enforces folder gating too, so a capability whose page sits inside a
    folder the caller cannot see is correctly dropped even though the page's own grant would pass.

    A GUEST gets the visitor capability list rather than a bare "you are not signed in". Being
    signed out is not the absence of capabilities - a guest can browse every published event and
    register for a Public one - and answering "what can I do here" with only what they cannot do is
    how a visitor was told their perfectly ordinary session was a problem to report.
    """
    if principal is None:
        return _guest_capability_document()
    assignments = principal.assignments or ()
    role_codes = [role_code for role_code, _ in assignments]
    known = [r for r in dict.fromkeys(role_codes) if r in _ROLE_CAPABILITIES]
    granted: list[str] = []
    for role in known:
        for capability, area_code in _ROLE_CAPABILITIES[role]:
            if scope.can_reach(principal, area_code):
                granted.append(f"- As {_ROLE_LABEL[role]}: {capability}")
    if not granted:
        return (
            "This account currently has no capabilities in this app - it holds no recognised role, "
            "or an administrator has not granted its role(s) any page. Say that plainly and "
            "suggest contacting an administrator; do not guess at what they might be able to do."
        )
    header = (
        "This asker's roles and what each one lets them do. This list is computed from their LIVE "
        "access and is COMPLETE - state only what is listed, and never add, generalise, or imply "
        "any other capability (anything missing is something they genuinely cannot do). A "
        "multi-role account holds the UNION of every line below, all at once:"
    )
    return "\n".join([header, *granted])


def _guest_capability_document() -> str:
    """What a signed-out visitor can actually do, listed rather than described as an absence.

    Built from the same Area table every other answer reads, so it cannot offer a section that is
    not on the landing page, and cannot miss one that is."""
    lines = [f"- {area.label}: {area.purpose}" for area in scope.AREAS.values()
             if area.reach == scope.VISITOR]
    return "\n".join([
        "The asker is a GUEST - not signed in, and holding no account in this system. That is the "
        "ordinary, expected state for a visitor, NOT a broken or misconfigured account: never "
        "suggest contacting an administrator and never imply anything is wrong, because they have "
        "no account for anything to be wrong with.",
        "What they can do right now, without signing in - this list is complete:",
        *lines,
        "- Register for a published Public event, straight from that event's details, with no "
        "account needed.",
        "Signing in or creating an account additionally lets them save events and keep track of "
        "their registrations under My Events. They have no access to clubs, proposals, or any "
        "internal university page, and no personal data of any kind exists for them here.",
    ])


def _role_reaches(role_code: str, area_code: str) -> bool:
    """Can a role, in the abstract, reach an Area? The role-level counterpart of scope.can_reach,
    which needs a specific principal.

    An internal page is answered by the grant table (any grant naming this role, in any unit - this
    is an overview of what the role is designed to reach, not one account's unit-scoped reality).
    The visitor areas belong to whoever is NOT in the internal shell, which among real roles is
    external-user alone: publicLandingGuard redirects every other role away from them."""
    area = scope.AREAS.get(area_code)
    if area is None:
        return False
    if area.reach == scope.PAGE:
        return identity.role_has_page_grant(role_code, area_code)
    return role_code == "external-user"


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
        for capability, area_code in _ROLE_CAPABILITIES[role_code]
        if _role_reaches(role_code, area_code)
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
