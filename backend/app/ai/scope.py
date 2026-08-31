"""WHAT THE ASSISTANT COVERS, AND FOR WHOM - the one definition every other AI module reads.

Before this module the same facts were written down in five places: seed/nav.py knew which pages a
role sees, topic_access.py knew which pages a topic hides behind, knowledge_base.py knew what each
role can do, suggestions.py knew which cards to offer, and api/ai.py carried a hand-written
paragraph naming the assistant's scope. Nothing kept them in agreement, and every defect found in
the 2026-09-01 role sweep was one of them disagreeing with another:

  - A Club Admin was OFFERED "the registration decisions you've made as an organiser" and then told
    "I don't have that information", because topic_access mapped event_organiser_decisions onto
    `history` - a SHARED hub page granted to nine roles for nine unrelated reasons. Owning a tab on
    a shared page is not owning the topic.
  - An External User was told their account "doesn't have any assigned roles" for every question,
    and then given working step-by-step instructions for saving an event. Both answers came from
    the same wrong premise: the assistant only knew about nav_page (the INTERNAL sidebar), and an
    external account holds no nav pages at all - by design, because external accounts never enter
    the /app shell.
  - A signed-out guest was told they have "no access to a personal calendar" and should "contact an
    administrator", while the Event Calendar section sat on the public landing page they were
    reading, and while they had no account for an administrator to fix.

The common cause is that nav_page describes ONE of the app's three surfaces. This module describes
all three, and calls them AREAS.

THE THREE SURFACES, which are the app's own routing rules (fyp-ui/src/app/app.routes.ts), not a
model invented here:

  VISITOR   the public landing page and the event details dialog it opens. Guests and external
            accounts live here. publicLandingGuard REDIRECTS an internal user away from it, so
            "public" does not mean "everyone" - it means the visitor tier, precisely.
  EXTERNAL  /my-events, behind externalUserGuard: a self-registered visitor's saved events and
            registrations. Internal users are redirected to their own equivalent, the `my-events`
            nav page.
  PAGE      /app/**, gated by nav_page_grants, i.e. Page Visibility - unchanged, still the single
            authorization source for everything inside the internal shell.

WHAT THIS MODULE DOES NOT DO: it does not enforce anything. topic_access.py still runs the gate,
sql_guard.py still validates the query, scope_rules.py still narrows the rows. This module holds
only the DEFINITIONS those layers read, so that a topic, a guide, a capability sentence, a
suggestion card and a refusal message cannot disagree about what a caller can reach - they are all
computed from the tables below.

ADDING SOMETHING: define the Area first (where does this live, and who can stand there), then point
a Topic or a Guide at it. tests/test_ai_scope.py fails if an Area names a page nav_page does not
have, if a Topic names an Area that does not exist, or if a classifier class has no Topic - which
is what stops the drift this module was written to end.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..services import identity

# --- Tiers: which surface is this caller standing on -----------------------------------------

GUEST = "guest"        # no account at all
EXTERNAL = "external"  # a self-registered visitor account (role external-user)
INTERNAL = "internal"  # any account that holds nav pages - staff, students, admins


def tier_of(principal) -> str:
    """Which surface this caller lives on. Read off the authenticated principal only - never off
    anything the question claims about itself."""
    if principal is None:
        return GUEST
    if getattr(principal, "is_external", False):
        return EXTERNAL
    return INTERNAL


TIER_LABEL: dict[str, str] = {
    GUEST: "a visitor who is not signed in",
    EXTERNAL: "a signed-in visitor account (external, not a university account)",
    INTERNAL: "a signed-in university account",
}


# --- Areas: every place in this app a person can actually be ---------------------------------

VISITOR = "visitor"              # the public landing page: guests AND external accounts
EXTERNAL_ONLY = "external-only"  # /my-events, the external account's own area
PAGE = "page"                    # an internal nav page, gated by Page Visibility


@dataclass(frozen=True)
class Area:
    """One place in the app, and the one sentence that says what it is for.

    `purpose` exists so "what is the Event Calendar for" is ANSWERED FROM A DEFINITION rather than
    improvised from whatever rows happened to be retrieved. That improvisation is what produced a
    confident description of a "personal calendar" this app has never had.
    """

    code: str
    label: str
    reach: str
    purpose: str
    route: str | None = None
    # What people actually call it, for resolving "what is X for" - matched case-insensitively.
    aliases: tuple[str, ...] = ()


def _area(code, label, reach, purpose, route=None, aliases=()) -> Area:
    return Area(code=code, label=label, reach=reach, purpose=purpose, route=route, aliases=aliases)


AREAS: dict[str, Area] = {area.code: area for area in (
    # --- VISITOR: the public landing page, section by section --------------------------------
    # These are the five anchors in site-header.ts's navItems plus the dialog they open. They are
    # the ENTIRE app for a guest, and the browsing half of it for an external account.
    _area("public-home", "Home", VISITOR,
          "The landing page's opening section - what APU Events is, with a search box and a way "
          "into the published events below it.",
          route="/#home", aliases=("landing page", "home page")),
    _area("public-campus-life", "Life at APU", VISITOR,
          "A short introduction to campus life - the kinds of activity, clubs and events the "
          "university runs. Descriptive only; it holds nothing to book or join.",
          route="/#campus-life", aliases=("campus life",)),
    _area("public-happening-soon", "Happening Soon", VISITOR,
          "The next few published events by date, as a quick glance at what is on shortly. It is "
          "a preview of the same catalogue Explore Events lists in full.",
          route="/#happening-soon", aliases=("upcoming events",)),
    _area("public-explore-events", "Explore Events", VISITOR,
          "The full browsable list of published events, searchable and filterable by category. "
          "This is where a visitor finds an event and opens it to register.",
          route="/#explore-events", aliases=("browse events", "event list")),
    _area("public-event-calendar", "Event Calendar", VISITOR,
          "The published events laid out by date on a month calendar, so you can see what falls "
          "on a given day. It is the same public catalogue as Explore Events in a calendar view - "
          "it is NOT a personal or private calendar, and it holds nothing but published events.",
          route="/#event-calendar", aliases=("events calendar",)),
    _area("public-event-details", "Event details", VISITOR,
          "An individual event's dialog: full description, schedule, venue, categories, and the "
          "Register button - including the payment-proof upload when the event charges a fee.",
          aliases=("event page", "event dialog")),

    # --- EXTERNAL: the visitor account's own area --------------------------------------------
    _area("public-my-events", "My Events", EXTERNAL_ONLY,
          "A signed-in visitor's own events: the ones they saved, registrations still awaiting "
          "the organiser's approval, confirmed registrations, and past ones.",
          route="/my-events", aliases=("saved events",)),

    # --- PAGE: the internal shell, gated by Page Visibility ----------------------------------
    _area("how-it-works", "How It Works", PAGE,
          "A written walkthrough of how a proposal becomes a published event, stage by stage.",
          route="/app/how-it-works"),
    _area("dashboard", "Dashboard", PAGE,
          "An at-a-glance activity summary for the unit or outlet the viewer is responsible for.",
          route="/app/dashboard"),
    _area("inbox", "Inbox", PAGE,
          "Everything currently waiting on THIS viewer to act: proposals at their approval stage, "
          "department tasks, catering orders, registrations needing manual approval, and "
          "president-change requests for a Club Admin. A shared hub - which tabs appear depends "
          "entirely on who is looking.",
          route="/app/inbox"),
    _area("reports", "Reports", PAGE,
          "Operational reports across the cafeteria system - orders, outlets and staff activity.",
          route="/app/reports"),
    _area("my-requests", "My Requests", PAGE,
          "The folder holding Ongoing, History and Drafts - everything the viewer has submitted or "
          "still has to follow up."),
    _area("ongoing", "Ongoing", PAGE,
          "Requests the viewer has submitted that are still moving through their workflow.",
          route="/app/ongoing"),
    _area("history", "History", PAGE,
          "Requests that have finished - approved, rejected or cancelled. A shared hub: each role "
          "sees the tabs for the workflows it takes part in, and nothing else.",
          route="/app/history"),
    _area("drafts", "Drafts", PAGE,
          "Proposals the viewer has started and saved but not yet submitted for approval.",
          route="/app/proposals/drafts"),
    _area("events", "Events", PAGE,
          "The folder holding the internal event pages - Explore Events, My Events and the "
          "Event Calendar."),
    _area("explore-events", "Explore Events", PAGE,
          "The internal catalogue of published events - the same browsing and registering a "
          "visitor does on the landing page, plus the Internal-visibility events a university "
          "account may also see.", route="/app/events/explore-events"),
    _area("my-events", "My Events", PAGE,
          "The viewer's own events: saved, awaiting approval, registered, and past.",
          route="/app/events/my-events"),
    _area("event-calendar", "Event Calendar", PAGE,
          "The university-wide master calendar - every published event the viewer may see, laid "
          "out by date. A shared view of the catalogue, not a personal calendar.",
          route="/app/event-calendar", aliases=("master calendar",)),
    _area("forms", "Forms", PAGE,
          "The folder holding the forms this app accepts submissions through."),
    _area("proposal-form", "Proposal", PAGE,
          "The event proposal form - where an event is proposed, costed and sent for approval. "
          "Holding this page is also what makes someone an event ORGANISER, so it is what "
          "releases the registration lists and decisions for the events they run.",
          route="/app/forms/event-proposal", aliases=("proposal form", "event proposal")),
    _area("menu", "My Menu", PAGE,
          "The menu of the viewer's own cafeteria outlet, and what it currently offers.",
          route="/app/menu"),
    _area("cafeteria-my-staff", "My Staff", PAGE,
          "The staff posted to the viewer's own cafeteria outlet.",
          route="/app/cafeterias/my-staff"),
    _area("my-cafeteria-folder", "My Cafeteria", PAGE,
          "The folder holding the pages for running the viewer's own cafeteria outlet."),
    _area("cafeteria-admin-folder", "Cafeterias", PAGE,
          "The folder holding the pages for administering every cafeteria outlet."),
    _area("cafeteria-manage", "Manage Cafeterias", PAGE,
          "Every cafeteria outlet, and who runs each one.", route="/app/cafeterias/manage"),
    _area("cafeteria-staff-assignments", "Staff Assignments", PAGE,
          "Which cafeteria staff are posted to which outlet, across every outlet.",
          route="/app/cafeterias/staff-assignments"),
    _area("cafeteria-menu-oversight", "Menu Oversight", PAGE,
          "Every cafeteria outlet's menu, side by side, for whoever oversees them all.",
          route="/app/cafeterias/menu-oversight"),
    _area("cafeteria-staff-requests-history", "Staff Action History", PAGE,
          "The audit trail of cafeteria staff hires, suspensions, restorations and removals.",
          route="/app/cafeterias/staff-requests-history"),
    _area("admin-directory", "Internal Directory", PAGE,
          "The folder holding the account, unit, role and Page Visibility administration pages."),
    _area("admin-users", "Users", PAGE,
          "Every user account in the system, and the roles each one holds.", route="/app/users"),
    _area("admin-units", "Units", PAGE,
          "The schools, departments and cafeterias that a role can be scoped to.",
          route="/app/units"),
    _area("admin-roles", "Roles", PAGE,
          "The roles an account can hold, and what each one is called.", route="/app/roles"),
    _area("admin-page-visibility", "Page Visibility", PAGE,
          "Which roles and units can reach which pages. This page also decides what the assistant "
          "will answer for each role - the grant that shows a page is the grant that releases its "
          "topic.", route="/app/admin/page-visibility", aliases=("page permissions",)),
    _area("admin-ai-access-log", "AI Access Log", PAGE,
          "Every question the assistant refused, who asked it, which topic it needed and why it "
          "was declined.", route="/app/admin/ai-access-log"),
    _area("manage-clubs", "Clubs", PAGE,
          "The folder holding the club pages - Discover Clubs, My Clubs and the administration "
          "pages."),
    _area("clubs-manage", "Manage Clubs", PAGE,
          "Club administration: create, edit, deactivate and delete clubs, decide president-change "
          "requests, and see the system-wide picture across every club. It is not a place to "
          "browse or join a club.", route="/app/clubs/manage", aliases=("club management",)),
    _area("clubs-discover", "Discover Clubs", PAGE,
          "The catalogue of clubs open to join, with each club's description, categories and "
          "member count, and the button that submits a join request.",
          route="/app/clubs/discover", aliases=("club discovery", "browse clubs")),
    _area("clubs-my", "My Clubs", PAGE,
          "The clubs the viewer belongs to, the ones they preside over, and - for a President - "
          "the join requests and president-change requests for their own club.",
          route="/app/clubs"),
    _area("club-category", "Club Category", PAGE,
          "The categories clubs are filed under, and which clubs sit in each.",
          route="/app/club-category"),
    _area("system-config", "System Configuration", PAGE,
          "The folder holding the approval-workflow, event-category and event-format settings."),
    _area("admin-settings-policies", "Approval Workflows & Policies", PAGE,
          "The approval routing rules and the policy numbers behind them - the high-pax "
          "threshold, the cancellation deadline, the minimum lead time.",
          route="/app/admin/settings/policies"),
    _area("admin-settings-categories", "Event Categories", PAGE,
          "The categories an event can be filed under, which is also what Explore Events filters "
          "by.", route="/app/admin/settings/categories"),
    _area("admin-settings-formats", "Event Formats", PAGE,
          "The formats an event can take - the choices an applicant picks from on the proposal "
          "form.", route="/app/admin/settings/formats"),
    _area("dropdown-settings", "Dropdown Settings", PAGE,
          "The folder where each department maintains the dropdown options applicants pick from "
          "on the proposal form."),
)}

# The dropdown-option pages, one per kind, generated because they are a FAMILY: twelve pages that
# differ only in which list they maintain and which department owns it (seed/nav.py's
# dropdown_kinds). Writing twelve near-identical Area literals would invite exactly the drift this
# module exists to prevent - a thirteenth kind added to the seed and forgotten here.
_DROPDOWN_KINDS: tuple[tuple[str, str], ...] = (
    ("logistics", "Logistics Items"),
    ("transportation", "Transportation Types"),
    ("photoVideo", "Photography Services"),
    ("soundLight", "Sound & Light"),
    ("dietaryInformation", "Dietary Information"),
    ("servingUnit", "Serving Units"),
    ("campusTourStart", "Campus Tour Starting Points"),
    ("campusTourType", "Campus Tour Types"),
    ("waterNormal", "Mineral Water"),
    ("fundingMain", "Funding Main Items"),
    ("fundingSub", "Funding Sub-items"),
    ("venue", "Venue Management"),
)
AREAS.update({
    f"dropdown-{kind}": _area(
        f"dropdown-{kind}", label, PAGE,
        f"The {label} list - the options an applicant chooses from on the proposal form, "
        "maintained by the department that owns them.",
        route=f"/app/dropdown-options/{kind}",
    )
    for kind, label in _DROPDOWN_KINDS
})

# Derived, so adding an Area is the only edit needed.
VISITOR_AREAS: tuple[str, ...] = tuple(c for c, a in AREAS.items() if a.reach == VISITOR)
EXTERNAL_AREAS: tuple[str, ...] = tuple(c for c, a in AREAS.items() if a.reach == EXTERNAL_ONLY)
PAGE_AREAS: tuple[str, ...] = tuple(c for c, a in AREAS.items() if a.reach == PAGE)


def can_reach(principal, area_code: str) -> bool:
    """Can this caller actually stand in `area_code`? The one reachability question in the app.

    Mirrors the three route guards exactly, which is why an internal user does NOT pass a VISITOR
    area: publicLandingGuard redirects them off the landing page into their own shell, so telling
    them to scroll to a section they will be bounced away from would be a wrong answer, not a
    generous one. Their equivalent internal page is listed alongside it on every Topic.
    """
    area = AREAS.get(area_code)
    if area is None:
        return False
    tier = tier_of(principal)
    if area.reach == VISITOR:
        return tier in (GUEST, EXTERNAL)
    if area.reach == EXTERNAL_ONLY:
        return tier == EXTERNAL
    # PAGE: unchanged - Page Visibility, live, with no role names and no admin bypass.
    return tier == INTERNAL and identity.has_page_access(principal.assignments, area_code)


def reachable_areas(principal) -> list[Area]:
    """Everywhere this caller can actually go, in definition order."""
    return [area for code, area in AREAS.items() if can_reach(principal, code)]


# --- Resolving "what is X for" ----------------------------------------------------------------

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _normalise(text: str) -> str:
    return _NON_ALNUM.sub(" ", text.lower()).strip()


# Longest name first, so "Explore Events" wins over "Events" and "Discover Clubs" over "Clubs".
_AREA_NAMES: tuple[tuple[str, str], ...] = tuple(sorted(
    (
        (_normalise(name), code)
        for code, area in AREAS.items()
        for name in (area.label, *area.aliases)
        if len(_normalise(name)) >= 4
    ),
    key=lambda pair: -len(pair[0]),
))


def area_named(question: str) -> str | None:
    """Which Area a "what is X for" question names, or None.

    A dictionary lookup against the real Area table, deliberately NOT a model call and deliberately
    NOT a guess - the same reasoning query_router.named_role() is built on. An unrecognised name
    returns None, and api/ai.py then says it has no description of that page rather than composing
    a plausible one, which is exactly the failure this replaces.

    Three labels exist twice on purpose (Explore Events, Event Calendar and My Events each have a
    visitor and an internal form). Ties resolve to the first definition, and every caller pairs
    this with the asker's own tier through _twin_area(), so the answer describes the copy they can
    actually open.
    """
    haystack = f" {_normalise(question)} "
    for name, code in _AREA_NAMES:
        if f" {name} " in haystack:
            return code
    return None


def _twin_area(principal, area: Area) -> Area | None:
    """The copy of a shared-label Area that THIS caller actually has, if it is not the one matched.

    'Explore Events', 'Event Calendar' and 'My Events' each exist twice - once on the public
    landing page, once inside the internal shell - because the two tiers genuinely have separate
    pages of the same name. area_named() cannot know which was meant; the caller's tier can.
    """
    if can_reach(principal, area.code):
        return None
    label = _normalise(area.label)
    for code, candidate in AREAS.items():
        if code != area.code and _normalise(candidate.label) == label and can_reach(principal, code):
            return candidate
    return None


def area_purpose_document(principal, area_code: str) -> str:
    """The CONTEXT for "what is <area> for", written so the model states the definition rather
    than reconstructing one from whatever data is lying around."""
    area = AREAS[area_code]
    area = _twin_area(principal, area) or area
    if not can_reach(principal, area.code):
        return _unreachable_area_document(principal, area)
    where = f" It is at {area.route}." if area.route else ""
    return (
        f"WHAT '{area.label}' IS, stated by the app itself - use this and add nothing to it:\n"
        f"{area.purpose}{where}\n"
        "The asker can reach it. Say what it is for in one or two sentences, in your own words but "
        "WITHOUT adding any capability, screen, button or feature that is not named above - if it "
        "is not in that sentence, this app does not have it."
    )


def _unreachable_area_document(principal, area: Area) -> str:
    """"What is X for" asked about somewhere this caller cannot go.

    Still answers WHAT IT IS - a page's purpose is not somebody's data, and refusing to describe
    the app to the person using it is what made an external account's every question a dead end.
    What it withholds is the CONTENTS, and it says plainly that the area is not theirs.
    """
    tier = tier_of(principal)
    if tier == GUEST:
        reason = (
            "The asker is not signed in, and this part of the app is for signed-in accounts. Say "
            "that plainly and point them at signing in - do NOT tell them to contact an "
            "administrator, they have no account for an administrator to fix."
        )
    elif tier == EXTERNAL:
        reason = (
            "The asker holds a visitor account, and this part of the app is for university staff "
            "and students only. Say that plainly, as a fact about what their account is for rather "
            "than as a missing permission - do NOT suggest contacting an administrator, and do NOT "
            "imply their account is broken or misconfigured."
        )
    else:
        reason = (
            "The asker's role has not been granted this page in Page Visibility. Say plainly that "
            "they cannot open it, and that an administrator would have to grant it."
        )
    return (
        f"WHAT '{area.label}' IS, stated by the app itself - use this and add nothing to it:\n"
        f"{area.purpose}\n"
        f"THE ASKER CANNOT OPEN IT. {reason} "
        "Describe what it is FOR in one sentence so they know what it is, then say they cannot "
        "reach it. Do NOT describe what is currently on it, list anything from it, or offer to "
        "fetch anything from it."
    )


def unknown_area_document(question: str) -> str:
    """A "what is X for" question naming something this app has no Area for.

    The honest answer, and the one that replaces an invented page description. The app's own page
    list is finite and written down above; a name absent from it is either a page that does not
    exist or one nobody has defined, and both deserve "I don't have a description of that" rather
    than a confident paragraph."""
    return (
        "The asker is asking what some page or section of this app is for, but the name they used "
        "does not match any page or section this app has. Say plainly that you don't have a page "
        "by that name, and do NOT describe, guess at, or invent what it might do. Offer to tell "
        "them about the parts of the app they CAN reach instead."
    )


# --- Topics: what can be ASKED, and which area owns the answer --------------------------------

@dataclass(frozen=True)
class Topic:
    """One classifier class, and the areas that own its data.

    `areas` is the whole authorization rule for the topic: the caller may ask if they can stand in
    ANY of them. Every entry must be the area that OWNS the data - never a shared hub that merely
    displays a tab of it. `history` is the cautionary example: nine roles hold it, so mapping the
    organiser's decision log onto it told a Club Admin they could ask about registration decisions
    they have never been able to make.
    """

    key: str
    label: str
    ask_description: str
    areas: tuple[str, ...]


TOPICS: dict[str, Topic] = {topic.key: topic for topic in (
    Topic(
        key="events",
        label="published events",
        ask_description="Published events - what's on, when and where, and finding one by topic",
        # The visitor sections and the two internal pages showing the same catalogue. A role with
        # neither cannot ask about events at all, which is the intended answer for a Club Admin.
        areas=("public-happening-soon", "public-explore-events", "public-event-calendar",
               "public-event-details", "explore-events", "event-calendar"),
    ),
    Topic(
        key="my_registrations",
        label="your own saved events and registrations",
        ask_description="Your own event registrations and saved events",
        areas=("public-my-events", "my-events"),
    ),
    Topic(
        key="event_organiser",
        label="registrations for events you organise",
        ask_description="Who has registered for events you organise, and approvals waiting on you",
        # The proposal form is what makes someone an organiser, and it is exactly the grant the UI
        # itself checks before showing the Registrations tab (records-hub.ts showRegistrationsTab).
        areas=("proposal-form",),
    ),
    Topic(
        key="event_organiser_decisions",
        label="registration decisions you have made as an organiser",
        ask_description="Registrations you've already approved or rejected as an organiser",
        areas=("proposal-form",),
    ),
    Topic(
        key="clubs",
        label="clubs",
        ask_description="Clubs - what exists, what they do, their categories and how big they are",
        # Discover Clubs only. Manage Clubs is administration, and letting it satisfy this topic is
        # what had the assistant recommending clubs to join to the one role that cannot join any.
        areas=("clubs-discover",),
    ),
    Topic(
        key="clubs_mine",
        label="your own club memberships",
        ask_description="Your own club memberships, join requests and presidency",
        areas=("clubs-my",),
    ),
    Topic(
        key="clubs_admin",
        label="club administration",
        ask_description=("Club administration - every club including inactive ones, category "
                         "breakdowns, and president-change history"),
        areas=("clubs-manage", "club-category"),
    ),
    Topic(
        key="president_change",
        label="club president changes",
        ask_description="Club president-change requests",
        areas=("clubs-my", "clubs-manage"),
    ),
    Topic(
        key="admin_ai_denials",
        label="the AI access log",
        ask_description="The AI access log - which questions the assistant refused, who asked, and why",
        areas=("admin-ai-access-log",),
    ),
)}


def topic_areas(topic_key: str) -> tuple[str, ...]:
    topic = TOPICS.get(topic_key)
    return topic.areas if topic else ()


# --- Guides: how to DO something, and where the action happens --------------------------------

@dataclass(frozen=True)
class Guide:
    """One how-to. `areas` is where the ACTION happens, so the steps are released by exactly the
    grant that lets someone perform them - and withheld otherwise, rather than described to
    somebody who will then find no such button.

    `requires` is the rare second condition: ANY of `areas`, AND ALL of `requires`. It exists for
    the one action whose page genuinely cannot express it. Reviewing a proposal happens in the
    Inbox, but the Inbox is a shared hub - a Club Admin holds it to decide president-change
    requests, and would otherwise be handed instructions for reviewing proposals it takes no part
    in (the UI has the same problem and solves it by checking the role name, which nothing here is
    allowed to do). Requiring Ongoing as well says the real condition: you must be a participant in
    the proposal workflow, which every applicant and reviewer is and a Club Admin is not.

    Keep this empty unless a page genuinely cannot express the rule. Two conditions are harder to
    reason about than one, and the usual right answer is to name a more specific area instead.
    """

    key: str
    label: str
    steps: str
    areas: tuple[str, ...]
    requires: tuple[str, ...] = ()


GUIDES: dict[str, Guide] = {guide.key: guide for guide in (
    Guide(
        key="register_event",
        label="registering for an event",
        steps=(
            "How to register for an event: open the event from Explore Events and register from "
            "its details dialog. If the event's registration is Automatic you are confirmed "
            "immediately; if it is Manual approval, the request goes to the event's organiser and "
            "the outcome appears under My Events. A guest can register for a Public event without "
            "an account. If the event charges a fee, the same dialog asks for proof of payment "
            "before it will accept the registration."
        ),
        areas=("public-explore-events", "public-event-details", "explore-events"),
    ),
    Guide(
        key="upload_payment_proof",
        label="uploading proof of payment for an event",
        steps=(
            "How to upload proof of payment: a paid event asks for it in the same details dialog "
            "you register from - choose the receipt file (an image or a PDF) before confirming the "
            "registration. The organiser reviews it, and the registration stays pending until they "
            "do. A receipt is private: only the person who uploaded it and the event's organiser "
            "can ever open it."
        ),
        areas=("public-explore-events", "public-event-details", "explore-events"),
    ),
    Guide(
        key="save_event",
        label="saving an event",
        steps=(
            "How to save an event: use the save (heart) control on the event's card or in its "
            "details dialog. Saved events collect under My Events > Saved. Saving needs an "
            "account, so a signed-out visitor is asked to sign in first, and it is a bookmark "
            "only - it does not register you for anything."
        ),
        areas=("public-my-events", "my-events"),
    ),
    Guide(
        key="cancel_registration",
        label="cancelling your registration for an event",
        steps=(
            "How to cancel a registration: open My Events, find the event under Pending or "
            "Registered, and cancel it there. The organiser's attendee list updates straight away, "
            "and you can register again later while places remain."
        ),
        areas=("public-my-events", "my-events"),
    ),
    Guide(
        key="join_club",
        label="joining a club",
        steps=(
            "How to join a club: open Clubs > Discover Clubs, find one you're interested in, and "
            "submit a join request. The club's President reviews it and approves or rejects it - "
            "you can see the outcome under Clubs > My Clubs. Only students and lecturers can join "
            "clubs; only a student who is already a member can be promoted to President."
        ),
        areas=("clubs-discover",),
    ),
    Guide(
        key="decide_join_request",
        label="deciding a join request for your club",
        steps=(
            "How to decide a join request: as the club's President, open Clubs > My Clubs and pick "
            "your club - pending join requests are listed there to approve or reject. The "
            "applicant sees the outcome on their own My Clubs page."
        ),
        areas=("clubs-my",),
    ),
    Guide(
        key="become_president",
        label="becoming a club President",
        steps=(
            "How to become a club President: presidency is student-only, and is not something you "
            "apply for directly. A Club Admin assigns the first President when a club is created, "
            "or a sitting President can request to hand the role to another eligible student member "
            "via a president-change request - a Club Admin then approves or rejects that request."
        ),
        areas=("clubs-my",),
    ),
    Guide(
        key="decide_president_change",
        label="deciding a president-change request",
        steps=(
            "How to decide a president-change request: as a Club Admin, open your Inbox and go to "
            "the President Change Requests tab - each pending request names the club, the sitting "
            "President and the proposed student. Approve it to transfer the presidency, or reject "
            "it. Decided requests move to History."
        ),
        areas=("clubs-manage",),
    ),
    Guide(
        key="manage_clubs",
        label="creating or changing a club",
        steps=(
            "How to create or change a club: open Clubs > Manage Clubs. From there you can create "
            "a club (naming its first President, who must be a student), edit its details and "
            "categories, deactivate one that is no longer running, or delete it. The categories "
            "themselves are maintained on the Club Category page."
        ),
        areas=("clubs-manage",),
    ),
    Guide(
        key="submit_proposal",
        label="submitting an event proposal",
        steps=(
            "How to submit an event proposal: open Forms > Proposal, fill in the event details "
            "(title, description, schedule, expected attendance, visibility) and choose which "
            "department services you need (logistics, transport, sound/light, photography, campus "
            "tour, catering). Submitting routes it to your Head of School/Department first; large "
            "(high-pax) or paid events also go through F&B and/or the CFO before reaching the "
            "departments providing the services you asked for. You can track it under My Requests > "
            "Ongoing, and it lands in History once approved, rejected, or cancelled. If a reviewer "
            "sends it back for changes, it appears in your Inbox for you to resubmit."
        ),
        areas=("proposal-form",),
    ),
    Guide(
        key="review_proposal",
        label="reviewing a proposal",
        steps=(
            "How to review a proposal you're responsible for: it appears in your Inbox once it "
            "reaches your stage (Head of School/Department, F&B, CFO, or your department's task "
            "queue). Open it to approve, reject, or send it back to the applicant with a comment "
            "explaining what needs to change."
        ),
        areas=("inbox",),
        requires=("ongoing",),
    ),
    Guide(
        key="resubmit_proposal",
        label="resubmitting a proposal",
        steps=(
            "How to resubmit a proposal sent back for changes: it shows up in your Inbox with the "
            "reviewer's comment explaining what to fix. Open it, make the changes, and resubmit - "
            "it resumes the workflow from where it left off, it does not restart."
        ),
        # The APPLICANT's action, not the reviewer's: only someone who could submit a proposal can
        # be sent one back. Gated on the form rather than on the Inbox it is read in, so a Club
        # Admin - which holds the Inbox for president-change requests - is not told how to resubmit
        # a proposal it could never have submitted.
        areas=("proposal-form",),
    ),
    Guide(
        key="cancel_proposal",
        label="cancelling a proposal or event",
        steps=(
            "How to cancel a proposal or published event: open it from My Requests (Ongoing) and "
            "choose Cancel. This is only available up to a configured number of days before the "
            "event date, and it cancels any in-progress department tasks and cafeteria orders tied "
            "to it too."
        ),
        areas=("ongoing",),
    ),
    Guide(
        key="decide_registration",
        label="approving or rejecting a registration for your event",
        steps=(
            "How to decide a registration for an event you organise: manual-approval registrations "
            "land in your Inbox under Registrations. Open one to see who applied and, for a paid "
            "event, their proof of payment, then approve or reject it. The attendee sees the "
            "outcome under their own My Events."
        ),
        areas=("proposal-form",),
    ),
)}


# --- Back-compatible views over the tables above ----------------------------------------------
# topic_access.py and knowledge_base.py have imported these names for a long time, and
# tests/test_ai_scope.py asserts against them. They are DERIVED here rather than maintained
# separately - which is the entire point of this module.

# Internal nav page codes only, so "does this page exist in nav_page" stays a meaningful check.
# Visitor areas are not nav pages and never will be.
TOPIC_PAGES: dict[str, tuple[str, ...]] = {
    key: tuple(a for a in topic.areas if AREAS[a].reach == PAGE)
    for key, topic in TOPICS.items()
}
TOPIC_LABEL: dict[str, str] = {key: topic.label for key, topic in TOPICS.items()}
TOPIC_ASK_DESCRIPTION: dict[str, str] = {key: topic.ask_description for key, topic in TOPICS.items()}

HOW_TO_GUIDES: dict[str, str] = {key: guide.steps for key, guide in GUIDES.items()}
HOW_TO_LABEL: dict[str, str] = {key: guide.label for key, guide in GUIDES.items()}
HOW_TO_PAGES: dict[str, tuple[str, ...]] = {
    key: tuple(a for a in (*guide.areas, *guide.requires) if AREAS[a].reach == PAGE)
    for key, guide in GUIDES.items()
}
