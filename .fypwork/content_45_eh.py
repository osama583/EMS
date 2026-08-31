"""Section 4.5 content, groups E to H."""

GROUP_E = dict(
    number="4.5.5",
    title="Proposal Tracking and Review",
    folder="E - Proposal Tracking and Review",
    intro=[
        "Once a proposal has been submitted it becomes a shared object with two "
        "audiences. The applicant needs to know where it has reached and what, if "
        "anything, is expected of them; the reviewer at the current stage needs "
        "enough of it to decide. This group covers both, and the two views are "
        "the same underlying record rendered under different scopes rather than "
        "two copies of it.",
        "The review screen is presented three times in this group at different "
        "levels of detail — as a reviewer sees it, as a department head sees it, "
        "and with the decision panel isolated — because the contrast is the "
        "argument. A single page that changes what it shows according to who "
        "opened it is the mechanism by which a department is prevented from "
        "acting on requirements that are not theirs.",
    ],
    figures=[
        ("4.5.28 Draft Proposals",
         "Draft Proposals",
         "Saved but unsubmitted proposals awaiting resumption",
         ["Drafts are proposals that have been saved but not submitted. They are "
          "visible only to their owner and the co-owners named at step one, and "
          "they occupy no place in any reviewer's queue, because a draft has not "
          "yet asked anything of anybody. Keeping drafts as ordinary rows in the "
          "request table with a distinct status, rather than in a separate store, "
          "means that submitting one is a status transition rather than a copy, "
          "and the identifier the applicant has been quoting does not change at "
          "the moment it matters most."],
         ),
        ("4.5.29 Created by Me - Status Tracking",
         "Created by Me — Status Tracking",
         "The applicant's view of every proposal they have submitted",
         ["This is the applicant's answer to the question Chapter 3 found was "
          "hardest to get answered: where has my request reached. Each submitted "
          "proposal is listed with the stage it currently occupies, so the "
          "applicant can distinguish a proposal waiting on a Head of School from "
          "one already with the departments. The stage shown is read from the "
          "request itself rather than inferred, and it is the same value the "
          "reviewer's queue is built from, so the two cannot disagree.",
          "Where a proposal has required a payment, the receipt is reachable from "
          "this screen. The document is fetched as an authenticated request and "
          "opened from the response rather than linked directly, so that "
          "possession of a file name is not by itself sufficient to retrieve "
          "somebody's receipt."],
         ),
        ("4.5.30 Proposal Review - Reviewer View",
         "Proposal Review — Reviewer View",
         "A submitted proposal as its reviewing Head of School sees it",
         ["The review page opens on a summary strip and then presents the "
          "proposal in full, with the decision panel held to the right where it "
          "remains reachable as the reader scrolls. The proposal captured here is "
          "an international food festival for six hundred external attendees, "
          "restricted to club visibility, currently at the Head of School and "
          "Head of Department stage. A reviewer at this stage sees the whole "
          "proposal because their decision is about the event as a whole: whether "
          "it should happen at all, at this scale, under this unit's name.",
          "That is precisely what distinguishes this view from the next one. The "
          "authority to approve is not a property of the person but of the pairing "
          "of the person, the record and the stage it currently occupies, and it "
          "is checked on the server after the record has been loaded rather than "
          "by a role test on the route."],
         ),
        ("4.5.31 Proposal Review - Department View",
         "Proposal Review — Department View",
         "The same proposal as its Head of Logistics sees it",
         ["This is the same page and the same proposal, opened by a department "
          "head. The content has narrowed to that department's own requested "
          "items and the actions offered are the department's own: confirm "
          "fulfilment, or send the request back. A Head of Logistics has no "
          "opinion to give on whether the event should take place — that decision "
          "was taken at the previous stage — and no business seeing the "
          "transport arrangements. Presenting one page under two scopes rather "
          "than building two pages means a change to how a proposal is displayed "
          "cannot accidentally be applied to one audience and not the other."],
         ),
        ("4.5.32 Proposal Review - Summary KPI Bar",
         "Proposal Review — Summary Strip",
         "The six-card summary at the head of the review page",
         ["The summary strip carries the six facts that most often decide a "
          "review: the event title, the total number of attendees and how many "
          "are external, the visibility, the format, the current stage and the "
          "category. It is shown separately here because it is the part of the "
          "screen a reviewer reads first and, for a straightforward proposal, "
          "sometimes the only part they need. The external attendee count is "
          "given its own place rather than being folded into the total because it "
          "is the figure that triggers the additional review stages described in "
          "Section 4.5.11."],
         ),
        ("4.5.33 Reject Proposal - Reason Required",
         "Reject Proposal — Reason Required",
         "The decision panel refusing a rejection submitted without a comment",
         ["Pressing Reject with an empty comment produces the state shown here: "
          "the comment field outlined and the requirement stated in place. A "
          "rejection without a reason is of no use to the applicant, who must "
          "either resubmit or abandon the event, and it is of no use to the audit "
          "trail either, since the record would show that a decision was taken "
          "and nothing about why. The constraint is enforced on the server as "
          "well, where the comment is written into the workflow history in the "
          "same transaction as the status change.",
          "The screen also shows what the system deliberately does not do. There "
          "is no confirmation dialogue between the reviewer and the decision. The "
          "validation happens in place, in the panel the reviewer is already "
          "looking at, because an extra modal adds a click without adding any "
          "information the reviewer did not already have."],
         ),
        ("4.5.34 Workflow Actions Panel",
         "Workflow Actions Panel",
         "The three stage decisions available to a reviewer",
         ["The decision panel offers exactly three actions: approve, which "
          "advances the proposal to whatever stage the routing rules name next; "
          "resubmit, which returns it to the applicant with the comment attached "
          "and allows it to re-enter the chain at the point it left; and reject, "
          "which ends it. Send-back is offered as a first-class action rather "
          "than being achieved by rejecting and asking the applicant to start "
          "again, because a proposal that needs one figure corrected should not "
          "lose the approvals it has already collected."],
         ),
    ],
)

GROUP_F = dict(
    number="4.5.6",
    title="Departmental Task Handling",
    folder="F - Department Task Handling",
    intro=[
        "Three screens in this group are the same shell. Inbox, Ongoing and "
        "History are one records component whose tab strip is computed from the "
        "viewer's page grants, and they divide the same records by what is "
        "expected of the viewer rather than by what kind of record it is: the "
        "Inbox holds what is waiting on this person to act, Ongoing holds what is "
        "in flight and needs nothing from them, and History holds what has "
        "settled. Organising the application this way means a Head of Department "
        "has one place to look each morning rather than one per record type.",
    ],
    figures=[
        ("4.5.35 Inbox - Action Queues",
         "Inbox — Action Queues",
         "The action queue for a Head of Department, with the Proposals tab open",
         ["The Inbox is everything waiting on a decision from the account "
          "viewing it. The figure shows the Proposals queue for a Head of "
          "Logistics: seventeen proposals in a sortable table carrying the "
          "proposal identifier, event title, applicant, schedule, urgency, "
          "attendee count and current status, with a search field, a status "
          "filter and a card-or-table view toggle above it.",
          "The tab strip beside it is the part worth reading carefully, because "
          "the Inbox can carry six queues in total and no single role holds all "
          "of them. Proposals holds those awaiting this reviewer's decision; "
          "Requests holds departmental service requests routed to the unit they "
          "head; Events holds event registrations awaiting an organiser's "
          "decision; Tasks holds the shared work pool for department and "
          "cafeteria staff; Clubs holds membership requests awaiting a club "
          "president; and President Change Requests holds handovers awaiting a "
          "Club Admin. The strip shown here is the one this account's grants "
          "produce, and the queues themselves appear in their own right in "
          "Sections 4.5.7, 4.5.8 and 4.5.10."],
         ),
        ("4.5.38 Staff Task Assignment",
         "Staff Task Assignment",
         "The confirmation dialogue in which departmental work is assigned",
         ["This dialogue is where departmental work is actually allocated, and it "
          "encodes a decision worth stating plainly: approving is assigning. A "
          "department head confirming fulfilment of a requested item — here a "
          "single portable stage deck — must name the team member who will carry "
          "it out before the confirmation control becomes available. The "
          "alternative arrangement, in which approval and assignment are separate "
          "steps, produces a class of work that has been agreed to and belongs to "
          "nobody, which is precisely the accountability gap Chapter 1 set out to "
          "close."],
         ),
        ("4.5.39 Ongoing Records Hub",
         "Ongoing Records Hub",
         "Work in flight that the viewer can see but need not act on",
         ["Ongoing holds records that are moving but are not waiting on the "
          "viewer. The figure shows the Proposals tab, holding proposals that "
          "have been submitted and are still travelling through approval; the "
          "same shell also carries Events, holding the viewer's own event "
          "registrations still awaiting a decision, and, for a student, Clubs, "
          "holding join requests still pending. Separating this from the Inbox is "
          "what keeps the Inbox meaningful: if a queue mixes what needs a decision "
          "with what merely needs watching, it stops being a list of work and "
          "becomes a list of everything."],
         ),
        ("4.5.40 History Records Hub",
         "History Records Hub",
         "Settled records, retained as the audit trail",
         ["History is the settled counterpart of Ongoing. The Proposals tab shown "
          "here holds proposals that have been approved, rejected or cancelled, "
          "and the shell also carries Events for registrations confirmed and "
          "since concluded or turned down, Tasks for completed departmental work, "
          "Clubs for decided join requests and President Change Requests for "
          "completed handovers. Nothing is removed from the system when it "
          "concludes; every stage transition remains recorded with its actor, its "
          "timestamp and any comment given, which is what allows a decision taken "
          "months earlier to be accounted for."],
         ),
    ],
)

GROUP_G = dict(
    number="4.5.7",
    title="Cafeteria Module",
    folder="G - Cafeteria Module",
    intro=[
        "Catering is the one requirement in the system that is not fulfilled by a "
        "university department but by an outlet with its own staff, its own menu "
        "and its own manager. It therefore has a module rather than a task type. "
        "The module has three audiences — the staff who prepare orders, the "
        "manager who runs an outlet, and the administrator who oversees all of "
        "them — and the screens are grouped here in that order.",
    ],
    figures=[
        ("4.5.42 Cafeteria Staff Tasks",
         "Cafeteria Staff Tasks",
         "The shared-pool order queue as seen by cafeteria staff",
         ["Cafeteria orders are not assigned to an individual when they arrive. "
          "They are placed in the outlet's shared pool, from which any member of "
          "that outlet's staff may claim one, and the claim is what creates the "
          "assignment. The screen shows three orders in the pool with their event "
          "code, menu item, serving time, outlet and quantity. A shared pool "
          "suits catering for the reason it does not suit departmental work: an "
          "order is short-lived and any qualified member of the outlet can take "
          "it, whereas a logistics task may run for days and needs a named owner "
          "from the outset. The claim is recorded against the claiming user, so "
          "the pool is a queue rather than an absence of accountability."],
         ),
        ("4.5.43 My Menu Management",
         "My Menu Management",
         "An outlet manager maintaining their own menu",
         ["A cafeteria manager maintains the menu for their own outlet: the "
          "dishes offered, their prices, the units they are served in and their "
          "dietary information. This catalogue is the source the proposal form "
          "reads when an applicant asks for food and beverage, so withdrawing a "
          "dish here removes it from future proposals without affecting orders "
          "already placed against it. The screen is scoped to the outlet the "
          "manager's role assignment names, which is the same unit-scoping "
          "mechanism applied throughout the system rather than a rule particular "
          "to catering."],
         ),
        ("4.5.44 Manage Cafeterias",
         "Manage Cafeterias",
         "The catalogue of cafeteria outlets, held by the Cafeteria Admin",
         ["The outlet catalogue is administered centrally. An outlet may be "
          "created, edited, deactivated or deleted here, and the last two are "
          "deliberately different operations. Deactivating an outlet withdraws it "
          "from new proposals while leaving its history intact; deletion is "
          "refused outright while anything still depends on it, and the reasons "
          "for the refusal are stated rather than the control simply failing. "
          "That rule is applied consistently across every catalogue in the "
          "system and is described further in Section 4.5.11."],
         ),
        ("4.5.45 Cafeteria Staff Assignments",
         "Cafeteria Staff Assignments",
         "The posting of staff to outlets",
         ["This screen records which members of staff are posted to which outlet. "
          "An assignment is a role held within a unit, so the same person may "
          "hold a manager role at one outlet and nothing at another, and their "
          "authority follows the posting rather than the account. The screen also "
          "enforces a constraint that the workflow depends on: an outlet's last "
          "remaining manager can be neither removed nor deactivated, because an "
          "outlet with no manager can still receive orders and would have nobody "
          "able to act on them."],
         ),
        ("4.5.46 Menu Oversight",
         "Menu Oversight",
         "Every outlet's menu in one view, for administrative oversight",
         ["Menu oversight gathers the menus of all outlets into a single view. It "
          "is a read-heavy administrative screen rather than an editing surface: "
          "the manager of each outlet remains the author of their own menu, and "
          "the administrator's interest is in comparison — whether prices are "
          "consistent, whether dietary information has been supplied, whether an "
          "outlet has been left with nothing on offer."],
         ),
        ("4.5.47 My Staff",
         "My Staff",
         "An outlet manager's own team roster",
         ["The manager's roster shows the staff posted to their outlet, together "
          "with the status of each. It is the manager-scoped counterpart of the "
          "administrator's assignment screen: a manager may see and act on their "
          "own team but cannot post staff to an outlet they do not run, and the "
          "restriction is applied in the query rather than by hiding controls."],
         ),
        ("4.5.48 Staff Action History",
         "Staff Action History",
         "The audit log of cafeteria staff changes",
         ["Every change to a cafeteria posting — an addition, a suspension, a "
          "removal — is written to a dedicated audit log and surfaced here. The "
          "log is append-only and is written in the same transaction as the "
          "change it records, so a posting cannot be altered without the record "
          "of the alteration being created. This is the same guarantee applied to "
          "proposal stage transitions, and it is what makes the History screens "
          "in Section 4.5.6 trustworthy rather than merely informative."],
         ),
    ],
)

GROUP_H = dict(
    number="4.5.8",
    title="Clubs Module",
    folder="H - Clubs Module",
    intro=[
        "The clubs module is the community half of the platform. It exists "
        "because a large share of campus events are organised by student "
        "societies rather than by departments, and a system that could route a "
        "proposal but could not say who was entitled to raise one on a club's "
        "behalf would leave that share unmanaged. Membership, leadership and the "
        "handover of leadership are therefore modelled explicitly rather than "
        "being treated as attributes of a user.",
    ],
    figures=[
        ("4.5.49 Discover Clubs",
         "Discover Clubs",
         "The club directory browsed by a student",
         ["The directory lists the clubs a student may join, organised by the "
          "category taxonomy maintained on the last screen in this group. A club "
          "that has been deactivated does not appear here, and neither does one "
          "that has been archived, because both states mean the club is not "
          "accepting members even though its records are retained. Joining is "
          "requested rather than taken: selecting a club opens a request that "
          "carries a stated reason and lands with the club's president."],
         ),
        ("4.5.50 My Clubs",
         "My Clubs",
         "The clubs a student belongs to or presides over",
         ["My Clubs shows the memberships the signed-in student holds, each card "
          "offering a view of the roster and, for a president, the management "
          "actions that come with the office. The president of a club is not an "
          "attribute stored on the club row alone; it is a role assignment, which "
          "is what allows presidency to be transferred through a reviewed process "
          "rather than by editing a field.",
          "Where a handover has already been requested for a club, the control "
          "that would start one reports the request as pending instead of "
          "offering to raise a second. The server refuses a duplicate in any "
          "case, but a control that invites an action the server will reject is a "
          "defect in its own right, and the screen reads the pending state with "
          "the club rather than discovering it on submission."],
         ),
        ("4.5.51 Club Roster Modal",
         "Club Roster Modal",
         "The membership roster of a club",
         ["The roster overlay lists the club's current members and, for a "
          "president, offers removal. Removing a member sends them an email "
          "notification, which is a deliberate choice: a membership that "
          "disappears without explanation is indistinguishable from a defect, and "
          "the person best placed to query the decision is the person it was "
          "taken about."],
         ),
        ("4.5.52 Club Join Requests",
         "Club Join Requests",
         "Pending membership requests awaiting a president's decision",
         ["Join requests reach the president through the same Inbox shell as "
          "every other pending decision, on its Clubs tab. Each request carries "
          "the applicant's stated reason. The reason field is not decorative: "
          "without it a president is presented with a list of names and no basis "
          "on which to decide, which in practice produces either indiscriminate "
          "approval or none at all."],
         ),
        ("4.5.53 President Change Requests",
         "President Change Requests",
         "Presidency handovers awaiting administrative approval",
         ["A change of president is raised as a request and decided by a Club "
          "Admin rather than being performed by the outgoing president directly. "
          "The office carries the authority to admit and remove members and to "
          "raise proposals in the club's name, so transferring it is an "
          "administrative act with a record, not a setting. The queue shown here "
          "holds the requests awaiting that decision."],
         ),
        ("4.5.54 Manage Clubs",
         "Manage Clubs",
         "The administrative club catalogue",
         ["The Club Admin maintains the catalogue itself: creating clubs, editing "
          "their details, deactivating them and, where nothing depends on them, "
          "deleting them. Deletion is checked before it is offered. A club with "
          "members, with events raised in its name or with a membership history "
          "cannot be deleted at all, and the screen states which of those is the "
          "obstacle rather than reporting a generic failure."],
         ),
        ("4.5.55 Club Categories",
         "Club Categories",
         "The category taxonomy under which clubs are classified",
         ["Categories are the taxonomy the discovery directory is organised by. "
          "The table filters by status and offers an All view alongside the "
          "active and inactive ones, so an administrator can see the whole "
          "taxonomy including categories that have been withdrawn from use but "
          "are still attached to existing clubs. As elsewhere, a category that is "
          "in use is deactivated rather than deleted, which withdraws it from new "
          "classifications while leaving the clubs already classified under it "
          "intact."],
         ),
    ],
)
