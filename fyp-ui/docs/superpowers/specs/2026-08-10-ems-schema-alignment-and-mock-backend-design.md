# EMS Schema Alignment + Mock Backend — Design

Date: 2026-08-10
Status: Approved by project owner, ready for implementation planning.

## 1. Purpose

The Angular frontend for the APU Event Management System (EMS) was built
before `system.md` / `ems_database_schema.sql` / `ems_mermaid_erd.mmd`
(the authoritative source-of-truth package at
`cloud/system_logic/`) existed as a settled reference. This work:

1. Corrects remaining open questions in the source-of-truth package itself
   (decided in this design session).
2. Audits and corrects the Angular frontend's models, enums, and workflow
   logic against the corrected schema.
3. Builds a Node/Express mock backend (`db.js` + service layer + REST API)
   that implements the real workflow server-side, seeded with realistic
   mixed-state data, so the whole system can be exercised end-to-end before
   a real database/backend is built.

No backend exists today. All 51 schema tables need a stand-in.

## 2. Source-of-Truth Corrections

These resolve every item in `system.md` §7 (Open Questions) and one naming
correction, decided in this session:

| Item | Resolution |
|---|---|
| Student Services Manager role gap | Confirmed real. Add `student_services_manager`, `student_services_member` to `users.role` CHECK. They own the Campus Tour dropdown (trimmed, see below). |
| `ExternalUser` / `ClubPresident` (frontend-only roles) | Keep both. Add `external_user`, `club_president` to `users.role` CHECK. |
| F&B role split (`FmbReviewer` vs `FmbManager` in frontend) | These are a mistake — merge into ONE role. |
| "fnb" naming | Renders as "F&B" everywhere in APU's domain language. Every code identifier (`fnb_options`, `request_fnb`, requirement key `'fnb'`, TS enum values, etc.) is renamed to the token **`fmb`**. Display label is always **"F&B"**. |
| Mineral Water Logo/Normal ownership | NOT a separate department lane. Merged into the same F&B task as food — F&B reviews food + water together as one task. |
| F&B Water Services Staff role | Removed entirely. Water fulfilment goes through Cafeteria Staff's shared inbox, same mechanism as food. |
| Campus Tour structure | Trim to **Starting Point only**. Drop Tour Area and Campus Map tables/columns/fields entirely (both schema and frontend). |
| HOS/HOD self-review + high pax | Applicant = HOS/HOD of own unit → skip `hos_hod_review`, F&B reviews next. If pax is also above `HIGH_PAX_THRESHOLD`, CFO still reviews after F&B (same pairing as the normal high-pax path), before department_review. |
| Cafeteria Manager decision options | Approve (→ Cafeteria Staff shared inbox) or resubmit. Resubmit is NOT a return-to-applicant like other departments — see §3 F&B/Cafeteria chain. |
| PK datatype | Confirmed: surrogate integers (`BIGSERIAL`), no UUID. |
| `event_visibility` / `event_format` / `registration_approval` free text | Add CHECK constraints matching the Angular frontend's existing fixed dropdown option lists (exact values pulled from `event-proposal.ts` / `published-event.models.ts` during implementation). |

### Schema edits required in `ems_database_schema.sql`

- `users` CHECK: add `student_services_manager`, `student_services_member`,
  `external_user`, `club_president`; replace the `fnb` value with `fmb`.
  No dedicated water-staff role exists in the schema's CHECK today (only
  in the frontend, as `FmbWaterServicesStaff`), so there's nothing to
  remove from the schema itself — just don't add one.
- Rename `fnb_options` → `fmb_options`, `request_fnb` → `request_fmb`,
  `request_fnb_id` → `request_fmb_id`, `request_fnb_selection` →
  `request_fmb_selection`, `request_fnb_selection_id` →
  `request_fmb_selection_id`, `fnb_option_id` → `fmb_option_id`, and all FK
  columns referencing these.
- `water_logo_options` and `water_normal_options` (the manager-configured
  dropdown lookup tables) are UNCHANGED — F&B still manages these as
  reusable options. What changes is only on the *request* side:
  `request_mineral_water_logo` / `request_mineral_water_normal` rows
  attach to the SAME `request_task` as `request_fmb` (via a shared
  `request_task_id`, all under `stage_code='department_review'`,
  `requirement_id` still distinguishing which requirement each snapshot
  row belongs to) instead of each requirement getting its own
  independent `request_task` row. No table is dropped here — only the
  task-grouping behavior changes.
- Drop `campus_tour_area_options`, `campus_tour_map_options`. Remove
  `tour_area_option_id`, `tour_area`, `campus_map_option_id`, `campus_map`
  columns from `request_campus_tour`.
- Add `status` column to `request_fmb_selection`
  (`pending`/`approved`/`resubmitted`/`preparing`/`fulfilled`/`cancelled`)
  — new, needed for the per-selection resubmit lifecycle (§3).
- Extend `request.status` CHECK to the corrected value list (§3).
- Update `chk_task_status` on `request_task` to the corrected value list
  (§3) — drops `rejected`, adds `preparing`.
- Add CHECK constraints for `event_visibility`, `event_format`,
  `registration_approval` once exact value lists are confirmed from the
  frontend.

`system.md` and `ems_mermaid_erd.mmd` get regenerated to match at the end
of implementation, not hand-edited mid-way.

## 3. Corrected Workflow State Machine

This is the logic the Express server owns (system.md's stated principle:
"the backend owns the workflow, not the frontend" — the frontend sends
actions and renders whatever state comes back).

```
submitted
  |
  v
[applicant is HOS/HOD of own unit?] --yes--> skip to high-pax check below
  | no
  v
hos_hod_review
  (HOS/HOD of applicant's unit: approve / reject / resubmit)
  | approved
  v
[applicant is CFO or F&B?] --yes--> skip straight to department_review
  | no
  v
[total_pax > HIGH_PAX_THRESHOLD?]
  | yes                              | no
  v                                  |
fmb_review                           |
 (F&B reviews first. Approve/        |
  reject/resubmit — same             |
  single-actor semantics as          |
  hos_hod_review. Reject ends it.    |
  Resubmit sends to applicant,       |
  resumes at fmb_review. Only on     |
  approve does it proceed to CFO.)   |
  | approved                         |
  v                                  |
cfo_review                           |
 (CFO reviews second. Approve/       |
  reject/resubmit. Reject ends it.   |
  Resubmit sends to applicant,       |
  RESUMES AT cfo_review — NOT        |
  fmb_review. Once F&B has approved  |
  once, F&B's job on this proposal's |
  approval-level review is           |
  permanently done; later applicant  |
  resubmissions from this point      |
  never route back through F&B.)     |
  | approved                         |
  +---------------+------------------+
                   v
          department_review
   One request_task per selected requirement, PARALLEL and independent:
   Logistics / Transportation / Photo-Video / Sound-Light /
   Campus Tour (start-point only) / Funding-Purchase / F&B (food+water)
                   |
   Each manager: approve + assign staff, or resubmit-with-comment.
   Departments CANNOT reject — only the earlier single-actor stages
   (HOS/HOD, F&B, CFO) can end a proposal outright. A department's only
   way to push back is resubmit-with-comment.
   (a resubmit on one department does not affect the others' progress)
                   |
   Once approved + staff assigned, the assigned staff marks the task
   'preparing' when they start working it, then 'completed' when done.
   ('preparing' sits between 'approved' and 'completed' — makes
   in-progress work visible instead of jumping straight to done.)
                   |
   F&B's task specifically:
     F&B approves -> creates 1..N request_fmb_selection rows
     (cafeteria + real menu item from that cafeteria's "My Menu" + qty),
     one per cafeteria the food is split across
                   |
     EACH selection row's Cafeteria Manager independently:
       - approves -> row enters Cafeteria Staff SHARED INBOX for that
         cafeteria (assignment_mode='shared_pool'; first staff to claim
         it via task_assignment owns it, it leaves everyone else's inbox)
       - resubmits -> row status becomes 'resubmitted', goes back to F&B
         with the manager's comment. F&B edits (dish, quantity, or
         switches to a different cafeteria) or cancels JUST THAT ROW.
         Editing does not require a fresh "approve" click — saving the
         edit re-sends the row straight to whichever cafeteria is now
         on it (same one if unchanged, the new one if F&B switched it).
         Other selection rows for the same request_fmb are untouched.
                   |
   All department tasks reach a terminal state (`completed` or
   `cancelled`; F&B's task is terminal once all its selection rows are
   `fulfilled`/`cancelled`) --> completed_approved
```

### `request.status` values (server-computed, authoritative)

`draft`, `submitted`, `hos_hod_review`, `fmb_review`, `cfo_review`,
`department_review`, `resubmission_required`, `completed_approved`,
`completed_rejected`, `cancelled`

This splits the schema's single `high_pax_review` value into two —
`fmb_review` and `cfo_review` — since they're sequential sub-stages with
independent resume points (§3 diagram), not one combined stage. The
`ems_database_schema.sql` CHECK constraint needs updating to match when
implementation reaches that file.

`resubmission_required` applies only during the single-actor sequential
stages (hos_hod_review / fmb_review / cfo_review). During
`department_review`, `request.status` stays `department_review` even if
one department resubmits — that department's own resubmission lives in
its `request_task.status`, not on the parent request.

`resumeStage` (carried on the request, same concept as the existing
frontend's `ProposalWorkflowState.resumeStage`) tracks exactly which
stage an applicant resubmission resumes at — `hos_hod_review`,
`fmb_review`, or `cfo_review` — never re-entering a stage that already
approved earlier in the same chain.

### `request_task.status` (per department — CORRECTED from schema)

`pending`, `approved`, `resubmitted`, `preparing`, `completed`, `cancelled`

Two deviations from the schema as written: `rejected` is removed —
departments cannot reject a proposal outright, only the earlier
single-actor stages (HOS/HOD, F&B, CFO) can end a proposal that way; a
department's only pushback is resubmit-with-comment. `preparing` is new —
it sits between `approved` (manager approved + assigned staff) and
`completed` (staff marked the work done), so the assigned staff can mark
the task as actively being worked before marking it complete. The
`ems_database_schema.sql` `chk_task_status` CHECK constraint needs
updating to match when implementation reaches that file.

### `request_fmb_selection.status` (NEW column, per-selection lifecycle)

`pending`, `approved`, `resubmitted`, `preparing`, `fulfilled`, `cancelled`

`preparing` mirrors `request_task`'s new status: set once a Cafeteria
Staff member claims the row from the shared inbox and starts working it,
before marking it `fulfilled`.

Every transition writes a `workflow_history` row (action, actor, previous
status, new status, comment, timestamp). Authorization for who can act on
a given task is computed server-side from `request_task.assigned_role`
compared against the acting user's actual role — never trusted from the
client request body.

## 4. Angular Frontend Changes

### Roles (`core/auth/auth.models.ts`, `mock-users.ts`, `role-navigation.ts`)

- Merge `FmbReviewer` + `FmbManager` -> single `Fmb` role (`'fmb'`). This
  role now owns: high-pax review, F&B request review (food+water
  together), and the Mineral Water Logo/Normal + Dietary Information
  manager dropdowns (Campus Tour dropdowns stay with Student Services).
- Remove `FmbWaterServicesStaff` entirely.
- Keep `ExternalUser`, `ClubPresident`, `StudentServicesManager`,
  `StudentServicesMember` as-is.
- Update role labels, nav sections, and any role-gated guards/permissions
  referencing the removed/merged roles.

### `core/departments/department-workflow.config.ts`

- Remove `waterLogo` / `waterNormal` as independent `DepartmentRequestKind`
  entries with their own manager/staff workflow config — fold them as line
  items under the `fmb` kind's task.
- Remove `campusTour`'s area/map sub-handling; keep start-point only.
- `optionKindsForManager('fmb')` now returns
  `['fmb', 'servingUnit', 'dietaryInformation', 'waterLogo', 'waterNormal']`
  (F&B role manages all of these dropdown pages; `waterLogo`/`waterNormal`
  remain reusable *option* lookup tables even though their *requests* no
  longer get a separate department-review task).

### `core/proposals/proposal-status.models.ts`

Per the "server owns workflow" decision: this file is trimmed to types
and pure display helpers only (`ProposalStage` enum matching §3's status
values, `stageLabel()`, `isReviewerStage()` for UI badge rendering). The
transition functions (`applyReviewerApproval`, `applyDepartmentConfirmation`,
`applyReviewerResubmit`, etc.) are deleted from Angular — that logic now
lives only in the Express server's `workflow.service.js`.

### Repository collapse (`*.repository.ts` files)

`proposal-workflow`, `request-options`, `admin-directory`, `staff-tasks`
already have a working Mock/Api dual-class + InjectionToken pattern. Since
the mock server is now the real authority (not a client-side duplicate),
collapse each pair down to a single Api-backed repository calling the real
`/api/*` endpoints. Remove the now-meaningless `useMock*` environment
flags (or leave them declared but hardcoded `false` — decide during
implementation based on whether any test relies on true-mock mode).

### New Api-backed domains (previously pure client-side, no HTTP)

Extend the same pattern to: `auth` (login/session), `events` (published
events, registration, saved events, notification preferences),
`system-config` (the 3 admin settings), and `image-upload` (real upload
endpoint instead of client-side base64 data URL, though the mock server
may still just store the data URL server-side rather than real file
storage — file/attachment storage is explicitly flagged as unresolved in
system.md §8).

### Component-level updates

- Reviewer/department view components (`proposal-reviewer-view`,
  `proposal-department-view`) updated for new stage values and the F&B
  self-review skip / CFO-after-F&B pairing display.
- New Cafeteria Manager UI surface: approve/resubmit acts on an individual
  `request_fmb_selection` row, not the whole F&B task — needs a per-row
  action UI where today's `proposal-department-view` assumes one
  action per department task.
- Campus Tour request form and manager dropdown pages: remove Tour Area /
  Campus Map fields.
- Inbox/Ongoing/History filtering logic (wherever `roleOwnsWorkflowAction`
  is used) updated for the merged F&B role and the new per-selection
  Cafeteria Manager ownership check.

## 5. Mock Backend Server

Node.js + Express, plain JS (no TS build step), run alongside `ng serve`
via the Angular dev-server proxy.

```
fyp-ui/
  server/
    db.js                    <- aggregates all seed modules into one
                                 in-memory db object, one property per
                                 table (51 tables)
    db/
      seed-users.js            (users, staff, student, unit, unit_users,
                                 clubs, student_clubs)
      seed-cafeteria.js        (cafeteria, cafeteria_assignment)
      seed-options.js          (all manager-configured option tables,
                                 incl. event_category, event_requirements)
      seed-requests.js         (request + all snapshot/support tables —
                                 co_owners, organizers, important_people,
                                 general_guest, event_schedule,
                                 brief_agenda, request_discussion_topics,
                                 request_categories,
                                 application_requirements, and all
                                 request_<department> snapshot tables)
      seed-workflow.js         (request_task, task_assignment,
                                 workflow_history — consistent with each
                                 seeded request's actual state)
      seed-registrations.js    (event_registration, saved_event)
      seed-config.js           (config: HIGH_PAX_THRESHOLD=50,
                                 CANCELLATION_DEADLINE_DAYS=3,
                                 MAX_EVENT_CATEGORIES=2)
    services/
      workflow.service.js      <- the §3 state machine: computeNextState(),
                                   authorizeAction(), applyAction() as
                                   pure-ish functions operating on the
                                   in-memory db; called by request routes,
                                   never duplicated in a route handler
      request.service.js
      request-option.service.js
      admin-directory.service.js
      staff-task.service.js
      auth.service.js
      event.service.js
      config.service.js
    routes/
      <one Express router per domain>, mounted under /api/*, matching the
      existing Api*Repository contracts exactly for the 4 domains that
      already define them, plus new routes designed for auth/events/
      config/registration/image-upload
    app.js                    <- express app: cors, json body parsing,
                                 mounts all routers
    index.js                  <- starts the http server (port 4000)
  proxy.conf.json              <- /api/* -> http://localhost:4000
  angular.json                  <- wire proxyConfig into the serve target
  package.json                   <- "server" script (node server/index.js),
                                    "dev" script (concurrently: server +
                                    ng serve)
```

### Behavior

- **In-memory only.** Loaded fresh from the seed modules at startup;
  resets to known-good seed state on every restart. No disk writes.
- **No artificial latency or injected errors** — immediate, reliable
  responses. Async/Promise-shaped throughout so swapping the in-memory
  store for a real DB client later is a drop-in change, not a rewrite.
- **Auto-incrementing integer IDs** per table, mimicking `BIGSERIAL`.
- **All business logic lives in `services/`, never in route handlers.**
  Routes parse/validate the request shape, call a service function, return
  its result.
- **Mock-only auth addition:** the schema has no password column. The
  server seed adds a `password` field to seeded user records purely for
  mock login purposes (flagged as a mock-only deviation, not a schema
  change) — real auth/hashing is out of scope per system.md.

### Seed data coverage (realistic mixed states, not "everything approved")

At minimum, the seed includes:
- A plain low-pax proposal mid-`hos_hod_review`.
- A high-pax proposal mid-`fmb_review` (not yet reached CFO).
- A high-pax proposal mid-`cfo_review` (F&B already approved, CFO pending).
- A high-pax proposal where CFO resubmitted and it resumed at `cfo_review`
  after the applicant's fix (demonstrates F&B is skipped on resume).
- A HOS/HOD self-application that skipped straight to F&B review.
- An applicant-is-CFO application that skipped straight to
  `department_review`.
- A `department_review` proposal with 2 of 4 department tasks approved+
  assigned, 1 still pending, 1 resubmitted-with-comment.
- An F&B request with 2 `request_fmb_selection` rows: one approved and
  claimed by a Cafeteria Staff member (in their ongoing, out of the shared
  inbox), one resubmitted back to F&B awaiting an edit.
- A fully `completed_approved` proposal with full task/history trail.
- A `completed_rejected` proposal (rejected at `hos_hod_review`).
- A `cancelled` proposal (cancelled by applicant before the deadline).
- 2-3 `draft` proposals never submitted.
- At least one event with `registration_approval='manual'` and a pending
  registration sitting in the organizer's inbox.
- Enough manager-option rows (logistics, transportation, photo/video,
  sound/light, campus tour start points, F&B menu items across 2+
  cafeterias, dietary info, serving units, water logo/normal, funding
  main+sub) that every dropdown in the Angular app has real choices.

## 6. Out of Scope

- Real authentication/hashing/session security (mock password field only).
- Real file/attachment storage (data URLs or server-side stored data URLs
  stand in — system.md §8 already flags this as an unresolved future
  need).
- Notifications, reporting/analytics, audit log retention policy, time
  zone handling, draft autosave UX — all explicitly listed as future
  additions in system.md §8, not part of this pass.
- Porting the schema to MySQL — stays PostgreSQL-flavored DDL as written.
