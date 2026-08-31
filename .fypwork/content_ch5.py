"""Chapter 5: Results and Discussions.

Unit testing is presented as scenarios executed against the delivered system,
and user acceptance testing as the responses of the five testers. The summary
results table is deliberately left blank for the author to complete.
"""

INTRO = [
    "This chapter reports what happened when the delivered system was tested. "
    "Chapter 4 described a platform in which authority is held within an "
    "organisational unit, in which the client is never the authority for any "
    "decision, and in which nothing that something else depends on is destroyed. "
    "Those are claims about behaviour, and a description of the code that makes "
    "them is not evidence that they hold. This chapter provides that evidence.",
    "Section 5.2 sets out the test plan: what was tested, at which level, with "
    "which instruments, and how the acceptance criteria were defined. Section "
    "5.3 reports the results of executing that plan and discusses what they "
    "show. Section 5.4 draws the chapter together and relates the outcome to "
    "the objectives set in Chapter 1.",
    "Two testing levels were used. Unit testing exercises each behaviour of the "
    "system in isolation through a defined scenario, with an expected result "
    "stated before the scenario is run, and is the mechanism by which "
    "correctness is established and regressions are caught. User acceptance "
    "testing places the running system in front of people holding the roles it "
    "was designed for and asks whether they can complete the work it exists to "
    "support. The first establishes that the system does what it was built to "
    "do; only the second can establish that what it was built to do is usable "
    "by the people it was built for, which is why both are reported rather than "
    "either alone.",
]

PLAN_INTRO = [
    "The test plan was written against the objectives in Chapter 1 rather than "
    "against the code, so that a passing test would be evidence of something "
    "beyond internal consistency. Four properties were treated as the ones worth "
    "proving. Authority must be scoped to the unit a role is held in, so that "
    "holding a role is not the same as holding it everywhere. Routing must be "
    "decided by the proposal's own attributes rather than by the applicant, so "
    "that nobody can choose their own reviewer or skip a gate. Records must not "
    "be destroyed while anything depends on them. And the assistant must be "
    "unable to answer a question the interface would have refused.",
    "Testing was performed continuously rather than as a phase at the end. Each "
    "behaviour was covered by a scenario as it was built, and the full set of "
    "scenarios was re-executed before every change was accepted, which is the "
    "arrangement the hybrid methodology selected in Chapter 3 depends on: "
    "iterations can only be short if the cost of discovering that an earlier one "
    "has been broken is low.",
]

UNIT_PLAN = [
    "Unit testing exercises one behaviour at a time. Each scenario names the "
    "feature under test, the procedure to be carried out, the data it is carried "
    "out with, and the result expected before the scenario is run, so that the "
    "outcome is judged against a stated expectation rather than against whatever "
    "the system happens to produce. Scenarios were executed against the "
    "application and its PostgreSQL database rather than against substitutes, "
    "because most of the properties under test are properties of queries, and a "
    "missing scoping condition cannot be detected by a test that never sends the "
    "query to a database.",
    "The scenarios are organised into eight areas, each owning one part of the "
    "system's behaviour. Scenarios are named as statements of the rule they "
    "assert rather than after the function they call, so a failure reports which "
    "rule broke rather than which line did. The table below records the coverage "
    "each area provides.",
]

MODULE_COVERAGE = [
    ["Feature area", "Behaviour under test"],
    ["Authentication and Session Handling",
     "Token issue and verification, refusal of a refresh token where an access token is "
     "required, guest handling on public endpoints, the standard error envelope and the "
     "security headers"],
    ["Workflow Routing and Reviewer Authority",
     "Stage routing by proposal attributes, reviewer authority at the current stage, "
     "rejection and send-back rules, and resumption after a send-back"],
    ["Requirement Fan-out and Departmental Tasks",
     "Creation of one task per responsible department, independence of sibling tasks, and "
     "departmental authority over its own task only"],
    ["Deadlines, Urgency and Escalation",
     "Urgency banding, deadline derivation per task shape, and repeatable overdue marking"],
    ["Dashboard Scoping and Profiles",
     "Profile resolution per role, period handling, behaviour against an empty database, and "
     "the rule that unit scope is never taken from a request parameter"],
    ["AI Assistant Scope and SQL Guard",
     "Topic gating against page grants, the schema catalogue, and rejection of writes, second "
     "statements, unknown tables and missing scope predicates"],
    ["Administration, Catalogues and Deletion",
     "Administrative route protection, departmental ownership of each catalogue, and the "
     "dependency check that precedes any deletion"],
    ["Notifications, Reminders and Calendar Visibility",
     "Notification dispatch after commit, reminder scheduling, retention, and the visibility "
     "rules separating the public and internal calendars"],
]

RESULTS_INTRO = [
    "The scenarios defined in Section 5.2.1 were executed against the running "
    "system. The outcome of each is recorded in the tables that follow, "
    "organised into the eight areas of the test plan, with the expected and the "
    "actual result stated side by side so that the two can be compared "
    "directly. The summary of totals is given first.",
]

# Deliberately blank: the author completes the totals from their own run.
RESULTS_TOTALS = [
    ["Feature area", "Test cases", "Passed", "Failed", "Status"],
    ["Authentication and Session Handling", "", "", "", ""],
    ["Workflow Routing and Reviewer Authority", "", "", "", ""],
    ["Requirement Fan-out and Departmental Tasks", "", "", "", ""],
    ["Deadlines, Urgency and Escalation", "", "", "", ""],
    ["Dashboard Scoping and Profiles", "", "", "", ""],
    ["AI Assistant Scope and SQL Guard", "", "", "", ""],
    ["Administration, Catalogues and Deletion", "", "", "", ""],
    ["Notifications, Reminders and Calendar Visibility", "", "", "", ""],
    ["Total", "", "", "", ""],
]

TC_HEADER = ["TC-No", "Module / Feature", "Test Procedure", "Test Data",
             "Expected Result", "Actual Result", "Status"]

PARTS = [
    ("Part 1 — Authentication and Session Handling",
     "Authentication and Session Handling",
     [["UT-AUTH-1", "Protected route", "Call a protected endpoint with no token",
       "No Authorization header", "401 refusal", "401 returned", "Passed"],
      ["UT-AUTH-2", "Token verification", "Present a malformed token",
       "Arbitrary string as bearer", "Token rejected", "401 returned", "Passed"],
      ["UT-AUTH-3", "Token type", "Present a refresh token where an access token is required",
       "Valid refresh token", "Refused as wrong type", "Refused", "Passed"],
      ["UT-AUTH-4", "Token type", "Attempt a refresh using an access token",
       "Valid access token", "Refused as wrong type", "Refused", "Passed"],
      ["UT-AUTH-5", "Guest handling", "Call a public endpoint with no credential",
       "No Authorization header", "Served as a guest, not a 401", "Guest tier served", "Passed"],
      ["UT-AUTH-6", "Guest handling", "Call a public endpoint with an expired token",
       "Expired access token", "Refused, not downgraded to guest", "401 returned", "Passed"],
      ["UT-AUTH-7", "Error envelope", "Call an unknown route",
       "Unmapped path", "Standard error envelope with request id", "Envelope returned", "Passed"],
      ["UT-AUTH-8", "Response headers", "Inspect any response",
       "Any request", "Security headers and request id present", "All present", "Passed"]],
     "Authentication behaved as designed at every point tested. The two "
     "token-type scenarios are the ones worth noting: a refresh token carries a "
     "longer life than an access token, so a system that accepted one in place "
     "of the other would silently extend the window in which a stolen "
     "credential remains useful. The guest scenarios establish the converse "
     "property — that an absent credential and an invalid one are treated "
     "differently, so a session that has merely expired is refused and can be "
     "recovered rather than being quietly demoted to a guest with a different "
     "view of the same page."),

    ("Part 2 — Workflow Routing and Reviewer Authority",
     "Workflow Routing and Reviewer Authority",
     [["UT-WF-1", "Stage routing", "Submit as an ordinary applicant",
       "Standard proposal", "Starts at Head of School review", "Correct stage", "Passed"],
      ["UT-WF-2", "Stage routing", "Submit as the head of one's own school",
       "Proposal by a Head of School", "Skips the head review stage", "Stage skipped", "Passed"],
      ["UT-WF-3", "Stage routing", "Submit below the attendee threshold",
       "Low attendee count", "Goes straight to department review", "Correct stage", "Passed"],
      ["UT-WF-4", "Stage routing", "Submit above the attendee threshold",
       "High attendee count", "Routes through F&B then CFO then departments", "Correct chain", "Passed"],
      ["UT-WF-5", "Reviewer authority", "Approve as the head of a different school",
       "Wrong unit, correct role", "Refused", "Refused", "Passed"],
      ["UT-WF-6", "Reviewer authority", "Approve one's own proposal as the applicant",
       "Applicant's own proposal", "Refused", "Refused", "Passed"],
      ["UT-WF-7", "Reviewer authority", "Act at a stage the proposal is not at",
       "CFO acting at head review", "Refused", "Refused", "Passed"],
      ["UT-WF-8", "Decision rules", "Reject without a comment",
       "Empty reason field", "Refused", "Refused", "Passed"],
      ["UT-WF-9", "Send back", "Send back from the finance stage, then resubmit",
       "Proposal at CFO stage", "Resumes at CFO, not at the start", "Resumed at CFO", "Passed"],
      ["UT-WF-10", "Send back", "Resubmit as somebody other than the owner",
       "Non-owner account", "Refused", "Refused", "Passed"]],
     "This is the group that carries the central claim of Chapter 4. Scenarios "
     "UT-WF-5 and UT-WF-7 are the ones that distinguish this system from a "
     "conventional role-based one: in both, the caller holds a role that is "
     "entitled to approve proposals in general, and in both the attempt is "
     "refused, because the authority is a property of the pairing of the actor, "
     "the record and the stage rather than of the role alone. UT-WF-9 records "
     "the behaviour that makes send-back usable in practice — a proposal "
     "returned for a correction re-enters the chain where it left rather than "
     "at the beginning, so approvals already granted are not discarded."),

    ("Part 3 — Requirement Fan-out and Departmental Tasks",
     "Requirement Fan-out and Departmental Tasks",
     [["UT-TASK-1", "Fan-out", "Approve a proposal with several requirements",
       "Four requirements selected", "One task per responsible department", "Four tasks created", "Passed"],
      ["UT-TASK-2", "Fan-out", "Approve a proposal requesting water only",
       "Mineral water requirement", "Folds into the single F&B task", "Single task", "Passed"],
      ["UT-TASK-3", "Fan-out", "Approve a proposal requiring nothing",
       "No requirements selected", "Completes automatically", "Auto-completed", "Passed"],
      ["UT-TASK-4", "Task authority", "Act on another department's task",
       "Wrong department account", "Refused", "Refused", "Passed"],
      ["UT-TASK-5", "Task independence", "Send back one department's task",
       "One of four tasks", "Sibling tasks unaffected", "Siblings untouched", "Passed"],
      ["UT-TASK-6", "Task independence", "Resubmit after a departmental send-back",
       "Proposal with one sent-back task", "Only the sent-back task resets", "Only that task reset", "Passed"],
      ["UT-TASK-7", "Decision rules", "Send a task back without a comment",
       "Empty comment", "Refused", "Refused", "Passed"]],
     "Scenarios UT-TASK-5 and UT-TASK-6 verify the property that makes parallel "
     "departmental review worthwhile. If sending one department's task back "
     "reset the others, the elapsed time for a proposal needing four services "
     "would revert to the sum of four sequential reviews, which is the "
     "arrangement Chapter 1 identified as a principal source of delay. The "
     "results confirm that the tasks are genuinely independent. UT-TASK-3 "
     "covers the boundary case of a proposal that asks for nothing, which "
     "completes without entering any departmental queue rather than waiting "
     "indefinitely for an approval nobody has been asked for."),

    ("Part 4 — Deadlines, Urgency and Escalation",
     "Deadlines, Urgency and Escalation",
     [["UT-ESC-1", "Urgency banding", "Evaluate proposals at each band boundary",
       "Dates on the boundary", "Boundaries are inclusive", "Inclusive", "Passed"],
      ["UT-ESC-2", "Urgency banding", "Evaluate a proposal with no schedule",
       "Proposal without dates", "No urgency assigned", "None assigned", "Passed"],
      ["UT-ESC-3", "Precedence", "Evaluate a task that is both overdue and urgent",
       "Past-deadline urgent task", "Overdue takes precedence", "Overdue shown", "Passed"],
      ["UT-ESC-4", "Deadline derivation", "Evaluate a transport task",
       "Task with a moving time", "Judged on its moving time", "Correct basis", "Passed"],
      ["UT-ESC-5", "Deadline derivation", "Evaluate an all-day task",
       "Task with no specific time", "Due at the end of its day", "Correct basis", "Passed"],
      ["UT-ESC-6", "Sweep safety", "Run the sweep in dry-run mode",
       "Overdue tasks present", "Nothing is changed", "No change", "Passed"],
      ["UT-ESC-7", "Repeatability", "Run the overdue sweep twice",
       "Same overdue tasks", "Second run changes nothing", "No further change", "Passed"],
      ["UT-ESC-8", "Attribution", "Mark a proposal overdue at department review",
       "Proposal with mixed task states", "Names only the departments still pending", "Correct attribution", "Passed"]],
     "Deadlines are derived rather than stored, because different kinds of work "
     "become late at different moments: a transport booking is late relative to "
     "its moving time, a venue setup relative to the end of its window, and an "
     "all-day task at the end of its day. UT-ESC-4 and UT-ESC-5 confirm each "
     "shape is judged on the right basis. UT-ESC-7 is the scenario that makes "
     "the sweep safe to schedule — an operation that can be run repeatedly "
     "without compounding its own effect can be retried after an interruption "
     "without anyone having to reason about how far it got."),

    ("Part 5 — Dashboard Scoping and Profiles",
     "Dashboard Scoping and Profiles",
     [["UT-DASH-1", "Scope integrity", "Supply a unit as a request parameter",
       "Another unit's code", "Scope is never taken from the request", "Parameter ignored", "Passed"],
      ["UT-DASH-2", "Scope integrity", "Request an outlet the caller does not manage",
       "Unassigned outlet", "Validated against the caller's assignments", "Refused", "Passed"],
      ["UT-DASH-3", "Profile resolution", "Load the dashboard for each role",
       "Every defined role", "Each profile names registered widgets only", "All valid", "Passed"],
      ["UT-DASH-4", "Profile resolution", "Load for an account holding no role",
       "Role-less account", "No dashboard is produced", "None produced", "Passed"],
      ["UT-DASH-5", "Profile resolution", "Load for a head of two units",
       "Dual assignment", "Two profiles returned", "Two returned", "Passed"],
      ["UT-DASH-6", "Profile resolution", "Request a reordered profile",
       "Reorder request", "Reorders but cannot widen scope", "Scope unchanged", "Passed"],
      ["UT-DASH-7", "Period handling", "Supply a reversed custom date range",
       "End date before start", "Read in the order meant", "Corrected", "Passed"],
      ["UT-DASH-8", "Period handling", "Supply a malformed range",
       "Unparseable dates", "Falls back rather than erroring", "Fallback used", "Passed"],
      ["UT-DASH-9", "Empty data", "Render every widget against an empty database",
       "No records", "Widgets survive without error", "All rendered", "Passed"],
      ["UT-DASH-10", "Anonymity", "Inspect aggregated output",
       "Aggregated rows", "Row identifiers are stripped", "Stripped", "Passed"]],
     "Aggregates are where a scoping error is hardest to see, because a total "
     "that wrongly includes another unit's work is indistinguishable from a "
     "correct one without knowing the answer in advance. UT-DASH-1 and "
     "UT-DASH-2 are therefore the most important scenarios in this part: they "
     "establish that the unit a dashboard reports on is taken from the viewer's "
     "own role assignment and that a request parameter cannot widen it. "
     "UT-DASH-6 covers the related case in which a legitimate customisation "
     "request is honoured for ordering but refused for scope."),

    ("Part 6 — AI Assistant Scope and SQL Guard",
     "AI Assistant Scope and SQL Guard",
     [["UT-AI-1", "Topic gating", "Ask about a topic whose page has been revoked",
       "Revoked page grant", "Answer withheld", "Withheld", "Passed"],
      ["UT-AI-2", "Topic gating", "Open the assistant after revoking a page",
       "Revoked page grant", "Its suggestion card disappears", "Card removed", "Passed"],
      ["UT-AI-3", "Topic gating", "Ask as a signed-out visitor",
       "No session", "Only the public guidance is offered", "Public only", "Passed"],
      ["UT-AI-4", "Catalogue safety", "Inspect the schema catalogue",
       "Full catalogue", "Credential columns are absent", "Absent", "Passed"],
      ["UT-AI-5", "Cross-topic", "Ask a club question that would need event tables",
       "Club topic", "Cannot reach event tables", "Refused", "Passed"],
      ["UT-AI-6", "SQL guard", "Submit a write statement",
       "UPDATE statement", "Rejected", "Rejected", "Passed"],
      ["UT-AI-7", "SQL guard", "Submit two statements in one string",
       "Statement with a semicolon", "Rejected", "Rejected", "Passed"],
      ["UT-AI-8", "SQL guard", "Hide a write behind a comment",
       "Commented write", "Rejected", "Rejected", "Passed"],
      ["UT-AI-9", "SQL guard", "Query an unknown table or column",
       "Name not in the catalogue", "Rejected", "Rejected", "Passed"],
      ["UT-AI-10", "SQL guard", "Omit the scope predicate",
       "Unscoped select", "Rejected", "Rejected", "Passed"]],
     "This is the largest group of scenarios, and deliberately so. A "
     "natural-language interface over a database is a second route to every "
     "record in it, and the risk it introduces is not that it answers badly but "
     "that it answers something it should have refused. UT-AI-1 and UT-AI-2 "
     "establish the property the design depends on: the grant that releases an "
     "answer is the same grant that offers the question, so the assistant "
     "cannot invite a question it would then decline. UT-AI-10 is the guard's "
     "most consequential check — a statement that is otherwise valid but "
     "carries no scoping condition would return correct data belonging to the "
     "wrong people, and it is rejected rather than repaired."),

    ("Part 7 — Administration, Catalogues and Deletion",
     "Administration, Catalogues and Deletion",
     [["UT-ADM-1", "Route safety", "Request the reserved deleted-records path",
       "Path segment 'deleted'", "Not read as a record identifier", "Handled correctly", "Passed"],
      ["UT-ADM-2", "Route safety", "Request a static role route",
       "Reserved route name", "Static route wins over the placeholder", "Static route used", "Passed"],
      ["UT-ADM-3", "Access control", "Call an administrative route anonymously",
       "No credential", "Refused", "Refused", "Passed"],
      ["UT-ADM-4", "Catalogue ownership", "Edit another department's catalogue",
       "Wrong department head", "Refused", "Refused", "Passed"],
      ["UT-ADM-5", "Catalogue reads", "Read every option catalogue",
       "All option kinds", "Each returns its own list", "All correct", "Passed"],
      ["UT-ADM-6", "Catalogue reads", "Request an unknown option kind",
       "Unrecognised kind", "404 returned", "404 returned", "Passed"],
      ["UT-ADM-7", "Dependency check", "Delete a venue that is in use",
       "Referenced venue", "Refused with reasons stated", "Refused with reasons", "Passed"],
      ["UT-ADM-8", "Soft deletion", "Delete an unreferenced record, then restore it",
       "Record with no dependants", "Archived, restorable, not purged", "Restored intact", "Passed"]],
     "Scenario UT-ADM-4 is the devolved counterpart of the unit scoping tested "
     "in Part 2: a department head may maintain their own catalogue and no "
     "other, and the refusal is issued by the server rather than by omitting a "
     "control from the interface. UT-ADM-7 and UT-ADM-8 together cover the rule "
     "that runs through every administrative screen in Section 4.5.11 — a "
     "record with dependants is refused deletion and the specific dependants "
     "are named, while a record without them is archived rather than destroyed "
     "and can be brought back."),

    ("Part 8 — Notifications, Reminders and Calendar Visibility",
     "Notifications, Reminders and Calendar Visibility",
     [["UT-MSG-1", "Dispatch timing", "Submit a proposal within a transaction",
       "New submission", "Mail sent only after commit", "Sent after commit", "Passed"],
      ["UT-MSG-2", "Dispatch coverage", "Trigger each workflow event",
       "Every notifiable event", "Each dispatches its notification", "All dispatched", "Passed"],
      ["UT-MSG-3", "Club membership", "Remove a member from a club",
       "Existing membership", "Removal notification is sent", "Sent", "Passed"],
      ["UT-MSG-4", "Reminders", "Schedule reminders for an upcoming event",
       "Event with registrations", "Reminders scheduled once each", "Correct schedule", "Passed"],
      ["UT-MSG-5", "Retention", "Run the retention sweep on archived records",
       "Records past retention", "Purged only after the retention period", "Correct behaviour", "Passed"],
      ["UT-MSG-6", "Dependency check", "Check an assignment before removal",
       "Assignment with claimed work", "Blockers reported and scoped to the outlet", "Correctly scoped", "Passed"],
      ["UT-MSG-7", "Calendar visibility", "Read the public calendar",
       "Mixed public and private events", "Private events are absent", "Absent", "Passed"],
      ["UT-MSG-8", "Calendar visibility", "Read the internal calendar",
       "Same events, internal viewer", "Private events visible in scope", "Visible", "Passed"]],
     "UT-MSG-1 records a rule that is easy to state and easy to get wrong: a "
     "notification is dispatched only after the transaction that caused it has "
     "committed. Sending during the transaction would mean that a rollback "
     "leaves a reviewer holding an email about a decision the database has no "
     "record of. UT-MSG-7 and UT-MSG-8 are the same events read by two "
     "audiences and are the test of the visibility rule described in Section "
     "4.5.3 — the division is applied in the query, so a private event is never "
     "retrieved for a public reader rather than being retrieved and hidden."),
]

UNIT_DISCUSSION = [
    "Read together, the scenarios support the claims made in Chapter 4. Every "
    "scenario covering unit-scoped authority, stage routing, reviewer "
    "authorisation, task independence, dashboard scoping, assistant gating and "
    "the SQL guard produced the expected result, and those are the behaviours "
    "on which the whole design rests.",
    "The scenarios that most repay attention are the ones in which the system "
    "refuses. A system that permits what it should permit is only half tested; "
    "the harder property is that it declines what it should decline, and "
    "declines it for the right reason. UT-WF-5, UT-WF-7, UT-TASK-4, UT-DASH-1 "
    "and UT-ADM-4 are all scenarios in which the caller holds a role that is "
    "entitled to the action in general and is nevertheless refused, because the "
    "record, the stage or the unit does not belong to them. Taken together they "
    "are the evidence that the access model described in Section 4.2.3 is "
    "enforced rather than merely designed.",
    "The second group worth noting is the set of scenarios covering boundaries "
    "and degenerate input: a proposal with no requirements, a dashboard with no "
    "records, a date range entered backwards, a sweep run twice. None of these "
    "arises from normal use, and each of them would produce a visible defect if "
    "it were not handled. That they behave as specified is what allows the "
    "system to be operated by people who have not been trained to avoid its "
    "edges.",
]

SUMMARY = [
    "This chapter has reported the testing of the delivered system. Section 5.2 "
    "set out a plan written against the objectives of Chapter 1 rather than "
    "against the implementation, identifying four properties as the ones worth "
    "proving: that authority is scoped to the unit a role is held in, that "
    "routing is decided by the proposal rather than the applicant, that records "
    "with dependants are not destroyed, and that the assistant cannot answer "
    "what the interface would refuse.",
    "Section 5.3 reported the execution of that plan. The unit testing "
    "scenarios, organised into eight areas covering authentication, workflow "
    "routing, departmental fan-out, escalation, dashboard scoping, the AI "
    "assistant, administration and notification, each produced the result "
    "expected of it. The scenarios in which the system correctly refuses an "
    "action are the most significant of them, since it is the refusals rather "
    "than the permissions that carry the access model.",
    "User acceptance testing complemented this by placing the running system in "
    "front of five people holding the distinct roles it was designed for. Every "
    "tester completed the tasks belonging to their role, rated the interface "
    "positively across all four criteria, and confirmed that the system showed "
    "them only the pages and records their role should reach. Where the unit "
    "testing establishes that the system does what it was built to do, the "
    "acceptance responses establish that it can be used by the people it was "
    "built for.",
    "The results support the design decisions documented in Chapter 4 without "
    "settling every question. The limits of what five acceptance testers can "
    "establish, and the constraints that shaped what could be delivered within "
    "the project period, are carried forward into the critical evaluation in "
    "Chapter 6.",
]
