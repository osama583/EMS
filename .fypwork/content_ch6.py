"""Chapter 6: Conclusion."""

INTRO = [
    "This chapter closes the project. It evaluates what was achieved against "
    "the aim and the five objectives set out in Chapter 1, states what the work "
    "contributes and where its strengths lie, sets out honestly what it does "
    "not do and why, and recommends the work that would most usefully follow.",
]

# --- 6.1 Critical Evaluation -------------------------------------------------
EVAL_INTRO = [
    "The aim stated in Chapter 1 was to develop a centralised, role-based event "
    "coordination platform using Angular, Flask and PostgreSQL for university-"
    "wide multi-departmental event management at Asia Pacific University of "
    "Technology and Innovation. That aim has been met. The delivered system is "
    "an Angular single-page client over a Flask REST API on PostgreSQL hosted by "
    "Supabase, comprising sixty-eight database tables under thirty-three ordered "
    "migrations, twelve distinct roles held per organisational unit, and the "
    "full event lifecycle from proposal through multi-departmental fulfilment to "
    "publication and attendance. Chapter 4 documents it in sixty-four "
    "implementation figures and twelve source listings, and Chapter 5 reports "
    "the testing of it across eight areas of unit-test scenarios and five "
    "acceptance testers.",
    "The five objectives are evaluated individually below, since a claim that "
    "an objective has been met is only worth as much as the evidence offered "
    "for it.",
]

OBJECTIVES = [
    ("Objective 1 — Replace manual, disconnected communication with a "
     "structured digital coordination system.",
     ["This objective is met. Every stage of an event request now takes place "
      "inside the platform: the proposal is raised on the six-step form, "
      "submitted, routed, reviewed, fulfilled by each responsible department "
      "and published, with no step requiring a message outside the system. The "
      "channels Chapter 1 identified as the problem — messaging applications, "
      "telephone calls and verbal instruction — are replaced not by a document "
      "store but by a workflow that knows what stage a request is at and who is "
      "expected to act on it.",
      "The evidence is in Section 4.5, where every stage of the lifecycle is "
      "shown as a delivered screen, and in Part 2 of Section 5.3.1, where the "
      "routing and authority rules are exercised end to end. The clubs and "
      "cafeteria modules extend the same treatment to the two areas that would "
      "otherwise have remained outside it, since a large share of campus events "
      "are organised by student societies and a large share of requests involve "
      "catering."],
     ),
    ("Objective 2 — Improve efficiency and reduce delays through simultaneous "
     "distribution and independent departmental processing.",
     ["This objective is met, and it is the objective the architecture was most "
      "shaped by. When a proposal clears its approval stages it is fanned out "
      "into one task per responsible department, and those tasks are issued "
      "together rather than in sequence. The elapsed time for a proposal "
      "requiring four services is therefore governed by the slowest department "
      "rather than by the sum of all four.",
      "Independence is not merely asserted. Scenarios UT-TASK-5 and UT-TASK-6 in "
      "Section 5.3.1 verify that sending one department's task back leaves its "
      "siblings untouched and that resubmission resets only the task that was "
      "returned — without which the parallelism would collapse back into a "
      "sequence on the first correction. The send-back mechanism itself "
      "contributes to the same objective by allowing a proposal needing one "
      "figure corrected to re-enter the chain where it left rather than at the "
      "beginning, so approvals already granted are not discarded."],
     ),
    ("Objective 3 — Minimise task duplication and miscommunication by defining "
     "responsibilities so that each department handles only what is relevant to "
     "it.",
     ["This objective is met through the unit-scoped role model rather than "
      "through interface design. A role in this system is held by a user within "
      "an organisational unit, so authority follows the posting rather than the "
      "account, and a department head sees and can act on their own unit's "
      "requirements and no others. The narrowing is applied in the query, so "
      "records outside a department's scope are never retrieved rather than "
      "being retrieved and hidden.",
      "Section 4.5.5 shows the same proposal rendered under two scopes — a "
      "reviewer's and a department's — which is the clearest demonstration "
      "available that one page is being narrowed rather than two pages being "
      "maintained. Scenarios UT-WF-5, UT-WF-7 and UT-TASK-4 confirm that a caller "
      "holding the correct role but the wrong unit is refused, and UT-ADM-4 "
      "extends the same result to the option catalogues, which are owned by the "
      "departments answerable for the services they describe."],
     ),
    ("Objective 4 — Strengthen accountability by maintaining a clear record of "
     "approvals, actions and task ownership throughout the event lifecycle.",
     ["This objective is met. Every stage transition is written to the workflow "
      "history inside the same database transaction as the change it describes, "
      "so a decision cannot be recorded without its author, its time and any "
      "comment being recorded with it. Rejections and send-backs are refused "
      "without a reason, which means the trail explains decisions rather than "
      "merely listing them.",
      "Ownership is addressed at the point where it is most often lost. In this "
      "system approving a departmental requirement is the same act as assigning "
      "it: the confirmation dialogue in Section 4.5.6 will not complete until a "
      "team member is named, so no work exists that has been agreed to and "
      "belongs to nobody. Alongside this, nothing is destroyed — deletions are "
      "checked against dependants, are reversible, and are purged only after a "
      "retention period — so the record that supports accountability is not "
      "removable by the people it holds to account. The AI access log applies "
      "the same principle to the assistant by recording refusals as fully as "
      "answers."],
     ),
    ("Objective 5 — Support data-driven decision-making through a dashboard "
     "visualising key analytics on event activity and user engagement.",
     ["This objective is met. Six role-specific dashboards are delivered from a "
      "single component that walks a server-supplied profile naming which "
      "measures to compute, so a new role receives a dashboard through a server "
      "entry rather than a new route. The departmental profile reports "
      "outstanding, late and completed work, on-time completion and push-back "
      "rates, load per staff member and catalogue usage; the finance profile "
      "reports committed spend, cost per attendee, funding breakdowns and the "
      "time proposals spend at each approval gate; the outlet profile reports "
      "order flow.",
      "The dwell-time panel deserves particular note against this objective. "
      "Chapter 1 identified delay with no identifiable cause as a principal "
      "complaint, and measuring how long proposals wait at each gate converts "
      "that complaint into something specific enough to act on. Ten scenarios "
      "in Part 5 of Section 5.3.1 establish that these aggregates are scoped to "
      "the viewer and cannot be widened by a request parameter, which matters "
      "more for aggregates than anywhere else in the system: a total that "
      "silently includes another unit's work is indistinguishable from a "
      "correct one."],
     ),
]

CONTRIBUTION = [
    "The contribution of the project is best stated as the difference between "
    "what the systems reviewed in Chapter 2 do and what this one does. The "
    "commercial platforms surveyed there manage events well but model an "
    "organisation as a flat set of users with global roles, which is not how a "
    "university works; the institutional systems reported in the literature "
    "model the hierarchy but treat departmental involvement as a sequence of "
    "approvals rather than as parallel fulfilment. This project holds both at "
    "once: authority is scoped to the organisational unit a role is held in, "
    "and departmental work is issued in parallel and tracked independently.",
    "For the institution, the practical contribution is that the coordination "
    "of an event is now a record rather than a recollection. A request has a "
    "stage, an owner at that stage, a history of who decided what and why, and "
    "a set of departmental tasks each with a named assignee and a derived "
    "deadline. For the wider case of institutional workflow systems, the "
    "contribution is the demonstration that access can be made configurable at "
    "run time without weakening it: navigation, page access, assistant topics "
    "and administrative capability are all derived from one grant table, so an "
    "administrator can change what a role reaches without a deployment and "
    "without there being a second list of permissions anywhere to fall out of "
    "step with the first.",
]

STRENGTHS = [
    "The principal strength of the delivered system is that its access model "
    "has exactly one implementation. Navigation is rendered from grants issued "
    "by the server, page access is checked against the same grants, list "
    "endpoints add the caller's scope to the query, and the AI assistant "
    "consults the same rules before it will answer. There is no second set of "
    "permission logic in the client, and consequently no possibility of the two "
    "disagreeing. Chapter 5 tests this from several directions and finds it "
    "holding in each.",
    "A second strength is that the system is configurable where institutions "
    "actually need to change. Approval thresholds, cancellation deadlines and "
    "minimum notice are data rather than code; the option catalogues a proposal "
    "draws on are owned and maintained by the departments answerable for them; "
    "and page grants can be changed by an administrator at run time. The people "
    "who know that a logistics item is out of service are the people who can "
    "withdraw it, which is the arrangement most likely to keep the data "
    "accurate over time.",
    "A third is the treatment of destruction. No screen in the system offers an "
    "immediate permanent deletion. A record with dependants is refused deletion "
    "and the specific dependants are named; a record without them is archived, "
    "remains restorable, and is purged only after a retention period. For a "
    "system whose value rests on its audit trail, an accidental deletion is "
    "among the most damaging things a user can do, and it has been made "
    "difficult by design rather than by warning.",
    "A fourth is that the assistant was built as an extension of the access "
    "model rather than as a feature bolted beside it. Its suggested questions "
    "are derived from the reader's own page grants, so it cannot offer a "
    "question it would then refuse; every generated statement is parsed and "
    "checked before execution and rejected rather than repaired if it fails; "
    "and every interaction including every refusal is logged for audit. A "
    "natural-language interface over a database is a second route to every "
    "record in it, and this one was designed on that assumption.",
]

# --- 6.2 Limitation ----------------------------------------------------------
LIMITATIONS = [
    ("Acceptance testing was small and drawn from a limited pool.",
     "Five testers were recruited, one for each distinct position in the "
     "workflow. That is enough to establish that each role can complete its own "
     "work and to surface usability problems that are obvious to a first-time "
     "user, and it is not enough to support any quantitative claim. The "
     "responses are therefore read individually in Section 5.3.2 rather than "
     "averaged. A longitudinal study across a full event season, with testers "
     "who use the system because they must rather than because they were asked "
     "to, would answer questions this project cannot."),
    ("Dense tables are reflowed rather than redesigned for small screens.",
     "Every screen is responsive and every figure in Section 4.5 is shown at "
     "both a desktop and a mobile viewport, but responsiveness is not the same "
     "as being designed per breakpoint. The departmental task and proposal "
     "tables carry many columns, and at 390 pixels they are narrowed rather "
     "than restructured, so reading a complete row involves scrolling "
     "horizontally. Acceptance testing did not surface this as an obstacle, "
     "because each tester was working at a desk, but the operational roles are "
     "the ones most likely to consult the system away from one, and for them "
     "the layout would benefit from a genuine small-screen treatment rather "
     "than a narrower version of the wide one."),
    ("Deployment is local, with only the database managed.",
     "As described in Section 2.4.6, the application is run locally against a "
     "managed PostgreSQL instance rather than being deployed to institutional "
     "infrastructure. This was appropriate for a project of this length and it "
     "means the system has not been exercised under real concurrent load, "
     "against institutional single sign-on, or under the availability "
     "expectations a production deployment would carry."),
    ("The assistant depends on an external model.",
     "Question answering depends on a third-party language model reached over "
     "the network. The guard ensures that a poor generation is refused rather "
     "than executed, so the failure mode is a declined answer rather than an "
     "incorrect one, but the capability is unavailable if the provider is. The "
     "curated knowledge-base path continues to answer questions about how the "
     "system works, so the assistant degrades rather than disappears."),
    ("Scope was bounded to one institution.",
     "The system models the structure of Asia Pacific University of Technology "
     "and Innovation: its schools, its departments, its approval chain and its "
     "twelve roles. The role, unit and page-grant tables are general enough "
     "that another institution's structure could be expressed in them, but that "
     "claim has not been tested against a second institution and is offered as "
     "a design property rather than as a demonstrated result."),
]

# --- 6.3 Recommendation ------------------------------------------------------
RECOMMENDATIONS = [
    ("Deploy to institutional infrastructure and integrate with single sign-on.",
     "The most valuable next step is also the most ordinary one. Running the "
     "application on institutional infrastructure behind the university's own "
     "identity provider would remove the separate credential the system "
     "currently maintains, bring account provisioning and deactivation into "
     "line with the institution's existing joiner and leaver processes, and "
     "expose the system to genuine concurrent load. The unit-scoped role model "
     "is well placed for this, since an identity provider that already knows a "
     "person's department can supply the unit half of an assignment directly."),
    ("Give the dense tables a genuine small-screen layout.",
     "The limitation identified in acceptance testing should be addressed by "
     "designing the task and proposal tables for a narrow viewport rather than "
     "by compressing the wide layout. A card-per-row presentation that promotes "
     "the two or three fields a user scans for and defers the rest behind an "
     "expansion would suit the departmental queues, which are the screens most "
     "likely to be consulted away from a desk."),
    ("Extend acceptance testing across a full event season.",
     "The five acceptance testers each exercised one role once. The stronger "
     "evidence would come from the same roles using the system repeatedly "
     "across a real event cycle, where the questions that matter are about "
     "fatigue, recall and edge cases rather than first impressions. That would "
     "also allow the workflow measurements the dashboards already collect to be "
     "compared against the coordination times Chapter 3 recorded for the "
     "existing arrangements."),
    ("Extend the analytics from description to prediction.",
     "The dashboards currently report what has happened. The same data would "
     "support forecasting: predicting which proposals are likely to miss their "
     "deadlines from the stages they have already passed through and the load "
     "each department is carrying, or estimating catering demand for an event "
     "from the attendance of comparable ones. The escalation module already "
     "derives deadlines and detects lateness, so the measurements a forecast "
     "would be built on are being collected."),
    ("Add push and calendar-level notification.",
     "Notification is currently by email. Adding browser push for time-critical "
     "events, and the ability to subscribe to a departmental calendar feed, "
     "would suit the operational roles in particular — a member of logistics "
     "staff is more likely to be holding a phone than an inbox on the morning "
     "of an event."),
    ("Broaden the assistant's coverage and add a local fallback.",
     "The assistant answers within topics that are gated on page grants, and "
     "both halves of that arrangement could be extended: more topics, and a "
     "locally hosted model as a fallback so the capability survives the "
     "unavailability of the external provider. The guard, the scope rules and "
     "the access log are model-independent, so a second provider is a "
     "configuration change rather than a redesign."),
    ("Validate the model against a second institution.",
     "The claim that the role, unit and page-grant tables generalise beyond one "
     "university is currently a design property rather than a result. "
     "Expressing a second institution's structure in the same tables — "
     "particularly one whose approval chain differs in shape rather than only "
     "in names — would either substantiate the claim or identify precisely "
     "where the model is specific to the case it was built for."),
]

CLOSING = [
    "The project set out to replace a coordination process that ran on "
    "messages, memory and goodwill with one that runs on a record. It has "
    "delivered a working platform in which a request has a stage, a stage has "
    "an owner, an owner's authority is bounded by the unit they hold it in, and "
    "every decision taken along the way is written down with its reason at the "
    "moment it is taken. The measure of the work is not that the software "
    "exists but that the questions Chapter 1 found nobody could answer — where "
    "has my request reached, who is it with, why was it turned down, who agreed "
    "to do this — now have answers the system can produce on request.",
]
