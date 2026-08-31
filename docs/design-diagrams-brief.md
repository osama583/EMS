# Design Diagrams — Build Brief

Produce the thirteen UML/architecture diagrams for the Design chapter of a final-year
research report on this system (APU Event Management System). This brief is the
specification: it names every diagram, states what each one owns, lists the files to
read as evidence, and defines what each must and must not contain.

---

## 0. Mission

Thirteen diagrams. Each concept in the system appears in **exactly one** of them. The
set together covers the whole system.

**STATUS: BUILT — 2026-08-31.** All thirteen exist in `digrams/` as standalone
HTML/SVG figures, with PNG exports in `digrams/png/`. See `digrams/README.md` for
what was delivered and how figure 0 is regenerated. This brief remains the
specification of record: use it when revising a figure, so the ownership rule in
§1 keeps holding.

These are graded artefacts in an academic report. Correctness against the codebase
matters more than prettiness, and legibility matters more than completeness. A
diagram that is accurate but unreadable scores worse than one that is accurate and
shows slightly less.

---

## 1. Non-negotiable rules

1. **One concept, one diagram.** The ownership table is binding. If a fact is owned
   by diagram 6, it must not be drawn in diagram 4 or 10. Cross-reference in a
   caption instead ("routing rules: see Figure 6").

   | Type | Owns exclusively |
   |---|---|
   | ERD (0) | The physical database: every table, column, key and relationship |
   | Architecture (1–2) | Static structure: topology, layering, identity and authorization model |
   | Use case (3–5) | Functional scope: which actor may do what. No ordering, no rules |
   | Activity (6–8) | Behaviour: states, decision rules, parallelism, lifecycles |
   | Sequence (9–11) | Interaction: component messages, external services, transactions, failure and retry |
   | Site map (12) | Information architecture: what pages exist and who sees them |

2. **Evidence or omission.** Every element must be traceable to code. If you cannot
   find it in the repo, leave it out and record it in `GAPS.md`. Never invent a
   component, endpoint, role, status or table to make a diagram look complete.

3. **UML 2.5 notation**, applied consistently. Per-diagram requirements are listed
   below.

4. **Vocabulary is the code's vocabulary.** Use the real identifiers:
   `hos_hod_review`, not "Head Review"; `request_fmb_selection`, not "food order
   table"; `HIGH_PAX_THRESHOLD`, not "the limit". Where a label is too long for a
   box, shorten it and put the exact identifier in the figure caption.

5. **Do not modify application code.** This task is read-only over `backend/` and
   `fyp-ui/`. All new files go in `docs/diagrams/`.

---

## 2. Deliverables

```
digrams/
  00-erd.html              generated from live schema introspection
  01 … 12                  hand-authored HTML/SVG, one figure each
  png/                     rendered exports
  _introspect_schema.py    read-only schema dump  -> _schema.json
  _build_erd.py            _schema.json -> 00-erd.html

# The original PlantUML plan, kept for reference:
docs/diagrams/
  src/                     PlantUML source, one file per diagram
    01-deployment.puml
    02-security.puml
    03-usecase-access.puml
    04-usecase-proposal.puml
    05-usecase-admin.puml
    06-activity-proposal-lifecycle.puml
    07-activity-fulfilment.puml
    08-activity-registration.puml
    09-sequence-auth.puml
    10-sequence-write-path.puml
    11-sequence-ai.puml
    12-sitemap.puml
  out/                     Rendered PNG (300 dpi) and SVG, same basenames
  style/
    common.puml            Shared !include: skinparams, colours, fonts
  EVIDENCE.md              Per diagram: every claim with a file:line citation
  GAPS.md                  Anything specified here that the code does not support
  README.md                Figure list, captions, and how to re-render
```

Each diagram also needs a **figure caption** (2–4 sentences) in `README.md`, written
for a report: what the figure shows, and the one design decision it justifies.
Captions are where cross-references live.

---

## 3. Toolchain

**PlantUML is the required format.** Rationale: it is the only widely available
text-based tool that renders true UML use case diagrams (actor generalization,
`<<include>>`, `<<extend>>`), activity diagrams with fork/join bars and swimlanes,
and sequence diagrams with `alt`/`opt`/`loop`/`par` combined fragments. Mermaid
cannot express several of these and must not be used.

Render with a local `plantuml.jar` if Java is available; otherwise use the PlantUML
server or Kroki via a command documented in `docs/diagrams/README.md`. Check what is
available before starting and report which path you took. Every `.puml` must render
without warnings — a diagram that exists only as source is not delivered.

---

## 4. Visual style system

Treat the thirteen diagrams as one design system, not thirteen drawings. Create
`style/common.puml` first and `!include` it everywhere, so nothing is styled
per-file. Use the design skills available in this environment to settle the palette
and typography, then encode the result once in `common.puml`.

- **One palette, semantic not decorative.** Fix a meaning per colour and keep it
  across all thirteen: one hue for actor/user-facing, one for application/server, one
  for data/persistence, one for external services, one neutral for structure. A
  reader who learns the key on Figure 1 should not have to relearn it on Figure 7.
- **Terminal and exceptional paths are visually distinct.** Approved, rejected,
  cancelled and refused outcomes identifiable without reading labels.
- **Legible in greyscale, printed at A4.** Never rely on colour alone — pair it with
  shape, border weight or a label.
- **One font family, at most three sizes** (title, node label, note).
- **No default PlantUML styling.** Shadows off, explicit `defaultFontName`, explicit
  background and line colours.
- **Aspect ratio suits a report page.** Prefer portrait or square for single-column
  figures; use `left to right direction` only where it genuinely helps.
- **A legend on any diagram whose encoding is not self-evident** (1, 2, 6, 7, 12).

---

## 5. Working protocol

**Phase 0 — Orient (once).** Read `README.md`, `backend/app/__init__.py`,
`backend/app/api/__init__.py`, `backend/app/services/workflow/constants.py`, and
`backend/seed/nav.py`. Those five give you the system's shape. Do not read whole
large files (`api/events.py` is 1722 lines, `api/admin.py` 1511, `migrations/001`
1113) — grep for what you need and read the surrounding 40 lines.

**Phase 1 — Extract evidence, per diagram.** Before drawing anything, collect that
diagram's facts into `EVIDENCE.md` with `file:line` citations. Statuses, decision
conditions, actor lists and endpoint names must be copied from source, never
recalled. The docstrings in `services/workflow/` and `ai/` are unusually detailed
and explain *why* each rule exists — harvest them, they become the figure captions.

**Phase 2 — Author the `.puml`.**

**Phase 3 — Render, then look at the output.** Read the rendered image back and
check for overlap, truncated labels and crossing lines. Fix and re-render.

**Phase 4 — Self-check** against §7.

**Checkpoints.** Stop and show the user the rendered image after diagram 1, after
diagram 6, and after diagram 12. Diagram 1 sets the style system; diagram 6 is the
most complex. Both are worth confirming before the pattern is replicated. Between
checkpoints, work continuously — do not stop after every diagram.

**When the code contradicts this brief, the code wins.** Say so, record it in
`GAPS.md`, and adapt. This brief was written from a reading of the repo, but the
repo is the authority.

---

## 6. The thirteen diagrams

### 0. Entity relationship diagram — the whole database

**Owns:** the physical data model. Every table, column, primary key, foreign key and
data type. No other figure restates schema detail.

**Do NOT hand-draw this.** 68 tables and 111 relationships placed by hand will drift
from the schema the first time a migration lands. Generate it from a live introspection
of the database (`information_schema` plus `pg_class`), so the figure cannot disagree
with what is deployed. See `digrams/_introspect_schema.py` and `digrams/_build_erd.py`.

**Must contain:** all 68 tables grouped into labelled clusters — identity and access,
navigation and page visibility, request core, requirement detail, workflow and
assignment, events and community, catalog and dropdown options, platform and audit.
Each entity shows its columns with `PK` / `FK` markers, the SQL type, and a nullability
marker. Relationship edges carry crow's-foot at the many end and a bar at the one end.

**Guard against silent loss:** the generator must assert that every table returned by
the database lands in some cluster, and fall back to an "Unclassified" cluster rather
than dropping one.

**Caption should state the scale** — 68 tables, 471 columns, 111 foreign keys, applied
by 33 ordered migrations — because that number is itself a finding about the system.

---

### 1. Deployment and layered architecture

**Owns:** physical topology, technology stack, module decomposition, external
dependencies, cross-cutting middleware.

**Read:** `README.md` · `backend/app/__init__.py` (app factory, middleware,
`_register_blueprints`) · `backend/app/api/__init__.py` (the `BLUEPRINTS` list) ·
`backend/app/config.py` · `backend/wsgi.py` · `backend/requirements.txt` ·
`backend/app/db.py` (connection pool) · `backend/app/services/email/client.py` ·
`backend/app/ai/gemini.py` · `fyp-ui/package.json` · `fyp-ui/proxy.conf.json` ·
`fyp-ui/src/app/app.config.ts`

**Must contain:** three nodes — browser running the Angular 21 SPA, Flask/WSGI
application server, Supabase PostgreSQL — plus two external services (Google Gemini,
SMTP). Protocols on every connector. Inside the application-server node, the
layering: `api/` blueprints → `services/` (workflow, dashboard, email, identity,
soft_delete) → `db`, with `ai/` drawn as a parallel stack. Middleware annotated on
the node: rate limiting, security headers, structured request logging, uniform error
envelope. One constraint note: *blueprints never issue SQL directly; only the
workflow package writes `workflow_history`.*

**Notation:** deployment nodes with nested components; stereotypes where they clarify.

**Must NOT contain:** authorization mechanics (diagram 2), any behaviour or
sequencing, any role names.

---

### 2. Security and identity architecture

**Owns:** the RBAC identity model and the authorization enforcement mechanism.

**Read:** `backend/app/security/principal.py` ·
`backend/app/security/decorators.py` · `backend/app/security/tokens.py` ·
`backend/app/security/passwords.py` ·
`backend/app/services/workflow/authorization.py` ·
`backend/migrations/001_initial_schema.sql` lines 140–250 (`users`, `unit`, `role`,
`role_unit`, `user_unit_roles`) · `backend/app/ai/scope_rules.py` ·
`fyp-ui/src/app/core/auth/auth.interceptor.ts` ·
`fyp-ui/src/app/core/auth/token-store.ts` ·
`fyp-ui/src/app/core/auth/auth.guards.ts`

**Must contain:** two halves. *Left* — the identity model: `users` × `unit` × `role`
joined by `user_unit_roles`, where `unit_code = NULL` is a flat role (cfo,
system-admin) and a set `unit_code` is unit-scoped (head-of-school @
school_of_computing); `role_unit` decides which roles may be which; one user holds
many rows. *Right* — the enforcement chain: Bearer token → `authenticate()` →
**`Principal` rebuilt from the database on every request, never read from token
claims**, so a revoked role takes effect immediately → three enforcement tiers:
(a) coarse role decorators, (b) row-state rules that require the row loaded first,
(c) list endpoints scoped in SQL so unauthorised rows are never fetched. Show
`authenticate_optional()` as the public-but-personalised path.

**Notation:** component/structure diagram with annotated flow. Not a sequence
diagram — the token-refresh interaction belongs to diagram 9.

**Must NOT contain:** login/refresh message ordering (diagram 9), page visibility
grants (diagram 12), what any specific role can do (diagrams 3–5).

---

### 3. Use case — Access, participation and community

**Owns:** the functional scope of guests, external users, students, lecturers and
club roles.

**Read:** `backend/app/api/auth.py` (register, login, refresh, password reset, change
password) · `backend/app/api/events.py` (grep `@bp.get` / `@bp.post` for the
registration, saved-event, reminder, search and calendar endpoints) ·
`backend/app/api/clubs.py` · `backend/app/api/ai.py` (`/ask`) ·
`backend/app/api/uploads.py` · `fyp-ui/src/app/features/landing/` ·
`fyp-ui/src/app/features/my-events/`

**Must contain:** actors Guest, External User, Internal User (generalization parent
of Student, Lecturer, Staff), Club Admin, Club President, Event Organizer. Three
labelled packages — *Identity* (self-register with `<<include>>` verify OTP, log in,
reset password, change password, ask the AI assistant), *Events* (browse, search,
master calendar, save event, register, upload payment proof, cancel registration,
set reminder preferences; organizer-side approve or reject a registration, review
payment proof), *Clubs* (discover clubs, request to join, decide a join request,
request a president change, approve a president change, manage clubs and categories).

**Notation:** actor generalization; `<<include>>` and `<<extend>>` where the code
supports them; package boxes to control density.

**Must NOT contain:** ordering, states, or any approval rule.

---

### 4. Use case — Proposal and approval

**Owns:** the functional scope of the applicant, the three reviewer roles, the
department roles and the cafeteria operational roles.

**Read:** `backend/app/api/proposals.py` · `backend/app/api/tasks.py` ·
`backend/app/services/workflow/__init__.py` ·
`backend/app/services/workflow/authorization.py` ·
`backend/app/services/workflow/fmb.py` · `backend/seed/data.py` (role list, ~lines
17–28)

**Must contain:** actors Applicant, Head of School / Head of Department, F&B Head,
CFO, Department Staff, Cafeteria Manager, Cafeteria Staff. Use cases: save draft,
submit proposal, review at stage, approve, reject, send back with comment, resubmit,
resubmit a single department's items, cancel proposal, view approval history; assign
staff to a task, assign staff to an individual row, start preparing, complete task;
claim food order from the shared pool, mark ready, fulfil, send order back to F&B.
Annotate the capability asymmetry — **only the three single-actor reviewer stages
hold the *reject* capability; a department's only pushback is send-back** — because
that is a statement about capability, not sequencing.

**Must NOT contain:** stage order, skip conditions, the pax threshold, or any status
value.

---

### 5. Use case — Administration and configuration

**Owns:** administrative and configuration capability, including the soft-delete
lifecycle and dashboards.

**Read:** `backend/app/api/admin.py` · `backend/app/api/catalog.py` ·
`backend/app/api/options.py` · `backend/app/api/cafeterias.py` ·
`backend/app/api/dashboard.py` · `backend/app/api/ai_admin.py` ·
`backend/app/services/soft_delete.py` ·
`backend/app/services/dashboard/profiles.py` ·
`backend/app/services/dashboard/widgets/` · `backend/seed/nav.py` (which role owns
which dropdown page)

**Must contain:** actors System Admin, Cafeteria Admin, Head of Department, CFO,
Cafeteria Manager. Use cases: manage users, manage units, manage roles, manage page
visibility; the shared archive → restore → purge lifecycle with its dependency check
(draw once as a use case cluster; state in the caption that seven resource types
implement it); manage the dropdown options owned by the actor's own department; set
system configuration (`HIGH_PAX_THRESHOLD`, `CANCELLATION_DEADLINE_DAYS`,
`MAX_EVENT_CATEGORIES`); manage event categories and formats; manage cafeterias;
assign cafeteria staff; view the staff audit log; manage own menu; view and export
the role-scoped dashboard; review the AI access log.

**Must NOT contain:** the soft-delete state machine drawn out — it is described in
the caption, not diagrammed.

---

### 6. Activity — Proposal lifecycle, end-to-end

The flagship diagram. **Owns:** every `request.status` value, all stage-routing
rules, the parallel review, send-back and resume, and the cancellation window.

**Read:** `backend/app/services/workflow/stages.py` (read in full — the module
docstring is the specification) ·
`backend/app/services/workflow/constants.py` ·
`backend/app/services/workflow/authorization.py`
(`is_within_cancellation_window`, `authorize_cancel`) ·
`backend/app/services/workflow/history.py` · `backend/app/api/proposals.py` (the
`/decision`, `/resubmission` and `/cancellation` endpoints)

**Must contain:** partitions Applicant | HOS/HOD | F&B Head | CFO | Departments |
System. Flow: `draft` → submit → decision *"applicant heads own unit, is the CFO or
F&B head, or belongs to no unit?"* → skip, or `hos_hod_review` → decision
*"total_pax > HIGH_PAX_THRESHOLD?"* → `fmb_review` → `cfo_review` → **fork** into
parallel department tasks → **join** → `completed_approved`. Also: reject →
`completed_rejected` (reachable only from the three reviewer stages); send back →
`resubmission_required` with the **`resume_stage` return arc**, showing that a
proposal sent back from CFO resumes at `cfo_review` rather than restarting; cancel
guarded by *"within `CANCELLATION_DEADLINE_DAYS` of the event?"*. All ten status
values must appear. One note: every transition writes `workflow_history` in the same
transaction as the status change.

**Notation:** swimlanes/partitions; decision diamonds with the condition on the
guard; real fork and join bars for the parallel stage; terminal nodes for the three
end states.

**Must NOT contain:** the internal lifecycle of an individual department task
(diagram 7) — the fork leads to one action node per task and the join collects them.

---

### 7. Activity — Requirement fulfilment

**Owns:** `request_task` statuses, `request_fmb_selection` statuses, staff and
row-level assignment, and the shared-pool claim.

**Read:** `backend/app/services/workflow/tasks.py` (module docstring first) ·
`backend/app/services/workflow/fmb.py` ·
`backend/migrations/012_row_level_assignment.sql` ·
`backend/migrations/013_cafeteria_delivery_and_deadlines.sql` ·
`backend/migrations/001_initial_schema.sql` (`request_task` ~line 1068,
`request_fmb_selection` ~line 831) · `backend/app/api/tasks.py` ·
`backend/app/services/workflow/constants.py` (`ROW_ASSIGNABLE_REQUIREMENTS`,
`MAX_ASSIGNEES_PER_ROW`, `UNIT_CODE_FOR_REQUIREMENT`)

**Must contain:** two clearly divided bands in one diagram.
*Band A — department task:* `pending` → head approves and assigns staff →
`approved` → staff starts → `preparing` → `completed`; or head sends back →
`resubmitted` → applicant fixes → `pending`. Include the row-level assignment branch
(five requirement types are row-assignable, with a per-type assignee cap).
*Band B — F&B:* the approved F&B task fans out into per-cafeteria menu selections →
each cafeteria manager reviews independently (approve, or send back to F&B with a
per-selection comment) → approved orders enter a shared pool → guard *"already
claimed?"* → claim → `preparing` → `ready` → `fulfilled`.
End with the join condition: when every sibling task reaches a terminal state, the
parent proposal auto-completes.

**Notation:** two labelled bands with a visible divider, so the merge does not read
as one tangled flow.

**Must NOT contain:** the parent proposal's stage routing (diagram 6).

---

### 8. Activity — Event publication, registration and payment

**Owns:** the `event_registration` status and `payment_status` lifecycles.

**Read:** `backend/app/api/events.py` (registration endpoints: `POST
/<id>/registrations`, the decision endpoint, `registrations/mine`) ·
`backend/migrations/001_initial_schema.sql` (`event_registration` ~line 991 and its
two CHECK constraints) ·
`backend/migrations/019_event_registration_decided_by.sql` ·
`fyp-ui/src/app/core/events/payment-proof-upload.service.ts`

**Must contain:** an approved proposal becomes a published event → discovery
(explore, search, master calendar) → save or register → decision *"registration
approval auto or manual?"* → `registered`, or `pending_approval` → organizer decides
→ decision *"cost_amount > 0?"* → upload payment proof → `pending_review` → approved
or rejected. Include the capacity check and the cancel-then-re-register path
(permitted by the partial unique index that excludes cancelled rows).

---

### 9. Sequence — Authentication and session recovery

**Owns:** guest self-registration, login, and silent session recovery.

**Read:** `backend/app/api/auth.py` ·
`backend/migrations/020_registration_challenges.sql` ·
`backend/migrations/021_password_reset_tokens.sql` ·
`backend/app/security/tokens.py` · `backend/app/security/passwords.py` ·
`fyp-ui/src/app/core/auth/auth.interceptor.ts` ·
`fyp-ui/src/app/core/auth/auth.service.ts` ·
`fyp-ui/src/app/core/auth/external-registration.service.ts`

**Must contain:** one continuous story over the same lifelines (Client, Interceptor,
`api/auth`, DB, Mail). `register/start` stages the submitted form in
`registration_challenge` with a bcrypt-hashed six-digit code and emails it →
`register/verify` checks code, attempt count and expiry → **only then is the `users`
row inserted**, so an abandoned attempt never becomes an account → login issues an
access + refresh pair → a later request returns 401, the interceptor pauses it,
calls `refresh`, and **replays the original request transparently**. `alt` fragment
for *refresh also expired → redirect to login*.

**Notation:** activation bars; `alt` fragment; a note marking the point at which the
account first exists.

---

### 10. Sequence — Write-path integrity and notification

**Owns:** transaction boundaries, the audit trail guarantee, and the email
notification subsystem.

**Read:** `backend/app/db.py` (`transaction()` context manager, ~line 74) ·
`backend/app/api/proposals.py` (the create endpoint) ·
`backend/app/services/workflow/history.py` ·
`backend/app/services/email/notifications.py` ·
`backend/app/services/email/recipients.py` ·
`backend/app/services/email/client.py` (read the `send` docstring — failures are
logged, never raised)

**Must contain:** proposal submission as a transaction. Authenticate → load
`Principal` → validate → **begin transaction** → insert `request` plus the
requirement child rows → write `workflow_history` **inside the same transaction** →
**commit** → resolve recipients → send email **after** commit, with failure logged
rather than raised. Mark the transaction boundary as a note or `ref` frame spanning
the enclosed messages.

**Must NOT contain:** the routing decision itself (diagram 6). This diagram is about
how a write is made durable and who is told, not about which stage comes next.

---

### 11. Sequence — AI assistant query

**Owns:** the text-to-SQL pipeline, the guard, bounded retry, and denial logging.

**Read:** `backend/app/ai/text_to_sql.py` (module docstring is the specification) ·
`backend/app/ai/classifier.py` · `backend/app/ai/topic_access.py` ·
`backend/app/ai/scope_rules.py` · `backend/app/ai/schema_catalog.py` ·
`backend/app/ai/sql_guard.py` · `backend/app/ai/sql_llm.py` ·
`backend/app/ai/sql_runner.py` · `backend/app/api/ai.py` ·
`backend/migrations/025_ai_access_denials.sql` ·
`backend/migrations/026_ai_access_log_outcome.sql`

**Must contain:** lifelines Client, `api/ai`, Classifier, Gemini, `topic_access`,
`scope_rules`, `schema_catalog`, `sql_guard`, `sql_runner`, DB. Straight path:
classify (with recent turns supplied, so a bare follow-up resolves) → topic access
check → derive row-level scope → describe **only** scope-permitted tables → generate
SQL → guard → execute → answer. Then `loop(≤ MAX_ATTEMPTS)` around generate → guard
→ repairable fault fed back with the exact reason; and an `alt` where the guard
reports an **authorization violation → break out, log to `ai_access_denial`, refuse,
never retry**. Show the three distinct terminations: answered, no rows, cannot
answer.

**Caption must state the ordering rationale**, taken from the source docstring:
scope before schema so an unauthorised table is never named to the model; guard
before execute, absolutely; retry bounded, and never retried after an authorization
violation.

---

### 12. Site map with role-grant overlay

**Owns:** the page catalog, the hub-with-tabs pattern, and runtime-configurable page
visibility.

**Read:** `backend/seed/nav.py` (read in full — 221 lines, it is the page catalog) ·
`backend/migrations/001_initial_schema.sql` (`nav_page` ~line 252,
`nav_page_grants` ~286, `nav_page_grant_roles` ~298, `nav_page_grant_units` ~306) ·
`backend/app/api/admin.py` (the `nav-pages` endpoints) ·
`fyp-ui/src/app/app.routes.ts` ·
`fyp-ui/src/app/features/internal/layout/internal-layout.ts` ·
`fyp-ui/src/app/core/auth/role-navigation.ts`

**Must contain:** the public zone (landing, explore events, event detail, login,
register, reset password, standalone assistant) flowing into the `/app` tree:
top-level pages (How It Works, Dashboard, Inbox, Reports, My Menu) and the folders
(My Requests, Events, Forms, My Cafeteria, Dropdown Settings, Cafeterias, Internal
Directory, Clubs, System Configuration) with their children. Show the hub-with-tabs
pattern: Inbox / Ongoing / History are each one page carrying up to seven
role-dependent tabs. Overlay the visibility mechanism: entries come from `nav_page`
filtered by `nav_page_grants`, granted either by flat role or by (role, unit) pair,
with a folder's own grant gating all of its children as a group. Show four role
sub-trees — Student, Head of Department (Logistics), Cafeteria Manager, System Admin.

**Caption should cite the two seeded rules** that prove the mechanism is real: a
Logistics head sees only the Logistics dropdown page and never Sound & Light,
because a uniform grant would show a link the API then refuses; and the Cafeteria
Manager gets Inbox/Ongoing/History but never Drafts or Forms, because they review
orders and never submit proposals.

**Must NOT contain:** a list of what each role can *do* (diagrams 3–5). This diagram
is about pages, not capabilities.

---

## 7. Acceptance checklist

Run this before declaring done. Report the result item by item, honestly.

- [ ] All thirteen figures render to PNG and SVG with no warnings.
- [ ] Every diagram `!include`s `style/common.puml`; no per-file styling.
- [ ] `EVIDENCE.md` cites `file:line` for every status value, decision condition,
      actor and endpoint that appears in any diagram.
- [ ] No concept appears in two diagrams. Check the known collision risks
      specifically: reject-capability (4, not 6) · stage order (6, not 4) · task
      statuses (7, not 6) · token refresh (9, not 2) · identity model (2, not 12) ·
      page grants (12, not 2) · routing decision (6, not 10).
- [ ] Diagram 6 shows all ten `request.status` values.
- [ ] Diagram 6 has a real fork and join bar, not a decision node standing in.
- [ ] Diagram 7's two bands are visually separated and separately titled.
- [ ] Diagrams 9, 10 and 11 each use at least one combined fragment (`alt`, `loop`,
      `opt` or `par`) and show activation bars.
- [ ] Diagram 3 uses actor generalization and at least one `<<include>>`.
- [ ] Every diagram is legible at A4 width in greyscale.
- [ ] Thirteen captions written in `docs/diagrams/README.md`.
- [ ] `GAPS.md` lists anything in this brief the code does not support, or is empty
      and says so.

---

## 8. Anti-patterns

- Hand-placing the ERD. It is generated (figure 0); the conceptual identity model in
  figure 2 stays conceptual and does not repeat column detail.
- Reading `api/events.py` or `api/admin.py` end to end. Grep for the endpoint, read
  the surrounding 40 lines.
- Padding a diagram with elements that are not in the code, to make it look thorough.
- Silently dropping a required element because it was hard to lay out. Say so.
- Thirteen different colour schemes.
- Declaring completion without reading the rendered images back.
