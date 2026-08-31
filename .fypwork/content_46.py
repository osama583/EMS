"""Section 4.6 (sample codes) and 4.7 (summary)."""

INTRO = [
    "This section presents twelve listings taken directly from the delivered "
    "source rather than written for the report. Each figure carries a header "
    "naming the file, its path within the repository and the exact line range "
    "reproduced, so every listing can be located in the submitted code and "
    "checked against it.",
    "The listings were not chosen to demonstrate the largest or the most "
    "intricate code in the project. They were chosen because each one is the "
    "single place where a claim made earlier in this chapter is actually "
    "enforced. Between them they cover the two halves of authentication, the "
    "three points at which authorisation is applied, the state machine that "
    "drives the workflow, the fan-out that turns an approved proposal into "
    "departmental work, the deadline sweep, the guard that stands between the "
    "assistant and the database, and the scoping applied to dashboard "
    "aggregates. Where a design decision has been described in words in Sections "
    "4.2 to 4.5, one of these listings is the code that carries it out.",
]

FIGURES = [
    ("4.6.01 auth.py.png",
     "auth.py",
     "backend/app/api/auth.py, lines 56 to 111",
     "Sign-in: credential verification and token issuance",
     ["The sign-in handler verifies the submitted credential and, on success, "
      "issues a short-lived access token together with a longer-lived refresh "
      "token. The detail worth reading closely is that the password is hashed "
      "and compared even when no account matches the submitted email. That work "
      "is deliberately wasted: without it, a request naming an address that does "
      "not exist would return measurably faster than one naming an address that "
      "does, and the endpoint would become a way of discovering which people "
      "hold accounts. The response text is identical in both cases for the same "
      "reason.",
      "Passwords are stored only as bcrypt hashes with a configurable work "
      "factor, and the plaintext is never written to a log; the audit entry "
      "records the outcome and the address that was tried, which is what an "
      "administrator investigating repeated failures needs, and nothing more."],
     ),
    ("4.6.02 login.ts.png",
     "login.ts",
     "fyp-ui/src/app/features/auth/login/login.ts, lines 126 to 176",
     "The client half of sign-in: validation and the authentication call",
     ["The client component collects the credential, applies the same shape "
      "constraints the server applies, and calls the authentication service. It "
      "makes no decision about whether the credential is correct and holds no "
      "rule about what the resulting session may do; it receives a token and the "
      "grants that came with it, and stores them. Placing this listing "
      "immediately after the server one makes the division explicit — the client "
      "improves the experience of getting authentication right, and the server "
      "decides whether it was."],
     ),
    ("4.6.03 auth.guards.ts.png",
     "auth.guards.ts",
     "fyp-ui/src/app/core/auth/auth.guards.ts, lines 1 to 76",
     "Route guards gating internal pages on session and grant",
     ["The route guards prevent an unauthenticated visitor from reaching an "
      "internal route and redirect them to sign in, and prevent a signed-in user "
      "from reaching a page their grants do not include. They are a usability "
      "mechanism rather than a security control, and the distinction is worth "
      "stating plainly in a report: a guard runs in code the user's browser "
      "already holds and can be removed by anyone determined to remove it. What "
      "it buys is that a user is never shown a page that will fail when its data "
      "is requested. The refusal that matters happens on the server, in the "
      "listing that follows shortly."],
     ),
    ("4.6.04 auth.interceptor.ts.png",
     "auth.interceptor.ts",
     "fyp-ui/src/app/core/auth/auth.interceptor.ts, lines 31 to 84",
     "Attaching the bearer token and recovering an expired session",
     ["The interceptor attaches the access token to every outbound API call, so "
      "that no individual service has to remember to do it, and handles the case "
      "where the token has expired. Rather than returning the failure to the "
      "calling component, it exchanges the refresh token for a new access token "
      "and replays the original request. Requests arriving while that exchange "
      "is in progress wait for it and then proceed, so a page issuing several "
      "calls at once produces one refresh rather than several. The effect for "
      "the user is that a session recovers silently instead of ejecting them to "
      "the sign-in screen mid-task."],
     ),
    ("4.6.05 role-navigation.ts.png",
     "role-navigation.ts",
     "fyp-ui/src/app/core/navigation/role-navigation.ts, lines 20 to 60",
     "Building each role's menu from server-issued page grants",
     ["This is the code behind the sidebar in Section 4.5.3 and the claim made "
      "repeatedly in this chapter that the client decides nothing. The menu is "
      "produced by filtering the page catalogue against the grants returned with "
      "the session. There is no list of roles here and no conditional naming a "
      "role, so a page granted on the Page Visibility screen appears without a "
      "change to this file, and a role added to the system receives a working "
      "menu without one either."],
     ),
    ("4.6.06 event-proposal.ts.png",
     "event-proposal.ts",
     "fyp-ui/src/app/features/forms/event-proposal/event-proposal.ts, lines 1150 to 1200",
     "Step navigation and per-step validation in the six-step form",
     ["This is the movement logic of the proposal form. Advancing validates the "
      "step being left and refuses to move while it is incomplete, which is the "
      "behaviour shown in the validation figure of Section 4.5.4; moving "
      "backwards is unconditional, because a user reviewing what they entered "
      "should never be blocked by a step further on. The step being left is "
      "committed to the working draft as it is left, which is what allows the "
      "form to be saved and resumed at any point without the applicant having "
      "reached the end."],
     ),
    ("4.6.07 stages.py.png",
     "stages.py",
     "backend/app/services/workflow/stages.py, lines 123 to 216",
     "The proposal workflow state machine",
     ["The state machine is the centre of the system. It holds the permitted "
      "transitions from each stage and the rules that decide which stage a "
      "proposal reaches next — whether the finance gate applies at this attendee "
      "count, which departments the requirement selection has brought in, and "
      "whether the proposal is returning after a send-back and should resume "
      "where it left off rather than starting again.",
      "Two properties of this listing are worth drawing out. The transition and "
      "the history record are written inside a single transaction, so a "
      "proposal cannot change stage without the record of who changed it being "
      "created; and the transition table is consulted rather than assumed, so a "
      "decision submitted for a stage the proposal is no longer at is refused "
      "rather than applied. That second property is what makes the workflow "
      "safe when two reviewers act at once."],
     ),
    ("4.6.08 authorization.py.png",
     "authorization.py",
     "backend/app/services/workflow/authorization.py, lines 147 to 207",
     "Server-side authorisation, with the actor taken from the token",
     ["This is the refusal that the route guards only anticipate. The acting "
      "user is read from the verified token and never from the request body, so "
      "a caller cannot assert who they are; their role assignments are then "
      "loaded from the database rather than trusted from the token's claims, so "
      "that a revoked role takes effect on the next request rather than when the "
      "token happens to expire. The check that follows is not a role test but a "
      "test of the pairing of this actor, this record and the stage the record "
      "currently occupies — which is what allows one department head to act on a "
      "proposal and another, holding the identical role in a different unit, to "
      "be refused."],
     ),
    ("4.6.09 tasks.py.png",
     "tasks.py",
     "backend/app/services/workflow/tasks.py, lines 48 to 113",
     "Fan-out of an approved proposal into departmental tasks",
     ["When a proposal clears its approval stages this code turns it into work. "
      "One task is created for each department the requirement selection at step "
      "three brought in, carrying the requested items, the schedule and the "
      "location, and each lands in that department's own queue. This is the "
      "mechanism behind the parallel review described in Section 4.2: the "
      "departments receive their tasks together rather than in sequence, so the "
      "elapsed time for a proposal needing four services is the time taken by "
      "the slowest of them rather than the sum of all four. Chapter 1 identified "
      "sequential departmental handling as a principal source of delay, and this "
      "listing is the direct answer to it."],
     ),
    ("4.6.10 escalation.py.png",
     "escalation.py",
     "backend/app/services/workflow/escalation.py, lines 211 to 271",
     "Detecting work that has passed its deadline",
     ["The escalation sweep finds tasks whose deadline has passed without "
      "completion and marks them overdue, which is what populates the late "
      "counters and the jobs-at-risk panel on the departmental dashboard. "
      "Deriving lateness in one place rather than computing it in each view that "
      "displays it means a task cannot be late on the dashboard and on time in "
      "the queue. The sweep is idempotent — running it twice produces the same "
      "state as running it once — which is what makes it safe to schedule."],
     ),
    ("4.6.11 sql_guard.py.png",
     "sql_guard.py",
     "backend/app/ai/sql_guard.py, lines 181 to 250",
     "Validating every generated statement before it reaches the database",
     ["This is the guard between the assistant and the database, and it is the "
      "listing that most directly supports the claims made in Section 4.5.12. "
      "Every statement produced by the language model is parsed and checked "
      "before execution: it must be a single read, it may touch only tables the "
      "asker's topic entitles them to, it must carry the scoping conditions that "
      "restrict it to their own records, and it must not contain the constructs "
      "by which a query can be made to do something other than read.",
      "The guard rejects rather than repairs. A statement that fails is not "
      "rewritten into a safe one; it is refused, the refusal is logged with its "
      "reason, and the model is given one bounded opportunity to produce an "
      "acceptable statement instead. The distinction matters, because a guard "
      "that silently corrects what it is given eventually corrects something "
      "into a query nobody intended."],
     ),
    ("4.6.12 scope.py.png",
     "scope.py",
     "backend/app/services/dashboard/scope.py, lines 208 to 284",
     "Scoping dashboard aggregates to the viewer",
     ["The dashboards aggregate across many records, which makes them the place "
      "where a scoping mistake would be least visible: a total that silently "
      "includes another department's work looks exactly like a correct total. "
      "This code adds the viewer's scope to the aggregation as a filtering "
      "condition, so records outside it are never read rather than being read "
      "and then discounted. It is the same scope object the list endpoints and "
      "the assistant use, which is what allows the guarantee to be stated once "
      "for the whole system rather than verified separately for every figure on "
      "every dashboard."],
     ),
]

SUMMARY = [
    "This chapter has taken the system from design to delivered software. "
    "Section 4.2 established the architecture, the identity model and the three "
    "tiers at which authorisation is applied, and set out the functional scope "
    "in use cases, the behaviour in activity diagrams and the interactions in "
    "sequence diagrams. Section 4.3 presented the physical database as it is "
    "deployed, with its data dictionary organised into the eight clusters the "
    "schema itself is grouped into. Section 4.4 documented the interface design "
    "— the navigation map, the screen anatomy, the role-derived menu, the design "
    "tokens, the shared component library, the storyboards for the three "
    "principal journeys and the responsive strategy.",
    "Section 4.5 then presented the delivered system itself in sixty-four "
    "figures, each captured from the running application at two viewports, "
    "covering the public tier, attendance, the application shell, the six-step "
    "proposal form, tracking and review, departmental task handling, the "
    "cafeteria and clubs modules, the role dashboards, event registrations, "
    "system administration and the AI assistant. Section 4.6 closed with twelve "
    "listings taken from the submitted source, each the place where one of the "
    "chapter's claims is enforced.",
    "Three decisions run through the whole of it and are worth restating "
    "together. The first is that a role is held within an organisational unit "
    "rather than globally, which is what allows the same role to carry authority "
    "in one department and none in another. The second is that the client is "
    "never the authority: it renders a menu from grants the server issued and "
    "guards routes for the user's convenience, while every refusal that matters "
    "is made on the server after the record in question has been loaded. The "
    "third is that nothing which something else depends on is ever destroyed — "
    "records are withdrawn from use, deletions are checked against their "
    "dependants and are reversible, and every stage transition is written in the "
    "same transaction as the change it describes.",
    "What the chapter has not established is whether the delivered system "
    "behaves correctly, which is the subject of Chapter 5. The following chapter "
    "presents the test plan, the results of executing it against the deployed "
    "application and database, and the discussion of what those results show.",
]
