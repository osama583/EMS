"""Section 4.5 content, groups A to D.

Each figure is (folder, heading title, caption, [paragraphs]). The folder name is
the one on disk under `ui png/Implementation/<group>/`, so the manifest cannot
drift from the captures.
"""

GROUP_A = dict(
    number="4.5.1",
    title="Public Access and Authentication",
    folder="A - Public and Authentication",
    intro=[
        "The public tier is the part of the system that requires no credential at "
        "all. It exists because the majority of people who need to know what is "
        "happening on campus have no reason to hold an account, and Chapter 2 "
        "found that requiring one is a common reason institutional event systems "
        "go unused. The screens in this group are therefore served to anyone who "
        "reaches the address, and the same endpoints that serve them return only "
        "the public projection of an event: enough to decide whether to attend, "
        "and nothing about the approval history that produced it.",
        "Authentication is presented in the same group because the public tier "
        "leads into it. A visitor who decides to attend an event is offered guest "
        "registration rather than being turned away, which is the mechanism that "
        "lets an external attendee hold a place without an institutional account.",
    ],
    figures=[
        ("4.5.01 Landing Page - Hero",
         "Landing Page — Hero",
         "Public landing page above the fold, viewed with no session",
         ["The landing page opens on a full-width hero over the institutional "
          "navy header. The header carries the university mark and the public "
          "navigation — Home, Life at APU, Happening Soon, Explore Events, Event "
          "Calendar and Saved Events — with a Login control and a prominent "
          "Request an Event call to action. The two controls are deliberately "
          "distinct: Login is the route for people who already hold standing in "
          "the system, while Request an Event is the entry point to the proposal "
          "process described in Section 4.5.4, and pressing it while signed out "
          "sends the visitor through authentication first rather than failing at "
          "submission. The mobile rendering on the right collapses the same "
          "navigation into a drawer and keeps both controls reachable without "
          "scrolling, which is the pattern applied throughout the public tier."],
         ),
        ("4.5.02 Landing Page - Happening Soon Carousel",
         "Landing Page — Happening Soon Carousel",
         "Near-term events presented as a horizontally scrollable carousel",
         ["Beneath the hero the page presents the events occurring soonest as a "
          "horizontally draggable strip of cards with previous and next controls. "
          "The carousel is a deliberate choice over a second grid. A visitor "
          "arriving at the landing page has not yet expressed an interest to "
          "filter on, so the most useful thing the page can offer is proximity in "
          "time; the grid further down the page then serves the visitor who knows "
          "what they are looking for. Each card carries the event category, date, "
          "time and venue, so the strip can be scanned without opening anything. "
          "On the mobile viewport the same strip becomes touch-scrollable and the "
          "arrow controls are withdrawn, because a swipe is the native gesture "
          "there and duplicated controls would only consume width."],
         ),
        ("4.5.03 Landing Page - Explore Events",
         "Landing Page — Explore Events",
         "Public event discovery grid with search and live result count",
         ["The discovery section, headed “Discover Your Campus”, is the "
          "main public listing. It provides a search field, a live count of "
          "matching events, and a grid of event cards each showing category, "
          "date, time, venue, a save control and an Explore Event button. The "
          "count updates as the query narrows, so a visitor can tell that a "
          "search has taken effect even when the result set is still larger than "
          "the visible grid. This screen is the public counterpart of the "
          "internal discovery page in Section 4.5.3; the two are the same "
          "component, and the filter bar is rendered only for the internal "
          "variant because the public projection of an event carries none of the "
          "fields those filters operate on."],
         ),
        ("4.5.04 Landing Page - Campus Life",
         "Landing Page — Campus Life",
         "Campus life section of the public landing page",
         ["The Campus Life section is editorial rather than transactional. It "
          "exists because a visitor arriving with no prior knowledge of the "
          "institution needs some context for the events listed above it, and "
          "because the landing page is the only surface in the system that is "
          "read by people who will never sign in. The section carries no data "
          "from the request workflow and issues no queries against it, which is "
          "why it renders identically for every visitor."],
         ),
        ("4.5.05 Landing Page - Public Event Calendar",
         "Landing Page — Public Event Calendar",
         "Month calendar of published events on the public page",
         ["The public calendar presents the same published events as the "
          "discovery grid, arranged by date rather than by relevance. Offering "
          "both is not duplication: a visitor asking “what is on next "
          "Tuesday” and a visitor asking “what workshops are "
          "there” need different arrangements of the same records, and "
          "forcing either to use the other's view is the kind of friction "
          "Chapter 3 identified in the existing arrangements. The calendar is "
          "restricted to events whose visibility is public and whose proposal has "
          "completed approval, so nothing in flight is ever exposed here. On "
          "mobile the month grid becomes a vertically stacked day list, because a "
          "seven-column grid at 390 pixels renders cells too small to read."],
         ),
        ("4.5.06 Event Details Modal",
         "Event Details Modal",
         "Event details overlay opened from a public event card",
         ["Selecting Explore Event opens the details overlay shown here for the "
          "Data Visualisation Workshop. The overlay carries the event banner, the "
          "category, the current registration count, the visibility setting and "
          "the event introduction, closing with Cancel and Register. It is "
          "presented as an overlay rather than a separate route so that "
          "dismissing it returns the visitor to their position in the grid with "
          "the scroll offset and any active search intact. The Register control "
          "is the junction between the public and authenticated tiers: a visitor "
          "with no session is offered guest registration at this point, which is "
          "the path documented in the next three figures."],
         ),
        ("4.5.07 Login Page",
         "Login Page",
         "Sign-in screen with credential entry and guest registration route",
         ["The sign-in screen is a split layout: an animated headline on the "
          "institutional blue panel, and the credential form beside it with "
          "email, a password field with a reveal toggle, a Forgot password link, "
          "the Sign In control and a separate route to register as a guest. "
          "Offering guest registration from the sign-in screen rather than only "
          "from the registration flow matters because an external attendee who "
          "follows an event link will arrive here first and would otherwise have "
          "no way forward. Every figure in this chapter was captured with the "
          "credential fields empty, so no screenshot in Section 4.5 discloses a "
          "working credential."],
         ),
        ("4.5.08 Forgot Password Modal",
         "Forgot Password Modal",
         "Password reset request overlay opened from the sign-in form",
         ["The reset request overlay collects only the account email. The server "
          "responds identically whether or not that address corresponds to an "
          "account, so the screen cannot be used to enumerate registered users; "
          "the same reasoning is applied to the sign-in endpoint, which verifies "
          "a password even when no such user exists so that a bad email and a bad "
          "password cannot be distinguished by response time. Where an account "
          "does exist, the message that follows carries a hashed, expiring token "
          "rather than a password, and the recipient lands on the screen shown in "
          "the final figure of this group."],
         ),
        ("4.5.09 Guest Registration - Account Details",
         "Guest Registration — Account Details",
         "Guest account creation form in its initial state",
         ["Guest registration collects an email address, first and last name with "
          "live character counters, age, gender and a password. The set of fields "
          "is deliberately short. An external attendee is being asked to create "
          "an account solely so that a place on an event can be held in their "
          "name, and every field beyond that is an opportunity to abandon the "
          "flow. The account this produces is issued the external guest role, "
          "which is unit-independent and grants only the attendee pages described "
          "in Section 4.5.2 — it confers no access to the proposal workflow, "
          "which is enforced on the server rather than by hiding controls."],
         ),
        ("4.5.10 Guest Registration - Completed Form",
         "Guest Registration — Completed Form",
         "The same form with all fields satisfied and submission enabled",
         ["The completed state is shown alongside the empty one because it "
          "demonstrates the validation behaviour rather than merely the layout. "
          "The Continue control is disabled until every constraint is satisfied, "
          "and the counters beneath the name fields report the remaining "
          "allowance as it is consumed rather than reporting a violation after "
          "the fact. Client-side validation of this kind is a convenience and not "
          "a control; the same constraints are re-checked on the server, because "
          "the client is not the authority for any rule in this system."],
         ),
        ("4.5.11 Reset Password Page",
         "Reset Password Page",
         "Landing screen for a password reset link",
         ["A recipient who follows a reset link arrives here to choose a new "
          "password. The token in the link is matched against a stored hash and "
          "checked for expiry before the form is honoured, and it is consumed on "
          "use so that a link cannot be replayed. This is the only route by which "
          "a password can be changed without presenting the current one, which is "
          "why it is treated as an authentication surface rather than a profile "
          "setting."],
         ),
    ],
)

GROUP_B = dict(
    number="4.5.2",
    title="Attendee Screens for Students and External Users",
    folder="B - External and Student User",
    intro=[
        "Attendance is the one capability the system offers to every account "
        "type, and it is served by two different shells. An internal member of "
        "the university sees it inside the application shell described in Section "
        "4.5.3, alongside whatever else their role grants them; an external guest "
        "sees a standalone layout with no sidebar, because there is nothing else "
        "their account can reach. Both are shown here rather than only one, since "
        "the difference between them is a design decision rather than an "
        "accident of styling.",
    ],
    figures=[
        ("4.5.12 My Events",
         "My Events — Internal Shell",
         "Saved events for a signed-in student, inside the internal shell",
         ["My Events collects everything the signed-in user has an attendance "
          "relationship with. The figure shows the Saved tab; the same page also "
          "carries Registered, holding confirmed places on events still to come, "
          "and Conducted, holding events for which a confirmed place was held and "
          "which have since finished. All three tabs render the same card list "
          "and the server decides which registrations belong to each, so the "
          "distinction between them is a property of the data rather than three "
          "separate implementations. Above the list sits an email reminders "
          "control, which is where a user chooses whether this list generates "
          "notifications, and a filter and search bar with a live result count.",
          "Saving an event is separated from registering for one because they "
          "answer different questions. A save records interest and commits the "
          "user to nothing; a registration occupies a place and, where the "
          "organiser has set manual approval, enters a queue for a decision. "
          "Keeping them apart means a user can track an event they are still "
          "deciding about without distorting the attendance figures the organiser "
          "and the dashboards in Section 4.5.9 depend on."],
         ),
        ("4.5.13 My Events - External User",
         "My Events — External User",
         "The external attendee layout, which carries no application sidebar",
         ["An external guest sees the same records in a different shell. There is "
          "no sidebar, because page grants give this account nothing else to "
          "navigate to, and a persistent empty menu would only advertise "
          "capabilities the account does not have. The external layout carries "
          "four tabs of its own: Saved, Pending for sign-ups still awaiting an "
          "organiser's decision, Registered for confirmed places, and History for "
          "sign-ups that were declined together with events already attended. The "
          "Pending tab exists here and not in the internal shell because manual "
          "approval is most often applied to events open to visitors, so an "
          "external attendee is the account most likely to be waiting on a "
          "decision."],
         ),
        ("4.5.16 User Profile",
         "User Profile",
         "Account profile for an internal user",
         ["The profile screen carries the account's own details and the settings "
          "that belong to the person rather than to a role, including the email "
          "reminder preferences that govern which notifications the system sends "
          "them. Role assignments are shown but are not editable here: a role is "
          "held by a user within an organisational unit, and granting one is an "
          "administrative act performed on the screens in Section 4.5.11. Keeping "
          "the two apart is what prevents a user from adjusting their own "
          "standing, and it is the reason the profile page issues no writes "
          "against the assignment tables at all."],
         ),
    ],
)

GROUP_C = dict(
    number="4.5.3",
    title="Internal Application Shell and Onboarding",
    folder="C - Internal Shell and Onboarding",
    intro=[
        "Every internal page in the system is rendered inside one shell. The "
        "shell supplies the sidebar, the top bar with its breadcrumb trail and "
        "the persistent assistant launcher, and the pages themselves supply only "
        "their own workspace. This is what makes the access model visible: the "
        "sidebar is built from page grants issued by the server, so two accounts "
        "looking at the same shell see different menus without any page having "
        "been written twice.",
    ],
    figures=[
        ("4.5.17 Internal Layout and Sidebar Navigation",
         "Internal Layout and Sidebar Navigation",
         "The internal shell with the sidebar pinned open, as a Head of Department",
         ["This figure is the anchor for the rest of Section 4.5, and every "
          "subsequent screen is rendered inside the frame it establishes. The "
          "sidebar is pinned open so that the labels are legible: the brand and "
          "the pin control at the top, the pages this account may reach in the "
          "middle, and Profile and Logout fixed to the bottom where they do not "
          "move as the menu above them changes length. The account shown is a "
          "Head of Department, and the menu it produces is not written anywhere "
          "in the client. It is assembled from the grants returned with the "
          "session, which is why the Page Visibility screen in Section 4.5.11 can "
          "add or remove an entry without a deployment.",
          "The mobile rendering places the same navigation behind a drawer and "
          "keeps the breadcrumb trail in the compact top bar. The trail carries "
          "more weight here than it would in a smaller application: because the "
          "menu differs per role, no two users share a mental map of where a page "
          "sits, and the trail is the only element that states the current "
          "position in terms that are the same for everybody."],
         ),
        ("4.5.18 How It Works - Onboarding Guide",
         "How It Works — Onboarding Guide",
         "Guided explanation of the proposal journey shown to applicants",
         ["How It Works is the first page a student or lecturer lands on. It "
          "exists because Chapter 3 found that the most consistent complaint "
          "about the current arrangements was not that they were slow but that "
          "nobody could say what happened next, and a system that routes a "
          "proposal through several departments invisibly would reproduce exactly "
          "that. The page sets out the stages a proposal passes through, who acts "
          "at each one and what is expected of the applicant in between, before "
          "any form is opened. It is a static page holding no request data, which "
          "is why it is granted to every internal role rather than scoped."],
         ),
        ("4.5.19 Master Event Calendar",
         "Master Event Calendar",
         "University-wide internal calendar of scheduled events",
         ["The internal calendar differs from the public one in what it is "
          "permitted to show. It carries every scheduled event the viewer's scope "
          "reaches, including those whose visibility restricts them to a club or "
          "a school and which therefore never appear publicly. At the point of "
          "capture the view reports forty-four events in range of which seven are "
          "private, and that division is the point of the screen: a Head of "
          "School planning around existing commitments has to see the private "
          "ones, and a public visitor must not. The distinction is applied in the "
          "query rather than in the rendering, so a record outside the viewer's "
          "scope is never retrieved."],
         ),
        ("4.5.20 Internal Explore Events",
         "Internal Explore Events",
         "Internal event discovery with the filter bar and pagination",
         ["The internal discovery page is the same component as the public grid "
          "in Section 4.5.1, rendered in its internal variant. The difference is "
          "the filter bar, which appears only here. A signed-in member of the "
          "university can filter by the fields that describe how an event was "
          "produced — its category, format and organising unit — and those fields "
          "are present on the internal projection of an event and absent from the "
          "public one. Rendering one component in two variants rather than "
          "maintaining two pages is what keeps the two listings consistent as the "
          "event card evolves."],
         ),
    ],
)

GROUP_D = dict(
    number="4.5.4",
    title="Event Proposal Submission",
    folder="D - Proposal Creation",
    intro=[
        "The proposal form is the entry point to the entire workflow and the "
        "single most complex screen in the system. It is presented as six ordered "
        "steps rather than one long form, with a step indicator across the top and "
        "a sticky footer carrying Previous, the current position, Next and Save "
        "as Draft. The division is not cosmetic. Each step is validated as it is "
        "left, so an applicant learns that a field is wrong while the section it "
        "belongs to is still on screen, and the draft can be saved at any point "
        "and resumed from the screen described in Section 4.5.5.",
        "The order of the steps is itself a design decision. The requirements a "
        "proposal asks for are chosen at step three, before their details are "
        "given at step four, because it is the selection at step three that "
        "determines which departments the proposal will later be routed to. "
        "Deferring that choice to the end would mean the applicant supplies "
        "detail for services they may not need and the routing cannot be shown "
        "to them until the form is complete.",
    ],
    figures=[
        ("4.5.21 Proposal Form - Step 1 Applicant Info",
         "Proposal Form — Step 1: Applicant Information",
         "First step of the proposal form, with applicant details pre-filled",
         ["The first step presents the applicant's own details — name, school or "
          "department and email — pre-filled from the signed-in profile and not "
          "re-typed, followed by the co-requesters section in which other members "
          "of the university may be named as co-owners of the proposal. "
          "Pre-filling matters beyond convenience: the organising unit recorded "
          "here is what the routing rules read to decide which Head of School or "
          "Head of Department the proposal must first reach, so allowing it to be "
          "typed freely would let an applicant choose their own reviewer."],
         ),
        ("4.5.22 Proposal Form - Step 2 General Event Info",
         "Proposal Form — Step 2: General Event Information",
         "Event identity, visibility, format and registration mode",
         ["The second step establishes what the event is: its title, a short "
          "introduction, the goals and expected benefits, and then four settings "
          "that govern how it will behave once approved — its visibility, its "
          "format, whether registrations are approved automatically or by hand, "
          "and how it will be publicised. Collecting these here rather than at "
          "publication time is deliberate. They describe the applicant's "
          "intention, and a reviewer deciding whether to approve a proposal for "
          "six hundred external attendees needs to see that intention at the "
          "point of decision rather than discover it afterwards."],
         ),
        ("4.5.23 Proposal Form - Step 3 Required for Event",
         "Proposal Form — Step 3: Requirements Selection",
         "The requirement picker that determines departmental routing",
         ["Step three is where the applicant states which services the event "
          "needs: logistics, transport, photography, sound and light, food and "
          "beverage, a campus tour, mineral water or funding. This is the most "
          "consequential screen in the form. The selection made here is what "
          "later fans the approved proposal out into one task per responsible "
          "department, so an unticked requirement is not merely an omitted detail "
          "but a department that will never be asked. The screen therefore states "
          "each option in the language of what the applicant needs rather than in "
          "the language of which unit provides it."],
         ),
        ("4.5.24 Proposal Form - Step 4 Request Details",
         "Proposal Form — Step 4: Requirement Details",
         "Detail tables for each requirement selected at the previous step",
         ["The fourth step presents one detail table per requirement chosen at "
          "step three, collecting items, quantities, dates, times, locations and "
          "notes. The tables are generated from the selection rather than from a "
          "fixed template, so an applicant who asked for nothing from Transport "
          "is never shown a transport table to leave empty. The options offered "
          "inside each table are read from the catalogues in Section 4.5.11, "
          "which are owned by the departments themselves; a logistics item can "
          "therefore be withdrawn by the Head of Logistics and cease to be "
          "offered here without any change to this form."],
         ),
        ("4.5.25 Proposal Form - Step 5 Detailed Event Info",
         "Proposal Form — Step 5: Detailed Event Information",
         "Schedule, agenda, organisers and guests",
         ["The fifth step covers the material a reviewer needs in order to judge "
          "the proposal rather than to fulfil it: the schedule, a brief agenda, "
          "the organising team, the important people expected, the general guests "
          "and the topics to be discussed. It is placed after the requirements "
          "because it is the longest step and the least likely to change the "
          "routing; an applicant who abandons the form here has still recorded "
          "everything the earlier steps need in order to be resumed."],
         ),
        ("4.5.26 Proposal Form - Step 6 Final Review",
         "Proposal Form — Step 6: Final Review",
         "Read-back of the complete proposal before submission",
         ["The final step reads the whole proposal back before it is submitted. "
          "Every section is shown as it will be seen by the reviewer, with a "
          "route back to the step that produced it. The read-back exists because "
          "submission is the point at which the proposal leaves the applicant's "
          "control: once submitted it enters the approval chain and can be "
          "changed only by being sent back, so the last opportunity to correct it "
          "cheaply is here."],
         ),
        ("4.5.27 Proposal Form - Validation Errors",
         "Proposal Form — Validation Errors",
         "The form after a submission attempt with required fields unsatisfied",
         ["This figure shows the form refusing an incomplete submission. The "
          "invalid fields are marked in place with the reason stated beneath "
          "them, and the step indicator identifies which step holds the problem "
          "so that the applicant is not left to search six steps for it. The "
          "behaviour illustrated here is the client half of a rule that is "
          "enforced twice: the same constraints are applied again on the server "
          "when the submission arrives, because a client that has been modified, "
          "or a request issued directly against the API, must not be able to "
          "introduce a proposal the workflow cannot route."],
         ),
    ],
)
