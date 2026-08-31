"""Section 4.5 content, groups I to L."""

GROUP_I = dict(
    number="4.5.9",
    title="Role Dashboards",
    folder="I - Dashboards",
    intro=[
        "Every dashboard in the system is one component. It does not know what a "
        "Head of Department is, or a CFO; it walks a profile document supplied by "
        "the server that names which measures to compute and how to present them, "
        "and it renders whatever that document describes. Adding a dashboard for a "
        "new role is therefore a server-side entry rather than a new route, a new "
        "template and a new set of queries.",
        "Three of the six are presented here. The four departmental dashboards are "
        "the same screen reading different units' numbers, so one stands for all "
        "of them; the CFO and cafeteria manager variants measure genuinely "
        "different things and are shown in their own right.",
    ],
    figures=[
        ("4.5.56 Dashboard - HOD Logistics",
         "Dashboard — Head of Department",
         "Departmental workload dashboard, shown for Logistics",
         ["The departmental dashboard answers the question a department head asks "
          "at the start of a day: what is outstanding, what is late, and who is "
          "carrying it. A period selector governs the whole page, followed by "
          "counters for the inbox, work in flight, completed work and late work, "
          "a panel naming the jobs currently at risk, an on-time completion rate, "
          "a push-back rate, a bar chart of load per staff member and a "
          "distribution over the department's own catalogue.",
          "This same screen serves the Heads of Logistics, Food and Beverage, "
          "Audio Visual and Transport. Only the unit name and the figures change, "
          "because the measures are computed against the unit named on the "
          "viewer's role assignment rather than selected by them. The load chart "
          "is the one panel that most repays the design: it is built from the "
          "assignments made in the confirmation dialogue of Section 4.5.6, so an "
          "uneven distribution is traceable to specific decisions rather than "
          "being an unattributable aggregate."],
         ),
        ("4.5.60 Dashboard - CFO Finance",
         "Dashboard — Chief Financial Officer",
         "Institutional finance dashboard covering commitment, coverage and collection",
         ["The finance dashboard measures money rather than workload, and its "
          "panels have no counterpart on the departmental view. Alongside the "
          "queue counters it reports total committed spend split between budget "
          "and catering, catering cost as a share of the total, cost per "
          "attendee, total attendees served, a breakdown by funding item and the "
          "time proposals spend waiting at each approval gate.",
          "The dwell-time panel is included because it measures the workflow "
          "itself rather than its output. Chapter 1 identified delay with no "
          "identifiable cause as a principal complaint about the existing "
          "arrangements, and a figure showing how long proposals wait at each "
          "gate turns that complaint into something that can be acted on."],
         ),
        ("4.5.61 Dashboard - Cafeteria Manager",
         "Dashboard — Cafeteria Manager",
         "Outlet-level order and fulfilment metrics",
         ["The cafeteria manager's dashboard is scoped to a single outlet and "
          "measures order flow: what has been ordered, what has been claimed from "
          "the shared pool, what has been prepared and what has been delivered. "
          "It is the third distinct profile served by the same component, and it "
          "is the clearest demonstration that the profile mechanism is doing real "
          "work — an outlet has no concept of an approval gate and a department "
          "has no concept of a serving time, yet neither needs its own dashboard "
          "implementation."],
         ),
    ],
)

GROUP_J = dict(
    number="4.5.10",
    title="Event Registrations",
    folder="J - Events and Registrations",
    intro=[
        "An approved proposal becomes a published event, and a published event "
        "collects registrations. Where the organiser chose automatic approval at "
        "step two of the proposal form, a registration is confirmed as it is "
        "made; where they chose manual approval, it waits for them here.",
    ],
    figures=[
        ("4.5.62 Event Registrations Hub",
         "Event Registrations Hub",
         "The organiser's queue of registrations awaiting a decision",
         ["This is the Events tab of the Inbox shell, holding registrations that "
          "need the organiser's decision, with search, an event filter and "
          "pagination. It is captured as a student who organises events, which "
          "matters: the queue is scoped to events the viewer created, so an "
          "account that has organised nothing correctly sees nothing here. "
          "Approving a registration confirms the attendee's place and moves the "
          "record into their Registered tab in Section 4.5.2; declining it moves "
          "the record to their History with the outcome recorded rather than "
          "removing it."],
         ),
    ],
)

GROUP_K = dict(
    number="4.5.11",
    title="System Administration and Option Catalogues",
    folder="K - System Administration",
    intro=[
        "Administration in this system is the work of keeping the configuration "
        "correct rather than of operating the workflow. It divides into two "
        "kinds. The first is central and belongs to the System Admin: the "
        "accounts, the organisational units, the roles and the page grants that "
        "decide what anybody can reach. The second is devolved: each option "
        "catalogue a proposal chooses from is owned by the department answerable "
        "for the service it describes, so the Head of Logistics maintains the "
        "logistics items and the CFO maintains the venues.",
        "A single rule runs through all of these screens and is worth stating "
        "once rather than at each of them. Nothing that something else depends on "
        "can be deleted. Before any deletion is offered the server is asked "
        "whether the record has dependants and answers with the specific reasons "
        "it does; a record that fails the check is deactivated instead, which "
        "withdraws it from future use while leaving the history that refers to it "
        "intact. Where a deletion is allowed it is a soft deletion: the record is "
        "archived, remains restorable, and is purged only after a retention "
        "period has elapsed. No screen in the system offers an immediate "
        "permanent deletion.",
    ],
    figures=[
        ("4.5.65 Users Directory",
         "Users Directory",
         "The internal account directory with search, filtering and role assignment",
         ["The user directory is where accounts are found and their standing is "
          "changed. A role is granted to a user within a unit rather than "
          "globally, so an assignment made here names all three, and a supporting "
          "table records which roles may legally be paired with which kinds of "
          "unit so that a nonsensical assignment cannot be created. Deactivating "
          "an account is checked before it is permitted: an account holding the "
          "last remaining leadership post of a unit cannot be deactivated, "
          "because doing so would leave that unit's queue with nobody able to act "
          "on it."],
         ),
        ("4.5.66 Units Directory",
         "Units Directory",
         "Schools, departments and cafeteria outlets",
         ["Units are the organisational structure roles are scoped to: schools, "
          "departments and cafeteria outlets. Because the routing rules read the "
          "applicant's unit to decide which reviewer a proposal must first reach, "
          "and because every departmental queue is filtered by unit, this "
          "directory is the backbone of the access model rather than a reference "
          "list. Units are therefore withdrawn from use rather than removed once "
          "any record refers to them."],
         ),
        ("4.5.67 Roles Management",
         "Roles Management",
         "Role definitions, including those protected from removal",
         ["Roles are defined here rather than being hard-coded. A small number "
          "are marked as protected and cannot be deleted at all, because the "
          "workflow names them directly — a system with no System Admin role, or "
          "no Head of School role, has no way to recover. The remainder may be "
          "added and withdrawn, and it is the combination of this screen with the "
          "next one that makes the access model configurable at run time rather "
          "than at deployment."],
         ),
        ("4.5.68 Page Visibility",
         "Page Visibility",
         "Granting application pages to roles and units",
         ["Page Visibility is the screen that makes the navigation model real. "
          "Granting a page to a role here causes it to appear in that role's "
          "sidebar at the next sign-in, and revoking it removes both the menu "
          "entry and the access, because the same grants the menu is built from "
          "are the ones the server checks when the page's data is requested. "
          "There is no second list of permissions in the client to keep in step.",
          "The same grants govern the assistant. A topic the assistant can answer "
          "is attached to the pages that hold the underlying data, so revoking a "
          "page here withdraws the corresponding questions from the assistant's "
          "suggestions and causes it to decline them if asked directly. That is "
          "why the module is treated as configuration rather than as a "
          "convenience feature, and why deleting a page is subject to the same "
          "dependency check as everything else: a page still granted to a role "
          "cannot be removed until those grants are."],
         ),
        ("4.5.69 System Configuration - Approval Policies",
         "System Configuration — Approval Policies",
         "The thresholds and deadlines that govern proposal routing",
         ["Approval policy is data rather than code. This tab holds the attendee "
          "threshold above which a proposal must additionally pass the finance "
          "gate, the deadline after which an event may no longer be cancelled, "
          "the minimum notice a proposal must give, and the maximum number of "
          "categories an event may carry. Holding the routing thresholds here "
          "means the institution can change what requires the CFO's approval "
          "without a deployment, and it is why the review stages shown in Section "
          "4.5.5 differ between proposals.",
          "The same page carries two further tabs, Event Categories and Event "
          "Formats, which are the same add, edit, deactivate and delete "
          "catalogue table pointed at different lists."],
         ),
        ("4.5.72 Option Catalogue - Logistics Items",
         "Option Catalogue — Departmental Options",
         "A department-owned catalogue, shown for logistics items",
         ["This is the catalogue a Head of Logistics maintains: the loanable "
          "items an applicant may request, with the quantity available and the "
          "unit each is counted in. One component serves every option list the "
          "proposal form draws on — transportation, sound and light, photography "
          "and videography, campus tours, funding, dietary information and "
          "serving units — with each list owned by the department answerable for "
          "it. Devolving the catalogues this way is what keeps them accurate: the "
          "people who know that an item is out of service are the people who can "
          "withdraw it, and they do not have to ask an administrator to do it for "
          "them."],
         ),
        ("4.5.76 Option Catalogue - Venue Management",
         "Option Catalogue — Venue Management",
         "The venue catalogue, held by the finance office",
         ["Venues are kept as a separate screen because they carry fields the "
          "other catalogues do not — a building, a capacity and an ordering "
          "position. The capacity in particular is not decorative: it is the "
          "figure against which an event's expected attendance is judged, which "
          "is why the catalogue is held by the finance office rather than by an "
          "individual department."],
         ),
    ],
)

GROUP_L = dict(
    number="4.5.12",
    title="AI Assistant",
    folder="L - AI Assistant",
    intro=[
        "The assistant answers questions written in ordinary language over the "
        "system's own data. Its design problem is not generating an answer but "
        "refusing to generate the wrong one: a natural-language interface over a "
        "database is a second route to every record in it, and it would be of "
        "little value if it were also a route around the access model that "
        "governs the rest of the application.",
        "It is not given its own rules. A question is attached to the pages that "
        "hold the data it would need, and it is answered only if the asker holds "
        "one of those page grants — the same grants that build their sidebar. "
        "Every generated query is then checked before execution and scoped to "
        "what the asker may already see, and every interaction, including every "
        "refusal, is recorded.",
    ],
    figures=[
        ("4.5.78 AI Assistant Dock",
         "AI Assistant Dock",
         "The assistant panel opened from the persistent launcher",
         ["The assistant is reachable from every internal page through the "
          "launcher fixed in the lower right corner, and opens as a docked panel "
          "over the current page rather than navigating away from it. The panel "
          "opens on a set of suggested questions, and these are the part of the "
          "screen that carries the design decision. They are not a fixed list. "
          "Each card names the pages its subject lives behind and is offered only "
          "if the reader holds one of them, so the cards a Head of Department "
          "sees are not the cards a student sees.",
          "The consequence is that a card cannot invite a question the assistant "
          "would then refuse, because the grant that releases the answer is the "
          "grant that shows the card. Revoking a page in Section 4.5.11 withdraws "
          "its cards at the next open with nothing to keep in step by hand, and a "
          "newly defined role receives the cards its grants imply without any "
          "change here."],
         ),
        ("4.5.79 AI Assistant Full Page",
         "AI Assistant Full Page",
         "The same assistant at its own route",
         ["The assistant is also addressable as a page in its own right. This is "
          "the same component instance rather than a second copy, which is what "
          "allows a conversation begun in the docked panel to be continued here "
          "without losing it. Giving it a real address means the browser's own "
          "controls behave as a user expects — back and forward move through the "
          "application rather than out of it, a refresh does not discard the "
          "session, and the assistant can be linked to directly."],
         ),
        ("4.5.80 AI Access Log",
         "AI Access Log",
         "The administrative record of assistant use, including refusals",
         ["The access log records who asked, what topic the question was "
          "classified as, which page grants that topic required, the question "
          "itself, the outcome and, where the request was declined, the reason. "
          "Recording refusals as fully as answers is the point of the screen. An "
          "assistant that silently declines is impossible to audit and impossible "
          "to tune, whereas a log of what was refused and why is evidence that "
          "the access model is being applied, and it is the surface on which a "
          "topic that is being refused too broadly becomes visible.",
          "This figure closes Section 4.5 because it is the clearest single piece "
          "of evidence for the claim the chapter has been making throughout: that "
          "authorisation in this system is enforced in one place and consulted by "
          "everything, rather than being re-implemented by each feature that "
          "needs it."],
         ),
    ],
)
