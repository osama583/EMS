"""The assistant's WORLD MODEL: every page it knows about, every function it can explain, the two
data topics it may answer from, and the one reachability check that gates all of them.

WHAT THE ASSISTANT IS, stated once so nothing downstream has to guess. It does exactly seven
things, and anything outside them is declined rather than improvised:

    1. suggest events            ask about preferences first, then a shortlist with reasons
    2. answer about an event     from the event CARD and the Explore Events details, nothing else
    3. suggest clubs             the same two-part flow as events
    4. answer about a club       from the club CARD and the Discover Clubs details, nothing else
    5. explain a page            from PAGES below - never improvised from whatever data is around
    6. explain how to do X       from FUNCTIONS below - name the page, then give the steps
    7. answer "who am I"         the asker's own identity, roles and access, from their token

Everything else is out of scope: who registered for an event, who joined a club, anybody else's
registration or membership, event administration, approval-workflow status, analytics, reports,
internal system data, and every subject outside this app entirely. Not "gated", not "ask an
administrator" - absent. See topic_access.out_of_scope_document for the sentence the asker gets.

TWO KNOWLEDGE BASES, ONE SHAPE EACH, and this module is the whole of both - because a page and the
functions living on it drifting apart is the specific failure it exists to prevent.

    Page      Page Name / Purpose / What Users Can Do / Related Functions / Visibility Rules
    Function  Function Name / Page / Purpose / User Steps / Visibility Rules

`Related Functions` is DERIVED from FUNCTIONS: a function names its page, and the page reads its
own function list back out. Neither side can be edited into disagreeing with the other.

PAGE VISIBILITY IS THE SOURCE OF TRUTH FOR EVERYTHING. One check - can_reach() - decides whether a
page may be described, whether a function's steps may be given, whether the event or club topic may
be answered at all, and what "what can you do?" is allowed to claim. An internal page resolves
against nav_page_grants, the same table the sidebar and require_page() use, so revoking a page in
/app/admin/page-visibility narrows the assistant on the very next request - no deploy, and no role
name hardcoded anywhere in this module.

A page the caller cannot reach is treated as ABSENT rather than forbidden wherever they can see the
difference: its functions are not offered, its topics are not answerable, and it is never named in
a capability list. The single deliberate exception is a direct "what is X for" about a real page
they cannot open - a page's PURPOSE is nobody's data, and refusing to describe the app to the
person using it is a dead end, not privacy - so that answers with the definition and says plainly
they cannot open it. What is withheld there is the page's CONTENTS.

ADDING SOMETHING: define the Page first (what is it, what can you do there, who can stand there),
then point a Function or a Topic at it. tests/test_ai_scope.py fails if a Page names a nav page
that does not exist, if a Function names a Page that does not, or if an intent has no route -
which is what stops the drift this module was written to end.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..services import identity

# --- Tiers: which surface is this caller standing on ------------------------------------------

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


# --- Reach: the three kinds of visibility rule a page can have --------------------------------

VISITOR = "visitor"              # the public landing page: guests AND external accounts
EXTERNAL_ONLY = "external-only"  # /my-events, the external account's own area
PAGE = "page"                    # an internal nav page, gated by Page Visibility


@dataclass(frozen=True)
class Page:
    """One page of this app, in the five fields the assistant may describe it with.

    name        Page Name          what it is called in the UI
    purpose     Purpose            one or two sentences, and the ONLY thing "what is this page"
                                   may be answered from
    actions     What Users Can Do  the real, concrete things available on it
    functions   Related Functions  DERIVED from FUNCTIONS below - never written here
    visibility  Visibility Rules   DERIVED from reach / gated_by / audience below

    `gated_by` exists for a page whose visibility is not its own nav_page row. Created by Me has no
    nav entry at all, and its real condition is holding the proposal form - which is what makes
    someone an organiser, and an organiser is exactly who that page is for. Default is the page's
    own code, which is the ordinary case.
    """

    code: str
    name: str
    reach: str
    purpose: str
    actions: tuple[str, ...] = ()
    route: str | None = None
    aliases: tuple[str, ...] = ()
    gated_by: tuple[str, ...] = ()
    audience: str = ""

    @property
    def gates(self) -> tuple[str, ...]:
        return self.gated_by or (self.code,)

    @property
    def functions(self) -> tuple[Function, ...]:
        """Related Functions, read out of the function table rather than maintained here."""
        return tuple(fn for fn in FUNCTIONS.values() if self.code in fn.pages)

    @property
    def visibility(self) -> str:
        """Visibility Rules as one plain sentence, derived from the same fields can_reach() reads."""
        if self.reach == VISITOR:
            base = ("Open to everyone, signed in or not - it is a section of the public landing "
                    "page. University accounts use the equivalent page inside the app instead.")
        elif self.reach == EXTERNAL_ONLY:
            base = "Signed-in visitor accounts only."
        elif self.gates == (self.code,):
            base = (f"University accounts whose role has been granted '{self.name}' in Page "
                    "Visibility.")
        else:
            gates = ", ".join(f"'{PAGES[code].name}'" for code in self.gates if code in PAGES)
            base = f"University accounts whose role has been granted {gates} in Page Visibility."
        return f"{base} {self.audience}".strip()


def _page(code, name, reach, purpose, actions=(), route=None, aliases=(), gated_by=(),
          audience="") -> Page:
    return Page(code=code, name=name, reach=reach, purpose=purpose, actions=tuple(actions),
                route=route, aliases=tuple(aliases), gated_by=tuple(gated_by), audience=audience)


PAGES: dict[str, Page] = {page.code: page for page in (
    # --- VISITOR: the public landing page, section by section ---------------------------------
    _page("public-home", "Home", VISITOR,
          "The landing page's opening section - what APU Events is, with a search box and a way "
          "into the published events below it.",
          actions=("Read what the platform is for",
                   "Search published events from the header search box",
                   "Jump to the event sections further down the page"),
          route="/#home", aliases=("landing page", "home page")),
    _page("public-campus-life", "Life at APU", VISITOR,
          "A short introduction to campus life - the kinds of activity, clubs and events the "
          "university runs. Descriptive only; it holds nothing to book or join.",
          actions=("Read about the kinds of activity the university runs",),
          route="/#campus-life", aliases=("campus life",)),
    _page("public-happening-soon", "Happening Soon", VISITOR,
          "The next few published events by date, as a quick glance at what is on shortly. It is a "
          "preview of the same catalogue Explore Events lists in full.",
          actions=("See the next few published events",
                   "Open any of them to read the full details and register"),
          route="/#happening-soon", aliases=("upcoming events",)),
    _page("public-explore-events", "Explore Events", VISITOR,
          "The full browsable list of published events, searchable and filterable by category. "
          "This is where a visitor finds an event and opens it to register.",
          actions=("Browse every published event open to them",
                   "Search by name and filter by category",
                   "Open an event to see its full details",
                   "Register from the event's details dialog",
                   "Save an event, after signing in"),
          route="/#explore-events", aliases=("browse events", "event list")),
    _page("public-event-calendar", "Event Calendar", VISITOR,
          "The published events laid out by date on a month calendar, so you can see what falls on "
          "a given day. It is the same public catalogue as Explore Events in a calendar view - it "
          "is NOT a personal or private calendar, and it holds nothing but published events.",
          actions=("See which events fall on which date",
                   "Move between months",
                   "Open a day's event to read its details and register"),
          route="/#event-calendar", aliases=("events calendar",)),
    _page("public-event-details", "Event details", VISITOR,
          "One event's own dialog: its picture, categories, how many people have registered, its "
          "visibility, introduction, date, start and end time, venue, organiser, school or "
          "department, format, expected attendance, cost, how registration is approved, and the "
          "clubs behind it - plus the Register button.",
          actions=("Read every published detail of one event",
                   "Enlarge the event picture",
                   "Register, uploading proof of payment when the event charges a fee"),
          aliases=("event page", "event dialog", "event card", "event details dialog")),

    # --- EXTERNAL: the visitor account's own area ---------------------------------------------
    _page("public-my-events", "My Events", EXTERNAL_ONLY,
          "A signed-in visitor's own events: the ones they saved, registrations still awaiting the "
          "organiser's approval, confirmed registrations, and past ones.",
          actions=("See saved events",
                   "See pending and confirmed registrations",
                   "Cancel a registration",
                   "Look back at past events"),
          route="/my-events", aliases=("saved events",)),

    # --- PAGE: the internal shell, gated by Page Visibility -----------------------------------
    _page("how-it-works", "How It Works", PAGE,
          "A written walkthrough of how a proposal becomes a published event, stage by stage.",
          actions=("Read the proposal journey end to end before starting one",),
          route="/app/how-it-works"),
    _page("dashboard", "Dashboard", PAGE,
          "An at-a-glance activity summary for the unit or outlet the viewer is responsible for - "
          "the numbers and recent activity belonging to their own role.",
          actions=("See a summary of the activity you are responsible for",
                   "Follow a summary tile through to the page behind it"),
          route="/app/dashboard"),
    _page("inbox", "Inbox", PAGE,
          "Everything currently waiting on THIS viewer to act: proposals at their approval stage, "
          "department tasks, catering orders, registrations needing manual approval, and "
          "president-change requests for a Club Admin. A shared hub - which tabs appear depends "
          "entirely on who is looking.",
          actions=("See what is waiting on you, grouped by kind",
                   "Open an item and take the decision it is waiting for"),
          route="/app/inbox"),
    _page("reports", "Reports", PAGE,
          "Operational reports across the cafeteria system - orders, outlets and staff activity.",
          actions=("Read the cafeteria operational reports",),
          route="/app/reports"),
    _page("my-requests", "My Requests", PAGE,
          "The folder holding Ongoing, History and Drafts - everything the viewer has submitted or "
          "still has to follow up.",
          actions=("Open Ongoing, History or Drafts",)),
    _page("ongoing", "Ongoing", PAGE,
          "Requests the viewer has submitted that are still moving through their workflow.",
          actions=("Track where each submitted request has got to",
                   "Open a request to read its current stage",
                   "Cancel a request that has not finished yet"),
          route="/app/ongoing"),
    _page("history", "History", PAGE,
          "Requests that have finished - approved, rejected or cancelled. A shared hub: each role "
          "sees the tabs for the workflows it takes part in, and nothing else.",
          actions=("Look back at finished requests and how they were decided",),
          route="/app/history"),
    _page("drafts", "Drafts", PAGE,
          "Proposals the viewer has started and saved but not yet submitted for approval.",
          actions=("Reopen a saved draft and keep working on it",
                   "Submit a draft for approval",
                   "Delete a draft"),
          route="/app/proposals/drafts"),
    _page("events", "Events", PAGE,
          "The folder holding the internal event pages - Explore Events, My Events and the Event "
          "Calendar.",
          actions=("Open Explore Events, My Events or the Event Calendar",)),
    _page("explore-events", "Explore Events", PAGE,
          "The internal catalogue of published events - the same browsing and registering a "
          "visitor does on the landing page, plus the Internal-visibility events a university "
          "account may also see. Every event's card carries its title, categories, date, time, "
          "venue, the clubs behind it and how many people have registered.",
          actions=("Browse every published event you are allowed to see",
                   "Search by name and filter by category",
                   "Open an event to read its full details",
                   "Register for an event",
                   "Save an event to come back to"),
          route="/app/events/explore-events", aliases=("browse events", "event list")),
    _page("my-events", "My Events", PAGE,
          "The viewer's own events: saved, awaiting approval, registered, and past.",
          actions=("See saved events",
                   "See pending and confirmed registrations",
                   "Cancel a registration",
                   "Look back at past events"),
          route="/app/events/my-events"),
    _page("event-calendar", "Event Calendar", PAGE,
          "The university-wide master calendar - every published event the viewer may see, laid "
          "out by date. A shared view of the catalogue, not a personal calendar.",
          actions=("See which events fall on which date",
                   "Move between months",
                   "Open a day's event to read its details"),
          route="/app/event-calendar", aliases=("master calendar",)),
    _page("created-by-me", "Created by Me", PAGE,
          "The published events the viewer proposed or co-owns - their own organiser view of the "
          "events they are running.",
          actions=("See the published events you created",
                   "Search and filter your own events"),
          route="/app/created-by-me", aliases=("my created events",),
          # It has no nav_page row of its own. Holding the proposal form is what makes someone an
          # organiser, and an organiser is precisely who this page exists for.
          gated_by=("proposal-form",),
          audience="It is only meaningful for people who can propose events."),
    _page("forms", "Forms", PAGE,
          "The folder holding the forms this app accepts submissions through.",
          actions=("Open the Proposal form",)),
    _page("proposal-form", "Proposal", PAGE,
          "The event proposal form - where an event is proposed, costed and sent for approval. "
          "Holding this page is also what makes someone an event organiser.",
          actions=("Fill in and submit an event proposal",
                   "Choose the department services the event needs",
                   "Save a part-finished proposal as a draft"),
          route="/app/forms/event-proposal", aliases=("proposal form", "event proposal")),
    _page("menu", "My Menu", PAGE,
          "The menu of the viewer's own cafeteria outlet, and what it currently offers.",
          actions=("See your outlet's menu",
                   "Add, edit or remove a menu item",
                   "Mark an item available or unavailable"),
          route="/app/menu"),
    _page("cafeteria-my-staff", "My Staff", PAGE,
          "The staff posted to the viewer's own cafeteria outlet.",
          actions=("See who works at your outlet",
                   "Request a staff change for your outlet"),
          route="/app/cafeterias/my-staff"),
    _page("my-cafeteria-folder", "My Cafeteria", PAGE,
          "The folder holding the pages for running the viewer's own cafeteria outlet.",
          actions=("Open My Menu or My Staff",)),
    _page("cafeteria-admin-folder", "Cafeterias", PAGE,
          "The folder holding the pages for administering every cafeteria outlet.",
          actions=("Open the cafeteria administration pages",)),
    _page("cafeteria-manage", "Manage Cafeterias", PAGE,
          "Every cafeteria outlet, and who runs each one.",
          actions=("See every outlet and its manager",
                   "Create, edit or deactivate an outlet"),
          route="/app/cafeterias/manage"),
    _page("cafeteria-staff-assignments", "Staff Assignments", PAGE,
          "Which cafeteria staff are posted to which outlet, across every outlet.",
          actions=("See how staff are spread across outlets",
                   "Move a staff member between outlets"),
          route="/app/cafeterias/staff-assignments"),
    _page("cafeteria-menu-oversight", "Menu Oversight", PAGE,
          "Every cafeteria outlet's menu, side by side, for whoever oversees them all.",
          actions=("Compare what the different outlets offer",),
          route="/app/cafeterias/menu-oversight"),
    _page("cafeteria-staff-requests-history", "Staff Action History", PAGE,
          "The audit trail of cafeteria staff hires, suspensions, restorations and removals.",
          actions=("Look back at staff changes and who made them",),
          route="/app/cafeterias/staff-requests-history"),
    _page("admin-directory", "Internal Directory", PAGE,
          "The folder holding the account, unit, role and Page Visibility administration pages.",
          actions=("Open Users, Units, Roles or Page Visibility",)),
    _page("admin-users", "Users", PAGE,
          "Every user account in the system, and the roles each one holds.",
          actions=("Find an account",
                   "Create an account or change the roles it holds",
                   "Deactivate an account"),
          route="/app/users"),
    _page("admin-units", "Units", PAGE,
          "The schools, departments and cafeterias that a role can be scoped to.",
          actions=("See every unit", "Create, rename or deactivate a unit"),
          route="/app/units"),
    _page("admin-roles", "Roles", PAGE,
          "The roles an account can hold, and what each one is called.",
          actions=("See every role", "Create or rename a role"),
          route="/app/roles"),
    _page("admin-page-visibility", "Page Visibility", PAGE,
          "Which roles and units can reach which pages. This page also decides what the assistant "
          "will answer for each role - the grant that shows a page is the grant that releases it.",
          actions=("See which roles can reach which pages",
                   "Grant or revoke a page for a role, optionally scoped to a unit"),
          route="/app/admin/page-visibility", aliases=("page permissions",)),
    _page("admin-ai-access-log", "AI Access Log", PAGE,
          "Every question the assistant declined, who asked it, which topic it needed and why.",
          actions=("Read the refusal log", "Filter it by person, topic or reason"),
          route="/app/admin/ai-access-log"),
    _page("manage-clubs", "Clubs", PAGE,
          "The folder holding the club pages - Discover Clubs, My Clubs and the administration "
          "pages.",
          actions=("Open Discover Clubs, My Clubs, Manage Clubs or Club Category",)),
    _page("clubs-manage", "Manage Clubs", PAGE,
          "Club administration: create, edit, deactivate and delete clubs, and decide "
          "president-change requests. It is not a place to browse or join a club.",
          actions=("Create a club and name its first President",
                   "Edit a club's details and categories",
                   "Deactivate or delete a club",
                   "Approve or reject a president-change request"),
          route="/app/clubs/manage", aliases=("club management",)),
    _page("clubs-discover", "Discover Clubs", PAGE,
          "The catalogue of clubs open to join. Every club's card carries its name, categories, "
          "description, current President and member count, with the button that submits a join "
          "request.",
          actions=("Browse every active club",
                   "Search by name and filter by category",
                   "Read a club's description, categories, President and member count",
                   "Submit a request to join a club"),
          route="/app/clubs/discover",
          aliases=("club discovery", "browse clubs", "explore clubs", "club card")),
    _page("clubs-my", "My Clubs", PAGE,
          "The clubs the viewer belongs to, the ones they preside over, and - for a President - "
          "the join requests and president-change requests for their own club.",
          actions=("See the clubs you belong to and when you joined",
                   "As President, decide join requests for your own club",
                   "As President, request to hand the presidency to another student",
                   "Leave a club"),
          route="/app/clubs"),
    _page("club-category", "Club Category", PAGE,
          "The categories clubs are filed under, and which clubs sit in each.",
          actions=("See every club category", "Create, rename or deactivate a category"),
          route="/app/club-category"),
    _page("system-config", "System Configuration", PAGE,
          "The folder holding the approval-workflow, event-category and event-format settings.",
          actions=("Open the approval, category and format settings",)),
    _page("admin-settings-policies", "Approval Workflows & Policies", PAGE,
          "The approval routing rules and the policy numbers behind them - the high-pax threshold, "
          "the cancellation deadline, the minimum lead time.",
          actions=("See how proposals are routed for approval",
                   "Change a routing rule or a policy number"),
          route="/app/admin/settings/policies"),
    _page("admin-settings-categories", "Event Categories", PAGE,
          "The categories an event can be filed under, which is also what Explore Events filters "
          "by.",
          actions=("See every event category", "Create, rename or deactivate a category"),
          route="/app/admin/settings/categories"),
    _page("admin-settings-formats", "Event Formats", PAGE,
          "The formats an event can take - the choices an applicant picks from on the proposal "
          "form.",
          actions=("See every event format", "Create, rename or deactivate a format"),
          route="/app/admin/settings/formats"),
    _page("dropdown-settings", "Dropdown Settings", PAGE,
          "The folder where each department maintains the dropdown options applicants pick from on "
          "the proposal form.",
          actions=("Open the option list your department owns",)),
)}

# The dropdown-option pages, one per kind, generated because they are a FAMILY: twelve pages that
# differ only in which list they maintain and which department owns it (seed/nav.py's
# dropdown_kinds). Writing twelve near-identical Page literals would invite exactly the drift this
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
PAGES.update({
    f"dropdown-{kind}": _page(
        f"dropdown-{kind}", label, PAGE,
        f"The {label} list - the options an applicant chooses from on the proposal form, "
        "maintained by the department that owns them.",
        actions=(f"See every {label} option", "Add, rename or deactivate an option"),
        route=f"/app/dropdown-options/{kind}",
    )
    for kind, label in _DROPDOWN_KINDS
})

DROPDOWN_PAGES: tuple[str, ...] = tuple(f"dropdown-{kind}" for kind, _label in _DROPDOWN_KINDS)

# Derived, so adding a Page is the only edit needed.
VISITOR_PAGES: tuple[str, ...] = tuple(c for c, p in PAGES.items() if p.reach == VISITOR)
EXTERNAL_PAGES: tuple[str, ...] = tuple(c for c, p in PAGES.items() if p.reach == EXTERNAL_ONLY)
INTERNAL_PAGES: tuple[str, ...] = tuple(c for c, p in PAGES.items() if p.reach == PAGE)


# --- Functions: how to DO something, and where the action happens -----------------------------

@dataclass(frozen=True)
class Function:
    """One thing a person can DO in this app, in the five fields the assistant may describe it with.

    name        Function Name      what the action is called
    page        Page               where it happens - `pages[0]`, the owning page
    purpose     Purpose            what performing it achieves
    steps       User Steps         the ordered steps, and the only thing a how-to may be
                                   answered from
    visibility  Visibility Rules   DERIVED - reachable pages, and `requires` when there is one

    `pages` is more than one only where the SAME action genuinely exists on two surfaces (a visitor
    registers from the landing page, a university account from the internal catalogue). The first
    entry is the canonical one and is what gets named in an answer.

    `requires` is the rare second condition: ANY of `pages`, AND ALL of `requires`. It exists for
    the one action whose page cannot express it. Reviewing a proposal happens in the Inbox, but the
    Inbox is a shared hub - a Club Admin holds it to decide president-change requests, and would
    otherwise be handed instructions for reviewing proposals it takes no part in. Requiring Ongoing
    too states the real condition: you must be a participant in the proposal workflow.

    Keep `requires` empty unless a page genuinely cannot express the rule. Two conditions are harder
    to reason about than one, and the usual right answer is to name a more specific page instead.
    """

    key: str
    name: str
    pages: tuple[str, ...]
    purpose: str
    steps: tuple[str, ...]
    requires: tuple[str, ...] = ()
    # What people actually call this action, for resolving "how do I ...". Matched longest-first,
    # so a specific phrase always beats a general one - see function_named().
    aliases: tuple[str, ...] = ()

    @property
    def page(self) -> str:
        return self.pages[0]

    @property
    def page_name(self) -> str:
        return PAGES[self.page].name

    @property
    def visibility(self) -> str:
        names = " or ".join(f"'{PAGES[code].name}'" for code in self.pages if code in PAGES)
        extra = ""
        if self.requires:
            also = " and ".join(f"'{PAGES[code].name}'" for code in self.requires if code in PAGES)
            extra = f", and who also has {also}"
        return f"Anyone who can reach {names}{extra}."


def _fn(key, name, pages, purpose, steps, requires=(), aliases=()) -> Function:
    return Function(key=key, name=name, pages=tuple(pages), purpose=purpose, steps=tuple(steps),
                    requires=tuple(requires), aliases=tuple(aliases))


FUNCTIONS: dict[str, Function] = {fn.key: fn for fn in (
    # --- Events --------------------------------------------------------------------------------
    _fn("find_event", "Find an event", ("explore-events", "public-explore-events"),
        "Locate a published event by name, category or date, out of everything you are allowed to "
        "see.",
        ("Open Explore Events.",
         "Type part of the event's name in the search box, or leave it blank to see everything.",
         "Narrow the list with the category filter, and the date filter for a particular period.",
         "Open the card of the event you want to read its full details."),
        aliases=("find an event", "find events", "search for an event", "search events",
                 "look for an event", "browse events", "discover events", "see what events are on",
                 "find something to attend")),
    _fn("view_event_details", "See an event's details", ("explore-events", "public-explore-events"),
        "Read everything published about one event - its introduction, schedule, venue, organiser, "
        "format, cost, how registration works and how many people have registered.",
        ("Open Explore Events and find the event.",
         "Click the event's card to open its details dialog.",
         "Read the summary strip for its categories, registration count and visibility, then the "
         "detail list for date, time, venue, organiser, school or department, format, expected "
         "attendance, cost and how registration is approved."),
        aliases=("see an event's details", "view an event", "open an event", "event details",
                 "read about an event", "see more about an event")),
    _fn("register_event", "Register for an event", ("explore-events", "public-explore-events"),
        "Claim a place at a published event.",
        ("Open Explore Events and click the event you want.",
         "Enter your email in the details dialog - a signed-out visitor gives their name too.",
         "If the event approves registrations manually, write your reason for attending.",
         "If the event charges a fee, upload your proof of payment first.",
         "Press Register. An Automatic event confirms you straight away; a Manual one sends the "
         "request to the organiser, and the outcome appears under My Events."),
        aliases=("register for an event", "sign up for an event", "sign up for events",
                 "attend an event", "book an event", "book a place", "get a place at an event",
                 "join an event", "registration for an event")),
    _fn("upload_payment_proof", "Upload proof of payment",
        ("explore-events", "public-explore-events"),
        "Show the organiser you have paid, so a paid event can confirm your registration.",
        ("Open the paid event's details dialog from Explore Events.",
         "Read the Payment Required panel for the amount and the account to pay into.",
         "Choose your receipt file - a PNG, JPG, WebP or PDF - under Payment proof.",
         "Press Register. The registration stays pending until the organiser has reviewed the "
         "receipt."),
        aliases=("upload proof of payment", "upload a receipt", "attach a receipt", "payment proof",
                 "proof of payment", "pay for an event", "send my payment")),
    _fn("save_event", "Save an event", ("my-events", "public-my-events"),
        "Bookmark an event to come back to. It does not register you for anything.",
        ("Find the event in Explore Events.",
         "Press the heart on its card, or in its details dialog.",
         "It collects under My Events, in the Saved tab.",
         "Saving needs an account, so a signed-out visitor is asked to sign in first."),
        aliases=("save an event", "bookmark an event", "favourite an event", "favorite an event",
                 "heart an event", "keep an event for later")),
    _fn("cancel_registration", "Cancel a registration", ("my-events", "public-my-events"),
        "Give up a place you had claimed at an event.",
        ("Open My Events.",
         "Find the event under Pending or Registered.",
         "Cancel it there. You can register again later while places remain."),
        aliases=("cancel a registration", "cancel my registration", "cancel my place",
                 "cancel my booking", "unregister from an event", "withdraw from an event",
                 "pull out of an event")),
    _fn("view_event_calendar", "See events by date", ("event-calendar", "public-event-calendar"),
        "See what falls on a particular day, rather than searching the list.",
        ("Open the Event Calendar.",
         "Move to the month you are interested in.",
         "Click a day's entry to open that event's details."),
        aliases=("see the event calendar", "use the calendar", "check the calendar",
                 "see what is on a date", "view events by date")),

    # --- Clubs ---------------------------------------------------------------------------------
    _fn("find_club", "Find a club", ("clubs-discover",),
        "Locate a club by name or category out of the clubs open to join.",
        ("Open Clubs, then Discover Clubs.",
         "Type part of the club's name in the search box, or filter by category.",
         "Each card shows the club's categories, description, current President and member count.",
         "Read the description to see whether it matches what you are after."),
        aliases=("find a club", "find clubs", "discover clubs", "browse clubs", "explore clubs",
                 "search for a club", "look for a club", "find a club that matches my interests",
                 "find clubs that match my interests")),
    _fn("join_club", "Join a club", ("clubs-discover",),
        "Ask a club to take you on as a member.",
        ("Open Clubs, then Discover Clubs.",
         "Find the club you want and press Request to Join.",
         "Say why you want to join, and send the request.",
         "The club's President approves or rejects it, and the outcome appears under My Clubs.",
         "Only students and lecturers can join clubs."),
        aliases=("join a club", "request to join a club", "apply to a club", "sign up for a club",
                 "become a member of a club", "get into a club")),
    _fn("leave_club", "Leave a club", ("clubs-my",),
        "Give up a membership you no longer want.",
        ("Open Clubs, then My Clubs.",
         "Find the club in your membership list and leave it there."),
        aliases=("leave a club", "quit a club", "cancel my club membership")),
    _fn("decide_join_request", "Decide a join request", ("clubs-my",),
        "As a club's President, accept or turn down someone asking to join your club.",
        ("Open Clubs, then My Clubs.",
         "Pick the club you preside over.",
         "Read the pending join requests listed there.",
         "Approve or reject each one. The applicant sees the outcome on their own My Clubs page."),
        aliases=("decide a join request", "approve a join request", "reject a join request",
                 "handle join requests", "accept someone into my club",
                 "approve someone joining my club")),
    _fn("request_president_change", "Hand over the club presidency", ("clubs-my",),
        "Pass the President role to another student member of your club.",
        ("Presidency is student-only and is not something you apply for directly.",
         "A Club Admin names the first President when a club is created.",
         "A sitting President opens Clubs, then My Clubs, and raises a president-change request "
         "naming another eligible student member.",
         "A Club Admin approves or rejects that request, and the presidency transfers on approval."),
        aliases=("hand over the presidency", "step down as president", "become a club president",
                 "become president of a club", "become president", "transfer the presidency",
                 "president change request", "make someone else president")),
    _fn("decide_president_change", "Decide a president-change request", ("clubs-manage",),
        "As a Club Admin, approve or reject a request to move a club's presidency.",
        ("Open your Inbox and go to the President Change Requests tab.",
         "Each pending request names the club, the sitting President and the proposed student.",
         "Approve it to transfer the presidency, or reject it.",
         "Decided requests move to History."),
        aliases=("decide a president-change request", "approve a president change",
                 "reject a president change", "handle president change requests")),
    _fn("manage_clubs", "Create or change a club", ("clubs-manage",),
        "Set up a new club, or edit, deactivate or delete an existing one.",
        ("Open Clubs, then Manage Clubs.",
         "To create one, fill in its name, description and categories, and name its first "
         "President - who must be a student.",
         "To change one, open it and edit its details or categories.",
         "Deactivate a club that is no longer running, or delete it outright.",
         "The categories themselves are maintained on the Club Category page."),
        aliases=("create a club", "set up a club", "start a club", "add a club", "edit a club",
                 "rename a club", "delete a club", "deactivate a club", "manage clubs",
                 "change a club")),
    _fn("manage_club_categories", "Maintain club categories", ("club-category",),
        "Keep the list of categories clubs are filed under.",
        ("Open Clubs, then Club Category.",
         "Add a category, rename one, or deactivate one you no longer use.",
         "Each club can carry up to three of them."),
        aliases=("manage club categories", "add a club category", "create a club category",
                 "edit club categories")),

    # --- Proposals and the events they become --------------------------------------------------
    _fn("submit_proposal", "Submit an event proposal", ("proposal-form",),
        "Propose an event so it can be approved and published.",
        ("Open Forms, then Proposal.",
         "Fill in the event details - title, description, schedule, expected attendance and "
         "visibility.",
         "Choose the department services you need: logistics, transport, sound and light, "
         "photography, campus tour, catering.",
         "Submit. It goes to your Head of School or Department first; large or paid events also go "
         "through F&B and the CFO, then to the departments providing the services you asked for.",
         "Track it under My Requests, in Ongoing."),
        aliases=("submit a proposal", "submit an event proposal", "propose an event",
                 "create an event", "run an event", "organise an event", "organize an event",
                 "apply to run an event", "request an event", "make an event")),
    _fn("save_draft", "Save a proposal as a draft", ("drafts",),
        "Keep a part-finished proposal and come back to it.",
        ("Fill in as much of the Proposal form as you have.",
         "Save it as a draft instead of submitting.",
         "It waits under My Requests, in Drafts, until you reopen and submit it."),
        aliases=("save a draft", "save a proposal for later", "finish a draft later",
                 "come back to a proposal")),
    _fn("track_request", "Track a request you submitted", ("ongoing",),
        "See how far a submitted proposal has got through its approval workflow.",
        ("Open My Requests, then Ongoing.",
         "Each row shows the request and the stage it is currently sitting at.",
         "Open one to read its detail and its reviewers' comments.",
         "Once it finishes it moves to History."),
        aliases=("track my request", "track a request", "check my proposal status",
                 "see where my request is", "follow my proposal", "check on my proposal")),
    _fn("cancel_proposal", "Cancel a proposal or event", ("ongoing",),
        "Withdraw something you submitted, or call off an event that was already published.",
        ("Open My Requests, then Ongoing.",
         "Open the request and choose Cancel.",
         "This is only available up to a set number of days before the event date.",
         "Cancelling also stops any department tasks and cafeteria orders tied to it."),
        aliases=("cancel a proposal", "cancel my event", "withdraw a proposal",
                 "call off an event")),
    _fn("review_proposal", "Review a proposal", ("inbox",),
        "Take the approval decision a proposal is waiting on you for.",
        ("A proposal arrives in your Inbox once it reaches your stage.",
         "Open it and read the detail the applicant submitted.",
         "Approve it, reject it, or send it back with a comment saying what needs to change."),
        requires=("ongoing",),
        aliases=("review a proposal", "approve a proposal", "reject a proposal",
                 "decide a proposal", "send a proposal back", "action a proposal")),
    _fn("resubmit_proposal", "Resubmit a proposal", ("proposal-form",),
        "Fix and re-send a proposal a reviewer handed back to you.",
        ("It appears in your Inbox with the reviewer's comment explaining what to change.",
         "Open it, make the changes, and resubmit.",
         "It resumes the workflow from where it left off; it does not restart."),
        aliases=("resubmit a proposal", "resubmit my proposal", "fix a proposal",
                 "my proposal was sent back", "changes were requested")),
    _fn("decide_registration", "Decide a registration for your event", ("inbox",),
        "As the event's organiser, approve or reject someone's request to attend.",
        ("Manual-approval registrations land in your Inbox, under Registrations.",
         "Open one to see the request and, for a paid event, the proof of payment.",
         "Approve or reject it. The attendee sees the outcome under their own My Events."),
        requires=("proposal-form",),
        aliases=("decide a registration", "approve a registration", "reject a registration",
                 "approve attendees", "decide who can attend my event")),
    _fn("view_finished_requests", "Look up a finished request", ("history",),
        "Find something that has already been approved, rejected or cancelled.",
        ("Open My Requests, then History.",
         "Pick the tab for the kind of request you are after.",
         "Open a row to read how it was decided."),
        aliases=("look up a finished request", "see finished requests", "find an old request",
                 "see past requests")),

    # --- Cafeterias ----------------------------------------------------------------------------
    _fn("update_menu", "Update your outlet's menu", ("menu",),
        "Keep your own cafeteria outlet's menu current.",
        ("Open My Menu.",
         "Add an item, or edit or remove an existing one.",
         "Mark an item unavailable rather than deleting it if it is only off today."),
        aliases=("update my menu", "change the menu", "add a menu item", "edit the menu",
                 "remove a menu item")),
    _fn("manage_my_staff", "Manage your outlet's staff", ("cafeteria-my-staff",),
        "See and change who is posted to your own cafeteria outlet.",
        ("Open My Staff.",
         "Review who is currently posted to your outlet.",
         "Raise a staff request for a hire, suspension, restoration or removal."),
        aliases=("manage my staff", "see my outlet's staff", "request a staff change")),
    _fn("manage_cafeterias", "Create or change a cafeteria outlet", ("cafeteria-manage",),
        "Administer the outlets themselves and who runs each one.",
        ("Open Cafeterias, then Manage Cafeterias.",
         "Create an outlet, or open an existing one to edit it.",
         "Assign the manager who runs it, or deactivate an outlet that has closed."),
        aliases=("create a cafeteria", "add an outlet", "manage cafeterias", "edit an outlet",
                 "deactivate an outlet")),
    _fn("assign_cafeteria_staff", "Assign cafeteria staff", ("cafeteria-staff-assignments",),
        "Decide which staff work at which outlet.",
        ("Open Cafeterias, then Staff Assignments.",
         "Find the staff member and set the outlet they are posted to."),
        aliases=("assign cafeteria staff", "move staff between outlets", "staff assignments")),
    _fn("review_menus", "Compare outlet menus", ("cafeteria-menu-oversight",),
        "See every outlet's menu side by side.",
        ("Open Cafeterias, then Menu Oversight.",
         "Pick the outlets you want to compare."),
        aliases=("compare menus", "menu oversight", "see every menu")),
    _fn("review_staff_history", "Look up a staff change", ("cafeteria-staff-requests-history",),
        "Find out when a cafeteria staff change happened and who made it.",
        ("Open Cafeterias, then Staff Action History.",
         "Filter by outlet, person or kind of change."),
        aliases=("look up a staff change", "staff action history", "see past staff changes")),
    _fn("read_reports", "Read a cafeteria report", ("reports",),
        "See how the cafeteria system is running across orders, outlets and staff.",
        ("Open Reports.",
         "Choose the report you want and the period it should cover."),
        aliases=("read a report", "run a report", "see the reports")),

    # --- Administration ------------------------------------------------------------------------
    _fn("manage_users", "Manage a user account", ("admin-users",),
        "Create accounts, change the roles they hold, and deactivate ones no longer in use.",
        ("Open Internal Directory, then Users.",
         "Search for the account, or create a new one.",
         "Set the roles it holds - an account can hold more than one, each scoped to a unit.",
         "Deactivate an account instead of deleting it."),
        aliases=("manage a user", "manage users", "create a user", "add an account",
                 "change someone's role", "give someone a role", "deactivate an account")),
    _fn("manage_units", "Manage a unit", ("admin-units",),
        "Keep the schools, departments and cafeterias a role can be scoped to.",
        ("Open Internal Directory, then Units.",
         "Add a unit, rename one, or deactivate one no longer in use."),
        aliases=("manage a unit", "manage units", "add a unit", "create a department",
                 "add a school")),
    _fn("manage_roles", "Manage a role", ("admin-roles",),
        "Keep the list of roles an account can hold.",
        ("Open Internal Directory, then Roles.",
         "Add a role, or rename an existing one.",
         "What a role can actually reach is decided separately, on Page Visibility."),
        aliases=("manage a role", "manage roles", "add a role", "create a role", "rename a role")),
    _fn("set_page_visibility", "Grant or revoke a page", ("admin-page-visibility",),
        "Decide which roles can reach which pages - which also decides what the assistant will "
        "answer for them.",
        ("Open Internal Directory, then Page Visibility.",
         "Find the page you want to change.",
         "Grant or revoke it for a role, scoping it to a unit if the role is unit-scoped.",
         "The change applies immediately, to the sidebar and to the assistant alike."),
        aliases=("grant a page", "revoke a page", "change page visibility",
                 "give a role access to a page", "hide a page from a role", "page permissions")),
    _fn("read_ai_log", "Review declined questions", ("admin-ai-access-log",),
        "See what the assistant declined to answer, for whom, and why.",
        ("Open Internal Directory, then AI Access Log.",
         "Filter by person, topic or reason.",
         "A permissions refusal points at a Page Visibility grant; an unsupported one points at a "
         "capability the assistant does not have."),
        aliases=("review declined questions", "see the ai access log", "see refused questions")),
    _fn("configure_policies", "Change an approval rule", ("admin-settings-policies",),
        "Adjust how proposals are routed and the policy numbers behind that routing.",
        ("Open System Configuration, then Approval Workflows & Policies.",
         "Edit the routing rule, or the number behind it - the high-pax threshold, the "
         "cancellation deadline, the minimum lead time."),
        aliases=("change an approval rule", "change the approval workflow", "approval policies",
                 "set the high-pax threshold", "change the cancellation deadline")),
    _fn("manage_event_categories", "Maintain event categories", ("admin-settings-categories",),
        "Keep the categories events are filed under, which is also what Explore Events filters by.",
        ("Open System Configuration, then Event Categories.",
         "Add a category, rename one, or deactivate one no longer offered."),
        aliases=("manage event categories", "add an event category", "create an event category",
                 "edit event categories")),
    _fn("manage_event_formats", "Maintain event formats", ("admin-settings-formats",),
        "Keep the formats an applicant can pick from on the proposal form.",
        ("Open System Configuration, then Event Formats.",
         "Add a format, rename one, or deactivate one no longer offered."),
        aliases=("manage event formats", "add an event format", "edit event formats")),
    _fn("manage_dropdown_options", "Maintain a dropdown list", DROPDOWN_PAGES,
        "Keep the option list your department owns, which applicants choose from on the proposal "
        "form.",
        ("Open Dropdown Settings and pick the list your department owns - venues, logistics items, "
         "transport types, photography services, sound and light, dietary information, serving "
         "units, campus tour options, mineral water, or funding items.",
         "Add an option, rename one, or deactivate one no longer offered.",
         "The proposal form picks the change up immediately."),
        aliases=("maintain a dropdown list", "manage dropdown options", "add a dropdown option",
                 "add a venue", "manage venues", "add a logistics item", "add a transport type")),
    _fn("view_dashboard", "Check your dashboard", ("dashboard",),
        "See a summary of the activity you are responsible for.",
        ("Open Dashboard.",
         "The tiles reflect your own role and unit.",
         "Click a tile to open the page behind it."),
        aliases=("check my dashboard", "see my dashboard", "see my overview")),
    _fn("view_inbox", "See what needs your action", ("inbox",),
        "Find everything currently waiting on you to decide.",
        ("Open Inbox.",
         "Each tab is a different kind of item waiting on you.",
         "Open one and take the decision it is waiting for."),
        aliases=("see what needs my action", "check my inbox", "see my inbox",
                 "what is waiting on me")),
    _fn("view_created_by_me", "See the events you created", ("created-by-me",),
        "Look over the published events you proposed or co-own.",
        ("Open Created by Me.",
         "Search or filter to find one of your events.",
         "Open it to see how it is going."),
        aliases=("see the events i created", "see my created events", "my own events as organiser")),
)}


# --- Topics: the only two kinds of DATA question this assistant answers ------------------------

@dataclass(frozen=True)
class Topic:
    """One data topic, and the pages that own it.

    `pages` is the whole authorization rule: the caller may ask if they can stand in ANY of them.
    Every entry must OWN the data - never a shared hub that merely displays a tab of it.

    There are exactly two, and there will not be a third without the scope in this module's
    docstring changing first. `fields` is what the assistant may state about one, and it is the
    card plus the details dialog, nothing more - so a fact the page does not show is a fact the
    assistant does not have.
    """

    key: str
    label: str
    ask_description: str
    pages: tuple[str, ...]
    fields: tuple[str, ...]


TOPICS: dict[str, Topic] = {topic.key: topic for topic in (
    Topic(
        key="events",
        label="events",
        ask_description="Events - finding one, what it is about, and suggestions that fit you",
        # The visitor sections and the two internal pages showing the same catalogue. An account
        # with none of them cannot ask about events at all.
        pages=("public-happening-soon", "public-explore-events", "public-event-calendar",
               "public-event-details", "explore-events", "event-calendar"),
        fields=("title", "categories", "introduction", "date", "start and end time", "venue",
                "organiser", "school or department", "format", "expected attendance",
                "how many people have registered", "cost", "how registration is approved",
                "visibility", "the clubs behind it", "how many sessions it runs over",
                # The card prints "Registered" / "Pending Approval" to the viewer on their own
                # card, so their OWN state is card data. Anyone else's is not, and never becomes so.
                "whether the ASKER is already registered for it"),
    ),
    Topic(
        key="clubs",
        label="clubs",
        ask_description="Clubs - finding one, what it does, and suggestions that fit you",
        # Discover Clubs only. Manage Clubs is administration, and letting it satisfy this topic is
        # what had the assistant recommending clubs to join to the one role that cannot join any.
        pages=("clubs-discover",),
        # The last one is what Discover Clubs itself filters on: the page hides every club the
        # viewer is already a member of, presides over, or has a pending request for. A suggestion
        # that cannot see that flag offers them a club the page would never have shown them.
        fields=("name", "categories", "description", "current President", "member count",
                "whether the ASKER is already a member or the President of it"),
    ),
)}


def topic_pages(topic_key: str) -> tuple[str, ...]:
    topic = TOPICS.get(topic_key)
    return topic.pages if topic else ()


# --- The one reachability check ----------------------------------------------------------------

def can_reach(principal, page_code: str) -> bool:
    """Can this caller actually stand on `page_code`? The one reachability question in the app.

    Mirrors the three route guards exactly, which is why an internal user does NOT pass a VISITOR
    page: publicLandingGuard redirects them off the landing page into their own shell, so telling
    them to scroll to a section they will be bounced away from would be a wrong answer, not a
    generous one. Their equivalent internal page is listed alongside it on every Topic.
    """
    page = PAGES.get(page_code)
    if page is None:
        return False
    tier = tier_of(principal)
    if page.reach == VISITOR:
        return tier in (GUEST, EXTERNAL)
    if page.reach == EXTERNAL_ONLY:
        return tier == EXTERNAL
    # PAGE: Page Visibility, live, with no role names and no admin bypass. `gates` is the page's own
    # code in every ordinary case.
    if tier != INTERNAL:
        return False
    return any(identity.has_page_access(principal.assignments, gate) for gate in page.gates)


def reachable_pages(principal) -> list[Page]:
    """Everywhere this caller can actually go, in definition order."""
    return [page for code, page in PAGES.items() if can_reach(principal, code)]


def can_use(principal, function_key: str) -> bool:
    """May this caller be given the STEPS for `function_key`?

    ANY of the function's pages, AND ALL of its `requires`. An UNKNOWN key is False: a key absent
    from FUNCTIONS is a function nobody has written, and the honest answer is that the assistant
    has no instructions for it - not steps improvised from something adjacent.
    """
    fn = FUNCTIONS.get(function_key)
    if fn is None:
        return False
    if not all(can_reach(principal, page) for page in fn.requires):
        return False
    return any(can_reach(principal, page) for page in fn.pages)


def usable_functions(principal) -> list[Function]:
    """Every function this caller can actually perform, in definition order."""
    return [fn for key, fn in FUNCTIONS.items() if can_use(principal, key)]


def can_reach_topic(principal, topic_key: str) -> bool:
    """May this caller ask about `topic_key` at all? Any one of its owning pages is enough."""
    return any(can_reach(principal, page) for page in topic_pages(topic_key))


# --- Resolving a NAME out of a question --------------------------------------------------------
#
# Both resolvers are dictionary lookups against the real tables above, deliberately NOT model calls
# and deliberately NOT guesses. An unrecognised name returns None, and the caller then says it has
# no page/function by that name rather than composing a plausible one - which is exactly the
# failure this replaces.

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
# Articles are dropped from BOTH sides, so a name matches the way a reader would judge it to match
# rather than word for word. People type "how to save event", not "how to save an event", and an
# exact-phrase table missed that entirely - the same class of miss that made a resolvable how-to
# fall through to being improvised from the platform overview. Applied to the names too, so the
# two sides always agree.
_ARTICLES = frozenset({"a", "an", "the"})


def _normalise(text: str) -> str:
    words = _NON_ALNUM.sub(" ", text.lower()).split()
    return " ".join(word for word in words if word not in _ARTICLES)


def _longest_first(pairs) -> tuple[tuple[str, str], ...]:
    """Names sorted longest-first, so a specific one always wins over a general one: 'Explore
    Events' over 'Events', 'manage club categories' over 'manage clubs'. A general name placed
    above a specific one silently swallows it, which is the single failure mode a name table has."""
    return tuple(sorted(pairs, key=lambda pair: -len(pair[0])))


_PAGE_NAMES: tuple[tuple[str, str], ...] = _longest_first(
    (_normalise(name), code)
    for code, page in PAGES.items()
    for name in (page.name, *page.aliases)
    if len(_normalise(name)) >= 4
)

_FUNCTION_NAMES: tuple[tuple[str, str], ...] = _longest_first(
    (_normalise(name), key)
    for key, fn in FUNCTIONS.items()
    for name in (fn.name, *fn.aliases)
    if len(_normalise(name)) >= 4
)


def _match(question: str, table: tuple[tuple[str, str], ...]) -> str | None:
    haystack = f" {_normalise(question)} "
    for name, code in table:
        if f" {name} " in haystack:
            return code
    return None


def pages_named(question: str, limit: int = 2) -> list[str]:
    """Every Page a question names, longest name first, up to `limit`.

    MORE THAN ONE, because "what is the difference between Discover Clubs and My Clubs" is an
    ordinary question and answering it from one definition answers half of it. A single match is
    still the common case; this just stops the second page being silently dropped.

    A matched name is CONSUMED from the haystack before the next pass, which is what stops 'Explore
    Events' also matching 'Events' and reporting the folder as a second page the asker asked about.
    """
    haystack = f" {_normalise(question)} "
    found: list[str] = []
    for name, code in _PAGE_NAMES:
        token = f" {name} "
        if token not in haystack or code in found:
            continue
        found.append(code)
        haystack = haystack.replace(token, "  ")
        if len(found) >= limit:
            break
    return found


def page_named(question: str) -> str | None:
    """The Page a "what is X for" question names, or None.

    Three names exist twice on purpose (Explore Events, Event Calendar and My Events each have a
    visitor and an internal form). Ties resolve to the first definition, and every caller pairs this
    with the asker's own tier through _twin_page(), so the answer describes the copy they can
    actually open."""
    found = pages_named(question, limit=1)
    return found[0] if found else None


def function_named(question: str) -> str | None:
    """Which Function a "how do I X" question is about, or None."""
    return _match(question, _FUNCTION_NAMES)


def _twin_page(principal, page: Page) -> Page | None:
    """The copy of a shared-name Page that THIS caller actually has, if it is not the one matched.

    'Explore Events', 'Event Calendar' and 'My Events' each exist twice - once on the public landing
    page, once inside the internal shell - because the two tiers genuinely have separate pages of
    the same name. page_named() cannot know which was meant; the caller's tier can.
    """
    if can_reach(principal, page.code):
        return None
    name = _normalise(page.name)
    for code, candidate in PAGES.items():
        if code != page.code and _normalise(candidate.name) == name and can_reach(principal, code):
            return candidate
    return None


# --- The documents handed to the model ---------------------------------------------------------

def _bullets(items: tuple[str, ...]) -> str:
    return "\n".join(f"  - {item}" for item in items)


def _numbered(items: tuple[str, ...]) -> str:
    return "\n".join(f"  {n}. {step}" for n, step in enumerate(items, start=1))


def page_definition_document(principal, page_code: str) -> str:
    """The CONTEXT for "what is <page> for" / "what can I do on <page>" - the page's own five-field
    definition, so the model STATES it rather than reconstructing one from whatever data is lying
    around. That reconstruction is what produced a confident description of a "personal calendar"
    this app has never had."""
    page = PAGES[page_code]
    page = _twin_page(principal, page) or page
    if not can_reach(principal, page.code):
        return _unreachable_page_document(principal, page)
    functions = tuple(fn.name for fn in page.functions if can_use(principal, fn.key))
    lines = [
        f"PAGE DEFINITION for '{page.name}', stated by the app itself. Answer from this and add "
        "nothing to it - if a capability, screen or button is not named here, this app does not "
        "have it.",
        f"Page Name: {page.name}",
        f"Purpose: {page.purpose}",
        "What Users Can Do:",
        _bullets(page.actions) or "  - (nothing beyond opening it)",
    ]
    if functions:
        lines += ["Related Functions this asker can perform here:", _bullets(functions)]
    if page.route:
        lines.append(f"Where it is: {page.route}")
    lines.append(
        "The asker CAN open this page. Say what it is for in one or two sentences, in your own "
        "words, and mention one or two of the things they can do there if it helps. Do not list "
        "every bullet back at them, and do not add anything absent from the definition."
    )
    return "\n".join(lines)


def _unreachable_page_document(principal, page: Page) -> str:
    """"What is X for" asked about a real page this caller cannot open.

    Still answers WHAT IT IS - a page's purpose is not somebody's data, and refusing to describe the
    app to the person using it is what made an external account's every question a dead end. What it
    withholds is the CONTENTS, and it says plainly that the page is not theirs.
    """
    # Only the INTERNAL branch names an administrator. The other two do not mention one even to
    # forbid it: naming a thing in order to prohibit it is how it ends up in the reply anyway, so
    # the branches where an administrator is the wrong answer simply say what IS true.
    tier = tier_of(principal)
    if tier == GUEST:
        reason = ("The asker is not signed in, and this part of the app is for signed-in accounts. "
                  "Say that plainly and point them at signing in. They hold no account, so there "
                  "is nothing to be fixed and nobody for them to ask.")
    elif tier == EXTERNAL:
        reason = ("The asker holds a visitor account, and this part of the app is for university "
                  "staff and students only. Say that plainly, as a fact about what their account "
                  "is for rather than as a missing permission. Their account is working correctly "
                  "and there is nobody for them to ask to change it.")
    else:
        reason = ("The asker's role has not been granted this page in Page Visibility. Say plainly "
                  "that they cannot open it, and that an administrator would have to grant it.")
    return "\n".join([
        f"PAGE DEFINITION for '{page.name}', stated by the app itself - use this and add nothing:",
        f"Purpose: {page.purpose}",
        f"THE ASKER CANNOT OPEN IT. {reason}",
        "Describe what the page is FOR in one sentence so they know what it is, then say they "
        "cannot reach it. Do NOT describe what is currently on it, list anything from it, or offer "
        "to fetch anything from it.",
    ])


def unknown_page_document(question: str) -> str:
    """A "what is X for" naming something this app has no page for.

    The app's page list is finite and written down above; a name absent from it is either a page
    that does not exist or one nobody has defined, and both deserve "I don't have a page by that
    name" rather than a confident paragraph."""
    return (
        "The asker is asking what some page or section of this app is for, but the name they used "
        "matches no page this app has. Say plainly that you don't have a page by that name, and do "
        "NOT describe, guess at, or invent what it might do. Offer to tell them about the parts of "
        "the app they CAN reach instead."
    )


def function_definition_document(principal, function_key: str) -> str:
    """The CONTEXT for "how do I X" - the function's own five-field definition.

    The page comes FIRST in the answer on purpose: "where does this happen" is half of what a
    how-to question is actually asking, and steps with no location send someone hunting."""
    fn = FUNCTIONS[function_key]
    page = PAGES[fn.page]
    twin = _twin_page(principal, page)
    if twin is not None:
        page = twin
    return "\n".join([
        f"FUNCTION DEFINITION for '{fn.name}', stated by the app itself. Give these steps and "
        "nothing else - do not invent a step, name a button that is not here, or describe a screen "
        "you were not given.",
        f"Function Name: {fn.name}",
        f"Page: {page.name}" + (f" ({page.route})" if page.route else ""),
        f"Purpose: {fn.purpose}",
        "User Steps:",
        _numbered(fn.steps),
        "The asker CAN do this. Name the page first, then walk them through the steps in order, "
        "briefly and in your own words. Keep every step - a shortened procedure that skips one is "
        "a wrong answer.",
    ])


def function_denied_document(principal, function_key: str) -> str:
    """The refusal for a how-to whose ACTION this caller cannot perform.

    Deliberately distinct from a topic refusal: the caller asked how to DO something, and the honest
    reason is that the action is not theirs to take - not that some data is hidden.
    """
    fn = FUNCTIONS.get(function_key)
    label = fn.name.lower() if fn else function_key.replace("_", " ")
    tier = tier_of(principal)
    if tier == GUEST:
        why = ("That needs an account - point them at signing in or creating one. There is nobody "
               "for them to ask about it, since they hold no account.")
    elif tier == EXTERNAL:
        why = ("A visitor account cannot do that; it is for university staff and students. Say so "
               "as a fact about the account, not as a missing permission - their account is "
               "working correctly and there is nobody for them to ask to change it.")
    else:
        why = ("Their role has not been granted the page that action happens on, so an "
               "administrator would have to grant it.")
    return (
        f"This asker cannot do this: {label}. {why} Tell them plainly that this is not something "
        "they can do, and do NOT give the steps, describe the screen, or suggest a workaround."
    )


def unknown_function_document(principal) -> str:
    """A "how do I..." this assistant has no function definition for.

    A missing definition is a missing definition: say so, and offer the ones that do exist for this
    caller. Improvising is what once handed an account with no access at all a working procedure.
    """
    available = sorted({fn.name for fn in usable_functions(principal)})
    offer = (
        "The things you CAN give step-by-step instructions for, for this asker: "
        + "; ".join(available)
        + ". Offer one or two of these if any is close to what they asked."
    ) if available else "There is nothing this asker can be given step-by-step instructions for."
    return (
        "The asker wants step-by-step instructions for something this assistant has no written "
        "definition for. Say plainly that you don't have instructions for that. Do NOT improvise "
        "steps, name buttons, describe screens, or infer a procedure from how similar apps work - "
        "a made-up procedure sends someone looking for a control that does not exist. " + offer
    )
