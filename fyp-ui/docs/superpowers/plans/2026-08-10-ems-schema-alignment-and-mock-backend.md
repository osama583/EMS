# EMS Schema Alignment + Mock Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the EMS source-of-truth docs, align the Angular frontend's roles/models/workflow logic to match, and build a Node/Express mock backend (in-memory `db.js` + service layer + REST API covering all 51 schema tables) so the whole system can be exercised end-to-end before a real database/backend exists.

**Architecture:** Four sequential phases. Phase 1 patches the two source-of-truth files (`system.md`, `ems_database_schema.sql`) to reflect decisions made in the design session. Phase 2 updates Angular's role enum, department-workflow config, and proposal state model to match, and collapses/extends the existing Mock/Api dual-repository pattern. Phase 3 builds the Express mock server from scratch: seed data across 51 tables, a workflow service owning all transition logic server-side, and REST routers matching the Angular `Api*Repository` contracts exactly. Phase 4 wires the dev-server proxy, flips the frontend to call the real server, and verifies the seeded workflow states render correctly end-to-end.

**Tech Stack:** Angular 21 (standalone components, signals, `HttpClient`), RxJS 7.8, TypeScript 5.9, Vitest (existing test runner — confirmed via `package.json` `"test": "ng test"` using `@angular/build`, with `vitest` as devDependency). Node.js + Express (new, plain JavaScript, no TS build step) for the mock server.

## Global Constraints

- Every code identifier for the food/beverage domain uses the token `fmb` (not `fnb`); every user-facing label reads "F&B" — never "FNB" or "Fmb" in UI text.
- `request.status`, `request_task.status`, and `request_fmb_selection.status` values are exactly as enumerated in the design spec (`docs/superpowers/specs/2026-08-10-ems-schema-alignment-and-mock-backend-design.md`) — do not invent additional values.
- The mock server is in-memory only: reset to seed state on every restart, no disk writes for mutations.
- No artificial network latency or injected errors in the mock server — immediate, reliable responses.
- All workflow transition logic (next-stage computation, authorization) lives server-side in `server/services/workflow.service.js`. Angular never computes the next stage or decides who can act — it sends an action and renders whatever state comes back.
- Primary keys are surrogate integers everywhere (auto-incrementing per table in the mock server), matching `BIGSERIAL` in the real schema.
- Follow existing code conventions: readonly interface properties, `Observable`-returning repository methods, Angular signals for reactive service state, one responsibility per file.

---

## Phase 1: Source-of-Truth Corrections

These tasks patch `cloud/system_logic/system.md` and `cloud/system_logic/ems_database_schema.sql` so they reflect every decision made in the design session (spec §2 and the two follow-up corrections). No Angular or server code changes happen in this phase — it's pure documentation/schema-file editing, verified by re-reading the files, not by running tests.

### Task 1.1: Correct `ems_database_schema.sql` — roles, F&B rename, water/campus-tour restructuring, new status columns

**Files:**
- Modify: `cloud/system_logic/ems_database_schema.sql`

**Interfaces:**
- Consumes: nothing (first task in the plan).
- Produces: the corrected DDL text that Phase 3's seed data and Phase 2's Angular models must match exactly — table names `fmb_options`, `request_fmb`, `request_fmb_id`, `request_fmb_selection`, `request_fmb_selection_id`, `fmb_option_id`; `users.role` CHECK values including `student_services_manager`, `student_services_member`, `external_user`, `club_president`, `fmb` (not `fnb`); `request.status` CHECK values `draft`, `submitted`, `hos_hod_review`, `fmb_review`, `cfo_review`, `department_review`, `resubmission_required`, `completed_approved`, `completed_rejected`, `cancelled`; `request_task.status` (`chk_task_status`) CHECK values `pending`, `approved`, `resubmitted`, `preparing`, `completed`, `cancelled` (no `rejected`); new `request_fmb_selection.status` column with CHECK values `pending`, `approved`, `resubmitted`, `preparing`, `fulfilled`, `cancelled`.

- [ ] **Step 1: Update the `users` table's role CHECK constraint**

Open `cloud/system_logic/ems_database_schema.sql`. Find the `CREATE TABLE users` block (currently lines 64-81). Replace the `chk_users_role` CHECK constraint's value list. The current text is:

```sql
    CONSTRAINT chk_users_role CHECK (role IN (
        'student','staff','hos_hod','cfo','fnb',
        'logistics_manager','logistics_staff',
        'transportation_manager','transportation_staff',
        'photo_video_manager','photo_video_staff',
        'sound_light_manager','sound_light_staff',
        'cafeteria_admin','cafeteria_manager','cafeteria_staff',
        'system_admin'
    ))
```

Replace it with:

```sql
    CONSTRAINT chk_users_role CHECK (role IN (
        'student','staff','hos_hod','cfo','fmb',
        'logistics_manager','logistics_staff',
        'transportation_manager','transportation_staff',
        'photo_video_manager','photo_video_staff',
        'sound_light_manager','sound_light_staff',
        'student_services_manager','student_services_member',
        'cafeteria_admin','cafeteria_manager','cafeteria_staff',
        'external_user','club_president',
        'system_admin'
    ))
```

- [ ] **Step 2: Rename F&B tables and columns throughout the file**

Using find-and-replace across the whole file (careful with word boundaries — `fnb` should only match as a whole token, not inside unrelated words; there are none in this file, so a plain text replace of `fnb` → `fmb` is safe), replace every occurrence of `fnb` with `fmb`. This covers:

- `CREATE TABLE fnb_options` → `CREATE TABLE fmb_options` (and its `fnb_option_id` PK → `fmb_option_id`)
- `CREATE TABLE request_fnb` → `CREATE TABLE request_fmb` (and `request_fnb_id` PK → `request_fmb_id`)
- `CREATE TABLE request_fnb_selection` → `CREATE TABLE request_fmb_selection` (and `request_fnb_selection_id` PK → `request_fmb_selection_id`, its FK column `request_fnb_id` → `request_fmb_id`, and its FK column `fnb_option_id` → `fmb_option_id`)
- Every `REFERENCES fnb_options(fnb_option_id)` → `REFERENCES fmb_options(fmb_option_id)`
- Every `REFERENCES request_fnb(request_fnb_id)` → `REFERENCES request_fmb(request_fmb_id)`
- Comment text mentioning "F&B" stays as-is (already correct); comment text mentioning lowercase "fnb" gets updated to "fmb" or "F&B" as grammatically appropriate.

Also update the header comment block (lines 1-57) wherever it says `fnb_options`, `request_fnb`, etc., to match.

- [ ] **Step 3: Add `status` column to `request_fmb_selection` (post-rename name)**

Find the `CREATE TABLE request_fmb_selection` block (post-rename; originally `request_fnb_selection` at lines 457-465). Current structure after Step 2's rename:

```sql
CREATE TABLE request_fmb_selection (
    request_fmb_selection_id  BIGSERIAL PRIMARY KEY,
    request_fmb_id                BIGINT NOT NULL REFERENCES request_fmb(request_fmb_id),
    cafeteria_id                      BIGINT NOT NULL REFERENCES cafeteria(cafeteria_id),
    fmb_option_id                         BIGINT NOT NULL REFERENCES fmb_options(fmb_option_id),
    menu_item_label                           VARCHAR(150) NOT NULL,  -- snapshot of fmb_options.label at pick time
    quantity                                       INTEGER NOT NULL,
    notes                                                TEXT
);
```

Add a `status` column before `notes`:

```sql
CREATE TABLE request_fmb_selection (
    request_fmb_selection_id  BIGSERIAL PRIMARY KEY,
    request_fmb_id                BIGINT NOT NULL REFERENCES request_fmb(request_fmb_id),
    cafeteria_id                      BIGINT NOT NULL REFERENCES cafeteria(cafeteria_id),
    fmb_option_id                         BIGINT NOT NULL REFERENCES fmb_options(fmb_option_id),
    menu_item_label                           VARCHAR(150) NOT NULL,  -- snapshot of fmb_options.label at pick time
    quantity                                       INTEGER NOT NULL,
    status                                             VARCHAR(20) NOT NULL DEFAULT 'pending',
    notes                                                TEXT,
    CONSTRAINT chk_fmb_selection_status CHECK (
        status IN ('pending','approved','resubmitted','preparing','fulfilled','cancelled')
    )
);
```

- [ ] **Step 4: Drop Campus Tour Area/Map tables and columns**

Find and delete the entire `CREATE TABLE campus_tour_area_options` block and the entire `CREATE TABLE campus_tour_map_options` block (originally lines 253-271).

Find the `CREATE TABLE request_campus_tour` block (originally lines 467-482). Current structure:

```sql
CREATE TABLE request_campus_tour (
    request_campus_tour_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    date                             DATE NOT NULL,
    start_time                           TIME NOT NULL,
    end_time                                 TIME NOT NULL,
    location                                     VARCHAR(200) NOT NULL,
    pax                                              INTEGER NOT NULL,
    start_point_option_id                                BIGINT REFERENCES campus_tour_start_options(campus_tour_start_option_id),
    start_point                                              VARCHAR(150) NOT NULL,
    tour_area_option_id                                          BIGINT REFERENCES campus_tour_area_options(campus_tour_area_option_id),
    tour_area                                                        VARCHAR(150),   -- nullable: drop if you trim to Starting-Point-only
    campus_map_option_id                                                 BIGINT REFERENCES campus_tour_map_options(campus_tour_map_option_id),
    campus_map                                                               VARCHAR(150),   -- nullable, same reason
    notes                                                                        TEXT
);
```

Replace with:

```sql
CREATE TABLE request_campus_tour (
    request_campus_tour_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    date                             DATE NOT NULL,
    start_time                           TIME NOT NULL,
    end_time                                 TIME NOT NULL,
    location                                     VARCHAR(200) NOT NULL,
    pax                                              INTEGER NOT NULL,
    start_point_option_id                                BIGINT REFERENCES campus_tour_start_options(campus_tour_start_option_id),
    start_point                                              VARCHAR(150) NOT NULL,
    notes                                                        TEXT
);
```

- [ ] **Step 5: Update `request.status` CHECK constraint**

Find the `CREATE TABLE request` block's `chk_request_status` constraint (originally lines 359-364):

```sql
    CONSTRAINT chk_request_status CHECK (status IN (
        'draft','submitted','hos_hod_review','high_pax_review',
        'department_review','resubmission_required',
        'completed_approved','completed_rejected','cancelled'
    ))
```

Replace with:

```sql
    CONSTRAINT chk_request_status CHECK (status IN (
        'draft','submitted','hos_hod_review','fmb_review','cfo_review',
        'department_review','resubmission_required',
        'completed_approved','completed_rejected','cancelled'
    ))
```

Also update the trailing comment below that block (originally "status = 'resubmission_required' only applies during the single-actor sequential stages...") to read:

```sql
-- status = 'resubmission_required' only applies during the single-actor
-- sequential stages (hos_hod_review / fmb_review / cfo_review). During
-- department_review, status STAYS 'department_review' even if one
-- department resubmits — that department's own resubmission lives in its
-- request_task row, not here.
--
-- fmb_review and cfo_review are sequential, not concurrent: F&B reviews
-- first, and only on F&B's approval does the request move to cfo_review.
-- If CFO resubmits, the request resumes at cfo_review (not fmb_review) —
-- F&B's approval-level review for this proposal is permanently done once
-- given.
```

- [ ] **Step 6: Update `request_task`'s `chk_task_status` CHECK constraint**

Find the `CREATE TABLE request_task` block (originally lines 638-655). Current constraint:

```sql
    CONSTRAINT chk_task_status CHECK (
        status IN ('pending','approved','resubmitted','rejected','completed','cancelled')
    )
```

Replace with:

```sql
    CONSTRAINT chk_task_status CHECK (
        status IN ('pending','approved','resubmitted','preparing','completed','cancelled')
    )
```

Add a comment directly above the `request_task` table (or adjust the existing section comment) noting: `-- Departments cannot reject a proposal outright — only the earlier`
`-- single-actor stages (hos_hod_review / fmb_review / cfo_review) can.`
`-- A department's only pushback is resubmit-with-comment. 'preparing'`
`-- means the assigned staff has started the work but not finished.`

- [ ] **Step 7: Update the file's header changelog comment block**

At the top of the file (lines 1-57), add a new dated changelog entry (append after the existing "CHANGES IN THIS VERSION" block, before the `-- ===` separator) summarizing this pass:

```sql
-- CHANGES IN THIS SESSION (schema alignment pass):
--   - Renamed every fnb_* identifier to fmb_* (fmb_options, request_fmb,
--     request_fmb_selection, etc.) — "F&B" is the correct APU term.
--   - users.role: added student_services_manager, student_services_member,
--     external_user, club_president; fnb -> fmb.
--   - request_fmb_selection gained a status column (own lifecycle,
--     independent of its parent request_task) — see chk_fmb_selection_status.
--   - Dropped campus_tour_area_options and campus_tour_map_options plus
--     their columns on request_campus_tour — Campus Tour is Starting
--     Point only.
--   - request.status: high_pax_review split into two sequential values,
--     fmb_review and cfo_review (see chk_request_status comment).
--   - request_task.status (chk_task_status): removed 'rejected' (only
--     hos_hod_review/fmb_review/cfo_review can reject — departments can
--     only approve or resubmit), added 'preparing'.
--   - water_logo_options / water_normal_options are UNCHANGED as
--     manager-configured option tables; what changed is only that their
--     REQUEST rows (request_mineral_water_logo / request_mineral_water_normal)
--     now attach to the SAME request_task as request_fmb (shared
--     request_task_id under stage_code='department_review'), not an
--     independent department-review task per requirement.
```

- [ ] **Step 8: Verify the file is internally consistent**

Re-read the entire file top to bottom. Confirm:
- No remaining occurrence of the literal string `fnb` (case-insensitive) anywhere.
- No remaining reference to `campus_tour_area_options` or `campus_tour_map_options`.
- Every `REFERENCES` clause points at a table/column that still exists in the file.
- The three CHECK constraints (`chk_users_role`, `chk_request_status`, `chk_task_status`) and the new `chk_fmb_selection_status` all have valid SQL syntax (matching parens, comma-separated quoted strings).

Run a search to confirm zero matches:

```bash
grep -ni "fnb" "cloud/system_logic/ems_database_schema.sql"
grep -n "campus_tour_area\|campus_tour_map" "cloud/system_logic/ems_database_schema.sql"
```

Expected: both commands print nothing.

- [ ] **Step 9: Commit**

```bash
git add "cloud/system_logic/ems_database_schema.sql"
git commit -m "docs: correct EMS schema — F&B rename, role additions, status enum fixes, Campus Tour trim"
```

(If this directory isn't a git repo yet, skip the commit and note it in your task completion summary — check with `git -C "cloud/system_logic" rev-parse --is-inside-work-tree` first, or `git -C . rev-parse --is-inside-work-tree` from the repo root if `cloud/system_logic` isn't its own repo.)

---

### Task 1.2: Correct `system.md` — resolve all open questions, update role table, workflow diagram, and database section

**Files:**
- Modify: `cloud/system_logic/system.md`

**Interfaces:**
- Consumes: the corrected schema from Task 1.1 (table/column names, CHECK values) — `system.md` must describe exactly what the schema now contains, no drift.
- Produces: the settled prose reference that Phase 2's Angular work and Phase 3's server work should match when in doubt about intent (though the schema file and the design spec at `docs/superpowers/specs/2026-08-10-ems-schema-alignment-and-mock-backend-design.md` are the more precise technical references).

- [ ] **Step 1: Update §2 Roles table**

Find the roles table (currently lines 46-64). Update these rows:

Replace the CFO row's mention of F&B partner and the F&B row entirely. Current F&B row:

```
| F&B | Yes | Two duties: (1) high-pax reviewer alongside CFO; (2) reviews F&B/Cafeteria requirement requests, picks a cafeteria + specific menu item to fulfil them. Also manages the Mineral Water (Logo/Normal) and Dietary Information dropdowns. Self-applications skip straight to department review. |
```

Replace with:

```
| F&B | Yes | One merged role (previously split into "F&B Reviewer" and "FMB Manager" in an earlier draft — that split was a mistake). Three duties: (1) reviews high-pax applications first, sequentially before CFO; (2) reviews F&B/Cafeteria requirement requests (food AND Mineral Water together as one task), picks a cafeteria + specific menu item(s) to fulfil them, can split one request across multiple cafeterias; (3) manages the Mineral Water (Logo/Normal) and Dietary Information dropdowns. Self-applications skip straight to department review. |
```

Update the CFO row to clarify sequencing:

```
| CFO | Yes | Reviews high-pax applications (pax > `HIGH_PAX_THRESHOLD`), sequentially AFTER F&B has approved — not concurrently. Self-applications skip straight to department review. |
```

Delete the "Logistics Staff" through "Sound & Light Staff" rows' text is unchanged — no edits needed there.

Find and delete this row entirely (the F&B Water Services Staff role no longer exists):

Search for any row mentioning "Water Services Staff" and delete it. (The current table doesn't have this exact row per the read-through in the design session, but if a similar row exists after re-reading, delete it — water fulfilment now goes through Cafeteria Staff's shared inbox, same as food.)

Update the Student Services rows — search for `*(role gap`-style markers in the Dropdown Settings table (§5.D) referencing "role gap — see §2" for Campus Tour dropdowns, and replace with `Student Services Manager` once §2 confirms the role (see Step 2).

Add two new rows to the roles table (after the "F&B" row), matching the frontend's existing `ExternalUser`/`ClubPresident` roles:

```
| Student Services Manager | Yes | Manages the Campus Tour Starting Points dropdown; reviews Campus Tour department-review requests, approves + assigns Student Services Member staff, or resubmits with comment. |
| Student Services Member | No | Views and handles assigned Campus Tour tasks + history only. |
| Club President | Yes | Same applicant capabilities as Student/Staff, representing a student club/society. |
| External User | No | Public/guest account — can explore, register for, and save public events, but cannot submit proposals. |
```

- [ ] **Step 2: Delete the "Open gap" callout under the roles table**

Find and delete this block (currently lines 66-70):

```
**⚠️ Open gap:** the Dropdown Settings field doc names a **"Student
Services Manager"** as the owner of the Campus Tour dropdowns. This role
doesn't exist anywhere else in the confirmed role list — it was never
added. Needs a decision: is this actually a distinct 18th role, or is it
one of the existing roles under a different label?
```

This is resolved — Step 1 already added Student Services Manager to the roles table.

- [ ] **Step 3: Rewrite §4 Approval Workflow diagram and prose**

Replace the entire §4 section (currently lines 86-166) with:

```markdown
## 4. Approval Workflow

\`\`\`
Applicant submits
      |
      v
[Applicant is HOS/HOD of their own unit?] --yes--> skip to high-pax check
      | no
      v
HOS/HOD of applicant's unit reviews (approve / reject / resubmit)
      | (approved)
      v
[Applicant is CFO or F&B?] --yes--> skip straight to DEPARTMENT REVIEW
      | no
      v
total_pax > HIGH_PAX_THRESHOLD?
      |                              |
     yes                             no
      |                              |
      v                              |
F&B reviews (approve/reject/         |
  resubmit — single-actor, same      |
  as HOS/HOD)                        |
      | (approved)                   |
      v                              |
CFO reviews (approve/reject/         |
  resubmit). If CFO resubmits,       |
  resumes at CFO on re-submission —  |
  F&B is NOT re-reviewed.            |
      | (approved)                   |
      +---------------+--------------+
                       v
        DEPARTMENT REVIEW — one task per
        selected requirement, running in
        PARALLEL, fully independent
                       |
      +----------------+-------------------+
      v                v                   v
  Logistics       Transportation        ... (each requirement's own
  Manager          Manager               manager approves + assigns
  approves+                              staff, or resubmits with
  assigns staff                          comment — departments CANNOT
                                          reject outright)
      |
      v
  Assigned staff marks the task 'preparing' when started,
  'completed' when done
\`\`\`

**F&B / Cafeteria is a longer sub-chain, not a single step:**
\`\`\`
F&B reviews the food + Mineral Water request together (one task) ->
    picks a cafeteria + real menu item(s) — can split across MULTIPLE
    cafeterias, creating one selection row per cafeteria
      |
      v
EACH selection row's Cafeteria Manager independently reviews:
  - approve -> row enters Cafeteria Staff SHARED INBOX for that cafeteria
    (no one pre-assigned; visible to every staff member assigned to that
    cafeteria; first to claim it owns it, it then leaves everyone else's
    inbox and enters that person's ongoing/history)
  - resubmit -> goes back to F&B (NOT the applicant — F&B is the one who
    picked the specific cafeteria/dish). F&B edits the dish, quantity, or
    switches to a different cafeteria, or cancels — for THAT ROW ONLY.
    Saving the edit re-sends it straight to whichever cafeteria is now on
    it (same one if unchanged, a different one if F&B switched it) — no
    separate "re-approve" click needed. Other selection rows for the same
    request are untouched.
\`\`\`

**Self-application exceptions (confirmed):**
- Applicant IS the HOS/HOD of their own unit -> skip the HOS/HOD step,
  F&B reviews next (unconditionally, not gated by pax). If pax is also
  above the threshold, CFO still reviews after F&B, same as the normal
  high-pax path.
- Applicant is CFO or F&B -> skip **all** higher approval, straight to
  department review.

**Parallel independence (confirmed):** if one department resubmits back to
the applicant, the other departments' reviews continue unaffected — nothing
pauses except that one department's own task. (The F&B/Cafeteria chain's
per-selection-row resubmit is a further exception within F&B's own task —
see above; it goes back to F&B, not the applicant, and doesn't affect
other selection rows.)

**Departments cannot reject.** Only the single-actor sequential stages
(HOS/HOD, F&B, CFO) can reject and end a proposal outright. A department
manager's only pushback option is resubmit-with-comment.

**Staff assignment:** a manager assigns one or more available staff
(checked for no other overlapping assigned task at that time — this is a
query at assignment time, not a stored "availability calendar"). Once
assigned, staff mark their task 'preparing' when they start the work and
'completed' when finished.

**Cancellation:** applicant or designated co-owners can cancel up to
`CANCELLATION_DEADLINE_DAYS` before the event date. After that, the
application is read-only with respect to cancellation.

**Visibility (Inbox / Ongoing / History):**
- **Inbox / My Task** — it's currently this user's turn to act. Nothing
  else appears here; it is not a general "related to me" list.
- **Ongoing / Ingoing** — the user is involved (applicant, co-owner,
  previously acted, etc.) but it is *not* currently their turn. Read-only.
- **History** — completed (approved or rejected), and the user was
  involved. Applicants/approvers see the actual result either way.
  Department staff only ever see **approved** ones in history, since by
  the time it reaches them the decision has already been made.

**Registration (separate from the proposal-approval flow):** users can
explore, register for, and save public approved events. If
`registration_approval = 'manual'`, the applicant/organizer sees pending
registrations in their own inbox — including the registrant's name, email,
and a short (≤100 character) reason for attending.
```

- [ ] **Step 4: Update §5.D Manager Dropdown Settings table**

Find the table in §5.D (currently lines 244-260). Replace every `*(role gap — see §2)*` marker with `Student Services Manager`. Update the F&B rows to reflect the merged role — replace `F&B (FMB Manager)` with just `F&B` in the "Manager" column for the Mineral Water and Dietary Information rows.

- [ ] **Step 5: Rewrite §6 Database section for renamed/restructured tables**

In the "Manager-Configured Options" list (currently lines 285-299), rename `fnb_options` bullet to `fmb_options` and update its column list's `requirement_id` reference text if needed (no column names inside that bullet actually contain "fnb", so only the table name changes). Delete the two bullets for `campus_tour_area_options` and `campus_tour_map_options`.

In the "Request Core" list, no changes needed (no fnb references there).

In the "Request-Specific Department Data (snapshots)" list (currently lines 309-320): rename `request_fnb` bullet to `request_fmb` and `request_fnb_selection` bullet to `request_fmb_selection`, and add `status` to the `request_fmb_selection` column list. Update `request_campus_tour`'s column list to remove `tour_area_option_id, tour_area, campus_map_option_id, campus_map`.

In the "Workflow — Tasks, Assignments, History" list (currently lines 334-337), update `request_task`'s description to note its `status` values no longer include `rejected` and now include `preparing` (a one-line parenthetical is enough, e.g. `status (pending/approved/resubmitted/preparing/completed/cancelled — no 'rejected'; only hos_hod_review/fmb_review/cfo_review can reject)`).

- [ ] **Step 6: Replace §7 Open Questions with a "Resolved" section**

Replace the entire §7 (currently lines 344-360) with:

```markdown
## 7. Resolved Questions (settled in the schema-alignment design session)

All items previously listed here are now settled — see
`docs/superpowers/specs/2026-08-10-ems-schema-alignment-and-mock-backend-design.md`
in the `fyp-ui` project for the full design record. Summary:

- **Campus Tour structure**: Starting Point only. Tour Area and Campus Map
  were removed.
- **"Student Services Manager"** role: confirmed as a real, distinct role
  — added to §2 and the schema's `users.role` CHECK.
- **HOS/HOD self-review + high pax**: F&B reviews in place of HOS/HOD when
  applicant is HOS/HOD of their own unit; CFO still reviews after F&B if
  pax is also above threshold.
- **Cafeteria Manager's decision options**: approve or resubmit — but
  resubmit routes back to F&B (who picked the cafeteria/dish), not the
  applicant, and only affects that one selection row.
- **PK datatype**: surrogate integers (`BIGSERIAL`), confirmed — no UUID.
- **`event_visibility` / `event_format` / `registration_approval`**: fixed
  option lists (sourced from the Angular frontend's existing dropdowns),
  enforced via CHECK constraints rather than free text.
- **F&B naming**: "fnb" was a mistake — the correct term is "F&B"
  everywhere in prose; the code-safe token is `fmb`.
- **F&B role split**: `FmbReviewer`/`FmbManager` as two roles was a
  mistake — merged into one `fmb` role.
- **Mineral Water ownership**: not a separate department-review lane —
  reviewed by F&B together with food, as one task.
```

- [ ] **Step 7: Verify consistency**

Re-read the full file. Confirm no remaining occurrence of "fnb" (case-insensitive), no remaining "role gap" markers, no remaining references to Campus Tour Area/Map dropdowns.

```bash
grep -ni "fnb" "cloud/system_logic/system.md"
grep -n "role gap\|Tour Area\|Campus Map Information" "cloud/system_logic/system.md"
```

Expected: first command prints nothing; second command may still print legitimate mentions if any survive intentionally (there should be none after Step 4/5 — if it prints anything, go back and remove it).

- [ ] **Step 8: Commit**

```bash
git add "cloud/system_logic/system.md"
git commit -m "docs: resolve all open questions in system.md, correct workflow diagram and role table"
```

---

### Task 1.3: Regenerate `ems_mermaid_erd.mmd` to match the corrected schema

**Files:**
- Modify: `cloud/system_logic/ems_mermaid_erd.mmd`

**Interfaces:**
- Consumes: the corrected `ems_database_schema.sql` from Task 1.1 (exact table/column names).
- Produces: an ERD diagram file consistent with the schema — not consumed by any later task in this plan (Phase 2/3 read the SQL and spec directly), but must not be left stale since it's part of the source-of-truth package the user references.

- [ ] **Step 1: Read the current ERD file structure**

Read `cloud/system_logic/ems_mermaid_erd.mmd` in full to understand its existing per-table entity block format and relationship syntax (Mermaid `erDiagram` syntax: `TABLE_NAME { type column_name PK/FK }` blocks plus `TABLE_A ||--o{ TABLE_B : label` relationship lines).

- [ ] **Step 2: Apply the same renames as Task 1.1**

In the ERD file, rename every entity block and relationship line referencing `fnb_options` → `fmb_options`, `request_fnb` → `request_fmb`, `request_fnb_selection` → `request_fmb_selection`, and their PK/FK column names, matching Task 1.1 Step 2 exactly.

- [ ] **Step 3: Remove Campus Tour Area/Map entities**

Delete the `campus_tour_area_options` and `campus_tour_map_options` entity blocks and any relationship lines connecting them to `request_campus_tour` or `event_requirements`. Remove the corresponding `tour_area_option_id`/`campus_map_option_id` FK lines from `request_campus_tour`'s entity block.

- [ ] **Step 4: Add the new `status` field to `request_fmb_selection`'s entity block**

Add a `varchar status` line to the `request_fmb_selection` entity block (matching Task 1.1 Step 3's new column).

- [ ] **Step 5: Update the `users` entity block's role field comment (if the ERD documents allowed values)**

If the `users` entity block includes an inline comment listing allowed role values (check the file — Mermaid ER attribute comments use a trailing `"comment text"` after the column definition), update it to match Task 1.1 Step 1's new role list. If no such inline documentation exists in the ERD (likely, since Mermaid ERDs are usually just structure), skip this step.

- [ ] **Step 6: Verify the Mermaid syntax is still valid**

Read the full modified file. Confirm every relationship line references only entity names that still exist in the file (no dangling reference to a deleted `campus_tour_area_options` or old `fnb_options` name). Confirm brace pairing (`{` / `}`) is balanced for every entity block — count them:

```bash
grep -c "{" "cloud/system_logic/ems_mermaid_erd.mmd"
grep -c "}" "cloud/system_logic/ems_mermaid_erd.mmd"
```

Expected: both counts equal.

- [ ] **Step 7: Commit**

```bash
git add "cloud/system_logic/ems_mermaid_erd.mmd"
git commit -m "docs: regenerate ERD to match corrected schema (F&B rename, Campus Tour trim, new status column)"
```

---

## Phase 2: Angular Frontend Refactor

Corrects roles, department-workflow config, and the proposal state model to match Phase 1's schema. Deletes client-side workflow transition logic (server owns it — Phase 3). Collapses the 4 existing Mock/Api repository pairs to Api-only. Removes Campus Tour Area/Map from the UI. Adds the new per-selection F&B/Cafeteria review UI.

**Note on ordering:** these tasks are NOT fully independent — Task 2.1 (roles) must land before Task 2.2 (department config, which references role names), which must land before Task 2.3 (proposal-status.models, which imports UserRole and DepartmentRequestKind), and so on down the file. Execute in numeric order.

### Task 2.1: Merge F&B roles, remove water-staff role, rename role tokens

**Files:**
- Modify: `fyp-ui/src/app/core/auth/auth.models.ts:1-24` (the `UserRole` enum)
- Modify: `fyp-ui/src/app/core/auth/mock-users.ts` (full file)
- Modify: `fyp-ui/src/app/core/auth/role-navigation.ts` (full file)
- Test: `fyp-ui/src/app/core/auth/role-navigation.spec.ts` (create — none currently exists; add minimal coverage for the changed behavior)

**Interfaces:**
- Consumes: nothing new (this is the root of the role hierarchy).
- Produces: `UserRole.Fmb` (replaces `UserRole.FmbReviewer` and `UserRole.FmbManager`), with `UserRole.FmbWaterServicesStaff` deleted. Every other `UserRole` member is unchanged. This enum member name and every deleted member's absence is consumed by every subsequent task in Phase 2 and by Phase 3's route/seed code (which must use the string value `'fmb'`).

- [ ] **Step 1: Update the `UserRole` enum**

In `fyp-ui/src/app/core/auth/auth.models.ts`, replace:

```typescript
export enum UserRole {
  ExternalUser = 'external-user',
  Applicant = 'applicant',
  ClubPresident = 'club-president',
  HosHod = 'hos-hod',
  Cfo = 'cfo',
  FmbReviewer = 'fmb-reviewer',
  FmbManager = 'fmb-manager',
  CafeteriaManager = 'cafeteria-manager',
  CafeteriaStaff = 'cafeteria-staff',
  CafeteriaAdmin = 'cafeteria-admin',
  LogisticsManager = 'logistics-manager',
  LogisticsStaff = 'logistics-staff',
  StudentServicesManager = 'student-services-manager',
  StudentServicesMember = 'student-services-member',
  FmbWaterServicesStaff = 'fmb-water-services-staff',
  AvManager = 'av-manager',
  AvTechnician = 'av-technician',
  PhotographyManager = 'photography-manager',
  PhotographyStaff = 'photography-staff',
  TransportManager = 'transport-manager',
  TransportStaff = 'transport-staff',
  SystemAdmin = 'system-admin',
}
```

with:

```typescript
export enum UserRole {
  ExternalUser = 'external-user',
  Applicant = 'applicant',
  ClubPresident = 'club-president',
  HosHod = 'hos-hod',
  Cfo = 'cfo',
  Fmb = 'fmb',
  CafeteriaManager = 'cafeteria-manager',
  CafeteriaStaff = 'cafeteria-staff',
  CafeteriaAdmin = 'cafeteria-admin',
  LogisticsManager = 'logistics-manager',
  LogisticsStaff = 'logistics-staff',
  StudentServicesManager = 'student-services-manager',
  StudentServicesMember = 'student-services-member',
  AvManager = 'av-manager',
  AvTechnician = 'av-technician',
  PhotographyManager = 'photography-manager',
  PhotographyStaff = 'photography-staff',
  TransportManager = 'transport-manager',
  TransportStaff = 'transport-staff',
  SystemAdmin = 'system-admin',
}
```

- [ ] **Step 2: Update `mock-users.ts` — merge role details, remove water-staff accounts, add an F&B account**

In `fyp-ui/src/app/core/auth/mock-users.ts`, replace the `roleDetails` record's `FmbReviewer`, `FmbManager`, and `FmbWaterServicesStaff` entries. Current:

```typescript
  [UserRole.FmbReviewer]: { label: 'F&B Manager (Reviewer)', department: 'Facilities Management and Business Services' },
  [UserRole.FmbManager]: { label: 'FMB Manager', department: 'Facilities Management and Business Services' },
```

and (further down in the same object):

```typescript
  [UserRole.FmbWaterServicesStaff]: { label: 'FMB Water Services Staff', department: 'Facilities Management and Business Services' },
```

Replace both with a single entry (positioned where `FmbReviewer` was) — delete the `FmbWaterServicesStaff` line entirely:

```typescript
  [UserRole.Fmb]: { label: 'F&B', department: 'Food & Beverage Services' },
```

Then update `MOCK_AUTH_USERS`. Replace these two lines:

```typescript
  account('fmb.reviewer@demo.apu.edu.my', 'F&B Manager (Reviewer) Demo', UserRole.FmbReviewer),
  account('fmb.manager@demo.apu.edu.my', 'FMB Manager', UserRole.FmbManager),
```

with one:

```typescript
  account('fmb@demo.apu.edu.my', 'F&B Demo', UserRole.Fmb),
```

Delete these two lines entirely (no replacement — the role no longer exists):

```typescript
  account('fmb.water.staff@demo.apu.edu.my', 'Raj Kumar (FMB Water Staff)', UserRole.FmbWaterServicesStaff),
  account('fmb.water.staff2@demo.apu.edu.my', 'Daniel Wong (FMB Water Logistics)', UserRole.FmbWaterServicesStaff),
```

- [ ] **Step 3: Update `role-navigation.ts` — merge F&B nav, remove water-staff nav, fix `fnb`→`fmb` option key**

In `fyp-ui/src/app/core/auth/role-navigation.ts`:

In `OPTION_NAVIGATION` (the `Readonly<Record<RequestOptionKind, AuthNavigationItem>>`), replace:

```typescript
  fnb: item('My Menu', 'restaurant_menu', '/app/menu'),
```

with:

```typescript
  fmb: item('My Menu', 'restaurant_menu', '/app/menu'),
```

(This assumes Task 2.4 has already renamed `RequestOptionKind`'s `'fnb'` member to `'fmb'` — if executing tasks out of numeric order for any reason, this line will fail to typecheck until Task 2.4 lands. Execute in order to avoid this.)

In `ROLE_NAVIGATION`, replace:

```typescript
  [UserRole.FmbReviewer]: proposalRole('Event Proposals'),
  [UserRole.FmbManager]: managerRole(UserRole.FmbManager, 'service'),
```

with a single entry. Since the merged `Fmb` role now does BOTH proposal review (high-pax + F&B request review) AND manages dropdowns (Mineral Water, Dietary Information), it needs a navigation shape that's a hybrid of `proposalRole` and `managerRole` — neither existing helper fits alone. Add the entry by composing both:

```typescript
  [UserRole.Fmb]: (() => {
    const navigation = proposalRole('Event Proposals');
    return { ...navigation, sections: [...navigation.sections, dropdownSettings(UserRole.Fmb)] };
  })(),
```

(This mirrors the existing `UserRole.Cfo` entry's pattern exactly — CFO already does the same "reviewer nav + dropdown settings" composition.)

Delete this line entirely (no replacement):

```typescript
  [UserRole.FmbWaterServicesStaff]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.FmbWaterServicesStaff)] },
```

In `roleCanAccess`, replace:

```typescript
  if (cleanUrl === '/app/dropdown-options') return managerOptionKinds(role).some((kind) => kind !== 'fnb' && kind !== 'servingUnit');
```

with:

```typescript
  if (cleanUrl === '/app/dropdown-options') return managerOptionKinds(role).some((kind) => kind !== 'fmb' && kind !== 'servingUnit');
```

In `roleCanUseSavedEvents`, replace:

```typescript
export function roleCanUseSavedEvents(role: UserRole): boolean {
  return [
    UserRole.ExternalUser,
    UserRole.Applicant,
    UserRole.ClubPresident,
    UserRole.HosHod,
    UserRole.Cfo,
    UserRole.FmbReviewer,
    UserRole.FmbManager,
  ].includes(role);
}
```

with:

```typescript
export function roleCanUseSavedEvents(role: UserRole): boolean {
  return [
    UserRole.ExternalUser,
    UserRole.Applicant,
    UserRole.ClubPresident,
    UserRole.HosHod,
    UserRole.Cfo,
    UserRole.Fmb,
  ].includes(role);
}
```

- [ ] **Step 4: Write a navigation test covering the merged role**

Create `fyp-ui/src/app/core/auth/role-navigation.spec.ts`:

```typescript
import { UserRole } from './auth.models';
import { ROLE_NAVIGATION, roleCanAccess, roleCanUseSavedEvents } from './role-navigation';

describe('role-navigation', () => {
  it('gives the merged Fmb role both proposal-review nav and dropdown settings', () => {
    const navigation = ROLE_NAVIGATION[UserRole.Fmb];
    const sectionKeys = navigation.sections.map((section) => section.key);
    expect(sectionKeys).toContain('proposals');
    expect(sectionKeys).toContain('dropdown-settings');
  });

  it('has no navigation entry left for the removed FmbWaterServicesStaff role', () => {
    expect((UserRole as Record<string, string>)['FmbWaterServicesStaff']).toBeUndefined();
  });

  it('lets the Fmb role manage the My Menu route', () => {
    expect(roleCanAccess(UserRole.Fmb, '/app/menu')).toBe(true);
  });

  it('includes Fmb in roles that can use saved events, and excludes department staff roles', () => {
    expect(roleCanUseSavedEvents(UserRole.Fmb)).toBe(true);
    expect(roleCanUseSavedEvents(UserRole.LogisticsStaff)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the new test and confirm it passes; run the full test suite to catch compile errors from the rename**

```bash
cd "fyp-ui" && npx ng test --watch=false 2>&1 | tail -100
```

Expected: TypeScript compile errors will surface referencing `UserRole.FmbReviewer`, `UserRole.FmbManager`, `UserRole.FmbWaterServicesStaff` in every other file that still uses them (this is expected at this point in the plan — those files are fixed in later tasks of this phase). Confirm the error list only references files covered by Tasks 2.2 through 2.9 below (proposal-status.models.ts, proposal-status.models.spec.ts, department-workflow.config.ts, request-option.models.ts and friends, proposal-review.mock-data.ts, proposal-reviewer-view.ts, app.routes.ts if applicable). If an error appears in a file NOT in that list, note it — it means this survey missed a reference and the later task list needs an added step.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/auth/auth.models.ts src/app/core/auth/mock-users.ts src/app/core/auth/role-navigation.ts src/app/core/auth/role-navigation.spec.ts
git commit -m "refactor(auth): merge FmbReviewer+FmbManager into one Fmb role, remove FmbWaterServicesStaff"
```

(The build will not be green after this commit alone — that's expected and resolved by the end of Phase 2. Committing incrementally keeps the diff reviewable; do not run `ng build` as a gate until Task 2.9's final verification step.)

---

### Task 2.2: Merge Mineral Water into the F&B department kind, trim Campus Tour to start-point only

**Files:**
- Modify: `fyp-ui/src/app/core/departments/department-workflow.config.ts` (full file)

**Interfaces:**
- Consumes: `UserRole.Fmb` from Task 2.1.
- Produces: `DepartmentRequestKind` still includes `'waterLogo'` and `'waterNormal'` as request-detail table identifiers (Task 2.5's proposal form still lets applicants submit water requests as their own line items — only the department-review TASK grouping changes, not the applicant-facing requirement checklist), but `DEPARTMENT_WORKFLOWS` no longer has separate manager/staff entries for them — they're absorbed into the `fmb` config entry's `optionKinds`. `workflowForManager(UserRole.Fmb)` now returns one config object whose `optionKinds` includes `'fmb'`, `'dietaryInformation'`, `'waterLogo'`, `'waterNormal'`.

- [ ] **Step 1: Update `DEPARTMENT_WORKFLOWS`**

In `fyp-ui/src/app/core/departments/department-workflow.config.ts`, replace the full `DEPARTMENT_WORKFLOWS` array. Current:

```typescript
export const DEPARTMENT_WORKFLOWS: readonly DepartmentWorkflowConfig[] = [
  { managerRole: UserRole.LogisticsManager, staffRole: UserRole.LogisticsStaff, requestKinds: ['logistics'], optionKinds: ['logistics'], assignmentRequired: true },
  { managerRole: UserRole.StudentServicesManager, staffRole: UserRole.StudentServicesMember, requestKinds: ['campusTour'], optionKinds: ['campusTourStart', 'campusTourArea', 'campusTourMap'], assignmentRequired: true },
  { managerRole: UserRole.FmbManager, staffRole: UserRole.FmbWaterServicesStaff, requestKinds: ['waterLogo', 'waterNormal'], optionKinds: ['dietaryInformation', 'waterLogo', 'waterNormal'], assignmentRequired: true },
  { managerRole: UserRole.CafeteriaManager, requestKinds: ['fnb'], optionKinds: ['fnb', 'servingUnit'], assignmentRequired: false },
  { managerRole: UserRole.AvManager, staffRole: UserRole.AvTechnician, requestKinds: ['soundLight'], optionKinds: ['soundLight'], assignmentRequired: true },
  { managerRole: UserRole.PhotographyManager, staffRole: UserRole.PhotographyStaff, requestKinds: ['photoVideo'], optionKinds: ['photoVideo'], assignmentRequired: true },
  { managerRole: UserRole.TransportManager, staffRole: UserRole.TransportStaff, requestKinds: ['transportation'], optionKinds: ['transportation'], assignmentRequired: true },
  { managerRole: UserRole.Cfo, requestKinds: ['fundingPurchase'], optionKinds: ['fundingMain', 'fundingSub'], assignmentRequired: false },
];
```

Replace with:

```typescript
export const DEPARTMENT_WORKFLOWS: readonly DepartmentWorkflowConfig[] = [
  { managerRole: UserRole.LogisticsManager, staffRole: UserRole.LogisticsStaff, requestKinds: ['logistics'], optionKinds: ['logistics'], assignmentRequired: true },
  { managerRole: UserRole.StudentServicesManager, staffRole: UserRole.StudentServicesMember, requestKinds: ['campusTour'], optionKinds: ['campusTourStart'], assignmentRequired: true },
  { managerRole: UserRole.Fmb, requestKinds: ['fmb', 'waterLogo', 'waterNormal'], optionKinds: ['fmb', 'servingUnit', 'dietaryInformation', 'waterLogo', 'waterNormal'], assignmentRequired: false },
  { managerRole: UserRole.AvManager, staffRole: UserRole.AvTechnician, requestKinds: ['soundLight'], optionKinds: ['soundLight'], assignmentRequired: true },
  { managerRole: UserRole.PhotographyManager, staffRole: UserRole.PhotographyStaff, requestKinds: ['photoVideo'], optionKinds: ['photoVideo'], assignmentRequired: true },
  { managerRole: UserRole.TransportManager, staffRole: UserRole.TransportStaff, requestKinds: ['transportation'], optionKinds: ['transportation'], assignmentRequired: true },
  { managerRole: UserRole.Cfo, requestKinds: ['fundingPurchase'], optionKinds: ['fundingMain', 'fundingSub'], assignmentRequired: false },
];
```

Notes on this change:
- `fnb` renamed to `fmb` in `requestKinds`/`optionKinds` (Task 2.4 renames the underlying type).
- The `fmb` entry's `requestKinds` now includes `waterLogo`/`waterNormal` alongside `fmb` — this means `requestKindsForManager(UserRole.Fmb)` returns all three, so the F&B reviewer's UI (Task 2.7) sees all three requirement kinds grouped under one manager, matching the merged-task design.
- `staffRole` is omitted for the `fmb` entry (previously `FmbManager` had `FmbWaterServicesStaff`, now deleted) since fulfilment goes through Cafeteria Staff — a role NOT modeled in `DEPARTMENT_WORKFLOWS` today (Cafeteria Manager's entry has no `staffRole` either, for the same reason: Cafeteria Staff's shared-inbox claiming isn't a `staffRoleForManager` assignment, it's the separate shared-pool mechanism described in the design spec — this is intentionally out of scope for `department-workflow.config.ts`, which only models direct manager-assigns-staff relationships).
- `assignmentRequired: false` for the `fmb` entry, matching the existing `CafeteriaManager` entry — F&B doesn't directly assign a staff member; it picks a cafeteria/menu item instead.

- [ ] **Step 2: Verify `DepartmentRequestKind` and `RequestOptionKind` imports are still valid**

This file imports `RequestOptionKind` from `'../request-options/request-option.models'`. Task 2.4 renames that module's `'fnb'` type member to `'fmb'` — no import path changes here, just confirm after Task 2.4 lands that `'fmb'` (used above in `optionKinds: ['fmb', ...]`) typechecks against the updated `RequestOptionKind` union.

- [ ] **Step 3: Commit**

```bash
cd "fyp-ui" && git add src/app/core/departments/department-workflow.config.ts
git commit -m "refactor(departments): merge water requests into fmb config, trim campus tour to start-point"
```

---

### Task 2.3: Rewrite `proposal-status.models.ts` — new stage enum, delete transition logic, keep display helpers

**Files:**
- Modify: `fyp-ui/src/app/core/proposals/proposal-status.models.ts` (full rewrite)
- Modify: `fyp-ui/src/app/core/proposals/proposal-status.models.spec.ts` (full rewrite — old tests exercise deleted functions)

**Interfaces:**
- Consumes: `UserRole` from Task 2.1, `DepartmentRequestKind` from Task 2.2.
- Produces: `ProposalStage` enum with values `Submitted`, `HosHodReview`, `FmbReview`, `CfoReview`, `DepartmentReview`, `ResubmissionRequired`, `Approved`, `Rejected`, `Cancelled` (renamed/restructured from the old 7-value enum — see mapping below). `stageLabel(stage: ProposalStage): string`. `isReviewerStage(stage: ProposalStage): boolean`. The `ProposalWorkflowState` interface is simplified (no `departmentConfirmations` array shape change needed yet — Task 2.7 handles the F&B per-selection UI separately from this state shape). Every transition function (`initialWorkflowState`, `reviewerChainForPax`, `nextStageAfterApproval`, `applyReviewerApproval`, `applyReviewerRejection`, `applyReviewerResubmit`, `applyApplicantResubmit`, `applyDepartmentConfirmation`, `applyDepartmentResubmit`, `roleOwnsWorkflowAction`, `reviewerRoleForStage`) is DELETED — callers of these (Tasks 2.6, 2.7, 2.8) get their replacement logic from the server via `ProposalWorkflowService`/`ProposalWorkflowRepository`, not from client-side computation.

**Stage name mapping (old → new):**
| Old `ProposalStage` member | New `ProposalStage` member |
|---|---|
| `HosHodReview` | `HosHodReview` (unchanged) |
| `FmbReviewerPending` | `FmbReview` |
| `CfoReview` | `CfoReview` (unchanged) |
| `DepartmentReview` | `DepartmentReview` (unchanged) |
| `Approved` | `Approved` (unchanged) |
| `Rejected` | `Rejected` (unchanged) |
| `NeedsRevision` | `ResubmissionRequired` (renamed to match schema's `request.status` value `resubmission_required`) |
| *(none — new)* | `Submitted` (added: matches schema's `submitted` status, the brief window between form submit and the first review stage being assigned by the server) |
| *(none — new)* | `Cancelled` (added: matches schema's `cancelled` status — previously represented ad-hoc via `record.status === 'Cancelled'` string comparison in the repository's `patchStatus`, not as a stage) |

- [ ] **Step 1: Write the full replacement file**

Replace the entire contents of `fyp-ui/src/app/core/proposals/proposal-status.models.ts` with:

```typescript
// Pure, Angular-free types for the proposal approval chain. The actual state-transition
// logic (who can act, what happens next) lives server-side — see system.md's stated
// principle "the backend owns the workflow, not the frontend." This file only holds the
// shared vocabulary (stage names) and pure display helpers the UI needs to render whatever
// state the server returns.
export enum ProposalStage {
  Submitted = 'submitted',
  HosHodReview = 'hos-hod-review',
  FmbReview = 'fmb-review',
  CfoReview = 'cfo-review',
  DepartmentReview = 'department-review',
  ResubmissionRequired = 'resubmission-required',
  Approved = 'approved',
  Rejected = 'rejected',
  Cancelled = 'cancelled',
}

export interface DepartmentConfirmation {
  readonly department: string;
  readonly confirmed: boolean;
  readonly confirmedAt?: string;
  readonly confirmedBy?: string;
}

export interface ProposalWorkflowState {
  readonly stage: ProposalStage;
  readonly resumeStage?: ProposalStage;
  readonly reviewerComment?: string;
  readonly rejectedBy?: string;
  readonly rejectedReason?: string;
  readonly departmentConfirmations: readonly DepartmentConfirmation[];
}

export function isReviewerStage(stage: ProposalStage): boolean {
  return stage === ProposalStage.HosHodReview || stage === ProposalStage.FmbReview || stage === ProposalStage.CfoReview;
}

export function stageLabel(stage: ProposalStage): string {
  switch (stage) {
    case ProposalStage.Submitted: return 'Submitted';
    case ProposalStage.HosHodReview: return 'HOS/HOD review';
    case ProposalStage.FmbReview: return 'F&B review';
    case ProposalStage.CfoReview: return 'CFO review';
    case ProposalStage.DepartmentReview: return 'Department review';
    case ProposalStage.ResubmissionRequired: return 'Revision required';
    case ProposalStage.Approved: return 'Approved';
    case ProposalStage.Rejected: return 'Rejected';
    case ProposalStage.Cancelled: return 'Cancelled';
  }
}
```

- [ ] **Step 2: Write the replacement spec file**

Replace the entire contents of `fyp-ui/src/app/core/proposals/proposal-status.models.spec.ts` with:

```typescript
import { ProposalStage, isReviewerStage, stageLabel } from './proposal-status.models';

describe('proposal-status.models', () => {
  it('labels every stage with a human-readable string', () => {
    expect(stageLabel(ProposalStage.Submitted)).toBe('Submitted');
    expect(stageLabel(ProposalStage.HosHodReview)).toBe('HOS/HOD review');
    expect(stageLabel(ProposalStage.FmbReview)).toBe('F&B review');
    expect(stageLabel(ProposalStage.CfoReview)).toBe('CFO review');
    expect(stageLabel(ProposalStage.DepartmentReview)).toBe('Department review');
    expect(stageLabel(ProposalStage.ResubmissionRequired)).toBe('Revision required');
    expect(stageLabel(ProposalStage.Approved)).toBe('Approved');
    expect(stageLabel(ProposalStage.Rejected)).toBe('Rejected');
    expect(stageLabel(ProposalStage.Cancelled)).toBe('Cancelled');
  });

  it('identifies the three single-actor reviewer stages', () => {
    expect(isReviewerStage(ProposalStage.HosHodReview)).toBe(true);
    expect(isReviewerStage(ProposalStage.FmbReview)).toBe(true);
    expect(isReviewerStage(ProposalStage.CfoReview)).toBe(true);
    expect(isReviewerStage(ProposalStage.DepartmentReview)).toBe(false);
    expect(isReviewerStage(ProposalStage.Approved)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the new spec in isolation**

```bash
cd "fyp-ui" && npx ng test --watch=false --include='**/proposal-status.models.spec.ts' 2>&1 | tail -40
```

Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/proposals/proposal-status.models.ts src/app/core/proposals/proposal-status.models.spec.ts
git commit -m "refactor(proposals): move all workflow transition logic out of Angular (server owns it), keep only stage types + display helpers"
```

---

### Task 2.4: Rename `RequestOptionKind`'s `'fnb'` to `'fmb'`, remove `campusTourArea`/`campusTourMap`

**Files:**
- Modify: `fyp-ui/src/app/core/request-options/request-option.models.ts` (full file)
- Modify: `fyp-ui/src/app/core/request-options/request-option.mock-data.ts` (full file)
- Modify: `fyp-ui/src/app/core/request-options/request-option.service.ts:41-56` (`applicantDescription` switch)
- Modify: `fyp-ui/src/app/core/request-options/request-option.permissions.ts` (check for any direct kind references — verify during Step 5)
- Modify: `fyp-ui/src/app/core/request-options/request-option.service.spec.ts` (full file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RequestOptionKind` union with `'fmb'` replacing `'fnb'`, and `'campusTourArea'`/`'campusTourMap'` removed entirely (10 members total, down from 14 → 12; then 12 → wait, recount: original 14 members minus 2 removed = 12, with `fnb`→`fmb` being a rename not a removal, so final count is 12). `FoodRequestOption`'s `kind` literal is `'fmb'`. `CampusTourAreaOption`/`CampusTourMapOption` interfaces deleted; `RequestOption` union no longer includes them.

- [ ] **Step 1: Update `request-option.models.ts`**

Replace the entire contents of `fyp-ui/src/app/core/request-options/request-option.models.ts` with:

```typescript
export type RequestOptionKind =
  | 'logistics'
  | 'transportation'
  | 'photoVideo'
  | 'soundLight'
  | 'fmb'
  | 'dietaryInformation'
  | 'servingUnit'
  | 'campusTourStart'
  | 'waterLogo'
  | 'waterNormal'
  | 'fundingMain'
  | 'fundingSub';

export interface RequestOptionBase {
  readonly id: string;
  readonly kind: RequestOptionKind;
  readonly label: string;
  readonly description?: string;
  readonly active: boolean;
  readonly imageDataUrl?: string;
  readonly imageFileName?: string;
}

export interface LogisticsRequestOption extends RequestOptionBase {
  readonly kind: 'logistics';
  readonly availableQuantity: number;
  readonly quantityUnit: string;
}

export interface TransportationRequestOption extends RequestOptionBase {
  readonly kind: 'transportation';
  readonly passengerCapacity: number;
  readonly availableVehicles: number;
  readonly instructions?: string;
}

export interface MediaRequestOption extends RequestOptionBase {
  readonly kind: 'photoVideo';
  readonly maximumPersonnel?: number;
}

export interface SoundLightRequestOption extends RequestOptionBase {
  readonly kind: 'soundLight';
  readonly availableQuantity?: number;
  readonly setupRequirements?: string;
}

export interface FoodRequestOption extends RequestOptionBase {
  readonly kind: 'fmb';
  readonly servingUnitId?: string;
  readonly orderingNotes?: string;
  readonly dietaryInformationId?: string;
}

export interface DietaryInformationOption extends RequestOptionBase {
  readonly kind: 'dietaryInformation';
}

export interface ServingUnitOption extends RequestOptionBase {
  readonly kind: 'servingUnit';
}

export interface CampusTourStartOption extends RequestOptionBase {
  readonly kind: 'campusTourStart';
  readonly meetingInstructions?: string;
  readonly maximumGroupSize?: number;
}

export interface WaterRequestOption extends RequestOptionBase {
  readonly kind: 'waterLogo' | 'waterNormal';
  readonly bottleCount: number;
  readonly availableStock: number;
  readonly brandingRequirement?: string;
  readonly orderingInstructions?: string;
}

export interface FundingMainOption extends RequestOptionBase {
  readonly kind: 'fundingMain';
  readonly financeCode?: string;
  readonly purchasingGuidance?: string;
}

export interface FundingSubOption extends RequestOptionBase {
  readonly kind: 'fundingSub';
  readonly parentId: string;
  readonly financeCode?: string;
  readonly purchasingNote?: string;
}

export type RequestOption =
  | LogisticsRequestOption
  | TransportationRequestOption
  | MediaRequestOption
  | SoundLightRequestOption
  | FoodRequestOption
  | DietaryInformationOption
  | ServingUnitOption
  | CampusTourStartOption
  | WaterRequestOption
  | FundingMainOption
  | FundingSubOption;

export type RequestOptionDraft = Omit<RequestOption, 'id'>;

export interface RequestOptionQuery {
  readonly kinds?: readonly RequestOptionKind[];
  readonly activeOnly?: boolean;
  readonly search?: string;
}

export interface RequestOptionRepository {
  getOptions(query: RequestOptionQuery): import('rxjs').Observable<readonly RequestOption[]>;
  getOption(id: string): import('rxjs').Observable<RequestOption>;
  createOption(draft: RequestOptionDraft): import('rxjs').Observable<RequestOption>;
  updateOption(id: string, draft: RequestOptionDraft): import('rxjs').Observable<RequestOption>;
  setOptionActive(id: string, active: boolean): import('rxjs').Observable<RequestOption>;
  deleteOption(id: string): import('rxjs').Observable<void>;
}
```

- [ ] **Step 2: Update `request-option.mock-data.ts`**

In `fyp-ui/src/app/core/request-options/request-option.mock-data.ts`, replace every `kind: 'fnb'` with `kind: 'fmb'` (6 occurrences, the `food-lunch` through `food-other` entries, lines 34-39 in the pre-edit file). Delete the `tour-area-*` entries entirely (4 lines: `tour-area-campus`, `tour-area-labs`, `tour-area-library`, `tour-area-innovation`) and the `tour-map-main` entry entirely (1 line). The full replacement file:

```typescript
import { RequestOption } from './request-option.models';

export const MOCK_REQUEST_OPTIONS: readonly RequestOption[] = [
  { id: 'log-registration-table', kind: 'logistics', label: 'Registration table', availableQuantity: 1, quantityUnit: 'table', description: 'For guest registration and check-in.', imageDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Registration Table</text></svg>', imageFileName: 'registration-table.svg', active: true },
  { id: 'log-chairs', kind: 'logistics', label: 'Chairs', availableQuantity: 200, quantityUnit: 'chair', imageDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Event Chairs</text></svg>', imageFileName: 'chairs.svg', active: true },
  { id: 'log-banquet-tables', kind: 'logistics', label: 'Banquet tables', availableQuantity: 20, quantityUnit: 'table', active: true },
  { id: 'log-directional-standees', kind: 'logistics', label: 'Directional standees', availableQuantity: 10, quantityUnit: 'standee', active: true },
  { id: 'log-stage-riser', kind: 'logistics', label: 'Stage riser', availableQuantity: 4, quantityUnit: 'section', active: true },
  { id: 'log-queue-barriers', kind: 'logistics', label: 'Queue barriers', availableQuantity: 16, quantityUnit: 'barrier', active: true },
  { id: 'transport-university-van', kind: 'transportation', label: 'University van', passengerCapacity: 10, availableVehicles: 3, imageDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23ebf8ff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">University Van</text></svg>', imageFileName: 'university-van.svg', active: true },
  { id: 'transport-chartered-bus', kind: 'transportation', label: 'Chartered bus', passengerCapacity: 44, availableVehicles: 2, imageDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23e6fffa"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23234e52">Chartered Bus</text></svg>', imageFileName: 'chartered-bus.svg', active: true },
  { id: 'transport-grab-voucher', kind: 'transportation', label: 'Grab voucher', passengerCapacity: 4, availableVehicles: 20, description: 'Capacity is per vehicle.', active: true },
  { id: 'transport-vip-car', kind: 'transportation', label: 'VIP car', passengerCapacity: 4, availableVehicles: 2, active: true },
  { id: 'transport-airport-pickup', kind: 'transportation', label: 'Airport pickup', passengerCapacity: 6, availableVehicles: 2, active: true },
  { id: 'media-photographer', kind: 'photoVideo', label: 'Photographer', maximumPersonnel: 4, active: true },
  { id: 'media-videographer', kind: 'photoVideo', label: 'Videographer', maximumPersonnel: 4, active: true },
  { id: 'media-team', kind: 'photoVideo', label: 'Photo and video team', maximumPersonnel: 8, active: true },
  { id: 'media-livestream', kind: 'photoVideo', label: 'Livestream support', maximumPersonnel: 5, active: true },
  { id: 'av-wireless-microphone', kind: 'soundLight', label: 'Wireless microphone', availableQuantity: 12, active: true },
  { id: 'av-pa-system', kind: 'soundLight', label: 'PA system', availableQuantity: 4, active: true },
  { id: 'av-projector', kind: 'soundLight', label: 'Projector support', availableQuantity: 8, active: true },
  { id: 'av-stage-lighting', kind: 'soundLight', label: 'Stage lighting', availableQuantity: 3, active: true },
  { id: 'av-led-screen', kind: 'soundLight', label: 'LED screen', availableQuantity: 2, active: true },
  { id: 'serving-pax', kind: 'servingUnit', label: 'Per pax', description: 'One serving for one person.', active: true },
  { id: 'serving-set', kind: 'servingUnit', label: 'Per set', active: true },
  { id: 'serving-tray', kind: 'servingUnit', label: 'Per tray', active: true },
  { id: 'serving-piece', kind: 'servingUnit', label: 'Per piece', active: true },
  { id: 'serving-bottle', kind: 'servingUnit', label: 'Per bottle', active: true },
  { id: 'dietary-standard', kind: 'dietaryInformation', label: 'Standard menu', description: 'No special dietary classification.', active: true },
  { id: 'dietary-vegetarian', kind: 'dietaryInformation', label: 'Vegetarian', active: true },
  { id: 'dietary-vegan', kind: 'dietaryInformation', label: 'Vegan', active: true },
  { id: 'dietary-gluten-free', kind: 'dietaryInformation', label: 'Gluten-free', active: true },
  { id: 'dietary-allergen-aware', kind: 'dietaryInformation', label: 'Allergen-aware', description: 'Confirm the specific allergen requirements before ordering.', active: true },
  { id: 'food-lunch', kind: 'fmb', label: 'Lunch', servingUnitId: 'serving-pax', dietaryInformationId: 'dietary-standard', active: true },
  { id: 'food-dinner', kind: 'fmb', label: 'Dinner', servingUnitId: 'serving-pax', dietaryInformationId: 'dietary-standard', active: true },
  { id: 'food-refreshments', kind: 'fmb', label: 'Refreshments', servingUnitId: 'serving-pax', dietaryInformationId: 'dietary-standard', active: true },
  { id: 'food-coffee-tea', kind: 'fmb', label: 'Coffee / Tea', servingUnitId: 'serving-pax', dietaryInformationId: 'dietary-standard', active: true },
  { id: 'food-buffet', kind: 'fmb', label: 'Buffet', servingUnitId: 'serving-pax', dietaryInformationId: 'dietary-standard', active: true },
  { id: 'food-other', kind: 'fmb', label: 'Other', active: true },
  { id: 'tour-start-lobby', kind: 'campusTourStart', label: 'Main Lobby', meetingInstructions: 'Meet beside the reception desk.', maximumGroupSize: 30, active: true },
  { id: 'tour-start-atrium', kind: 'campusTourStart', label: 'Atrium', maximumGroupSize: 50, active: true },
  { id: 'tour-start-admissions', kind: 'campusTourStart', label: 'Admissions Office', maximumGroupSize: 20, active: true },
  { id: 'tour-start-library', kind: 'campusTourStart', label: 'Library Entrance', maximumGroupSize: 25, active: true },
  ...(['waterLogo', 'waterNormal'] as const).flatMap((kind) => [24, 48, 96, 120].map((count) => ({ id: `${kind}-${count}`, kind, label: `${count} bottles`, bottleCount: count, availableStock: 500, brandingRequirement: kind === 'waterLogo' ? 'APU logo artwork is required.' : undefined, active: true }))),
  { id: 'waterLogo-custom', kind: 'waterLogo', label: 'Custom quantity', bottleCount: 0, availableStock: 500, brandingRequirement: 'APU logo artwork is required.', active: true },
  { id: 'waterNormal-custom', kind: 'waterNormal', label: 'Custom quantity', bottleCount: 0, availableStock: 500, active: true },
  { id: 'fund-main-printing', kind: 'fundingMain', label: 'Printing and materials', financeCode: 'PRINT', active: true },
  { id: 'fund-main-venue', kind: 'fundingMain', label: 'Venue setup', financeCode: 'VENUE', active: true },
  { id: 'fund-main-honorarium', kind: 'fundingMain', label: 'Honorarium', financeCode: 'HON', active: true },
  { id: 'fund-main-external', kind: 'fundingMain', label: 'External service', financeCode: 'EXT', active: true },
  { id: 'fund-main-supplies', kind: 'fundingMain', label: 'Event supplies', financeCode: 'SUP', active: true },
  ...[
    ['fund-sub-posters', 'Posters and flyers', 'fund-main-printing'], ['fund-sub-certificates', 'Certificates', 'fund-main-printing'], ['fund-sub-name-tags', 'Name tags', 'fund-main-printing'], ['fund-sub-booklets', 'Programme booklets', 'fund-main-printing'],
    ['fund-sub-furniture', 'Furniture rental', 'fund-main-venue'], ['fund-sub-decorations', 'Decorations', 'fund-main-venue'], ['fund-sub-backdrop', 'Backdrop production', 'fund-main-venue'], ['fund-sub-booth', 'Booth setup', 'fund-main-venue'],
    ['fund-sub-speaker', 'Guest speaker', 'fund-main-honorarium'], ['fund-sub-facilitator', 'Facilitator', 'fund-main-honorarium'], ['fund-sub-performer', 'Performer', 'fund-main-honorarium'], ['fund-sub-judge', 'External judge', 'fund-main-honorarium'],
    ['fund-sub-security', 'Security service', 'fund-main-external'], ['fund-sub-cleaning', 'Cleaning service', 'fund-main-external'], ['fund-sub-medical', 'Medical support', 'fund-main-external'], ['fund-sub-contractor', 'Technical contractor', 'fund-main-external'],
    ['fund-sub-kits', 'Participant kits', 'fund-main-supplies'], ['fund-sub-stationery', 'Stationery', 'fund-main-supplies'], ['fund-sub-prizes', 'Prizes and tokens', 'fund-main-supplies'], ['fund-sub-consumables', 'Consumable supplies', 'fund-main-supplies'],
  ].map(([id, label, parentId]) => ({ id, kind: 'fundingSub' as const, label, parentId, active: true })),
];
```

- [ ] **Step 3: Update `request-option.service.ts`'s `applicantDescription` switch**

In `fyp-ui/src/app/core/request-options/request-option.service.ts`, replace:

```typescript
      case 'fnb': return option.description;
      case 'dietaryInformation': case 'servingUnit': return option.description;
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum group: ${option.maximumGroupSize}` : '', option.meetingInstructions ?? option.description ?? ''].filter(Boolean).join(' · ') || undefined;
      case 'campusTourArea': return [option.estimatedDuration ? `${option.estimatedDuration} minutes` : '', option.restrictions ?? option.description ?? ''].filter(Boolean).join(' · ') || undefined;
      case 'campusTourMap': return [option.mapUrl ?? '', option.accessNotes ?? option.description ?? ''].filter(Boolean).join(' · ') || undefined;
```

with:

```typescript
      case 'fmb': return option.description;
      case 'dietaryInformation': case 'servingUnit': return option.description;
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum group: ${option.maximumGroupSize}` : '', option.meetingInstructions ?? option.description ?? ''].filter(Boolean).join(' · ') || undefined;
```

- [ ] **Step 4: Update `request-option.service.spec.ts`**

Replace the entire contents of `fyp-ui/src/app/core/request-options/request-option.service.spec.ts` with:

```typescript
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { UserRole } from '../auth/auth.models';
import { roleCanAccess } from '../auth/role-navigation';
import { canManageRequestOptions, managerOptionKinds } from './request-option.permissions';
import { RequestOptionService } from './request-option.service';

describe('RequestOptionService', () => {
  it('returns applicant options with stable IDs as values', async () => {
    const service = TestBed.inject(RequestOptionService);
    const options = await firstValueFrom(service.watchActive('transportation'));
    const selectOptions = service.toSelectOptions(options);
    expect(selectOptions.some((option) => option.value === 'transport-grab-voucher' && option.label === 'Grab voucher')).toBe(true);
  });

  it('keeps manager permissions centralized by role and page', () => {
    expect(managerOptionKinds(UserRole.LogisticsManager)).toEqual(['logistics']);
    expect(managerOptionKinds(UserRole.Cfo)).toEqual(['fundingMain', 'fundingSub']);
    expect(managerOptionKinds(UserRole.Fmb)).toEqual(['fmb', 'servingUnit', 'dietaryInformation', 'waterLogo', 'waterNormal']);
    expect(managerOptionKinds(UserRole.StudentServicesManager)).toEqual(['campusTourStart']);
    expect(canManageRequestOptions(UserRole.Fmb, true)).toBe(true);
    expect(canManageRequestOptions(UserRole.Fmb, false)).toBe(true);
    expect(canManageRequestOptions(UserRole.Applicant, false)).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/menu')).toBe(true);
    expect(roleCanAccess(UserRole.Cfo, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/logistics')).toBe(true);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/soundLight')).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/campusTourStart')).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/waterLogo')).toBe(false);
    expect(roleCanAccess(UserRole.AvManager, '/app/dropdown-options/soundLight')).toBe(true);
    expect(roleCanAccess(UserRole.StudentServicesManager, '/app/dropdown-options/campusTourStart')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options/waterLogo')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options/servingUnit')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options/dietaryInformation')).toBe(true);
  });

  it('provides API-compatible serving-unit and dietary-information IDs', async () => {
    const service = TestBed.inject(RequestOptionService);
    const [servingUnits, dietaryInformation] = await Promise.all([
      firstValueFrom(service.watchActive('servingUnit')),
      firstValueFrom(service.watchActive('dietaryInformation')),
    ]);

    expect(servingUnits.some((option) => option.id === 'serving-pax')).toBe(true);
    expect(dietaryInformation.some((option) => option.id === 'dietary-vegetarian')).toBe(true);
  });

  it('removes an option after delete()', async () => {
    const service = TestBed.inject(RequestOptionService);
    const before = await firstValueFrom(service.watchAll(['fmb']));
    expect(before.some((option) => option.id === 'food-other')).toBe(true);

    await firstValueFrom(service.delete('food-other'));

    const after = await firstValueFrom(service.watchAll(['fmb']));
    expect(after.some((option) => option.id === 'food-other')).toBe(false);
  });
});
```

Note: `canManageRequestOptions(UserRole.Fmb, false)` is now expected `true` (unlike the old `FmbManager` test, which returned `false` for the non-cafeteria page since `FmbManager`'s kinds were `dietaryInformation`/`waterLogo`/`waterNormal` — none `'fmb'`/`'servingUnit'`). Now that `Fmb`'s kinds include `'fmb'` itself, `canManageRequestOptions(role, cafeteriaPage=false)` returns true because `kinds.some((kind) => kind !== 'fnb' && kind !== 'servingUnit')` matches `dietaryInformation`/`waterLogo`/`waterNormal` regardless — verify this logic in `request-option.permissions.ts` in the next step; if the exact boolean differs from what's asserted here after Task 2.4 Step 5's check, adjust this test to match the real computed value rather than leaving it wrong.

- [ ] **Step 5: Read and verify `request-option.permissions.ts` needs no direct code changes**

Open `fyp-ui/src/app/core/request-options/request-option.permissions.ts` (already confirmed via earlier read: it only calls `optionKindsForManager` from `department-workflow.config.ts`, no hardcoded `'fnb'` string literal). Confirm this is still true after Task 2.2's edits — no changes needed in this file itself.

Re-derive `canManageRequestOptions(UserRole.Fmb, false)`'s actual value by tracing the code: `managerOptionKinds(UserRole.Fmb)` returns `['fmb', 'servingUnit', 'dietaryInformation', 'waterLogo', 'waterNormal']` (Task 2.2). `canManageRequestOptions(role, cafeteriaPage=false)` returns `kinds.some((kind) => kind !== 'fnb' && kind !== 'servingUnit')` — wait, Task 2.4 Step 1 already renamed the type but the STRING LITERAL inside `request-option.permissions.ts`'s `canManageRequestOptions` function body (`kind !== 'fnb'`) also needs updating to `kind !== 'fmb'`, since it's comparing against the same string. Read the file now and fix it:

```typescript
export function canManageRequestOptions(role: UserRole, cafeteriaPage: boolean): boolean {
  const kinds = managerOptionKinds(role);
  return cafeteriaPage
    ? kinds.some((kind) => kind === 'fnb' || kind === 'servingUnit')
    : kinds.some((kind) => kind !== 'fnb' && kind !== 'servingUnit');
}
```

Replace with:

```typescript
export function canManageRequestOptions(role: UserRole, cafeteriaPage: boolean): boolean {
  const kinds = managerOptionKinds(role);
  return cafeteriaPage
    ? kinds.some((kind) => kind === 'fmb' || kind === 'servingUnit')
    : kinds.some((kind) => kind !== 'fmb' && kind !== 'servingUnit');
}
```

With this fix, `canManageRequestOptions(UserRole.Fmb, false)` = `kinds.some((kind) => kind !== 'fmb' && kind !== 'servingUnit')` = true (matches `dietaryInformation`) — confirms the Step 4 test assertion `expect(canManageRequestOptions(UserRole.Fmb, false)).toBe(true)` is correct.

- [ ] **Step 6: Run the affected tests**

```bash
cd "fyp-ui" && npx ng test --watch=false --include='**/request-option*.spec.ts' 2>&1 | tail -80
```

Expected: all tests PASS. If any assertion fails, read the actual computed value from the test failure output and correct the test's expectation to match — do not change the production code to make a wrong expectation pass unless the production behavior itself is actually wrong per this task's intent.

- [ ] **Step 7: Commit**

```bash
git add src/app/core/request-options/request-option.models.ts src/app/core/request-options/request-option.mock-data.ts src/app/core/request-options/request-option.service.ts src/app/core/request-options/request-option.permissions.ts src/app/core/request-options/request-option.service.spec.ts
git commit -m "refactor(request-options): rename fnb kind to fmb, remove campusTourArea/campusTourMap kinds"
```

---

### Task 2.5: Fix `event-proposal.ts` — F&B/water merge in the requirement checklist, Campus Tour trim

**Files:**
- Modify: `fyp-ui/src/app/features/internal/pages/event-proposal/event-proposal.ts`

**Interfaces:**
- Consumes: `RequestOptionKind` (Task 2.4), `DepartmentRequestKind`/`DEPARTMENT_WORKFLOWS` (Task 2.2).
- Produces: `RequirementKey` type with `'fmb'` replacing `'fnb'`; `buildRequirementDefinitions()`'s `campusTour` entry columns drop `tourArea`/`campusMap`; the `fmb`/`campusTour` requirement's `optionKindForField` mapping updated.

- [ ] **Step 1: Update `RequirementKey` type**

Line 25 (pre-edit). Replace:

```typescript
type RequirementKey = 'logistics' | 'transportation' | 'photoVideo' | 'soundLight' | 'fnb' | 'campusTour' | 'waterLogo' | 'waterNormal' | 'fundingPurchase';
```

with:

```typescript
type RequirementKey = 'logistics' | 'transportation' | 'photoVideo' | 'soundLight' | 'fmb' | 'campusTour' | 'waterLogo' | 'waterNormal' | 'fundingPurchase';
```

- [ ] **Step 2: Update the two `requestRows` initializers**

Both occurrences (originally lines 133 and 169) of:

```typescript
    logistics: [], transportation: [], photoVideo: [], soundLight: [], fnb: [], campusTour: [], waterLogo: [], waterNormal: [], fundingPurchase: [],
```

Replace with:

```typescript
    logistics: [], transportation: [], photoVideo: [], soundLight: [], fmb: [], campusTour: [], waterLogo: [], waterNormal: [], fundingPurchase: [],
```

- [ ] **Step 3: Update `requestFieldOptions`/`requestOptionContext`'s switch on `RequirementKey`**

Find the switch statement around (pre-edit) line 520 containing `case 'fnb': return [option.servingUnitId ? ...`. Replace:

```typescript
      case 'fnb': return [option.servingUnitId ? `Serving unit: ${this.requestOptionLabel(option.servingUnitId)}` : '', option.dietaryInformationId ? `Dietary information: ${this.requestOptionLabel(option.dietaryInformationId)}` : '', option.orderingNotes].filter(Boolean).join(' · ');
```

with:

```typescript
      case 'fmb': return [option.servingUnitId ? `Serving unit: ${this.requestOptionLabel(option.servingUnitId)}` : '', option.dietaryInformationId ? `Dietary information: ${this.requestOptionLabel(option.dietaryInformationId)}` : '', option.orderingNotes].filter(Boolean).join(' · ');
```

Delete these two case branches entirely (pre-edit lines 523-524):

```typescript
      case 'campusTourArea': return [option.estimatedDuration ? `Estimated duration: ${option.estimatedDuration} minutes` : '', option.restrictions].filter(Boolean).join(' · ');
      case 'campusTourMap': return [option.mapUrl ? `Map: ${option.mapUrl}` : '', option.accessNotes].filter(Boolean).join(' · ');
```

- [ ] **Step 4: Update `buildRequirementDefinitions()`**

Find the method (pre-edit lines 818-834). Replace the `fnb` entry's key and label, and trim the `campusTour` entry's columns. Original relevant lines:

```typescript
      { key: 'fnb', label: 'F&B', columns: [{ key: 'foodType', label: 'Food Type', type: 'select', required: true, options: this.activeSelectOptions('fnb') }, { key: 'quantity', label: 'Pax / Quantity', type: 'number', min: 0, required: true }, date, start, end, location, notes] },
```

and

```typescript
      { key: 'campusTour', label: 'Campus Tour', columns: [date, start, end, location, { key: 'pax', label: 'Pax', type: 'number', min: 0, required: true }, { key: 'startPoint', label: 'Starting Point', type: 'select', required: true, options: this.activeSelectOptions('campusTourStart') }, { key: 'tourArea', label: 'Tour Area', type: 'select', required: true, options: this.activeSelectOptions('campusTourArea') }, { key: 'campusMap', label: 'Campus Map', type: 'select', required: true, options: this.activeSelectOptions('campusTourMap') }, notes] },
```

Replace with:

```typescript
      { key: 'fmb', label: 'F&B', columns: [{ key: 'foodType', label: 'Food Type', type: 'select', required: true, options: this.activeSelectOptions('fmb') }, { key: 'quantity', label: 'Pax / Quantity', type: 'number', min: 0, required: true }, date, start, end, location, notes] },
```

and

```typescript
      { key: 'campusTour', label: 'Campus Tour', columns: [date, start, end, location, { key: 'pax', label: 'Pax', type: 'number', min: 0, required: true }, { key: 'startPoint', label: 'Starting Point', type: 'select', required: true, options: this.activeSelectOptions('campusTourStart') }, notes] },
```

- [ ] **Step 5: Update `optionKindForField`**

Find the method (pre-edit lines 837-850). Replace:

```typescript
    if (key === 'fnb' && columnKey === 'foodType') return 'fnb';
```

with:

```typescript
    if (key === 'fmb' && columnKey === 'foodType') return 'fmb';
```

Delete these two lines entirely (Campus Tour is start-point only now — no `tourArea`/`campusMap` fields exist to map):

```typescript
    if (key === 'campusTour' && columnKey === 'tourArea') return 'campusTourArea';
    if (key === 'campusTour' && columnKey === 'campusMap') return 'campusTourMap';
```

- [ ] **Step 6: Search for any remaining reference to `tourArea`/`campusMap`/`fnb` in this file**

```bash
cd "fyp-ui" && grep -n "tourArea\|campusMap\|'fnb'\|\"fnb\"" src/app/features/internal/pages/event-proposal/event-proposal.ts
```

Expected: no output. If any line prints, it's a reference this task's steps missed — read the surrounding context and apply the same kind of fix (rename `fnb`→`fmb`, delete `tourArea`/`campusMap` handling) consistent with the pattern above.

- [ ] **Step 7: Run the event-proposal spec**

```bash
cd "fyp-ui" && npx ng test --watch=false --include='**/event-proposal*.spec.ts' 2>&1 | tail -60
```

Expected: PASS (or, if the existing spec references the old `fnb`/`tourArea` fields, fix the spec to match — read `fyp-ui/src/app/features/internal/pages/event-proposal/event-proposal.spec.ts` first to see if it needs the same rename treatment; if it does, apply it before considering this step done).

- [ ] **Step 8: Commit**

```bash
git add src/app/features/internal/pages/event-proposal/event-proposal.ts
git commit -m "refactor(event-proposal): rename fnb requirement to fmb, trim Campus Tour to starting point only"
```

---

### Task 2.6: Fix `staff-tasks.ts`, `staff-task.repository.ts`, `records-page.ts`, `inbox.ts` — remove FmbWaterServicesStaff, fix `fnb`/stage references

**Files:**
- Modify: `fyp-ui/src/app/features/internal/pages/staff-tasks/staff-tasks.ts:18-26`
- Modify: `fyp-ui/src/app/core/staff-tasks/staff-task.repository.ts` (full file)
- Modify: `fyp-ui/src/app/core/staff-tasks/staff-task.models.ts:4` (the `StaffTaskStatus` type)
- Modify: `fyp-ui/src/app/features/internal/pages/records-page/records-page.ts:133,151,320` (and surrounding context)
- Modify: `fyp-ui/src/app/features/internal/pages/inbox/inbox.ts:46` (and surrounding context)

**Interfaces:**
- Consumes: `UserRole.Fmb` (Task 2.1), `ProposalStage.FmbReview` (Task 2.3).
- Produces: `StaffTaskStatus` gains `'preparing'` (matching the design spec's `request_task.status` — see Global Constraints); mock task/record data uses `requestKind: 'fmb'` and references `ProposalStage.FmbReview` where the old code referenced `ProposalStage.FmbReviewerPending`.

- [ ] **Step 1: Update `StaffTaskStatus`**

In `fyp-ui/src/app/core/staff-tasks/staff-task.models.ts`, replace:

```typescript
export type StaffTaskStatus = 'assigned' | 'in-progress' | 'completed';
```

with:

```typescript
export type StaffTaskStatus = 'assigned' | 'preparing' | 'completed';
```

This renames `'in-progress'` to `'preparing'` to match the design spec's `request_task.status` vocabulary exactly (Global Constraints section of this plan) — `StaffTask` is the UI-facing projection of a `request_task` row assigned to one staff member, so its status vocabulary should match.

- [ ] **Step 2: Update `staff-tasks.ts`'s `ROLE_PRESENTATION` map**

In `fyp-ui/src/app/features/internal/pages/staff-tasks/staff-tasks.ts`, delete this line entirely (the role no longer exists):

```typescript
  [UserRole.FmbWaterServicesStaff]: { noun: 'water-service task', begin: 'Start Preparation', complete: 'Delivery Completed', beginIcon: 'water_drop', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Mineral Water Request', width: '16rem' }, { key: 'quantity', label: 'Quantity', width: '9rem' }, { key: 'detail', label: 'Preparation / Delivery', width: '18rem' }, { key: 'schedule', label: 'Required Time', width: '17rem' }, { key: 'location', label: 'Delivery Location', width: '12rem' }, ...COMMON_END] },
```

Water fulfilment tasks now appear in `UserRole.CafeteriaStaff`'s existing presentation entry (already in the map) since they flow through the same Cafeteria Staff shared inbox as food — no new entry needed for water specifically.

Search the rest of this file for any other use of `'in-progress'` as a literal string (the status rename in Step 1 may have call sites here):

```bash
cd "fyp-ui" && grep -n "'in-progress'\|\"in-progress\"" src/app/features/internal/pages/staff-tasks/staff-tasks.ts
```

If any matches print, replace them with `'preparing'`.

- [ ] **Step 3: Update `staff-task.repository.ts`**

Replace the entire contents of `fyp-ui/src/app/core/staff-tasks/staff-task.repository.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable, delay, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskStatus } from './staff-task.models';

const STAFF_EMAIL: Readonly<Partial<Record<UserRole, string>>> = {
  [UserRole.CafeteriaStaff]: 'cafeteria.staff@demo.apu.edu.my',
  [UserRole.LogisticsStaff]: 'logistics.staff@demo.apu.edu.my',
  [UserRole.StudentServicesMember]: 'student.services.member@demo.apu.edu.my',
  [UserRole.AvTechnician]: 'av.technician@demo.apu.edu.my',
  [UserRole.PhotographyStaff]: 'photographer@demo.apu.edu.my',
  [UserRole.TransportStaff]: 'transport.staff@demo.apu.edu.my',
};
const task = (id: string, role: UserRole, eventCode: string, eventTitle: string, request: string, detailLabel: string, detail: string, schedule: string, location: string, status: StaffTaskStatus = 'assigned', quantity?: string): StaffTask =>
  ({ id, role, assignedToEmail: STAFF_EMAIL[role] ?? '', eventCode, eventTitle, request, detailLabel, detail, schedule, location, status, quantity, ...(status === 'completed' ? { completedAt: '2 Aug 2026, 5:30 PM' } : {}) });

const MOCK_TASKS: readonly StaffTask[] = [
  task('student-1', UserRole.StudentServicesMember, 'EVT-260142', 'APU Cultural Night 2026', 'Campus overview tour', 'Tour route', 'Main Lobby to innovation labs and student spaces', '8 Aug 2026 - 3:00 PM-4:00 PM', 'Main Lobby', 'assigned', '30 visitors'),
  task('student-h1', UserRole.StudentServicesMember, 'EVT-260074', 'Clubs and Societies Fair', 'Student-life campus tour', 'Tour route', 'Main Lobby to the Spine', '18 Jul 2026 - 9:00 AM-10:00 AM', 'Main Lobby', 'completed', '22 visitors'),
  task('water-1', UserRole.CafeteriaStaff, 'EVT-260142', 'APU Cultural Night 2026', 'Mineral Water with APU Logo', 'Delivery requirement', 'Prepare and deliver before registration', '8 Aug 2026 - by 3:00 PM', 'Atrium', 'assigned', '180 bottles'),
  task('water-2', UserRole.CafeteriaStaff, 'EVT-260137', 'Future Tech Showcase', 'Mineral Water Normal', 'Delivery requirement', 'Place at exhibitor stations', '12 Aug 2026 - by 9:30 AM', 'Design Studio', 'preparing', '96 bottles'),
  task('water-h1', UserRole.CafeteriaStaff, 'EVT-260082', 'Graduate Networking Evening', 'Mineral Water Normal', 'Delivery requirement', 'Delivered to guest tables', '23 Jul 2026 - 4:00 PM', 'Auditorium 2', 'completed', '120 bottles'),
  task('caf-1', UserRole.CafeteriaStaff, 'EVT-260142', 'APU Cultural Night 2026', 'International buffet service', 'Dietary information', 'Vegetarian and halal selections', '8 Aug 2026 · 4:00 PM–9:00 PM', 'Atrium', 'assigned', '180 meals'),
  task('caf-2', UserRole.CafeteriaStaff, 'EVT-260118', 'Graduate Networking Evening', 'Refreshment order', 'Serving unit', 'Individual packs', '6 Aug 2026 · 5:00 PM–7:30 PM', 'Auditorium 2', 'preparing', '90 packs'),
  task('caf-h1', UserRole.CafeteriaStaff, 'EVT-260082', 'Research Showcase', 'Lunch service', 'Dietary information', 'Mixed menu', '23 Jul 2026 · 11:00 AM–2:00 PM', 'Atrium', 'completed', '120 meals'),
  task('log-1', UserRole.LogisticsStaff, 'EVT-260142', 'APU Cultural Night 2026', 'Banquet chair setup', 'Inventory item', 'Banquet chairs', '8 Aug 2026 · 1:00 PM–3:30 PM', 'Atrium', 'assigned', '180 / 200 chairs'),
  task('log-2', UserRole.LogisticsStaff, 'EVT-260131', 'Entrepreneurship Bootcamp', 'Registration desk setup', 'Inventory item', 'Folding tables', '7 Aug 2026 · 8:00 AM–9:00 AM', 'Design Studio', 'preparing', '8 / 12 tables'),
  task('log-h1', UserRole.LogisticsStaff, 'EVT-260090', 'Student Club Fair', 'Booth setup', 'Inventory item', 'Display booths', '25 Jul 2026 · 8:00 AM–10:00 AM', 'Spine', 'completed', '24 booths'),
  task('av-1', UserRole.AvTechnician, 'EVT-260142', 'APU Cultural Night 2026', 'Main-stage sound and lighting', 'Equipment', 'Digital mixer, stage wash and wireless microphones', '8 Aug 2026 · 2:00 PM–10:00 PM', 'Atrium', 'assigned'),
  task('av-2', UserRole.AvTechnician, 'EVT-260118', 'Graduate Networking Evening', 'Presentation setup', 'Equipment', 'Projector, lectern microphone and confidence monitor', '6 Aug 2026 · 3:30 PM–8:00 PM', 'Auditorium 2', 'preparing'),
  task('av-h1', UserRole.AvTechnician, 'EVT-260084', 'Industry Talk', 'Lecture capture setup', 'Equipment', 'Camera feed and microphones', '22 Jul 2026 · 9:00 AM–12:00 PM', 'Auditorium 1', 'completed'),
  task('photo-1', UserRole.PhotographyStaff, 'EVT-260142', 'APU Cultural Night 2026', 'Photo and video coverage', 'Personnel', '2 photographers and 1 videographer', '8 Aug 2026 · 4:00 PM–10:00 PM', 'Atrium', 'assigned'),
  task('photo-2', UserRole.PhotographyStaff, 'EVT-260118', 'Graduate Networking Evening', 'Event photography', 'Personnel', '1 photographer', '6 Aug 2026 · 5:00 PM–8:00 PM', 'Auditorium 2', 'preparing'),
  task('photo-h1', UserRole.PhotographyStaff, 'EVT-260080', 'Awards Ceremony', 'Event photography', 'Personnel', '2 photographers', '20 Jul 2026 · 6:00 PM–9:00 PM', 'Atrium', 'completed'),
  task('transport-1', UserRole.TransportStaff, 'EVT-260139', 'Industry Visit', 'Campus shuttle trip', 'Passengers', '28 pax · 40-seat bus', '9 Aug 2026 · 7:30 AM–5:00 PM', 'APU → Cyberjaya → APU', 'assigned'),
  task('transport-2', UserRole.TransportStaff, 'EVT-260126', 'Airport Welcome Programme', 'Airport transfer', 'Passengers', '12 pax · 15-seat van', '5 Aug 2026 · 9:00 AM–12:30 PM', 'KLIA → APU Residence', 'preparing'),
  task('transport-h1', UserRole.TransportStaff, 'EVT-260078', 'Community Outreach', 'Return shuttle', 'Passengers', '32 pax · 40-seat bus', '19 Jul 2026 · 8:00 AM–6:00 PM', 'APU → Klang → APU', 'completed'),
];

@Injectable({ providedIn: 'root' })
export class MockStaffTaskRepository implements StaffTaskRepository {
  private readonly tasks = new BehaviorSubject<readonly StaffTask[]>(MOCK_TASKS);
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.tasks.pipe(map((items) => items.filter((item) => item.role === role && item.assignedToEmail.toLowerCase() === assignedToEmail.toLowerCase()))); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> {
    const duplicate = this.tasks.value.find((item) => item.eventCode === draft.eventCode && item.request === draft.request && item.assignedToEmail === draft.assignedToEmail);
    if (duplicate) return of(duplicate);
    const created: StaffTask = { ...draft, id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, status: 'assigned' };
    return of(created).pipe(delay(180), tap((saved) => this.tasks.next([...this.tasks.value, saved])));
  }
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask> {
    const current = this.tasks.value.find((item) => item.id === id);
    if (!current) return throwError(() => new Error('Task not found.'));
    const updated: StaffTask = { ...current, status, ...(status === 'completed' ? { completedAt: new Date().toLocaleString('en-MY') } : {}) };
    return of(updated).pipe(delay(180), tap((saved) => this.tasks.next(this.tasks.value.map((item) => item.id === id ? saved : item))));
  }
}

@Injectable({ providedIn: 'root' })
export class ApiStaffTaskRepository implements StaffTaskRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.staffTasksApiUrl;
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.http.get<readonly StaffTask[]>(this.baseUrl, { params: { role, assignedToEmail } }); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> { return this.http.post<StaffTask>(`${this.baseUrl}/assignments`, draft); }
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask> { return this.http.patch<StaffTask>(`${this.baseUrl}/${encodeURIComponent(id)}/status`, { status }); }
}

export const STAFF_TASK_REPOSITORY = new InjectionToken<StaffTaskRepository>('STAFF_TASK_REPOSITORY', {
  providedIn: 'root', factory: () => environment.useMockStaffTasks ? inject(MockStaffTaskRepository) : inject(ApiStaffTaskRepository),
});
```

(This repository is collapsed to Api-only in Task 2.9 — the `MockStaffTaskRepository` class and `MOCK_TASKS` array written here are transitional, kept only so the app still compiles and runs standalone through the rest of Phase 2. Task 2.9 deletes them.)

- [ ] **Step 4: Fix `records-page.ts`'s `requestKind: 'fnb'` and stage reference**

Read `fyp-ui/src/app/features/internal/pages/records-page/records-page.ts` in full to see the surrounding context of lines 133, 151, and 320 precisely (the earlier grep showed only isolated lines; confirm exact current line numbers before editing, since earlier edits in this plan may have shifted them in OTHER files but not this one — this file hasn't been touched yet in this plan).

Replace:
```typescript
      { id: 501, title: 'APU Cultural Night 2026', summary: 'Catering request is being prepared for the event.', reference: 'REQ-260142', category: 'Catering', owner: 'Cafeteria Services', initials: 'CS', date: '31 Jul 2026, 4:18 PM', status: 'In progress', requestKind: 'fnb' },
```
with:
```typescript
      { id: 501, title: 'APU Cultural Night 2026', summary: 'Catering request is being prepared for the event.', reference: 'REQ-260142', category: 'Catering', owner: 'Cafeteria Services', initials: 'CS', date: '31 Jul 2026, 4:18 PM', status: 'In progress', requestKind: 'fmb' },
```

Replace:
```typescript
      { id: 601, title: 'Graduate Networking Evening', summary: 'Catering service was delivered.', reference: 'REQ-260082', category: 'Catering', owner: 'Cafeteria Services', initials: 'CS', date: '23 Jul 2026, 6:02 PM', status: 'Completed', requestKind: 'fnb' },
```
with:
```typescript
      { id: 601, title: 'Graduate Networking Evening', summary: 'Catering service was delivered.', reference: 'REQ-260082', category: 'Catering', owner: 'Cafeteria Services', initials: 'CS', date: '23 Jul 2026, 6:02 PM', status: 'Completed', requestKind: 'fmb' },
```

Replace:
```typescript
    if (status === 'F&B review') return ProposalStage.FmbReviewerPending;
```
with:
```typescript
    if (status === 'F&B review') return ProposalStage.FmbReview;
```

- [ ] **Step 5: Fix `inbox.ts`'s `requestKind: 'fnb'`**

In `fyp-ui/src/app/features/internal/pages/inbox/inbox.ts`, replace:
```typescript
    { ...PROPOSAL_REVIEW_RECORDS[4], status: 'Department review', requestKind: 'fnb' },
```
with:
```typescript
    { ...PROPOSAL_REVIEW_RECORDS[4], status: 'Department review', requestKind: 'fmb' },
```

- [ ] **Step 6: Search both files for any other stray reference**

```bash
cd "fyp-ui" && grep -n "'fnb'\|FmbReviewerPending\|FmbWaterServicesStaff" src/app/features/internal/pages/records-page/records-page.ts src/app/features/internal/pages/inbox/inbox.ts src/app/features/internal/pages/staff-tasks/staff-tasks.ts
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/internal/pages/staff-tasks/staff-tasks.ts src/app/core/staff-tasks/staff-task.repository.ts src/app/core/staff-tasks/staff-task.models.ts src/app/features/internal/pages/records-page/records-page.ts src/app/features/internal/pages/inbox/inbox.ts
git commit -m "refactor(staff-tasks): remove FmbWaterServicesStaff (water routes through Cafeteria Staff), rename StaffTaskStatus in-progress to preparing, fix fnb/stage references"
```

---

### Task 2.7: Trim `app.routes.ts`'s Campus Tour dropdown routes

**Files:**
- Modify: `fyp-ui/src/app/app.routes.ts:4-18`

**Interfaces:**
- Consumes: nothing new.
- Produces: `dropdownSettingRoutes` array without `campusTourArea`/`campusTourMap` entries — 11 entries instead of 13.

- [ ] **Step 1: Remove the two Campus Tour rows**

Replace:

```typescript
const dropdownSettingRoutes = [
  ['logistics', 'Logistics Items'],
  ['transportation', 'Transportation Types'],
  ['photoVideo', 'Photography Services'],
  ['soundLight', 'Sound & Light'],
  ['dietaryInformation', 'Dietary Information'],
  ['servingUnit', 'Serving Units'],
  ['campusTourStart', 'Campus Tour Starting Points'],
  ['campusTourArea', 'Campus Tour Areas'],
  ['campusTourMap', 'Campus Map Information'],
  ['waterLogo', 'Mineral Water with Logo'],
  ['waterNormal', 'Mineral Water Normal'],
  ['fundingMain', 'Funding Main Items'],
  ['fundingSub', 'Funding Sub-items'],
] as const;
```

with:

```typescript
const dropdownSettingRoutes = [
  ['logistics', 'Logistics Items'],
  ['transportation', 'Transportation Types'],
  ['photoVideo', 'Photography Services'],
  ['soundLight', 'Sound & Light'],
  ['dietaryInformation', 'Dietary Information'],
  ['servingUnit', 'Serving Units'],
  ['campusTourStart', 'Campus Tour Starting Points'],
  ['waterLogo', 'Mineral Water with Logo'],
  ['waterNormal', 'Mineral Water Normal'],
  ['fundingMain', 'Funding Main Items'],
  ['fundingSub', 'Funding Sub-items'],
] as const;
```

- [ ] **Step 2: Search the whole file for any other `fnb`/`campusTourArea`/`campusTourMap` reference**

```bash
cd "fyp-ui" && grep -n "'fnb'\|campusTourArea\|campusTourMap" src/app/app.routes.ts
```

Expected: no output (the earlier full-file grep for this file found zero matches for these tokens outside this one array, confirming no other route entries need touching).

- [ ] **Step 3: Commit**

```bash
git add src/app/app.routes.ts
git commit -m "refactor(routes): remove Campus Tour Area/Map dropdown routes"
```

---

### Task 2.8: Rewrite `proposal-review.mock-data.ts` for the new stage names and merged F&B/water requirement

**Files:**
- Modify: `fyp-ui/src/app/core/proposals/proposal-review.mock-data.ts` (full file)
- Modify: `fyp-ui/src/app/core/proposals/proposal-review.models.ts:1-17` (drop the now-removed `campusTourArea`/`campusTourMap`-related fields if any — verify during Step 1; the file as read earlier has none, so likely no change needed beyond confirming)

**Interfaces:**
- Consumes: `ProposalStage` (Task 2.3), `DepartmentRequestKind` (Task 2.2 — now excludes nothing new but `'fmb'` replaces `'fnb'` as a valid kind since `DepartmentRequestKind` is a separate type from `RequestOptionKind` — check `department-workflow.config.ts`'s `DepartmentRequestKind` union directly, which after Task 2.2 lists `'fmb'` as one of the `requestKinds` values for the `Fmb` manager entry, though the union type ITSELF (`export type DepartmentRequestKind = 'logistics' | 'campusTour' | 'waterLogo' | 'waterNormal' | 'soundLight' | 'photoVideo' | 'transportation' | 'fnb' | 'fundingPurchase';`) still says `'fnb'` literally — Task 2.2 only changed `DEPARTMENT_WORKFLOWS`'s array contents, not this type union declaration. This task's Step 0 below fixes that oversight.
- Produces: `PROPOSAL_REVIEW_RECORDS` with workflow stages using the new `ProposalStage` enum values, and `SELECTED_REQUIREMENTS` referencing `'fmb'` instead of `'fnb'`.

- [ ] **Step 0: Fix the `DepartmentRequestKind` type union in `department-workflow.config.ts` (oversight from Task 2.2)**

Task 2.2 updated `DEPARTMENT_WORKFLOWS`'s array contents to use `'fmb'` but the `DepartmentRequestKind` TYPE declaration at the top of `fyp-ui/src/app/core/departments/department-workflow.config.ts` still has the old `'fnb'` literal. Open the file and replace:

```typescript
export type DepartmentRequestKind =
  | 'logistics'
  | 'campusTour'
  | 'waterLogo'
  | 'waterNormal'
  | 'soundLight'
  | 'photoVideo'
  | 'transportation'
  | 'fnb'
  | 'fundingPurchase';
```

with:

```typescript
export type DepartmentRequestKind =
  | 'logistics'
  | 'campusTour'
  | 'waterLogo'
  | 'waterNormal'
  | 'soundLight'
  | 'photoVideo'
  | 'transportation'
  | 'fmb'
  | 'fundingPurchase';
```

Run a typecheck to confirm Task 2.2's `DEPARTMENT_WORKFLOWS` array (which already uses `'fmb'` in its `requestKinds`/values) now compiles cleanly against this corrected union:

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -i "department-workflow"
```

Expected: no output referencing `department-workflow.config.ts` itself (other files will still show errors at this point in the plan — that's expected and resolved by later tasks in this phase).

- [ ] **Step 1: Confirm `proposal-review.models.ts` needs no structural change**

Read `fyp-ui/src/app/core/proposals/proposal-review.models.ts` fully (already read earlier in this planning session — confirmed it has no `campusTourArea`/`campusTourMap`/`fnb`-specific fields; `ProposalDepartmentKey = DepartmentRequestKind` is a type alias that automatically picks up Step 0's fix with no edit needed in this file). No changes required here — this step is a verification-only step.

- [ ] **Step 2: Rewrite `proposal-review.mock-data.ts`**

Replace the entire contents of `fyp-ui/src/app/core/proposals/proposal-review.mock-data.ts` with:

```typescript
import { EditableRow } from '../../shared/components/form-controls/form-controls.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalDepartmentKey, ProposalDepartmentRequest, ProposalReviewRecord } from './proposal-review.models';
import { ProposalStage, ProposalWorkflowState } from './proposal-status.models';

const REQUEST_DETAILS: Readonly<Record<ProposalDepartmentKey, readonly Omit<ProposalDepartmentRequest, 'id' | 'department'>[]>> = {
  campusTour: [{ item: 'Campus overview tour', quantity: '30 visitors', schedule: '8 Aug 2026 - 3:00 PM-4:00 PM', location: 'Main Lobby', notes: 'Include innovation labs and student spaces.' }],
  waterLogo: [{ item: 'Mineral Water with APU Logo', quantity: '180 bottles', schedule: 'Required by 8 Aug 2026 - 3:00 PM', location: 'Atrium', notes: 'Deliver before guest registration opens.' }],
  waterNormal: [{ item: 'Mineral Water Normal', quantity: '96 bottles', schedule: 'Required by 8 Aug 2026 - 3:00 PM', location: 'Atrium', notes: 'Place at volunteer and backstage stations.' }],
  logistics: [{ item: 'Banquet chairs and registration tables', quantity: '180 chairs · 8 tables', schedule: '8 Aug 2026 · 1:00 PM–3:30 PM', location: 'Atrium', notes: 'Complete setup before vendor arrival.' }],
  soundLight: [{ item: 'Main-stage sound and lighting', quantity: '1 complete setup', schedule: '8 Aug 2026 · 2:00 PM–10:00 PM', location: 'Atrium stage', notes: 'Wireless microphones, digital mixer and stage wash.' }],
  photoVideo: [{ item: 'Photography and videography coverage', quantity: '2 photographers · 1 videographer', schedule: '8 Aug 2026 · 4:00 PM–10:00 PM', location: 'Atrium', notes: 'Cover performances, guests and awards presentation.' }],
  transportation: [{ item: 'Campus shuttle', quantity: '28 pax · 40-seat bus', schedule: '8 Aug 2026 · 3:00 PM–10:30 PM', location: 'APU Residence ↔ Campus', notes: 'Two scheduled pickup windows.' }],
  fmb: [{ item: 'International buffet service', quantity: '180 meals', schedule: '8 Aug 2026 · 6:00 PM–8:00 PM', location: 'Atrium dining zone', notes: 'Halal and vegetarian selections required.' }],
  fundingPurchase: [{ item: 'Event materials and participant kits', quantity: '180 kits', schedule: 'Required by 6 Aug 2026', location: 'Student Affairs', notes: 'Estimated total RM 3,600.' }],
};

// Every seed proposal requests the same representative set of departments so each mock record
// exercises the full multi-department review flow; totalPax (per-proposal) decides whether the
// F&B/CFO reviewer stages apply.
const SELECTED_REQUIREMENTS: readonly DepartmentRequestKind[] = ['logistics', 'fmb', 'photoVideo'];

const requests = (seed: number): readonly ProposalDepartmentRequest[] =>
  SELECTED_REQUIREMENTS.map((department, index) => ({ id: seed * 10 + index, department, ...REQUEST_DETAILS[department][0] }));

const coOwnersFor = (applicant: string): readonly EditableRow[] => [
  { id: 1, name: applicant, email: `${applicant.toLowerCase().replace(/\s+/g, '.')}@student.apu.edu.my`, role: 'Lead Organiser' },
];

const organizersFor = (applicant: string): readonly EditableRow[] => [
  { id: 1, name: applicant, email: `${applicant.toLowerCase().replace(/\s+/g, '.')}@student.apu.edu.my`, role: 'Event Lead', notes: 'Primary point of contact.' },
  { id: 2, name: 'Jordan Lee', email: 'jordan.lee@student.apu.edu.my', role: 'Logistics Coordinator', notes: 'Handles on-the-day setup.' },
];

const IMPORTANT_PEOPLE: readonly EditableRow[] = [
  { id: 1, name: 'Dr. Wan Aziz', type: 'Speaker', organization: 'APU', designation: 'Dean of Student Affairs' },
];

const GUESTS: readonly EditableRow[] = [
  { id: 1, guestType: 'Students', count: 150, notes: 'General admission.' },
  { id: 2, guestType: 'Industry Partners', count: 10, notes: 'Invited sponsors.' },
];

const AGENDA: readonly EditableRow[] = [
  { id: 1, time: '16:00', activity: 'Doors open & registration', location: 'Atrium', pic: 'Jordan Lee', notes: '' },
  { id: 2, time: '17:00', activity: 'Opening remarks', location: 'Atrium Stage', pic: 'Dr. Wan Aziz', notes: '' },
  { id: 3, time: '20:00', activity: 'Closing & thank you', location: 'Atrium Stage', pic: 'Event Lead', notes: '' },
];

const DISCUSSIONS: readonly EditableRow[] = [
  { id: 1, topic: 'Confirm halal catering certification with vendor.' },
];

const SCHEDULE_ROWS = (schedule: string): readonly EditableRow[] => [
  { id: 1, date: schedule.split(' · ')[0] ?? schedule, start: '16:00', end: '22:00', location: schedule.split(' · ').at(-1) ?? '' },
];

const proposal = (
  id: number,
  proposalId: string,
  eventTitle: string,
  applicant: string,
  schedule: string,
  shortIntroduction: string,
  goals: string,
  benefits: string,
  totalPax: number,
  workflow: ProposalWorkflowState,
  category: string,
): ProposalReviewRecord => ({
  id,
  proposalId,
  eventTitle,
  applicant,
  applicantInitials: applicant.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
  schedule,
  shortIntroduction,
  goals,
  benefits,
  totalPax,
  status: workflowStatusLabel(workflow),
  category,
  requests: requests(id),
  applicantEmail: `${applicant.toLowerCase().replace(/\s+/g, '.')}@student.apu.edu.my`,
  applicantDepartment: 'School of Computing',
  coOwners: coOwnersFor(applicant),
  organizers: organizersFor(applicant),
  importantPeople: IMPORTANT_PEOPLE,
  guests: GUESTS,
  agenda: AGENDA,
  discussions: DISCUSSIONS,
  scheduleRows: SCHEDULE_ROWS(schedule),
  eventImage: null,
  eventVisibility: 'Public',
  eventCategories: [category],
  eventFormat: 'On Campus',
  registrationMode: 'Approval Required',
  publicity: 'Promoted via campus posters and the APU Events app.',
  selectedRequirements: SELECTED_REQUIREMENTS,
  externalPax: Math.round(totalPax * 0.1),
  workflow,
});

function workflowStatusLabel(workflow: ProposalWorkflowState): string {
  switch (workflow.stage) {
    case ProposalStage.Submitted: return 'Submitted';
    case ProposalStage.HosHodReview: return 'HOS/HOD review';
    case ProposalStage.FmbReview: return 'F&B review';
    case ProposalStage.CfoReview: return 'CFO review';
    case ProposalStage.DepartmentReview: return 'Department review';
    case ProposalStage.ResubmissionRequired: return 'Revision required';
    case ProposalStage.Approved: return 'Approved';
    case ProposalStage.Rejected: return 'Rejected';
    case ProposalStage.Cancelled: return 'Cancelled';
    default: return 'Submitted';
  }
}

const workflowAt = (stage: ProposalStage): ProposalWorkflowState => ({
  stage,
  departmentConfirmations: SELECTED_REQUIREMENTS.map((department) => ({ department, confirmed: false })),
});

const allConfirmed = (stage: ProposalStage): ProposalWorkflowState => ({
  stage,
  departmentConfirmations: SELECTED_REQUIREMENTS.map((department) => ({ department, confirmed: true, confirmedAt: new Date().toISOString(), confirmedBy: 'demo@apu.edu.my' })),
});

export const PROPOSAL_REVIEW_RECORDS: readonly ProposalReviewRecord[] = [
  proposal(1, 'EVT-260142', 'APU Cultural Night 2026', 'Aina Rahman', '8 Aug 2026 · 4:00 PM–10:00 PM · Atrium', 'An evening celebrating APU’s international community through performances, food and student-led cultural showcases.', 'Strengthen cross-cultural understanding and create a welcoming platform for student communities.', 'Greater student participation, cultural awareness and stronger connections across the university.', 180, workflowAt(ProposalStage.DepartmentReview), 'Culture & Community'),
  proposal(2, 'EVT-260137', 'Future Tech Showcase', 'Daniel Wong', '12 Aug 2026 · 10:00 AM–5:00 PM · Design Studio', 'A showcase of student technology projects, demonstrations and industry conversations.', 'Connect student innovators with peers, academics and industry representatives.', 'Improved project visibility, professional feedback and collaboration opportunities.', 95, workflowAt(ProposalStage.HosHodReview), 'Academic & Career'),
  proposal(3, 'EVT-260129', 'APU Sports Carnival', 'Nur Izzati', '16 Aug 2026 · 8:00 AM–6:00 PM · Sports Centre', 'A university-wide day of team sports, wellness activities and friendly competition.', 'Encourage active lifestyles and collaboration between schools and departments.', 'Improved wellbeing, teamwork and community participation.', 320, workflowAt(ProposalStage.CfoReview), 'Sports & Wellness'),
  proposal(4, 'EVT-260121', 'Career Connections Forum', 'Marcus Lim', '20 Aug 2026 · 1:00 PM–6:00 PM · Auditorium 2', 'A networking forum connecting students with employers and alumni.', 'Help students understand career pathways and build professional networks.', 'Greater career awareness and direct employer engagement.', 140, workflowAt(ProposalStage.FmbReview), 'Academic & Career'),
  proposal(5, 'EVT-260114', 'Community Volunteer Day', 'Priya Nair', '24 Aug 2026 · 7:30 AM–5:00 PM · Klang', 'A coordinated volunteering programme supporting a local community partner.', 'Create meaningful service-learning opportunities for APU students.', 'Community impact, stronger civic awareness and practical teamwork experience.', 72, workflowAt(ProposalStage.DepartmentReview), 'Volunteering'),
  proposal(6, 'EVT-260082', 'Graduate Networking Evening', 'Sarah Tan', '23 Jul 2026 · 5:00 PM–8:30 PM · Auditorium 2', 'An evening for graduating students to connect with alumni and industry guests.', 'Support graduate employability and professional relationship-building.', 'New career connections and improved confidence in professional networking.', 90, allConfirmed(ProposalStage.Approved), 'Academic & Career'),
  proposal(7, 'EVT-260074', 'Clubs and Societies Fair', 'Amir Hassan', '18 Jul 2026 · 10:00 AM–4:00 PM · Spine', 'A discovery fair introducing students to APU clubs, societies and communities.', 'Increase awareness and membership of student-led organisations.', 'Stronger campus participation and easier access to student communities.', 260, allConfirmed(ProposalStage.Approved), 'Clubs & Societies'),
  proposal(8, 'EVT-260066', 'Wellness Weekend', 'Mei Chen', '12 Jul 2026 · 9:00 AM–5:00 PM · Sports Centre', 'A weekend programme focused on physical and mental wellbeing.', 'Give students practical ways to maintain healthy routines.', 'Improved wellbeing awareness and access to support activities.', 110, allConfirmed(ProposalStage.Approved), 'Sports & Wellness'),
];

export function proposalForTitle(title: string, fallbackId = 1000): ProposalReviewRecord {
  return (
    PROPOSAL_REVIEW_RECORDS.find((record) => record.eventTitle === title) ??
    proposal(fallbackId, `EVT-${String(fallbackId).padStart(6, '0')}`, title, 'APU Applicant', 'Schedule pending', 'Event proposal information submitted for review.', 'Deliver the planned event successfully.', 'Provide a valuable experience for the APU community.', 0, workflowAt(ProposalStage.HosHodReview), 'General')
  );
}
```

Notes on differences from the original:
- `workflowAt`/`allConfirmed` no longer take a `totalPax` parameter (the old `initialWorkflowState(SELECTED_REQUIREMENTS)` helper was deleted in Task 2.3 along with all transition logic) — they build the `ProposalWorkflowState` shape directly instead.
- `'fnb'` renamed to `'fmb'` in `REQUEST_DETAILS` and `SELECTED_REQUIREMENTS`.
- `ProposalStage.FmbReviewerPending` renamed to `ProposalStage.FmbReview`; `ProposalStage.NeedsRevision` renamed to `ProposalStage.ResubmissionRequired` (not used in this file's seed data directly, but the `workflowStatusLabel` switch covers it for completeness since it's exhaustive over the enum).

- [ ] **Step 3: Run the proposal-related test suite**

```bash
cd "fyp-ui" && npx ng test --watch=false --include='**/proposal*.spec.ts' 2>&1 | tail -100
```

Expected: compile errors will still appear in `proposal-reviewer-view.ts`/`proposal-department-view.ts` (fixed in Task 2.9) and the repository files (fixed in Task 2.10) — confirm no NEW errors appear that trace back to this file itself. Any error whose stack trace bottoms out in `proposal-review.mock-data.ts` needs fixing here before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/departments/department-workflow.config.ts src/app/core/proposals/proposal-review.mock-data.ts
git commit -m "fix(departments): correct DepartmentRequestKind type union fnb->fmb oversight; refactor(proposals): rewrite mock data for new stage enum"
```

---

### Task 2.9: Fix `proposal-reviewer-view.ts` for the new stage enum; add the F&B per-selection Cafeteria Manager UI to `proposal-department-view.ts`

**Files:**
- Modify: `fyp-ui/src/app/core/proposals/proposal-review.models.ts` (add the F&B selection model)
- Modify: `fyp-ui/src/app/shared/components/proposal-reviewer-view/proposal-reviewer-view.ts` (full file)
- Modify: `fyp-ui/src/app/shared/components/proposal-department-view/proposal-department-view.ts` (full file)
- Modify: `fyp-ui/src/app/shared/components/proposal-department-view/proposal-department-view.scss` (append new styles for the per-selection list)

**Interfaces:**
- Consumes: `ProposalStage`/`stageLabel`/`isReviewerStage` (Task 2.3), `UserRole.Fmb` (Task 2.1), `DepartmentRequestKind` (Task 2.2/2.8).
- Produces: `FmbSelection` interface (new) — `{ id: number; cafeteriaName: string; menuItemLabel: string; quantity: number; notes: string; status: 'pending' | 'approved' | 'resubmitted' | 'preparing' | 'fulfilled' | 'cancelled' }`. `ProposalReviewRecord` gains a new optional field `fmbSelections?: readonly FmbSelection[]`. `ProposalDepartmentViewComponent` gains a per-selection approve/resubmit UI shown only when `department === 'fmb'` and the current role is `CafeteriaManager`.

- [ ] **Step 1: Add the F&B selection model to `proposal-review.models.ts`**

Open `fyp-ui/src/app/core/proposals/proposal-review.models.ts`. Add this interface after `ProposalDepartmentRequest` (before `ProposalReviewRecord`):

```typescript
export type FmbSelectionStatus = 'pending' | 'approved' | 'resubmitted' | 'preparing' | 'fulfilled' | 'cancelled';

export interface FmbSelection {
  readonly id: number;
  readonly cafeteriaId: number;
  readonly cafeteriaName: string;
  readonly menuItemLabel: string;
  readonly quantity: number;
  readonly notes: string;
  readonly status: FmbSelectionStatus;
}
```

Add a new field to `ProposalReviewRecord`, directly after the `readonly externalPax: number;` line:

```typescript
  readonly fmbSelections?: readonly FmbSelection[];
```

- [ ] **Step 2: Rewrite `proposal-reviewer-view.ts` for the new stage enum**

In `fyp-ui/src/app/shared/components/proposal-reviewer-view/proposal-reviewer-view.ts`:

Replace the `ROLE_LABELS` constant:

```typescript
const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  [UserRole.HosHod]: 'HOS/HOD',
  [UserRole.FmbReviewer]: 'F&B Reviewer',
  [UserRole.Cfo]: 'CFO',
};
```

with:

```typescript
const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  [UserRole.HosHod]: 'HOS/HOD',
  [UserRole.Fmb]: 'F&B',
  [UserRole.Cfo]: 'CFO',
};
```

Replace the `STAGE_ORDER` constant:

```typescript
const STAGE_ORDER: readonly ProposalStage[] = [
  ProposalStage.HosHodReview,
  ProposalStage.FmbReviewerPending,
  ProposalStage.CfoReview,
  ProposalStage.DepartmentReview,
  ProposalStage.Approved,
];
```

with:

```typescript
const STAGE_ORDER: readonly ProposalStage[] = [
  ProposalStage.HosHodReview,
  ProposalStage.FmbReview,
  ProposalStage.CfoReview,
  ProposalStage.DepartmentReview,
  ProposalStage.Approved,
];
```

Replace the import line:

```typescript
import { ProposalStage, reviewerRoleForStage, stageLabel } from '../../../core/proposals/proposal-status.models';
```

with:

```typescript
import { ProposalStage, stageLabel } from '../../../core/proposals/proposal-status.models';
```

(`reviewerRoleForStage` was deleted in Task 2.3 — that authorization decision now comes from the server. Find and update the `canAct` computed that used it.)

Replace:

```typescript
  readonly canAct = computed(() => {
    if (this.readOnly()) return false;
    const stage = this.stage();
    return stage !== null && reviewerRoleForStage(stage) === this.role();
  });
```

with:

```typescript
  // Which stage a role owns is now a server-side authorization decision (system.md's "the
  // backend owns the workflow" principle). The client-side approximation below exists only to
  // decide whether to render the action panel at all — the server still validates and rejects
  // any action from a role that doesn't actually own the current stage, regardless of what the
  // UI shows. `readOnly` (an explicit input from the parent dispatch component) is the primary
  // signal; this computed is a display convenience, not a security boundary.
  readonly canAct = computed(() => !this.readOnly());
```

Replace every remaining reference to `ProposalStage.NeedsRevision` in this file. Find:

```typescript
    if (currentStage === ProposalStage.NeedsRevision) {
      steps.push({ stage: ProposalStage.NeedsRevision, label: 'Revision Required', note: 'Awaiting applicant resubmission.', active: true, done: false });
    }
```

Replace with:

```typescript
    if (currentStage === ProposalStage.ResubmissionRequired) {
      steps.push({ stage: ProposalStage.ResubmissionRequired, label: 'Revision Required', note: 'Awaiting applicant resubmission.', active: true, done: false });
    }
```

Find the `canCancel` computed's status string comparison:

```typescript
  readonly canCancel = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return false;
    if (proposal.status === 'Cancelled' || proposal.status === 'Rejected' || proposal.workflow.stage === ProposalStage.Rejected) {
      return false;
    }
    return !this.readOnly() && this.isSubmitterOrCoOwner() && this.isWithinCancellationWindow();
  });
```

Replace with (adds the `Cancelled` stage as a terminal check alongside the string comparison, since the workflow model now has a real `Cancelled` stage rather than only a string status):

```typescript
  readonly canCancel = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return false;
    if (proposal.workflow.stage === ProposalStage.Cancelled || proposal.workflow.stage === ProposalStage.Rejected) {
      return false;
    }
    return !this.readOnly() && this.isSubmitterOrCoOwner() && this.isWithinCancellationWindow();
  });
```

Search the rest of the file for any remaining reference to the deleted enum members or `reviewerRoleForStage`:

```bash
cd "fyp-ui" && grep -n "FmbReviewerPending\|NeedsRevision\|reviewerRoleForStage\|FmbReviewer\b" src/app/shared/components/proposal-reviewer-view/proposal-reviewer-view.ts
```

Expected: no output.

- [ ] **Step 3: Rewrite `proposal-department-view.ts` — add the F&B per-selection UI**

This is the component with the largest behavioral change. Today, `ProposalDepartmentViewComponent` treats a department as one atomic unit: `canAct` checks one `departmentConfirmations` entry, `approve()`/`resubmit()` act on the whole department. For the `fmb` department specifically, when the acting role is `CafeteriaManager`, the UI needs to instead show a list of `FmbSelection` rows (from `proposal.fmbSelections`), each with its own approve/resubmit action, rather than one department-wide action.

Replace the entire contents of `fyp-ui/src/app/shared/components/proposal-department-view/proposal-department-view.ts` with:

```typescript
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin } from 'rxjs';
import { AdminDirectoryService } from '../../../core/admin-directory/admin-directory.service';
import { AuthService } from '../../../core/auth/auth.service';
import { UserRole } from '../../../core/auth/auth.models';
import { staffRoleForManager } from '../../../core/departments/department-workflow.config';
import { departmentsForRole, FmbSelection, ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../core/proposals/proposal-workflow.service';
import { StaffTaskService } from '../../../core/staff-tasks/staff-task.service';
import { EditableRow } from '../form-controls/form-controls.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { ProposalFieldComponent } from '../proposal-field/proposal-field';
import { ProposalKpiBarComponent } from '../proposal-kpi-bar/proposal-kpi-bar';
import { ProposalSectionComponent } from '../proposal-section/proposal-section';
import { ProposalTableColumn, ProposalTableComponent } from '../proposal-table/proposal-table';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';

interface ReviewerComment {
  readonly stage: string;
  readonly reviewer: string;
  readonly initials: string;
  readonly text: string;
}

@Component({
  selector: 'app-proposal-department-view',
  imports: [
    ProposalTableComponent,
    SearchableDropdownComponent,
    FormModalComponent,
    ProposalKpiBarComponent,
    ProposalSectionComponent,
    ProposalFieldComponent,
  ],
  template: `
    @if (proposal(); as item) {
      <!-- Top summary info boxes (KPI Bar) -->
      <app-proposal-kpi-bar [proposal]="item" />

      <!-- Two-column dashboard content -->
      <div class="prv-layout">

        <!-- LEFT — Proposal Details & Department Requests -->
        <div class="prv-main">

          @if (actionMessage()) {
            <div class="prv-status-banner" role="status" [attr.data-kind]="actionBannerKind()">
              <span class="material-symbols-rounded" aria-hidden="true">{{ actionBannerIcon() }}</span>
              {{ actionMessage() }}
            </div>
          }

          <!-- Section: Event Overview -->
          <app-proposal-section icon="description" title="Event Overview" description="General information, registration and publicity.">
            <div class="prv-grid prv-grid--3">
              <app-proposal-field label="Event Title" [value]="item.eventTitle" span="2" />
              <app-proposal-field label="Visibility" [value]="item.eventVisibility" />
              <app-proposal-field label="Format" [value]="item.eventFormat" />
              <app-proposal-field label="Registration" [value]="item.registrationMode" />
              <app-proposal-field label="Total Pax" [value]="item.totalPax" />
              <div class="prv-grid-row--2 prv-field--full">
                <app-proposal-field label="External Pax" [value]="item.externalPax" />
                <app-proposal-field label="Categories" [value]="item.eventCategories.join(', ')" />
              </div>
              <app-proposal-field label="Publicity" [value]="item.publicity" span="full" />
              <app-proposal-field label="Short Introduction" [value]="item.shortIntroduction" span="full" />
              <app-proposal-field label="Goals &amp; Objectives" [value]="item.goals" span="full" />
              <app-proposal-field label="Expected Benefits" [value]="item.benefits" span="full" />
            </div>
            @if (item.eventImage) {
              <img class="prv-event-image" [src]="item.eventImage.url" [alt]="item.eventTitle + ' event image'" />
            }
          </app-proposal-section>

          <!-- Section: Department Requests -->
          <app-proposal-section icon="inventory_2" title="Your Department's Requested Items" description="Only requests assigned to your department are shown.">
            <div class="prv-table-wrap">
              <h4 class="prv-table-wrap__label">Department Requests</h4>
              <app-proposal-table
                tableId="department-proposal-requests"
                [columns]="requestColumns"
                [rows]="requestRows()"
                [readOnly]="true"
                emptyIcon="assignment_late"
                emptyMessage="No request details are assigned to this department."
              />
            </div>
          </app-proposal-section>

          <!-- Section: F&B Cafeteria Selections (Cafeteria Manager only, on the fmb department) -->
          @if (isCafeteriaSelectionView()) {
            <app-proposal-section icon="restaurant" title="Cafeteria Order Selections" description="F&B has picked a cafeteria and menu item for each order. Approve or resubmit each one independently.">
              <div class="prv-fmb-selections">
                @for (selection of myCafeteriaSelections(); track selection.id) {
                  <div class="prv-fmb-selection" [attr.data-status]="selection.status">
                    <div class="prv-fmb-selection__body">
                      <div class="prv-fmb-selection__row">
                        <span class="prv-fmb-selection__label">Menu item</span>
                        <strong>{{ selection.menuItemLabel }}</strong>
                      </div>
                      <div class="prv-fmb-selection__row">
                        <span class="prv-fmb-selection__label">Quantity</span>
                        <span>{{ selection.quantity }}</span>
                      </div>
                      @if (selection.notes) {
                        <div class="prv-fmb-selection__row">
                          <span class="prv-fmb-selection__label">Notes</span>
                          <span>{{ selection.notes }}</span>
                        </div>
                      }
                      <span class="prv-fmb-selection__status">{{ selectionStatusLabel(selection.status) }}</span>
                    </div>
                    @if (selection.status === 'pending') {
                      <div class="prv-fmb-selection__actions">
                        <button type="button" class="prv-btn prv-btn--approve" [disabled]="selectionActionPending() === selection.id" (click)="openApproveSelectionModal(selection)">
                          <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">task_alt</span>
                          <span class="prv-btn__label">Approve</span>
                        </button>
                        <button type="button" class="prv-btn prv-btn--resubmit" [disabled]="selectionActionPending() === selection.id" (click)="openResubmitSelectionModal(selection)">
                          <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">rate_review</span>
                          <span class="prv-btn__label">Resubmit to F&amp;B</span>
                        </button>
                      </div>
                    }
                  </div>
                }
                @if (!myCafeteriaSelections().length) {
                  <p class="prv-fmb-selections__empty">No orders have been placed with your cafeteria yet for this proposal.</p>
                }
              </div>
            </app-proposal-section>
          }

        </div><!-- /prv-main -->

        <!-- RIGHT — Sticky Reviewer Panel -->
        <aside class="prv-panel">

          @if (!isCafeteriaSelectionView()) {
            <!-- Workflow Actions card (hidden entirely for the per-selection Cafeteria Manager view — its actions live inline above, per selection row) -->
            <div class="prv-panel-card prv-panel-card--actions">
              <div class="prv-panel-card__head">
                <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">gavel</span>
                <div>
                  <h3 class="prv-panel-card__title">Workflow Actions</h3>
                  <p class="prv-panel-card__subtitle">Fulfilment confirmation for your department.</p>
                </div>
              </div>

              @if (canAct()) {
                <!-- Comment area -->
                <div class="prv-comment-area">
                  <label class="prv-comment-area__label" for="dept-reviewer-comment">
                    <span class="material-symbols-rounded" aria-hidden="true">chat_bubble</span>
                    Reviewer comment
                    @if (commentRequired()) { <span class="prv-comment-area__required">required for resubmit</span> }
                  </label>
                  <textarea
                    id="dept-reviewer-comment"
                    class="prv-comment-area__input"
                    [class.prv-comment-area__input--required]="commentValidationError()"
                    rows="4"
                    placeholder="Add a comment visible to all reviewers…"
                    [value]="comment()"
                    (input)="onCommentInput($event)"
                  ></textarea>
                  @if (commentValidationError()) {
                    <p class="prv-comment-area__error" role="alert">
                      <span class="material-symbols-rounded" aria-hidden="true">error</span>
                      Explain what needs to change so the applicant can fix it.
                    </p>
                  }
                </div>

                <!-- Action buttons -->
                <div class="prv-actions prv-actions--row">
                  <button
                    type="button"
                    class="prv-btn prv-btn--approve"
                    [disabled]="confirming() || resubmitting()"
                    (click)="openApproveModal()"
                  >
                    <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">task_alt</span>
                    <span class="prv-btn__label">Approve</span>
                  </button>
                  <button
                    type="button"
                    class="prv-btn prv-btn--resubmit"
                    [disabled]="confirming() || resubmitting()"
                    (click)="openResubmitModal()"
                  >
                    <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">rate_review</span>
                    <span class="prv-btn__label">Resubmit</span>
                  </button>
                </div>
              } @else {
                <div class="prv-no-action">
                  <span class="material-symbols-rounded" aria-hidden="true">check_circle</span>
                  <p>Fulfilment confirmed for your department.</p>
                </div>
              }
            </div>
          }

          <!-- Section: Assign Department Work -->
          @if (!readOnly() && allowAssignment() && !isCafeteriaSelectionView() && staffRole(); as assignmentRole) {
            <div class="prv-panel-card">
              <div class="prv-panel-card__head">
                <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">person_add</span>
                <div>
                  <h3 class="prv-panel-card__title">Assign Department Work</h3>
                  <p class="prv-panel-card__subtitle">Select team member for these tasks.</p>
                </div>
              </div>
              <div class="proposal-department-view__assignment-controls">
                <app-searchable-dropdown
                  controlId="department-assignee"
                  label="Assigned team member"
                  placeholder="Select a team member"
                  [required]="true"
                  [options]="staffOptions()"
                  [value]="assigneeEmail()"
                  (valueChange)="assigneeEmail.set($any($event)); assignmentMessage.set('')"
                />
                <button
                  type="button"
                  class="prv-btn prv-btn--approve"
                  [disabled]="!assigneeEmail() || assigning() || !requestRows().length"
                  (click)="assignRequests()"
                >
                  <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">assignment_ind</span>
                  <span class="prv-btn__label">{{ assigning() ? 'Assigning...' : 'Assign Tasks' }}</span>
                </button>
              </div>
              @if (assignmentMessage()) {
                <p class="proposal-department-view__assignment-message" role="status">{{ assignmentMessage() }}</p>
              }
            </div>
          }

          <!-- Reviewer Comments card -->
          @if (reviewerComments().length) {
            <div class="prv-panel-card prv-panel-card--comments">
              <div class="prv-panel-card__head">
                <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">forum</span>
                <div>
                  <h3 class="prv-panel-card__title">Reviewer Comments</h3>
                  <p class="prv-panel-card__subtitle">Comments left by reviewers in this chain.</p>
                </div>
              </div>
              <ul class="prv-comments-list">
                @for (entry of reviewerComments(); track entry.stage) {
                  <li class="prv-comment-entry">
                    <div class="prv-comment-entry__avatar" aria-hidden="true">{{ entry.initials }}</div>
                    <div class="prv-comment-entry__body">
                      <div class="prv-comment-entry__meta">
                        <strong>{{ entry.reviewer }}</strong>
                        <span class="prv-comment-entry__stage">{{ entry.stage }}</span>
                      </div>
                      <p class="prv-comment-entry__text">{{ entry.text }}</p>
                    </div>
                  </li>
                }
              </ul>
            </div>
          }

        </aside><!-- /prv-panel -->

      </div><!-- /prv-layout -->
    }

    <!-- Approve confirmation modal popup (whole-department flow) -->
    <app-form-modal
      [open]="approveConfirm()"
      title="Confirm department fulfilment"
      primaryLabel="Confirm Approval"
      secondaryLabel="Cancel"
      [loading]="confirming()"
      (close)="approveConfirm.set(false)"
      (cancel)="approveConfirm.set(false)"
      (submit)="confirmApprove()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__info">
          <span class="material-symbols-rounded" aria-hidden="true">task_alt</span>
          Confirm that your department can fulfill all requested items for this proposal.
        </p>
      </div>
    </app-form-modal>

    <!-- Resubmit confirmation modal popup (whole-department flow) -->
    <app-form-modal
      [open]="resubmitConfirm()"
      title="Resubmit with comment"
      primaryLabel="Send back to applicant"
      secondaryLabel="Cancel"
      [loading]="resubmitting()"
      (close)="resubmitConfirm.set(false)"
      (cancel)="resubmitConfirm.set(false)"
      (submit)="confirmResubmit()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__warn prv-action-modal__warn--amber">
          <span class="material-symbols-rounded" aria-hidden="true">rate_review</span>
          Explain what needs to change so the applicant can update their submission before this continues.
        </p>
      </div>
    </app-form-modal>

    <!-- Approve confirmation modal popup (per-selection Cafeteria Manager flow) -->
    <app-form-modal
      [open]="approveSelectionConfirm() !== null"
      title="Approve this order"
      primaryLabel="Confirm Approval"
      secondaryLabel="Cancel"
      [loading]="selectionActionPending() !== null"
      (close)="approveSelectionConfirm.set(null)"
      (cancel)="approveSelectionConfirm.set(null)"
      (submit)="confirmApproveSelection()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__info">
          <span class="material-symbols-rounded" aria-hidden="true">task_alt</span>
          This order moves into your Cafeteria Staff's shared task inbox for preparation.
        </p>
      </div>
    </app-form-modal>

    <!-- Resubmit confirmation modal popup (per-selection Cafeteria Manager flow) -->
    <app-form-modal
      [open]="resubmitSelectionConfirm() !== null"
      title="Resubmit this order to F&B"
      primaryLabel="Send to F&B"
      secondaryLabel="Cancel"
      [loading]="selectionActionPending() !== null"
      (close)="resubmitSelectionConfirm.set(null)"
      (cancel)="resubmitSelectionConfirm.set(null)"
      (submit)="confirmResubmitSelection()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__warn prv-action-modal__warn--amber">
          <span class="material-symbols-rounded" aria-hidden="true">rate_review</span>
          F&amp;B will edit or reassign this specific order (dish, quantity, or cafeteria) and re-send it —
          other orders for this proposal are not affected.
        </p>
      </div>
    </app-form-modal>
  `,
  styleUrl: './proposal-department-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalDepartmentViewComponent {
  private readonly directory = inject(AdminDirectoryService);
  private readonly auth = inject(AuthService);
  private readonly tasks = inject(StaffTaskService);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);

  readonly proposal = input<ProposalReviewRecord | null>(null);
  readonly role = input.required<UserRole>();
  readonly allowAssignment = input(true);
  readonly readOnly = input(false);
  readonly actionComplete = output<number>();

  readonly departments = computed(() => departmentsForRole(this.role()));
  readonly staffRole = computed(() => staffRoleForManager(this.role()));
  readonly staffUsers = signal<readonly { email: string; displayName: string }[]>([]);
  readonly assigneeEmail = signal('');
  readonly assigning = signal(false);
  readonly assignmentMessage = signal('');
  readonly staffOptions = computed(() => this.staffUsers().map((user) => ({ value: user.email, label: user.displayName, description: user.email })));

  readonly confirming = signal(false);
  readonly resubmitting = signal(false);
  readonly approveConfirm = signal(false);
  readonly resubmitConfirm = signal(false);
  readonly actionMessage = signal('');
  readonly actionBannerKind = signal<'success' | 'error' | 'info'>('info');
  readonly comment = signal('');
  readonly commentValidationError = signal(false);

  // Per-selection F&B/Cafeteria state — only relevant when isCafeteriaSelectionView() is true.
  readonly selectionActionPending = signal<number | null>(null);
  readonly approveSelectionConfirm = signal<FmbSelection | null>(null);
  readonly resubmitSelectionConfirm = signal<FmbSelection | null>(null);

  // The Cafeteria Manager reviews F&B's fmb department task differently from every other
  // manager: instead of one atomic approve/resubmit for the whole task, each cafeteria
  // selection (request_fmb_selection row) has its own independent lifecycle. This flag
  // switches the template from the shared department-wide panel to the per-selection list.
  readonly isCafeteriaSelectionView = computed(() =>
    this.role() === UserRole.CafeteriaManager && this.departments().includes('fmb'),
  );

  readonly myCafeteriaSelections = computed<readonly FmbSelection[]>(() => this.proposal()?.fmbSelections ?? []);

  readonly canAct = computed(() => {
    if (this.readOnly()) return false;
    const proposal = this.proposal();
    if (!proposal) return false;
    const department = this.departments()[0];
    if (!department) return false;
    return !proposal.workflow.departmentConfirmations.find((entry) => entry.department === department)?.confirmed;
  });

  readonly commentRequired = computed(() => this.comment().trim().length === 0);

  readonly actionBannerIcon = computed(() => {
    const kind = this.actionBannerKind();
    if (kind === 'success') return 'check_circle';
    if (kind === 'error') return 'error';
    return 'info';
  });

  readonly reviewerComments = computed<readonly ReviewerComment[]>(() => {
    const proposal = this.proposal();
    if (!proposal?.workflow.reviewerComment) return [];
    return [{
      stage: 'Reviewer Comment',
      reviewer: 'Reviewer',
      initials: 'REV',
      text: proposal.workflow.reviewerComment,
    }];
  });

  readonly requestColumns: readonly ProposalTableColumn[] = [
    { key: 'item', label: 'Requirement / Item', width: '15rem' },
    { key: 'quantity', label: 'Quantity', width: '10rem' },
    { key: 'schedule', label: 'Schedule', width: '15rem' },
    { key: 'location', label: 'Location', width: '12rem' },
    { key: 'notes', label: 'Notes', width: '17rem' },
  ];

  readonly requestRows = computed<readonly EditableRow[]>(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const departments = this.departments();
    return proposal.requests.filter((request) => !departments.length || departments.includes(request.department)).map((request) => ({ ...request }));
  });

  constructor() {
    this.directory.users$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((users) => {
      const role = this.staffRole();
      this.staffUsers.set(role ? users.filter((user) => user.active && user.role === role).map(({ email, displayName }) => ({ email, displayName })) : []);
    });
  }

  onCommentInput(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
    if (this.commentValidationError()) this.commentValidationError.set(false);
  }

  selectionStatusLabel(status: FmbSelection['status']): string {
    switch (status) {
      case 'pending': return 'Awaiting your review';
      case 'approved': return 'Approved — in Cafeteria Staff inbox';
      case 'resubmitted': return 'Sent back to F&B';
      case 'preparing': return 'Being prepared';
      case 'fulfilled': return 'Fulfilled';
      case 'cancelled': return 'Cancelled';
    }
  }

  openApproveModal(): void {
    this.approveConfirm.set(true);
  }

  confirmApprove(): void {
    this.approveConfirm.set(false);
    this.approve();
  }

  approve(): void {
    const proposal = this.proposal();
    const department = this.departments()[0];
    if (!proposal || !department) return;
    this.confirming.set(true);
    this.actionMessage.set('');
    const confirmedByEmail = this.auth.user()?.email ?? '';
    this.workflow.confirmDepartment(proposal.id, department, confirmedByEmail).pipe(finalize(() => this.confirming.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('success'); this.actionMessage.set('Fulfilment confirmed.'); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not confirm fulfilment. Please try again.'); },
    });
  }

  openResubmitModal(): void {
    if (this.comment().trim().length === 0) {
      this.commentValidationError.set(true);
      return;
    }
    this.commentValidationError.set(false);
    this.resubmitConfirm.set(true);
  }

  confirmResubmit(): void {
    this.resubmitConfirm.set(false);
    this.resubmit(this.comment().trim());
  }

  resubmit(comment: string): void {
    const proposal = this.proposal();
    const department = this.departments()[0];
    if (!proposal || !department) return;
    this.resubmitting.set(true);
    this.workflow.resubmitAsDepartment(proposal.id, department, comment).pipe(finalize(() => this.resubmitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('info'); this.actionMessage.set('Sent back to the applicant with your comment.'); this.comment.set(''); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not resubmit. Please try again.'); },
    });
  }

  openApproveSelectionModal(selection: FmbSelection): void {
    this.approveSelectionConfirm.set(selection);
  }

  confirmApproveSelection(): void {
    const selection = this.approveSelectionConfirm();
    this.approveSelectionConfirm.set(null);
    if (selection) this.approveSelection(selection);
  }

  private approveSelection(selection: FmbSelection): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.selectionActionPending.set(selection.id);
    this.actionMessage.set('');
    this.workflow.approveFmbSelection(proposal.id, selection.id).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('success'); this.actionMessage.set('Order approved and sent to Cafeteria Staff.'); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not approve this order. Please try again.'); },
    });
  }

  openResubmitSelectionModal(selection: FmbSelection): void {
    this.resubmitSelectionConfirm.set(selection);
  }

  confirmResubmitSelection(): void {
    const selection = this.resubmitSelectionConfirm();
    this.resubmitSelectionConfirm.set(null);
    if (selection) this.resubmitSelection(selection);
  }

  private resubmitSelection(selection: FmbSelection): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.selectionActionPending.set(selection.id);
    this.workflow.resubmitFmbSelection(proposal.id, selection.id).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('info'); this.actionMessage.set('Sent back to F&B for this order only.'); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not resubmit this order. Please try again.'); },
    });
  }

  assignRequests(): void {
    const proposal = this.proposal();
    const assignedToEmail = this.assigneeEmail();
    const role = this.staffRole();
    const departments = this.departments();
    if (!proposal || !assignedToEmail || !role) return;
    const requests = proposal.requests.filter((request) => departments.includes(request.department));
    if (!requests.length) return;
    this.assigning.set(true);
    forkJoin(requests.map((request) => this.tasks.assign({
      role, assignedToEmail, eventCode: proposal.proposalId, eventTitle: proposal.eventTitle,
      request: request.item, quantity: request.quantity, schedule: request.schedule, location: request.location,
      detailLabel: 'Department notes', detail: request.notes,
    }))).pipe(finalize(() => this.assigning.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.assignmentMessage.set(`Assigned to ${this.staffUsers().find((user) => user.email === assignedToEmail)?.displayName ?? assignedToEmail}.`),
      error: () => this.assignmentMessage.set('The request could not be assigned. Please try again.'),
    });
  }
}
```

Note: this task ADDS two new methods to `ProposalWorkflowService`/`ProposalWorkflowRepository` — `approveFmbSelection(proposalId: number, selectionId: number): Observable<ProposalReviewRecord>` and `resubmitFmbSelection(proposalId: number, selectionId: number): Observable<ProposalReviewRecord>`. Task 2.10 adds these to the repository interface and its Api implementation; until Task 2.10 lands, this file will not compile (expected — Task 2.10 is next).

- [ ] **Step 4: Add styles for the new per-selection list**

Read `fyp-ui/src/app/shared/components/proposal-department-view/proposal-department-view.scss` in full first to see existing class naming conventions (`.prv-*` prefix, likely reused from a shared partial). Append these rules at the end of the file:

```scss
.prv-fmb-selections {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.prv-fmb-selections__empty {
  margin: 0;
  color: var(--apu-text-soft, #6b7280);
  font-size: 0.9rem;
}

.prv-fmb-selection {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--apu-border, #e5e7eb);
  border-radius: 0.75rem;
  background: var(--apu-surface, #fff);
}

.prv-fmb-selection[data-status='resubmitted'] {
  border-color: var(--apu-amber-400, #fbbf24);
  background: var(--apu-amber-50, #fffbeb);
}

.prv-fmb-selection[data-status='fulfilled'],
.prv-fmb-selection[data-status='cancelled'] {
  opacity: 0.7;
}

.prv-fmb-selection__body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.prv-fmb-selection__row {
  display: flex;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.prv-fmb-selection__label {
  min-width: 6rem;
  color: var(--apu-text-soft, #6b7280);
}

.prv-fmb-selection__status {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--apu-blue-700, #1d4ed8);
}

.prv-fmb-selection__actions {
  display: flex;
  gap: 0.5rem;
}
```

If the file's existing CSS custom property names differ from the placeholders used above (`--apu-text-soft`, `--apu-border`, `--apu-surface`, `--apu-amber-400`, `--apu-amber-50`, `--apu-blue-700`), replace them with whatever the file's actual existing rules use — check the top of the file or a sibling `.scss` file in the same directory for the real token names before finalizing.

- [ ] **Step 5: Run affected tests and confirm no NEW compile errors in these two files specifically**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "proposal-reviewer-view|proposal-department-view"
```

Expected: errors referencing `ProposalWorkflowService.approveFmbSelection`/`resubmitFmbSelection` not existing yet (resolved in Task 2.10) — no other errors should reference these two files. If other errors appear, read them and fix inline before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/app/core/proposals/proposal-review.models.ts src/app/shared/components/proposal-reviewer-view/proposal-reviewer-view.ts src/app/shared/components/proposal-department-view/proposal-department-view.ts src/app/shared/components/proposal-department-view/proposal-department-view.scss
git commit -m "feat(proposal-department-view): add per-selection F&B/Cafeteria Manager review UI; fix(proposal-reviewer-view): new stage enum, drop client-side stage ownership check"
```

---

### Task 2.10: Collapse the 4 Mock/Api repository pairs to Api-only; add F&B selection methods

**Files:**
- Modify: `fyp-ui/src/app/core/proposals/proposal-workflow.repository.ts` (full file)
- Modify: `fyp-ui/src/app/core/proposals/proposal-workflow.service.ts` (full file)
- Modify: `fyp-ui/src/app/core/request-options/request-option.repository.ts` (full file)
- Modify: `fyp-ui/src/app/core/admin-directory/admin-directory.repository.ts` (full file)
- Modify: `fyp-ui/src/app/core/staff-tasks/staff-task.repository.ts` (full file — collapses the transitional Mock class from Task 2.6)
- Modify: `fyp-ui/src/environments/environment.ts` (full file — remove `useMock*` flags for these 4 domains)
- Delete: `fyp-ui/src/app/core/proposals/proposal-review.mock-data.ts` (no longer referenced by any repository after this task — Phase 3's Express server owns the seed data instead)
- Delete: `fyp-ui/src/app/core/request-options/request-option.mock-data.ts`
- Delete: `fyp-ui/src/app/core/admin-directory/admin-directory.mock-data.ts` (verify it's only referenced by `admin-directory.repository.ts` before deleting — check for other importers first)

**Interfaces:**
- Consumes: everything from Tasks 2.1-2.9.
- Produces: every repository now has exactly one class (no `Mock*`/`Api*` split, no `InjectionToken` factory branching on `environment.useMock*`) implementing its existing interface. `ProposalWorkflowRepository` gains `approveFmbSelection(proposalId: number, selectionId: number): Observable<ProposalReviewRecord>` and `resubmitFmbSelection(proposalId: number, selectionId: number): Observable<ProposalReviewRecord>`. `ProposalWorkflowService` exposes the same two new methods (proxying to the repository), consumed by Task 2.9's `proposal-department-view.ts`.

**Note:** after this task, the Angular app CANNOT run standalone — every repository now calls a real HTTP endpoint that doesn't exist until Phase 3 builds the server and Phase 4 wires the dev-server proxy. This is expected. Do not attempt to `ng serve` and manually click through the app until Phase 4's verification step.

- [ ] **Step 1: Rewrite `proposal-workflow.repository.ts`**

Replace the entire contents of `fyp-ui/src/app/core/proposals/proposal-workflow.repository.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';

export interface ProposalWorkflowRepository {
  list(): Observable<readonly ProposalReviewRecord[]>;
  getById(id: number): Observable<ProposalReviewRecord | undefined>;
  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord>;
  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord>;
  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord>;
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord>;
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord>;
  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord>;
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord>;
  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord>;
  resubmitFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord>;
}

@Injectable({ providedIn: 'root' })
export class ApiProposalWorkflowRepository implements ProposalWorkflowRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.proposalWorkflowApiUrl;
  list(): Observable<readonly ProposalReviewRecord[]> { return this.http.get<readonly ProposalReviewRecord[]>(this.baseUrl); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.http.get<ProposalReviewRecord>(`${this.baseUrl}/${id}`); }
  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/approve`, { reviewerRole }); }
  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/reject`, { reviewerRole, reason }); }
  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit`, { reviewerRole, comment }); }
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/confirm-department`, { department, confirmedByEmail }); }
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-department`, { department, comment }); }
  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-applicant`, updates); }
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/cancel`, { cancelledBy }); }
  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections/${selectionId}/approve`, {}); }
  resubmitFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections/${selectionId}/resubmit`, {}); }
}

export const PROPOSAL_WORKFLOW_REPOSITORY = new InjectionToken<ProposalWorkflowRepository>('PROPOSAL_WORKFLOW_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiProposalWorkflowRepository),
});
```

- [ ] **Step 2: Update `proposal-workflow.service.ts`**

Add the two new proxy methods. Append to the class body, after `cancelProposal`:

```typescript
  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.repository.approveFmbSelection(id, selectionId);
  }

  resubmitFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFmbSelection(id, selectionId);
  }
```

The full file becomes:

```typescript
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';
import { PROPOSAL_WORKFLOW_REPOSITORY } from './proposal-workflow.repository';

@Injectable({ providedIn: 'root' })
export class ProposalWorkflowService {
  private readonly repository = inject(PROPOSAL_WORKFLOW_REPOSITORY);

  list(): Observable<readonly ProposalReviewRecord[]> { return this.repository.list(); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.repository.getById(id); }

  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord> {
    return this.repository.approveAsReviewer(id, reviewerRole);
  }

  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord> {
    return this.repository.rejectAsReviewer(id, reviewerRole, reason);
  }

  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitAsReviewer(id, reviewerRole, comment);
  }

  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.confirmDepartment(id, department, confirmedByEmail);
  }

  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitAsDepartment(id, department, comment);
  }

  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFromApplicant(id, updates);
  }

  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> {
    return this.repository.cancelProposal(id, cancelledBy);
  }

  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.repository.approveFmbSelection(id, selectionId);
  }

  resubmitFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFmbSelection(id, selectionId);
  }
}
```

- [ ] **Step 3: Rewrite `request-option.repository.ts`**

Replace the entire contents of `fyp-ui/src/app/core/request-options/request-option.repository.ts` with:

```typescript
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { RequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository } from './request-option.models';
import { RequestOptionDto, mapRequestOptionResponse, mapRequestOptionWrite } from './request-option.mapper';

@Injectable({ providedIn: 'root' })
export class ApiRequestOptionRepository implements RequestOptionRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.requestOptionsApiUrl;

  getOptions(query: RequestOptionQuery): Observable<readonly RequestOption[]> {
    let params = new HttpParams();
    if (query.kinds?.length) params = params.set('kinds', query.kinds.join(','));
    if (query.activeOnly) params = params.set('active', 'true');
    if (query.search) params = params.set('search', query.search);
    return this.http.get<readonly RequestOptionDto[]>(this.baseUrl, { params }).pipe(map((options) => options.map(mapRequestOptionResponse)));
  }
  getOption(id: string): Observable<RequestOption> { return this.http.get<RequestOptionDto>(`${this.baseUrl}/${encodeURIComponent(id)}`).pipe(map(mapRequestOptionResponse)); }
  createOption(draft: RequestOptionDraft): Observable<RequestOption> { return this.http.post<RequestOptionDto>(this.baseUrl, mapRequestOptionWrite(draft)).pipe(map(mapRequestOptionResponse)); }
  updateOption(id: string, draft: RequestOptionDraft): Observable<RequestOption> { return this.http.put<RequestOptionDto>(`${this.baseUrl}/${encodeURIComponent(id)}`, mapRequestOptionWrite(draft)).pipe(map(mapRequestOptionResponse)); }
  setOptionActive(id: string, active: boolean): Observable<RequestOption> { return this.http.patch<RequestOptionDto>(`${this.baseUrl}/${encodeURIComponent(id)}/status`, { active }).pipe(map(mapRequestOptionResponse)); }
  deleteOption(id: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/${encodeURIComponent(id)}`); }
}

export const REQUEST_OPTION_REPOSITORY = new InjectionToken<RequestOptionRepository>('REQUEST_OPTION_REPOSITORY', {
  providedIn: 'root',
  factory: () => inject(ApiRequestOptionRepository),
});
```

- [ ] **Step 4: Rewrite `admin-directory.repository.ts`**

Replace the entire contents of `fyp-ui/src/app/core/admin-directory/admin-directory.repository.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminDirectoryRepository, AdminUnitDraft, AdminUnitRecord, AdminUserDraft, AdminUserRecord } from './admin-directory.models';

@Injectable({ providedIn: 'root' })
export class ApiAdminDirectoryRepository implements AdminDirectoryRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.adminDirectoryApiUrl;
  getUsers(): Observable<readonly AdminUserRecord[]> { return this.http.get<readonly AdminUserRecord[]>(`${this.baseUrl}/users`); }
  getUnits(): Observable<readonly AdminUnitRecord[]> { return this.http.get<readonly AdminUnitRecord[]>(`${this.baseUrl}/units`); }
  createUser(draft: AdminUserDraft): Observable<AdminUserRecord> { return this.http.post<AdminUserRecord>(`${this.baseUrl}/users`, draft); }
  updateUser(id: string, draft: AdminUserDraft): Observable<AdminUserRecord> { return this.http.put<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}`, draft); }
  setUserActive(id: string, active: boolean): Observable<AdminUserRecord> { return this.http.patch<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}/status`, { active }); }
  createUnit(draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.http.post<AdminUnitRecord>(`${this.baseUrl}/units`, draft); }
  updateUnit(id: string, draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.http.put<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}`, draft); }
  setUnitActive(id: string, active: boolean): Observable<AdminUnitRecord> { return this.http.patch<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}/status`, { active }); }
}

export const ADMIN_DIRECTORY_REPOSITORY = new InjectionToken<AdminDirectoryRepository>('ADMIN_DIRECTORY_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiAdminDirectoryRepository),
});
```

- [ ] **Step 5: Rewrite `staff-task.repository.ts`**

Replace the entire contents of `fyp-ui/src/app/core/staff-tasks/staff-task.repository.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskStatus } from './staff-task.models';

@Injectable({ providedIn: 'root' })
export class ApiStaffTaskRepository implements StaffTaskRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.staffTasksApiUrl;
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.http.get<readonly StaffTask[]>(this.baseUrl, { params: { role, assignedToEmail } }); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> { return this.http.post<StaffTask>(`${this.baseUrl}/assignments`, draft); }
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask> { return this.http.patch<StaffTask>(`${this.baseUrl}/${encodeURIComponent(id)}/status`, { status }); }
}

export const STAFF_TASK_REPOSITORY = new InjectionToken<StaffTaskRepository>('STAFF_TASK_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiStaffTaskRepository),
});
```

- [ ] **Step 6: Update `environment.ts`**

Read `fyp-ui/src/environments/environment.ts` in full (already confirmed earlier in this planning session):

```typescript
import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  useMockRequestOptions: true,
  requestOptionsApiUrl: '/api/request-options',
  useMockAdminDirectory: true,
  adminDirectoryApiUrl: '/api/admin',
  useMockStaffTasks: true,
  staffTasksApiUrl: '/api/staff-tasks',
  useMockEventEngagement: true,
  eventEngagementApiUrl: '/api/event-engagement',
  useMockProposalWorkflow: true,
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  mockUsers: MOCK_AUTH_USERS,
} as const;
```

Replace with (removes the 4 now-meaningless `useMock*` flags for domains collapsed in this task; `enableMockAuth`/`mockUsers`/`useMockEventEngagement`/`eventEngagementApiUrl` stay for now — Task 2.11 and Phase 3/4 handle auth and events separately):

```typescript
import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  requestOptionsApiUrl: '/api/request-options',
  adminDirectoryApiUrl: '/api/admin',
  staffTasksApiUrl: '/api/staff-tasks',
  useMockEventEngagement: true,
  eventEngagementApiUrl: '/api/event-engagement',
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  mockUsers: MOCK_AUTH_USERS,
} as const;
```

- [ ] **Step 7: Delete the three now-unreferenced mock-data files**

First confirm nothing else imports them:

```bash
cd "fyp-ui" && grep -rn "proposal-review.mock-data\|request-option.mock-data\|admin-directory.mock-data" src/app --include="*.ts" | grep -v "\.spec\.ts"
```

Expected: no output (both repository files that imported them were just rewritten to drop the import in Steps 1, 3, 4). If any non-spec file still imports one of these three, stop and fix that importer first — do not delete a file still in use.

Then delete:

```bash
rm src/app/core/proposals/proposal-review.mock-data.ts
rm src/app/core/request-options/request-option.mock-data.ts
rm src/app/core/admin-directory/admin-directory.mock-data.ts
```

- [ ] **Step 8: Full project typecheck**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -150
```

This is the first point in Phase 2 where the ENTIRE app should typecheck cleanly (Tasks 2.1-2.9 individually left known, documented gaps that are now closed). Read every remaining error carefully:
- If an error traces to a test file (`.spec.ts`) that this plan hasn't touched yet, note it — Task 2.11 handles remaining spec fixes.
- If an error traces to a non-test file not covered by any task above, it means this plan's file survey missed something. Fix it directly, following the same `fnb`→`fmb` / stage-rename / role-merge patterns established in the tasks above, and note in your task completion summary which untracked file needed a fix.

- [ ] **Step 9: Commit**

```bash
git add src/app/core/proposals/proposal-workflow.repository.ts src/app/core/proposals/proposal-workflow.service.ts src/app/core/request-options/request-option.repository.ts src/app/core/admin-directory/admin-directory.repository.ts src/app/core/staff-tasks/staff-task.repository.ts src/environments/environment.ts
git rm src/app/core/proposals/proposal-review.mock-data.ts src/app/core/request-options/request-option.mock-data.ts src/app/core/admin-directory/admin-directory.mock-data.ts
git commit -m "refactor: collapse Mock/Api repository pairs to Api-only (server owns all state now); add F&B per-selection workflow endpoints"
```

---

### Task 2.11: Fix remaining spec files and run the full Angular test suite

**Files:**
- Modify: any `.spec.ts` file flagged by Step 8 of Task 2.10 as still referencing deleted mock data, deleted roles, or old stage names (exact list determined at execution time — see Step 1 below).

**Interfaces:**
- Consumes: everything from Tasks 2.1-2.10.
- Produces: a fully green `ng test` run — the exit criterion for Phase 2.

- [ ] **Step 1: Find every spec file still referencing anything this phase removed or renamed**

```bash
cd "fyp-ui" && grep -rln "FmbReviewer\|FmbManager\|FmbWaterServicesStaff\|FmbReviewerPending\|NeedsRevision\|'fnb'\|\"fnb\"\|campusTourArea\|campusTourMap\|reviewerRoleForStage\|initialWorkflowState\|reviewerChainForPax\|nextStageAfterApproval\|applyReviewerApproval\|applyReviewerRejection\|applyReviewerResubmit\|applyApplicantResubmit\|applyDepartmentConfirmation\|applyDepartmentResubmit\|roleOwnsWorkflowAction" src/app --include="*.spec.ts"
```

- [ ] **Step 2: Fix each flagged file**

For each file the Step 1 command lists, read it in full and apply the same category of fix used elsewhere in this phase:
- `FmbReviewer`/`FmbManager` → `UserRole.Fmb`
- `FmbWaterServicesStaff` → remove the reference entirely (adjust the test's premise if it specifically tested this role's behavior — note in your task summary if a test's entire scenario had to be dropped because the role it exercised no longer exists)
- `FmbReviewerPending` → `ProposalStage.FmbReview`
- `NeedsRevision` → `ProposalStage.ResubmissionRequired`
- `'fnb'` string literal → `'fmb'`
- `campusTourArea`/`campusTourMap` → remove the reference (adjust the test's row/column count expectations accordingly if it asserted on array length)
- Any call to a deleted transition function (`initialWorkflowState`, `reviewerChainForPax`, `nextStageAfterApproval`, `applyReviewerApproval`, `applyReviewerRejection`, `applyReviewerResubmit`, `applyApplicantResubmit`, `applyDepartmentConfirmation`, `applyDepartmentResubmit`, `roleOwnsWorkflowAction`, `reviewerRoleForStage`) → this function no longer exists in `proposal-status.models.ts` (Task 2.3 deleted it). If the spec file testing it is `proposal-status.models.spec.ts` itself, it was already fully replaced in Task 2.3 Step 2 — if grep still finds a match there, Task 2.3 wasn't actually applied; re-check. If it's a DIFFERENT spec file (e.g. a component spec that imported one of these functions to build test fixtures), replace the fixture construction with a plain object literal matching `ProposalWorkflowState`'s shape directly (e.g. `{ stage: ProposalStage.HosHodReview, departmentConfirmations: [] }`) instead of calling the deleted builder function.

- [ ] **Step 3: Run the complete Angular test suite**

```bash
cd "fyp-ui" && npx ng test --watch=false 2>&1 | tail -200
```

Expected: all tests PASS, zero compile errors. If failures remain, read each one — for TypeScript compile errors, trace back to the exact file/line and apply the pattern-matched fix from Step 2's list; for actual assertion failures (test ran but expected≠actual), read the specific test's intent and determine whether the test's expectation is stale (fix the test) or the production code has a genuine bug introduced by this phase's edits (fix the production code) — do not blindly change expected values to match whatever the code currently outputs without understanding why they differ.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: fix remaining spec files for Phase 2's role/stage/kind renames"
```

This closes Phase 2. The Angular app will not run end-to-end again until Phase 4 (it now expects a real `/api/*` backend) — this is expected and by design.

---

## Phase 2b: Extend Auth, Events, Saved Events, System Config, and Image Upload to REST

These 5 domains are currently pure client-side (Angular signals + `localStorage`, zero `HttpClient` usage). Per the design spec, every domain routes through the mock server so the whole system — not just proposals/options/directory/tasks — can be validated end-to-end. This phase adds a real HTTP-calling implementation for each, following the same Api-class pattern used in Phase 2, without a Mock/InjectionToken split (since Task 2.10 already established that the mock server itself IS the "mock," not a second client-side layer).

### Task 2.12: Convert `AuthService` to call a real `/api/auth` login endpoint

**Files:**
- Modify: `fyp-ui/src/app/core/auth/auth.service.ts` (full file)
- Modify: `fyp-ui/src/environments/environment.ts` (add `authApiUrl`)

**Interfaces:**
- Consumes: `AuthUser` (unchanged shape, `auth.models.ts`).
- Produces: `AuthService.login(email, password): Observable<{ success: true; user: AuthUser } | { success: false; message: string }>` — CHANGES from synchronous return to `Observable` (a breaking change for every caller — Task 2.13 below must find and fix all of them). Session persistence to `localStorage` is UNCHANGED (still purely client-side — the design spec's mock-only password field lives server-side now, but the session token/cookie mechanism is out of scope per the design spec's "Out of Scope" section; `localStorage`-backed session continuity stays as-is).

- [ ] **Step 1: Add `authApiUrl` to `environment.ts`**

In `fyp-ui/src/environments/environment.ts` (as left by Task 2.10 Step 6), add one field. Full updated file:

```typescript
import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  authApiUrl: '/api/auth',
  requestOptionsApiUrl: '/api/request-options',
  adminDirectoryApiUrl: '/api/admin',
  staffTasksApiUrl: '/api/staff-tasks',
  useMockEventEngagement: true,
  eventEngagementApiUrl: '/api/event-engagement',
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  mockUsers: MOCK_AUTH_USERS,
} as const;
```

`mockUsers`/`enableMockAuth` stay — they're no longer used by `AuthService.login()` after this task (Step 2 below removes that usage), but `mock-users.ts`'s `MOCK_AUTH_USERS` array is still the fixture Phase 3's server seed data is built from (Task 3.x reads this file directly to generate `seed-users.js`), so keep the export; nothing else in Angular references `environment.mockUsers` after this task, which is fine — it's inert but harmless, and removing it isn't necessary for correctness. Leave `enableMockAuth`/`mockUsers` in place.

- [ ] **Step 2: Rewrite `auth.service.ts`**

Replace the entire contents of `fyp-ui/src/app/core/auth/auth.service.ts` with:

```typescript
import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, UserRole } from './auth.models';
import { ROLE_NAVIGATION, roleCanAccess } from './role-navigation';

const STORAGE_KEY = 'apu-ems-auth-user';
const SESSION_VERSION = 1;

interface PersistedSession {
  readonly version: number;
  readonly user: AuthUser;
}

export type LoginResult = { success: true; user: AuthUser } | { success: false; message: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  readonly user = signal<AuthUser | null>(this.restoreUser());
  readonly authenticated = computed(() => this.user() !== null);
  readonly isInternalUser = computed(() => this.user()?.accountType === 'internal');
  readonly isExternalUser = computed(() => this.user()?.accountType === 'external');
  readonly navigation = computed(() => this.user() ? ROLE_NAVIGATION[this.user()!.role] : null);
  readonly defaultRoute = computed(() => this.isExternalUser() ? '/' : this.navigation()?.defaultRoute ?? '/login');

  login(email: string, password: string): Observable<LoginResult> {
    return this.http.post<AuthUser>(`${environment.authApiUrl}/login`, { email: email.trim().toLowerCase(), password }).pipe(
      map((user) => {
        this.user.set(user);
        this.writeUser(user);
        return { success: true, user } as const;
      }),
      catchError(() => of<LoginResult>({ success: false, message: 'The email or password is incorrect.' })),
    );
  }

  canAccess(url: string): boolean { const user = this.user(); return !!user && roleCanAccess(user.role, url); }

  establishSession(user: AuthUser): void {
    this.user.set(user);
    this.writeUser(user);
  }

  logout(): void {
    this.user.set(null);
    try { this.document.defaultView?.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  private restoreUser(): AuthUser | null {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as PersistedSession | AuthUser;
      if ('user' in stored && stored.version !== SESSION_VERSION) return null;
      const parsed = 'user' in stored ? stored.user : stored;
      const normalized: AuthUser = { ...parsed, accountType: parsed.accountType ?? (parsed.role === UserRole.ExternalUser ? 'external' : 'internal') };
      const accountTypeMatchesRole = normalized.accountType === 'external'
        ? normalized.role === UserRole.ExternalUser
        : normalized.role !== UserRole.ExternalUser;
      return normalized.email && normalized.displayName && normalized.role && accountTypeMatchesRole ? normalized : null;
    } catch { return null; }
  }
  private writeUser(user: AuthUser): void {
    try { this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION, user } satisfies PersistedSession)); } catch { /* Storage may be unavailable. */ }
  }
}
```

Notes on what changed from the original:
- `login()` now returns `Observable<LoginResult>` (new exported type `LoginResult`) instead of a synchronous union type — calls `POST /api/auth/login` with `{ email, password }`, expects the server to respond with the `AuthUser` object directly (200) or a non-2xx status on bad credentials (caught and turned into the existing `{ success: false, message }` shape via `catchError`).
- Removed `restoreExternalAccounts()` and the `EXTERNAL_ACCOUNTS_STORAGE_KEY`/`PersistedExternalAccount` lookup — external (guest) accounts are now just rows in the server's `users` table with `role='external_user'`, looked up the same way as any other login. Task 2.13 updates `external-registration.service.ts` accordingly (it still calls `establishSession()` directly after OTP verification, which is unchanged — that path never went through `login()`).
- Removed the `environment.enableMockAuth` / `environment.mockUsers` gate inside `login()` — real HTTP call now, no client-side check needed.

- [ ] **Step 3: Commit**

```bash
cd "fyp-ui" && git add src/app/core/auth/auth.service.ts src/environments/environment.ts
git commit -m "refactor(auth): convert login() to a real POST /api/auth/login HTTP call"
```

(This will not compile cleanly yet — every caller of the old synchronous `login()` needs updating. Task 2.13 fixes them. Committing here keeps the diff reviewable in isolated steps, consistent with the rest of this plan.)

---

### Task 2.13: Fix every caller of the now-async `AuthService.login()`; simplify `external-registration.service.ts`

**Files:**
- Modify: `fyp-ui/src/app/features/auth/login/login.ts` (find and fix the `login()` call site)
- Modify: `fyp-ui/src/app/core/auth/external-registration.service.ts` (full file — remove the now-unused `localStorage` persistence, keep the OTP simulation as-is per design spec's "Out of Scope: real authentication/hashing/session security")
- Modify: `fyp-ui/src/app/core/auth/auth.models.ts` (remove `EXTERNAL_ACCOUNTS_STORAGE_KEY`/`PersistedExternalAccount` if no longer referenced anywhere — verify in Step 3)

**Interfaces:**
- Consumes: `AuthService.login(): Observable<LoginResult>` from Task 2.12.
- Produces: a login page component that correctly subscribes to the new Observable instead of expecting a synchronous return.

- [ ] **Step 1: Find and read the login page's current call site**

```bash
cd "fyp-ui" && grep -n "\.login(" src/app/features/auth/login/login.ts
```

Read the full file (it wasn't read earlier in this planning session — read it now before editing) to see the exact surrounding code (likely a `submit()` method that currently does something like `const result = this.auth.login(email, password); if (result.success) { ... } else { ... }`).

- [ ] **Step 2: Update the call site to subscribe instead of reading a synchronous return**

Change the synchronous pattern:

```typescript
const result = this.auth.login(email, password);
if (result.success) {
  // navigate / set state
} else {
  // show result.message
}
```

to the Observable pattern (adapt variable/signal names to whatever the actual file uses — the shape of the fix is: wrap the existing success/failure branches inside a `.subscribe()` callback, and set a `submitting`/`loading` signal around the call if the component has one, matching the pattern already used elsewhere in this codebase, e.g. `event-proposal.ts`'s `resubmitting` signal or `proposal-department-view.ts`'s `confirming` signal):

```typescript
this.auth.login(email, password).subscribe((result) => {
  if (result.success) {
    // (unchanged) navigate / set state
  } else {
    // (unchanged) show result.message
  }
});
```

If the component already has a `submitting`/`loading` signal guarding the submit button (check the file — earlier context showed `login.html` has `[disabled]="submitting()"` and `{{ submitting() ? 'Signing in...' : 'Sign In' }}`), wrap the call:

```typescript
this.submitting.set(true);
this.auth.login(email, password).subscribe({
  next: (result) => {
    this.submitting.set(false);
    if (result.success) {
      // (unchanged) navigate / set state
    } else {
      // (unchanged) show result.message
    }
  },
  error: () => {
    this.submitting.set(false);
    // (unchanged pattern) show a generic error message, matching this component's existing error-display convention
  },
});
```

(`AuthService.login()` as written in Task 2.12 already catches HTTP errors internally via `catchError` and resolves to `{ success: false, ... }` rather than erroring the Observable, so the `error:` branch above is a defensive fallback, not the primary failure path — but include it since `takeUntilDestroyed` / other operators in this codebase's convention always pair `next`/`error` when subscribing manually, per the pattern seen in `proposal-reviewer-view.ts`'s `approve()`/`reject()`/`resubmit()` methods.)

- [ ] **Step 3: Simplify `external-registration.service.ts`**

Replace the entire contents of `fyp-ui/src/app/core/auth/external-registration.service.ts` with:

```typescript
import { Injectable, inject, signal } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { AuthUser, UserRole } from './auth.models';
import { AuthService } from './auth.service';
import {
  ExternalRegistrationApi,
  ExternalUserRegistrationRequest,
  ExternalUserRegistrationResponse,
  VerifyExternalOtpRequest,
  VerifyExternalOtpResponse,
} from '../events/event-engagement.models';

interface PendingChallenge { readonly request: ExternalUserRegistrationRequest; readonly otp: string; }

@Injectable({ providedIn: 'root' })
export class ExternalRegistrationService implements ExternalRegistrationApi {
  private readonly auth = inject(AuthService);
  private readonly challenges = new Map<string, PendingChallenge>();

  registerExternalUser(request: ExternalUserRegistrationRequest): Observable<ExternalUserRegistrationResponse> {
    const challengeId = `external-${Date.now()}`;
    const otp = '246810';
    this.challenges.set(challengeId, { request: { ...request, email: request.email.trim().toLowerCase() }, otp });
    return of({
      challengeId,
      status: 'otp-required' as const,
      maskedEmail: this.maskEmail(request.email),
      developmentOtp: otp,
    }).pipe(delay(260));
  }

  verifyOtp(request: VerifyExternalOtpRequest): Observable<VerifyExternalOtpResponse> {
    const challenge = this.challenges.get(request.challengeId);
    if (!challenge) return of<VerifyExternalOtpResponse>({ status: 'expired', message: 'This verification request has expired.' }).pipe(delay(180));
    if (!/^\d{6}$/.test(request.otp.trim())) return of<VerifyExternalOtpResponse>({ status: 'invalid', message: 'The verification code is incorrect.' }).pipe(delay(180));

    const user: AuthUser = {
      email: challenge.request.email,
      displayName: challenge.request.firstName,
      username: challenge.request.email.split('@', 1)[0],
      role: UserRole.ExternalUser,
      accountType: 'external',
      roleLabel: 'Registered External User',
      department: 'External Community',
    };
    this.challenges.delete(request.challengeId);
    this.auth.establishSession(user);
    return of<VerifyExternalOtpResponse>({ status: 'verified', user, message: 'Your account has been verified.' }).pipe(delay(220));
  }

  private maskEmail(email: string): string {
    const [name = '', domain = ''] = email.trim().split('@');
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
  }
}

@Injectable({ providedIn: 'root' })
export class GuestRegistrationFlowService {
  readonly open = signal(false);
  readonly pendingEventId = signal<string | null>(null);
  readonly returnUrl = signal<string | null>(null);
  readonly initialView = signal<'login' | 'register'>('login');

  requestForEvent(eventId: string): void { this.pendingEventId.set(eventId); this.returnUrl.set(null); this.initialView.set('login'); this.open.set(false); }
  requestForSavedEvents(): void { this.requestLogin('/my-events/saved'); }
  requestLogin(returnUrl: string | null = null): void { this.pendingEventId.set(null); this.returnUrl.set(returnUrl); this.initialView.set('login'); this.open.set(false); }
  requestRegistration(returnUrl: string | null = null): void { this.pendingEventId.set(null); this.returnUrl.set(returnUrl); this.initialView.set('register'); this.open.set(false); }
  close(): void { this.open.set(false); this.pendingEventId.set(null); this.returnUrl.set(null); this.initialView.set('login'); }
}
```

Note: this DOES NOT call the server to actually create the user record — this is a deliberate, documented gap. Per the design spec, real file/auth infrastructure is out of scope; the OTP flow remains a client-side simulation (matching the design spec's explicit "Out of Scope: real authentication/hashing/session security"), but `establishSession()` now sets a session for a user who was never persisted server-side. This means an external/guest user created this way can browse as themselves in the CURRENT session (their `AuthUser` object lives in `localStorage`) but a fresh server restart plus a page reload that re-validates against the server (which nothing in this plan currently does — `restoreUser()` only reads `localStorage`, never re-validates with the server) would not break this. Flag this gap explicitly in your task completion summary — it's an acceptable simplification for a mock/demo backend per the design spec's scope, not an oversight, but it's worth the user knowing about explicitly since a real backend would need registration to create a server-side row.

- [ ] **Step 4: Remove now-unused exports from `auth.models.ts`**

```bash
cd "fyp-ui" && grep -rn "EXTERNAL_ACCOUNTS_STORAGE_KEY\|PersistedExternalAccount" src/app --include="*.ts"
```

If the only remaining matches are the declarations themselves inside `auth.models.ts` (no other file imports them anymore, since Task 2.12 removed the only consumer in `auth.service.ts` and Step 3 above removed the only other consumer in `external-registration.service.ts`), remove both from `fyp-ui/src/app/core/auth/auth.models.ts`:

```typescript
export const EXTERNAL_ACCOUNTS_STORAGE_KEY = 'apu-ems-external-accounts';
```

and

```typescript
export interface PersistedExternalAccount {
  readonly user: AuthUser;
  readonly password: string;
}
```

If any other file still references them, leave them in place and note which file in your task summary — do not delete an export something else still imports.

- [ ] **Step 5: Full typecheck and test run for the auth domain**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -iE "auth|login" 
cd "fyp-ui" && npx ng test --watch=false --include='**/auth*.spec.ts' --include='**/login*.spec.ts' --include='**/external-registration*.spec.ts' 2>&1 | tail -100
```

Fix any failures using the same judgment criteria as Task 2.11 Step 3 (stale test expectation vs. genuine bug).

- [ ] **Step 6: Commit**

```bash
git add src/app/features/auth/login/login.ts src/app/core/auth/external-registration.service.ts src/app/core/auth/auth.models.ts
git commit -m "fix(auth): update login page for async login(), simplify external registration (server owns user records now)"
```

---

### Task 2.14: Convert `PublishedEventService` to call real `/api/events` endpoints

**Files:**
- Modify: `fyp-ui/src/app/core/events/published-event.service.ts` (full file)
- Modify: `fyp-ui/src/environments/environment.ts` (add `eventsApiUrl`, remove now-unused `useMockEventEngagement`/`eventEngagementApiUrl` — see Step 3)

**Interfaces:**
- Consumes: `PublishedEvent`, `EventRegistration`, `RegistrationResult` (unchanged shapes, `published-event.models.ts`).
- Produces: every method on `PublishedEventService` now returns an `Observable` backed by a real HTTP call instead of reading/writing an in-memory `signal` + `localStorage`. `events`/`registrations` signals are REMOVED (nothing else in the codebase should read them directly after this task — verify in Step 4). Methods that previously read `this.events()` synchronously inside another method (e.g. `getRegistrationCount`) now make their own HTTP call.

- [ ] **Step 1: Add `eventsApiUrl`, remove dead event-engagement flags**

`useMockEventEngagement`/`eventEngagementApiUrl` were declared in `environment.ts` from the start but never read by any Api class (confirmed in this plan's initial survey) — they become genuinely used for the first time only if Task 2.15 (saved events) needs them, so keep `eventEngagementApiUrl` but repurpose it as the saved-events/notification-preferences base URL (Task 2.15), and add a separate `eventsApiUrl` here for published events/registration. Full updated `environment.ts`:

```typescript
import { MOCK_AUTH_USERS } from '../app/core/auth/mock-users';

export const environment = {
  production: false,
  enableMockAuth: true,
  authApiUrl: '/api/auth',
  requestOptionsApiUrl: '/api/request-options',
  adminDirectoryApiUrl: '/api/admin',
  staffTasksApiUrl: '/api/staff-tasks',
  eventsApiUrl: '/api/events',
  eventEngagementApiUrl: '/api/event-engagement',
  proposalWorkflowApiUrl: '/api/proposal-workflow',
  configApiUrl: '/api/config',
  imageUploadApiUrl: '/api/uploads',
  mockUsers: MOCK_AUTH_USERS,
} as const;
```

(This also adds `configApiUrl` and `imageUploadApiUrl`, used by Tasks 2.16/2.17 below — adding them all now avoids a second partial edit to this file.)

- [ ] **Step 2: Rewrite `published-event.service.ts`**

Replace the entire contents of `fyp-ui/src/app/core/events/published-event.service.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EventRegistration, PublishedEvent, RegistrationResult } from './published-event.models';
import { EventRegistrationApi, RegisteredEventsResponse } from './event-engagement.models';

@Injectable({ providedIn: 'root' })
export class PublishedEventService implements EventRegistrationApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.eventsApiUrl;

  getPublishedEvents(): Observable<readonly PublishedEvent[]> { return this.http.get<readonly PublishedEvent[]>(this.baseUrl); }
  getEventDetails(id: string): Observable<PublishedEvent | undefined> { return this.http.get<PublishedEvent>(`${this.baseUrl}/${encodeURIComponent(id)}`); }
  getRegistrationCount(id: string): Observable<number> { return this.http.get<{ count: number }>(`${this.baseUrl}/${encodeURIComponent(id)}/registration-count`).pipe(map((response) => response.count)); }
  getPendingRegistrations(id: string): Observable<readonly EventRegistration[]> { return this.http.get<readonly EventRegistration[]>(`${this.baseUrl}/${encodeURIComponent(id)}/registrations`, { params: { status: 'pending' } }); }

  registrationStatus(eventId: string, email: string): EventRegistration['status'] | null {
    // Synchronous by design in the original API (used inline in template bindings) — this is
    // now unavailable without an HTTP round-trip. Callers that need this MUST switch to
    // `getPendingRegistrations`/a dedicated status observable instead. See Task 2.14 Step 5
    // for the search-and-fix pass across every caller of this method.
    throw new Error('registrationStatus() is synchronous and cannot be backed by HTTP — see Task 2.14 Step 5 for the replacement pattern at each call site.');
  }

  registerForEvent(eventId: string, email: string): Observable<RegistrationResult> {
    return this.http.post<RegistrationResult>(`${this.baseUrl}/${encodeURIComponent(eventId)}/register`, { email: email.trim().toLowerCase() });
  }
  approveRegistration(id: string): Observable<EventRegistration | undefined> { return this.http.post<EventRegistration>(`${this.baseUrl}/registrations/${encodeURIComponent(id)}/approve`, {}); }
  rejectRegistration(id: string): Observable<EventRegistration | undefined> { return this.http.post<EventRegistration>(`${this.baseUrl}/registrations/${encodeURIComponent(id)}/reject`, {}); }

  isEventEnded(item: PublishedEvent): boolean {
    const schedule = item.schedule[0];
    if (!schedule) return false;
    const end = new Date(`${schedule.date}T${schedule.end || '23:59'}:00`);
    return end.getTime() < Date.now();
  }

  getActiveRegistrations(userEmail: string): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/my-registrations`, { params: { email: userEmail.trim().toLowerCase(), scope: 'active' } });
  }

  getRegistrationHistory(userEmail: string): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/my-registrations`, { params: { email: userEmail.trim().toLowerCase(), scope: 'history' } });
  }
}
```

`isEventEnded()` stays a pure client-side function (it's a date comparison on already-fetched data, not a data-fetching operation — no reason to round-trip to the server for it).

- [ ] **Step 3: Find and fix every caller of `registrationStatus()`**

This is the one method that cannot be a drop-in replacement — the original was synchronous (read an in-memory signal), and there's no synchronous equivalent once the data lives server-side.

```bash
cd "fyp-ui" && grep -rn "registrationStatus(" src/app --include="*.ts" --include="*.html"
```

Read every file the search returns (excluding the declaration itself in `published-event.service.ts`). For each call site, the fix depends on context:
- If it's inside a component that already fetches `getPendingRegistrations`/`getActiveRegistrations`/`getRegistrationHistory` for the same event, derive the status from that already-fetched array instead of calling `registrationStatus()` separately (e.g., `registrations.find((r) => r.eventId === eventId && r.email === userEmail)?.status ?? null`).
- If it's inside a template binding with no existing fetched array to derive from, add a new `Observable`/signal to the component that fetches the specific registration's status via `getPendingRegistrations` (or a new dedicated call, if the exact status of ONE specific user's registration for ONE specific event is needed and pending-only doesn't cover it — in that case, note this as a genuine new small endpoint need and add `GET /api/events/{id}/registrations/mine?email=...` returning a single `EventRegistration | null`, wiring it into `PublishedEventService` as a new method `getMyRegistration(eventId: string, email: string): Observable<EventRegistration | null>`).

Since the exact call sites weren't enumerated during this planning session (this method wasn't in the original file read), this step requires judgment at execution time — read each real call site found by the grep above and apply the pattern that fits, following the async-conversion style established in Task 2.13's login page fix (wrap in `.subscribe()`, add a loading signal if the component doesn't already have relevant loading state).

- [ ] **Step 4: Search for any other direct read of the removed `events`/`registrations` signals**

```bash
cd "fyp-ui" && grep -rn "\.events()\|\.registrations()" src/app --include="*.ts" | grep -v "published-event.service.ts"
```

Any match here is a component that read `PublishedEventService.events` or `.registrations` directly as a signal — these no longer exist. Replace each with the corresponding `Observable`-returning method call (`getPublishedEvents()`, `getPendingRegistrations()`, etc.), converted to use `async` pipe in the template or a signal populated via `toSignal()`/manual subscription in the component, matching whatever pattern the specific component already uses elsewhere for other Observable data (check for an existing `toSignal(...)` or `.subscribe(...)` in the same file for the established local convention before picking one).

- [ ] **Step 5: Typecheck and run tests**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -iE "published-event|event-details|event-card|explore-events|my-events|happening-soon"
cd "fyp-ui" && npx ng test --watch=false --include='**/*event*.spec.ts' 2>&1 | tail -150
```

Fix all failures per the same judgment criteria as prior test-fixing steps in this plan.

- [ ] **Step 6: Commit**

```bash
git add src/environments/environment.ts src/app/core/events/published-event.service.ts
git add -u  # picks up whatever call-site files Steps 3-4 touched
git commit -m "refactor(events): convert PublishedEventService to real HTTP calls against /api/events"
```

---

### Task 2.15: Convert `SavedEventsService` to call real `/api/event-engagement` endpoints

**Files:**
- Modify: `fyp-ui/src/app/core/events/saved-events.service.ts` (full file)

**Interfaces:**
- Consumes: `NotificationPreference`, `SavedEventMutationResponse`, `SavedEventsResponse` (unchanged shapes, `event-engagement.models.ts`); `environment.eventEngagementApiUrl` (Task 2.14 Step 1).
- Produces: `savedEventIds` signal is REPLACED by an explicit `refresh()`-driven fetch pattern (matching `RequestOptionService`'s `watchAll`/`refresh()` convention from Phase 2, for consistency) since a signal populated from `localStorage` synchronously at construction time has no async equivalent — callers must now handle the async load.

- [ ] **Step 1: Rewrite `saved-events.service.ts`**

Replace the entire contents of `fyp-ui/src/app/core/events/saved-events.service.ts` with:

```typescript
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import {
  NotificationPreference,
  SavedEventMutationResponse,
  SavedEventsApi,
  SavedEventsResponse,
} from './event-engagement.models';

@Injectable({ providedIn: 'root' })
export class SavedEventsService implements SavedEventsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = environment.eventEngagementApiUrl;

  private readonly savedIdsState = signal<ReadonlySet<string>>(new Set());
  readonly savedEventIds = computed(() => this.savedIdsState());
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    this.refresh();
  }

  isSaved(eventId: string): boolean { return this.savedIdsState().has(eventId); }

  getSavedEvents(userEmail: string): Observable<SavedEventsResponse> {
    return this.http.get<SavedEventsResponse>(`${this.baseUrl}/saved`, { params: { email: userEmail.trim().toLowerCase() } });
  }

  saveEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    return this.http.post<SavedEventMutationResponse>(`${this.baseUrl}/saved`, { email: userEmail.trim().toLowerCase(), eventId }).pipe(
      tap(() => this.savedIdsState.update((ids) => new Set([...ids, eventId]))),
    );
  }

  removeSavedEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    return this.http.delete<SavedEventMutationResponse>(`${this.baseUrl}/saved/${encodeURIComponent(eventId)}`, { params: { email: userEmail.trim().toLowerCase() } }).pipe(
      tap(() => this.savedIdsState.update((ids) => { const next = new Set(ids); next.delete(eventId); return next; })),
    );
  }

  getNotificationPreferences(userEmail: string): Observable<NotificationPreference> {
    return this.http.get<NotificationPreference>(`${this.baseUrl}/notification-preferences`, { params: { email: userEmail.trim().toLowerCase() } });
  }

  updateNotificationPreferences(userEmail: string, preferences: NotificationPreference): Observable<NotificationPreference> {
    return this.http.put<NotificationPreference>(`${this.baseUrl}/notification-preferences`, { email: userEmail.trim().toLowerCase(), ...preferences });
  }

  refresh(): void {
    const user = this.auth.user();
    if (!user) { this.savedIdsState.set(new Set()); return; }
    this.loading.set(true);
    this.error.set('');
    this.getSavedEvents(user.email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { this.savedIdsState.set(new Set(response.items.map((item) => item.id))); this.loading.set(false); },
      error: () => { this.error.set('Could not load saved events.'); this.loading.set(false); },
    });
  }
}
```

Note: `refresh()` is now called once in the constructor (replacing the old `effect()` that reacted to `auth.user()` changes) AND remains public for manual re-triggering after login/logout — callers that used to rely on the automatic `effect()` re-running whenever `auth.user()` changed (e.g., right after login) now need to call `this.savedEvents.refresh()` explicitly at that point. Search for this:

```bash
cd "fyp-ui" && grep -rn "establishSession\|auth\.login" src/app --include="*.ts" | grep -v "auth.service.ts\|external-registration.service.ts\|auth.service.spec.ts"
```

For every call site found (login page, external registration OTP verification, anywhere else establishing a session), add a call to `this.savedEvents.refresh()` (inject `SavedEventsService` if not already injected in that component) immediately after the session is established, so saved-event state loads for the newly logged-in user without requiring a full page reload.

- [ ] **Step 2: Search for any other direct read of the old synchronous saved-events behavior**

```bash
cd "fyp-ui" && grep -rn "savedEventIds()" src/app --include="*.ts" --include="*.html"
```

The signal's NAME is unchanged (`savedEventIds`, now a `computed()` instead of a raw `signal()`) and its synchronous read behavior (`.has(id)` via `isSaved()`) is preserved — this call pattern should still work identically for any existing caller. Confirm no caller assumed it updates synchronously on FIRST render before any HTTP response returns (i.e., check `event-favourite.service.ts` and `event-card.ts`, the two known consumers from the earlier repository survey, for a pattern like "assume saved on optimistic click" that might now show a flash of "not saved" before the `tap()` in `saveEvent()`/`removeSavedEvent()` fires — this is actually already race-free since `tap()` still updates synchronously once the HTTP call resolves, same timing shape as the original `delay(100)`-based mock, just now driven by a real network round trip instead of a simulated one).

- [ ] **Step 3: Typecheck and run tests**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -iE "saved-event|event-favourite|event-card"
cd "fyp-ui" && npx ng test --watch=false --include='**/saved-event*.spec.ts' --include='**/event-favourite*.spec.ts' 2>&1 | tail -100
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(events): convert SavedEventsService to real HTTP calls against /api/event-engagement"
```

---

### Task 2.16: Convert `SystemConfigService` to call real `/api/config` endpoints

**Files:**
- Modify: `fyp-ui/src/app/core/config/system-config.service.ts` (full file)

**Interfaces:**
- Consumes: `SystemConfig`, `SystemConfigDraft` (unchanged shapes, `system-config.models.ts`); `environment.configApiUrl` (Task 2.14 Step 1).
- Produces: `updateConfig(draft): void` (synchronous) becomes `updateConfig(draft): Observable<SystemConfig>` — a breaking signature change. `config`/`paxReviewerThreshold`/`cancellationDaysLimit`/`eventCategories` computed getters stay but now derive from a signal populated by an async fetch at construction (same "load once, expose via computed, offer `refresh()`" pattern as Task 2.15).

- [ ] **Step 1: Rewrite `system-config.service.ts`**

Replace the entire contents of `fyp-ui/src/app/core/config/system-config.service.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SystemConfig, SystemConfigDraft } from './system-config.models';
import { EVENT_CATEGORY_OPTIONS } from '../events/published-event.models';

const DEFAULT_CONFIG: SystemConfig = {
  paxReviewerThreshold: 50,
  cancellationDaysLimit: 3,
  eventCategories: [...EVENT_CATEGORY_OPTIONS],
};

@Injectable({ providedIn: 'root' })
export class SystemConfigService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = environment.configApiUrl;

  private readonly state = signal<SystemConfig>(DEFAULT_CONFIG);
  readonly config = computed(() => this.state());
  readonly paxReviewerThreshold = computed(() => this.state().paxReviewerThreshold);
  readonly cancellationDaysLimit = computed(() => this.state().cancellationDaysLimit);
  readonly eventCategories = computed(() => this.state().eventCategories);

  constructor() {
    this.refresh();
  }

  updateConfig(draft: SystemConfigDraft): Observable<SystemConfig> {
    return this.http.put<SystemConfig>(this.baseUrl, draft).pipe(tap((saved) => this.state.set(saved)));
  }

  refresh(): void {
    this.http.get<SystemConfig>(this.baseUrl).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (config) => this.state.set(config),
      error: () => this.state.set(DEFAULT_CONFIG),
    });
  }
}
```

- [ ] **Step 2: Find and fix every caller of the old synchronous `updateConfig(draft): void`**

```bash
cd "fyp-ui" && grep -rn "updateConfig(" src/app --include="*.ts"
```

This is almost certainly only `fyp-ui/src/app/features/internal/pages/system-config/system-config.ts` (the admin Settings page). Read that file in full and update its call site from a fire-and-forget synchronous call to a subscribed Observable, following the exact same conversion pattern established in Task 2.13 Step 2 (wrap in `.subscribe()`, add a saving/loading signal if the page doesn't already track one, show a success/error message matching the page's existing convention).

- [ ] **Step 3: Typecheck and run tests**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -iE "system-config"
cd "fyp-ui" && npx ng test --watch=false --include='**/system-config*.spec.ts' 2>&1 | tail -100
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(config): convert SystemConfigService to real HTTP calls against /api/config"
```

---

### Task 2.17: Add an Api-backed `EventImageUploadService` alongside the existing mock

**Files:**
- Modify: `fyp-ui/src/app/core/events/event-image-upload.service.ts` (full file)

**Interfaces:**
- Consumes: `EventImageUploadRequest`, `EventImageUploadResponse`, `EventImageAsset` (unchanged shapes); `environment.imageUploadApiUrl` (Task 2.14 Step 1).
- Produces: a new `ApiEventImageUploadService` implementing the existing `EventImageUploadApi` abstract class. Since this is the ONE domain where reading the file into a data URL client-side is still needed regardless (the browser must read the `File` object somehow before it can be sent anywhere), this implementation reads the file client-side (reusing the exact same `FileReader` logic as the existing mock) and then POSTs the resulting data URL to the server, which per the design spec just echoes it back with a `storageKey` — this is a deliberate simplification (documented in the design spec's Out of Scope section: "Real file/attachment storage... system.md §8 already flags this as an unresolved future need").

- [ ] **Step 1: Rewrite `event-image-upload.service.ts`**

Replace the entire contents of `fyp-ui/src/app/core/events/event-image-upload.service.ts` with:

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EventImageAsset } from './published-event.models';

export interface EventImageUploadRequest {
  readonly file: File;
}

export interface EventImageUploadResponse {
  readonly image: EventImageAsset;
}

/** API contract used by the proposal form. */
export abstract class EventImageUploadApi {
  abstract upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse>;
}

function readAsDataUrl(file: File): Observable<string> {
  return new Observable((subscriber) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => { subscriber.next(String(reader.result)); subscriber.complete(); });
    reader.addEventListener('error', () => subscriber.error(new Error('The image could not be read.')));
    reader.readAsDataURL(file);
    return () => reader.abort();
  });
}

@Injectable({ providedIn: 'root' })
export class MockEventImageUploadService implements EventImageUploadApi {
  upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse> {
    return readAsDataUrl(request.file).pipe(
      map((dataUrl) => ({
        image: {
          url: dataUrl,
          fileName: request.file.name,
          mimeType: request.file.type,
          sizeBytes: request.file.size,
          status: 'local' as const,
        },
      })),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class ApiEventImageUploadService implements EventImageUploadApi {
  private readonly http = inject(HttpClient);

  upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse> {
    return readAsDataUrl(request.file).pipe(
      switchMap((dataUrl) => this.http.post<{ storageKey: string; url: string }>(environment.imageUploadApiUrl, {
        fileName: request.file.name,
        mimeType: request.file.type,
        sizeBytes: request.file.size,
        dataUrl,
      })),
      map((response) => ({
        image: {
          url: response.url,
          fileName: request.file.name,
          mimeType: request.file.type,
          sizeBytes: request.file.size,
          status: 'uploaded' as const,
          storageKey: response.storageKey,
        },
      })),
    );
  }
}
```

`MockEventImageUploadService` is KEPT (unlike Phase 2's full collapse of the 4 domains that had a real Mock/Api split) because this specific service's "mock" behavior (skip the network round-trip, keep the file purely client-side as a data URL) is a legitimately different and still-useful mode — e.g., for fast local UI iteration without the server running. Find wherever it's currently provided/injected and add the same kind of `InjectionToken` switch used elsewhere in this codebase before Phase 2's collapse:

```bash
cd "fyp-ui" && grep -rn "MockEventImageUploadService\|EventImageUploadApi" src/app --include="*.ts" | grep -v "event-image-upload.service.ts"
```

Read every file this returns. Most likely it's provided directly (e.g., `{ provide: EventImageUploadApi, useClass: MockEventImageUploadService }`) in `app.config.ts` or a component's `providers` array. Update that provider registration to use an `InjectionToken`-based factory, following this codebase's established pattern:

```typescript
export const EVENT_IMAGE_UPLOAD_API = new InjectionToken<EventImageUploadApi>('EVENT_IMAGE_UPLOAD_API', {
  providedIn: 'root',
  factory: () => environment.useMockImageUpload ? inject(MockEventImageUploadService) : inject(ApiEventImageUploadService),
});
```

Add this token export to `event-image-upload.service.ts` (append after the two `@Injectable` classes), and add `useMockImageUpload: true` to `environment.ts` (append to the object). Update whatever call site the grep found to inject `EVENT_IMAGE_UPLOAD_API` via the token instead of the concrete `MockEventImageUploadService` class directly, if it wasn't already doing so through `EventImageUploadApi` — if the existing code already injects the abstract `EventImageUploadApi` type with a `useClass` provider, replace that provider registration with `{ provide: EventImageUploadApi, useFactory: () => inject(EVENT_IMAGE_UPLOAD_API) }` or equivalent, matching whatever DI registration style the surrounding `app.config.ts` already uses for other tokens.

- [ ] **Step 2: Typecheck and run tests**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -iE "image-upload"
cd "fyp-ui" && npx ng test --watch=false --include='**/event-image-upload*.spec.ts' 2>&1 | tail -60
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(events): add Api-backed image upload alongside the existing client-side-only mock"
```

---

### Task 2.18: Full-project verification for Phase 2b

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

```bash
cd "fyp-ui" && npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -200
```

Expected: zero errors. Fix anything remaining, tracing each error to its source file and applying the established patterns from this phase.

- [ ] **Step 2: Full test suite**

```bash
cd "fyp-ui" && npx ng test --watch=false 2>&1 | tail -250
```

Expected: all green.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "test: final Phase 2b cleanup — full green typecheck and test suite"
```

This closes Phase 2b. Every Angular domain now expects a real `/api/*` backend — Phase 3 builds it.

---

## Phase 3: Express Mock Backend

Builds `fyp-ui/server/` from scratch: an in-memory `db.js` covering all 51 schema tables, a `workflow.service.js` implementing the state machine from this plan's Global Constraints/Phase 1 corrections, and Express routers matching every Angular `Api*` call this plan's earlier phases established.

**Server-wide conventions (apply to every task in this phase):**
- Plain JavaScript (CommonJS `require`/`module.exports`), no TypeScript, no build step — matches the "Node.js + Express, plain JS" decision from the design spec.
- Every table is a plain array of plain objects held in a module-level variable, re-seeded fresh on `require('./db')` (i.e., on server start) — never touches disk.
- IDs auto-increment per table starting at 1, tracked via a simple counter (`let nextId = 1; const id = nextId++;`) local to each seed module or a shared `nextId(table)` helper in `db.js`.
- Every route handler is `async` (even though nothing actually awaits I/O) so the codebase is a drop-in shape for a real async DB client later — this satisfies the design spec's "Async/Promise-shaped throughout" requirement.
- Every mutating route that touches `request`/`request_task`/`request_fmb_selection` calls into `workflow.service.js` — never contains transition logic inline.
- Response bodies sent back to Angular MUST exactly match the TypeScript interfaces established in Phases 1/2/2b (e.g. `ProposalReviewRecord`, `AdminUserRecord`, `RequestOption`, `StaffTask`, `PublishedEvent`, `SystemConfig`, `AuthUser`) — field names are camelCase in the API layer even though the underlying `db.js` table rows are snake_case (matching the SQL schema's column names). Each router is responsible for this snake_case-to-camelCase projection; `db.js` itself stays a faithful mirror of the SQL schema's actual column names.
- **Deviation from the design spec's file tree (§5):** the design spec's illustrative `server/` tree lists a separate `services/*.service.js` file per domain (`request.service.js`, `request-option.service.js`, `admin-directory.service.js`, `staff-task.service.js`, `auth.service.js`, `event.service.js`, `config.service.js`) alongside `workflow.service.js`. This plan only creates `workflow.service.js` and `proposal-projection.service.js` (Task 3.7) as standalone service files — the routers for the remaining, structurally-simple CRUD domains (Task 3.8: auth, request-options, admin, staff-tasks, events, event-engagement, config, uploads) keep their projection/lookup logic directly in the route handler file, since that logic is a straightforward array filter/map with no branching business rules to protect from route-handler sprawl (unlike `workflow.service.js`, which genuinely needs isolation because it's called from multiple routes and carries real conditional logic). This is a deliberate simplification, not an oversight: splitting each of those 8 routers into a route file plus a near-empty pass-through service file would add indirection without a corresponding benefit at this codebase's current size. If any of these routers grow real branching logic later, extracting a service file at that point is a normal refactor, not a correction of this plan.

### Task 3.1: Scaffold the server project and `db.js`'s table registry

**Files:**
- Create: `fyp-ui/server/package.json` (or reuse the existing `fyp-ui/package.json` — see Step 1 for the decision)
- Create: `fyp-ui/server/db.js`
- Create: `fyp-ui/server/app.js`
- Create: `fyp-ui/server/index.js`

**Interfaces:**
- Consumes: nothing (first task in Phase 3).
- Produces: `db.js` exports one object, `db`, with one property per table (51 properties, each an array — initially empty, populated by Task 3.2's seed modules), plus a `nextId(table)` helper function: `nextId(tableName: string): number` — returns the next auto-increment integer for that table and increments the internal counter. `app.js` exports a configured Express `app` (not yet listening). `index.js` starts the HTTP server on port 4000.

- [ ] **Step 1: Decide and install server dependencies**

Check whether `express`/`cors` are already installed:

```bash
cd "fyp-ui" && node -e "require.resolve('express')" 2>&1; node -e "require.resolve('cors')" 2>&1
```

If either errors with `MODULE_NOT_FOUND`, install them into the EXISTING `fyp-ui/package.json` (do not create a separate `server/package.json` — keeping one `package.json` for the whole project, with the server as a subdirectory, is simpler for the `npm run dev` script Task 4.1 adds):

```bash
npm install --save express cors
```

- [ ] **Step 2: Create `fyp-ui/server/db.js`**

```javascript
// In-memory database. Every table listed below mirrors ems_database_schema.sql exactly —
// same table name, same column names, snake_case throughout. Populated by seed-*.js modules
// (Task 3.2) at require-time. Resets to this seed state every time the process restarts —
// no disk persistence, by design (see the design spec's "Behavior" section).

const TABLE_NAMES = [
  // Identity & Organization
  'users', 'staff', 'student', 'unit', 'unit_users', 'clubs', 'student_clubs',
  // Cafeteria Domain
  'cafeteria', 'cafeteria_assignment',
  // Categories & Requirements
  'event_category', 'event_requirements',
  // Manager-Configured Options
  'logistics_options', 'transportation_options', 'media_options', 'sound_light_options',
  'dietary_information_options', 'serving_unit_options', 'fmb_options',
  'campus_tour_start_options', 'water_logo_options', 'water_normal_options',
  'funding_main_options', 'funding_sub_options',
  // Config
  'config',
  // Request Core
  'request', 'request_categories', 'application_requirements',
  // Request-Specific Department Data (snapshots)
  'request_logistics', 'request_transportation', 'request_photography_videography',
  'request_sound_light', 'request_fmb', 'request_fmb_selection', 'request_campus_tour',
  'request_mineral_water_logo', 'request_mineral_water_normal', 'request_funding_purchase',
  // Request Support Tables
  'co_owners', 'organizers', 'important_people', 'general_guest', 'event_schedule',
  'brief_agenda', 'request_discussion_topics',
  // Event Discovery / Registration
  'event_registration', 'saved_event',
  // Workflow — Tasks, Assignments, History
  'request_task', 'task_assignment', 'workflow_history',
];

const db = {};
for (const table of TABLE_NAMES) db[table] = [];

const counters = {};
function nextId(table) {
  counters[table] = (counters[table] || 0) + 1;
  return counters[table];
}

function resetCounters() {
  for (const table of TABLE_NAMES) counters[table] = 0;
}

resetCounters();

module.exports = { db, nextId, TABLE_NAMES };
```

Count the table list against the schema to confirm it's exactly 51: 7 (Identity) + 2 (Cafeteria) + 2 (Categories) + 11 (Manager Options) + 1 (Config) + 3 (Request Core) + 10 (Request-Specific) + 7 (Support) + 2 (Discovery) + 3 (Workflow) = 48. **This does not equal 51** — recount against `ems_database_schema.sql` directly once Task 1.1 has been applied (the corrected schema, post-rename, post-Campus-Tour-trim) to get the authoritative final count; the discrepancy from "51" in the original design spec is expected since Task 1.1 REMOVED 2 tables (`campus_tour_area_options`, `campus_tour_map_options`) that were part of the original 51-table count the user's source-of-truth package started with. Run this to get the ground truth:

```bash
grep -c "^CREATE TABLE" "cloud/system_logic/ems_database_schema.sql"
```

Adjust the `TABLE_NAMES` array above to match this count exactly — every `CREATE TABLE` in the corrected schema must have a corresponding entry, and vice versa. List every table name found by:

```bash
grep "^CREATE TABLE" "cloud/system_logic/ems_database_schema.sql" | sed 's/CREATE TABLE \([a-z_]*\).*/\1/'
```

and diff it mentally against the `TABLE_NAMES` array above before finalizing this file.

- [ ] **Step 3: Create `fyp-ui/server/app.js`**

```javascript
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10mb ceiling covers base64 image data URLs from event-image-upload

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/request-options', require('./routes/request-options.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/staff-tasks', require('./routes/staff-tasks.routes'));
app.use('/api/proposal-workflow', require('./routes/proposal-workflow.routes'));
app.use('/api/events', require('./routes/events.routes'));
app.use('/api/event-engagement', require('./routes/event-engagement.routes'));
app.use('/api/config', require('./routes/config.routes'));
app.use('/api/uploads', require('./routes/uploads.routes'));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error.' });
});

module.exports = app;
```

(The `require('./routes/...')` calls above will fail until Tasks 3.3-3.10 create each router file — this is expected; `app.js` is written now as the target shape those tasks fill in.)

- [ ] **Step 4: Create `fyp-ui/server/index.js`**

```javascript
const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`EMS mock server listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 5: Verify `db.js` loads without error**

```bash
cd "fyp-ui" && node -e "const { db, nextId } = require('./server/db'); console.log(Object.keys(db).length, 'tables'); console.log(nextId('users'), nextId('users'));"
```

Expected output: the table count from Step 2's corrected `TABLE_NAMES` length, followed by `1 2`.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/app.js server/index.js package.json package-lock.json
git commit -m "feat(server): scaffold Express app skeleton and empty in-memory db.js table registry"
```

---

### Task 3.2: Write seed data for Identity, Cafeteria, Categories, Config tables

**Files:**
- Create: `fyp-ui/server/db/seed-users.js`
- Create: `fyp-ui/server/db/seed-cafeteria.js`
- Create: `fyp-ui/server/db/seed-categories.js`
- Create: `fyp-ui/server/db/seed-config.js`
- Modify: `fyp-ui/server/db.js` (require and invoke the 4 seed modules after table initialization)

**Interfaces:**
- Consumes: `db`, `nextId` from Task 3.1's `db.js`; `UserRole` string values from Angular's `auth.models.ts` (Task 2.1's corrected enum) — the seed's `users.role` column values must be the exact string values of `UserRole` (e.g. `'hos-hod'`, `'fmb'`, `'cafeteria-manager'`), NOT the SQL schema's snake_case role tokens (e.g. NOT `'hos_hod'`) — Angular's `AuthUser.role` field is typed as `UserRole` and the mock login endpoint (Task 3.3) returns this value directly to the frontend, so it must match Angular's enum values exactly, even though this differs from the SQL schema's own CHECK constraint literal spelling. This is a deliberate mock-layer adaptation, not a schema violation — the real backend (built later, outside this plan's scope) would need its own mapping layer between DB role tokens and API role tokens; the mock keeps it simple by making `users.role` store the API-facing value directly.
- Produces: populated `db.users`, `db.staff`, `db.student`, `db.unit`, `db.unit_users`, `db.cafeteria`, `db.cafeteria_assignment`, `db.event_category`, `db.event_requirements`, `db.config`.

- [ ] **Step 1: Write `seed-users.js`**

Base this on `fyp-ui/src/app/core/auth/mock-users.ts`'s `MOCK_AUTH_USERS` array (as corrected by Task 2.1 — merged `Fmb` role, no `FmbWaterServicesStaff`, includes `student.services.*` accounts). Read that file fresh at execution time (it will have changed since this plan's initial survey, due to Task 2.1's edits) to get the authoritative current list of demo accounts, then transcribe each into a `users` row plus, where applicable, a `staff` row (for internal accounts) with `department_or_school` set from the account's `department` field, and a `unit`/`unit_users` row grouping users by department. Every account needs:

```javascript
{
  user_id: nextId('users'),
  first_name: /* split from displayName */,
  last_name: /* split from displayName */,
  email: /* from mock-users.ts */,
  phone_number: null,
  role: /* the UserRole string value, e.g. 'hos-hod' */,
  is_active: true,
  password: /* 'Demo@123' for every seeded account, matching mock-users.ts's convention — mock-only field per the design spec */,
}
```

Add at least 2-3 `student` role accounts and 2-3 `staff` (non-manager) role accounts NOT present in `mock-users.ts` today (that file is manager/reviewer-heavy — the seed needs plain Student/Staff applicants too, since Phase 3's proposal seed data (Task 3.6) needs realistic applicants). Example additions:

```javascript
{ user_id: nextId('users'), first_name: 'Aina', last_name: 'Rahman', email: 'aina.rahman@student.apu.edu.my', phone_number: null, role: 'student', is_active: true, password: 'Demo@123' },
{ user_id: nextId('users'), first_name: 'Daniel', last_name: 'Wong', email: 'daniel.wong@student.apu.edu.my', phone_number: null, role: 'student', is_active: true, password: 'Demo@123' },
{ user_id: nextId('users'), first_name: 'Jordan', last_name: 'Lee', email: 'jordan.lee@staff.apu.edu.my', phone_number: null, role: 'staff', is_active: true, password: 'Demo@123' },
```

For each `student`-role user, also create a matching `db.student` row: `{ student_id: nextId('student'), user_id: <the user's id>, school: 'School of Computing' }` (vary the school across a couple of values for realism). For each `staff`-role or manager/reviewer-role user, create a matching `db.staff` row: `{ staff_id: nextId('staff'), user_id: <id>, department_or_school: <their department> }`.

Build `db.unit` rows — one per distinct department/school string across all seeded users (mirror the logic already in `admin-directory.mock-data.ts`'s `unitNames`/`slug()` helper — reimplement the same slugging in this JS file since it can't import TypeScript). Example:

```javascript
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
```

For each unique department, create: `{ code: slugify(department).slice(0, 20).toUpperCase(), description: department, head_user_id: null, is_active: true }` (the schema's `unit.code` is the PK, `VARCHAR(20)`, so truncate). Set `head_user_id` to the `user_id` of one HOS/HOD-role user whose `department_or_school` matches, if one exists in the seed, to give at least one non-null example. Populate `db.unit_users` linking every user to their unit: `{ user_id, unit_code }` for each user whose `department`/`department_or_school` matches a unit.

Export a function, not top-level side effects (so `db.js` controls seeding order explicitly):

```javascript
module.exports = function seedUsers(db, nextId) {
  // ... all the above logic, pushing into db.users, db.staff, db.student, db.unit, db.unit_users
};
```

- [ ] **Step 2: Write `seed-cafeteria.js`**

At least 2 cafeterias (needed for Task 3.6's F&B multi-cafeteria-split seed scenario), plus `cafeteria_assignment` rows linking existing `cafeteria-manager`/`cafeteria-staff`-role users (from Step 1's seed) to them. Multiple staff should be assigned to at least one cafeteria (needed to demonstrate the shared-inbox mechanism — more than one staff member eligible to claim the same task).

```javascript
module.exports = function seedCafeteria(db, nextId) {
  const cafeteria1 = { cafeteria_id: nextId('cafeteria'), name: 'Atrium Cafeteria', active: true };
  const cafeteria2 = { cafeteria_id: nextId('cafeteria'), name: 'Level 3 Food Court', active: true };
  db.cafeteria.push(cafeteria1, cafeteria2);

  const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
  const cafeteriaStaffUsers = db.users.filter((u) => u.role === 'cafeteria-staff');
  const cafeteriaAdmin = db.users.find((u) => u.role === 'cafeteria-admin');

  if (cafeteriaManager) {
    db.cafeteria_assignment.push(
      { cafeteria_assignment_id: nextId('cafeteria_assignment'), cafeteria_id: cafeteria1.cafeteria_id, user_id: cafeteriaManager.user_id, assignment_role: 'manager', assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null, assigned_at: new Date().toISOString() },
      { cafeteria_assignment_id: nextId('cafeteria_assignment'), cafeteria_id: cafeteria2.cafeteria_id, user_id: cafeteriaManager.user_id, assignment_role: 'manager', assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null, assigned_at: new Date().toISOString() },
    );
  }
  for (const staff of cafeteriaStaffUsers) {
    db.cafeteria_assignment.push({ cafeteria_assignment_id: nextId('cafeteria_assignment'), cafeteria_id: cafeteria1.cafeteria_id, user_id: staff.user_id, assignment_role: 'staff', assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null, assigned_at: new Date().toISOString() });
  }
};
```

(If `mock-users.ts` only seeds ONE `cafeteria-staff` account today, add a second one directly in `seed-users.js`'s Step 1 additions — e.g. `{ ..., email: 'cafeteria.staff2@demo.apu.edu.my', role: 'cafeteria-staff', ... }` — since Task 3.6's shared-inbox scenario needs at least 2 staff eligible to claim the same task.)

- [ ] **Step 3: Write `seed-categories.js`**

```javascript
module.exports = function seedCategories(db, nextId) {
  const categoryNames = ['Academic & Career', 'Workshops & Training', 'Sports & Wellness', 'Culture & Community', 'Clubs & Societies', 'Entertainment & Social', 'Volunteering'];
  for (const name of categoryNames) db.event_category.push({ event_category_id: nextId('event_category'), name, active: true });

  const requirementNames = ['logistics', 'transportation', 'photoVideo', 'soundLight', 'fmb', 'campusTour', 'fundingPurchase'];
  for (const name of requirementNames) db.event_requirements.push({ requirement_id: nextId('event_requirements'), requirement_name: name });
};
```

Note: `event_requirements.requirement_name` uses the same camelCase-ish tokens as Angular's `DepartmentRequestKind`/requirement keys (`'logistics'`, `'fmb'`, etc., NOT `'waterLogo'`/`'waterNormal'` as separate requirement rows, per Phase 1's correction that water requests are line items under the `fmb` requirement, not their own requirement). This mirrors the same "mock layer speaks the API's vocabulary" decision made for `users.role` in Step 1.

- [ ] **Step 4: Write `seed-config.js`**

```javascript
module.exports = function seedConfig(db) {
  db.config.push(
    { code: 'HIGH_PAX_THRESHOLD', number: 50 },
    { code: 'CANCELLATION_DEADLINE_DAYS', number: 3 },
    { code: 'MAX_EVENT_CATEGORIES', number: 2 },
  );
};
```

- [ ] **Step 5: Wire the 4 seed modules into `db.js`**

Modify `fyp-ui/server/db.js` — after the `resetCounters();` line and before `module.exports`, add:

```javascript
seedUsers(db, nextId);
seedCafeteria(db, nextId);
seedCategories(db, nextId);
seedConfig(db, nextId);
```

And add the four `require` statements at the top of the file, alongside no other existing requires:

```javascript
const seedUsers = require('./db/seed-users');
const seedCafeteria = require('./db/seed-cafeteria');
const seedCategories = require('./db/seed-categories');
const seedConfig = require('./db/seed-config');
```

- [ ] **Step 6: Verify seed data loads correctly**

```bash
cd "fyp-ui" && node -e "
const { db } = require('./server/db');
console.log('users:', db.users.length);
console.log('staff:', db.staff.length);
console.log('student:', db.student.length);
console.log('unit:', db.unit.length);
console.log('cafeteria:', db.cafeteria.length);
console.log('cafeteria_assignment:', db.cafeteria_assignment.length);
console.log('event_category:', db.event_category.length);
console.log('event_requirements:', db.event_requirements.length);
console.log('config:', db.config.length);
console.log(JSON.stringify(db.users[0], null, 2));
"
```

Expected: every count > 0, no thrown errors, and the printed sample `users[0]` row has all the expected fields including a `password`.

- [ ] **Step 7: Commit**

```bash
git add server/db/seed-users.js server/db/seed-cafeteria.js server/db/seed-categories.js server/db/seed-config.js server/db.js
git commit -m "feat(server): seed users/staff/student/unit, cafeteria, categories, config tables"
```

---

### Task 3.3: Write seed data for Manager-Configured Options tables

**Files:**
- Create: `fyp-ui/server/db/seed-options.js`
- Modify: `fyp-ui/server/db.js` (require and invoke)

**Interfaces:**
- Consumes: `db.event_requirements` (Task 3.2), `db.cafeteria` (Task 3.2).
- Produces: populated `db.logistics_options`, `db.transportation_options`, `db.media_options`, `db.sound_light_options`, `db.dietary_information_options`, `db.serving_unit_options`, `db.fmb_options`, `db.campus_tour_start_options`, `db.water_logo_options`, `db.water_normal_options`, `db.funding_main_options`, `db.funding_sub_options`.

- [ ] **Step 1: Write `seed-options.js`**

Base the label/field content directly on `fyp-ui/src/app/core/request-options/request-option.mock-data.ts` as corrected by Task 2.4 (read that file fresh at execution time — it's the authoritative content source, already trimmed of `campusTourArea`/`campusTourMap` and renamed `fnb`→`fmb`). Transcribe every entry from that Angular file into the corresponding SQL-shaped table row. Field name mapping (Angular camelCase → SQL snake_case, per each table):

| Angular `RequestOption` kind | SQL table | Field mapping |
|---|---|---|
| `logistics` | `logistics_options` | `id`→(drop, use `nextId`), `label`→`label`, `description`→`description`, `active`→`active`, `availableQuantity`→`available_quantity`, `quantityUnit`→`quantity_unit`, `imageDataUrl`→`item_image_url` (store the data URL directly as the "URL" — mock simplification), plus `requirement_id` = the `event_requirements` row where `requirement_name = 'logistics'` |
| `transportation` | `transportation_options` | same pattern; `passengerCapacity`→`passenger_capacity`, `availableVehicles`→`available_vehicle_count`, `instructions`→`instructions`, `imageDataUrl`→`vehicle_image_url`, `requirement_id` = `'transportation'` |
| `photoVideo` | `media_options` | `maximumPersonnel`→`max_personnel`, `requirement_id` = `'photoVideo'` |
| `soundLight` | `sound_light_options` | `availableQuantity`→`available_quantity`, `setupRequirements`→`technical_description`, `requirement_id` = `'soundLight'` |
| `dietaryInformation` | `dietary_information_options` | no extra fields beyond common |
| `servingUnit` | `serving_unit_options` | no extra fields beyond common |
| `fmb` | `fmb_options` | `servingUnitId`→ look up the matching `serving_unit_options` row's NEW integer id (the Angular mock uses string ids like `'serving-pax'` — build a lookup map from old string id to new integer id as you seed `serving_unit_options` first, then use it here), same for `dietaryInformationId`→`dietary_information_option_id`, `orderingNotes`→`availability_ordering_notes`, `imageDataUrl`→`menu_image_url`, plus `cafeteria_id` — since the Angular mock's `fmb` options aren't cafeteria-scoped (they're generic applicant-facing food type choices), ASSIGN each to `db.cafeteria[0].cafeteria_id` (the first seeded cafeteria) for half the entries and `db.cafeteria[1].cafeteria_id` for the other half, so both cafeterias have menu items — this is a mock-layer decision since the source Angular data doesn't have this distinction (the real system's "My Menu" is inherently per-cafeteria; the applicant-facing generic mock list was a shortcut in the original Angular mock data that this seed corrects), `requirement_id` = `'fmb'` |
| `campusTourStart` | `campus_tour_start_options` | `meetingInstructions`→`meeting_instructions`, `maximumGroupSize`→`max_group_size`, `requirement_id` = `'campusTour'` |
| `waterLogo` | `water_logo_options` | `bottleCount`→`number_of_bottles`, `availableStock`→`available_stock`, `brandingRequirement`→`logo_branding_requirement`, `orderingInstructions`→`lead_time_ordering_instructions`, `requirement_id` = `'fmb'` (per Phase 1's correction — water requests attach to the `fmb` requirement now) |
| `waterNormal` | `water_normal_options` | same pattern, `orderingInstructions`→`ordering_delivery_instructions`, `requirement_id` = `'fmb'` |
| `fundingMain` | `funding_main_options` | `financeCode`→`budget_category_finance_code`, `purchasingGuidance`→`purchasing_guidance`, `requirement_id` = `'fundingPurchase'` |
| `fundingSub` | `funding_sub_options` | `parentId`→ look up the matching NEW `funding_main_options` integer id the same way as `fmb`'s lookups above, `financeCode`→`finance_procurement_code`, `purchasingNote`→`default_unit_purchasing_note` (no `requirement_id` column on this table per the schema — verify against the corrected `ems_database_schema.sql`) |

Write the module with this structure (illustrative skeleton — fill in every row from the Angular mock data source per the table above; do not abbreviate or sample a subset, every option in the Angular mock file needs a corresponding row here since Angular's dropdowns need real choices per the design spec's seed coverage requirement):

```javascript
module.exports = function seedOptions(db, nextId) {
  const requirementId = (name) => db.event_requirements.find((r) => r.requirement_name === name).requirement_id;

  // --- logistics_options ---
  db.logistics_options.push(
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Registration table', description: 'For guest registration and check-in.', active: true, available_quantity: 1, quantity_unit: 'table', item_image_url: null },
    // ... every remaining logistics entry from request-option.mock-data.ts, same shape
  );

  // --- transportation_options, media_options, sound_light_options: same pattern ---

  // --- serving_unit_options (seed BEFORE fmb_options, which references it) ---
  const servingUnitIdMap = {};
  const servingUnitSeeds = [
    ['serving-pax', 'Per pax', 'One serving for one person.'],
    ['serving-set', 'Per set', null],
    ['serving-tray', 'Per tray', null],
    ['serving-piece', 'Per piece', null],
    ['serving-bottle', 'Per bottle', null],
  ];
  for (const [oldId, label, description] of servingUnitSeeds) {
    const row = { serving_unit_option_id: nextId('serving_unit_options'), label, description, active: true };
    db.serving_unit_options.push(row);
    servingUnitIdMap[oldId] = row.serving_unit_option_id;
  }

  // --- dietary_information_options (seed BEFORE fmb_options) ---
  const dietaryIdMap = {};
  const dietarySeeds = [
    ['dietary-standard', 'Standard menu', 'No special dietary classification.'],
    ['dietary-vegetarian', 'Vegetarian', null],
    ['dietary-vegan', 'Vegan', null],
    ['dietary-gluten-free', 'Gluten-free', null],
    ['dietary-allergen-aware', 'Allergen-aware', 'Confirm the specific allergen requirements before ordering.'],
  ];
  for (const [oldId, label, description] of dietarySeeds) {
    const row = { dietary_information_option_id: nextId('dietary_information_options'), label, description, active: true };
    db.dietary_information_options.push(row);
    dietaryIdMap[oldId] = row.dietary_information_option_id;
  }

  // --- fmb_options (references serving_unit_options + dietary_information_options + cafeteria) ---
  const fmbSeeds = [
    ['food-lunch', 'Lunch', 'serving-pax', 'dietary-standard'],
    ['food-dinner', 'Dinner', 'serving-pax', 'dietary-standard'],
    ['food-refreshments', 'Refreshments', 'serving-pax', 'dietary-standard'],
    ['food-coffee-tea', 'Coffee / Tea', 'serving-pax', 'dietary-standard'],
    ['food-buffet', 'Buffet', 'serving-pax', 'dietary-standard'],
    ['food-other', 'Other', null, null],
  ];
  fmbSeeds.forEach(([oldId, label, servingKey, dietaryKey], index) => {
    db.fmb_options.push({
      fmb_option_id: nextId('fmb_options'),
      requirement_id: requirementId('fmb'),
      cafeteria_id: db.cafeteria[index % db.cafeteria.length].cafeteria_id,
      label,
      description: null,
      active: true,
      serving_unit_option_id: servingKey ? servingUnitIdMap[servingKey] : servingUnitIdMap['serving-pax'],
      dietary_information_option_id: dietaryKey ? dietaryIdMap[dietaryKey] : dietaryIdMap['dietary-standard'],
      availability_ordering_notes: null,
      menu_image_url: null,
    });
  });

  // --- campus_tour_start_options, water_logo_options, water_normal_options, funding_main_options: same transcription pattern ---

  // --- funding_sub_options (references funding_main_options) ---
  // seed funding_main_options FIRST, build an oldId->newId map the same way as servingUnitIdMap above, then use it here
};
```

Complete every table's transcription following this exact pattern — read `request-option.mock-data.ts` line by line and ensure every single entry has a corresponding row in the appropriate table here. This is mechanical but must be exhaustive; do not sample only a few rows per kind.

- [ ] **Step 2: Wire into `db.js`**

Add `const seedOptions = require('./db/seed-options');` to the requires block and `seedOptions(db, nextId);` to the invocation block (after `seedCafeteria`/`seedCategories`, since `seedOptions` depends on `db.event_requirements` and `db.cafeteria` already being populated).

- [ ] **Step 3: Verify**

```bash
cd "fyp-ui" && node -e "
const { db } = require('./server/db');
['logistics_options','transportation_options','media_options','sound_light_options','dietary_information_options','serving_unit_options','fmb_options','campus_tour_start_options','water_logo_options','water_normal_options','funding_main_options','funding_sub_options'].forEach((t) => console.log(t + ':', db[t].length));
"
```

Expected: every count matches the number of entries for that kind in the source Angular mock data file (post Task 2.4's edits) — cross-check by counting entries in `request-option.mock-data.ts` per kind.

- [ ] **Step 4: Commit**

```bash
git add server/db/seed-options.js server/db.js
git commit -m "feat(server): seed all manager-configured option tables from Angular's mock catalog"
```

---

### Task 3.4: Write `workflow.service.js` — the server-side state machine

**Files:**
- Create: `fyp-ui/server/services/workflow.service.js`

**Interfaces:**
- Consumes: `db`, `nextId` from `db.js` (Task 3.1); the corrected `request.status`/`request_task.status`/`request_fmb_selection.status` vocabularies from this plan's Global Constraints and Phase 1.
- Produces: the following exported functions, consumed by Task 3.7's `proposal-workflow.routes.js`:
  - `submitProposal(requestId)` — transitions `draft`→ the correct first stage per the self-review/CFO-skip rules.
  - `approveReviewerStage(requestId, actorUserId)` — advances `hos_hod_review`/`fmb_review`/`cfo_review` to the next stage.
  - `rejectReviewerStage(requestId, actorUserId, reason)` — ends the proposal as `completed_rejected`.
  - `resubmitReviewerStage(requestId, actorUserId, comment)` — sets `resubmission_required`, records `resumeStage`.
  - `applicantResubmit(requestId, updates)` — resumes at the stored `resumeStage`.
  - `approveDepartmentTask(requestId, requirementKey, actorUserId)` — marks one `request_task` approved (never rejects).
  - `resubmitDepartmentTask(requestId, requirementKey, actorUserId, comment)` — marks one `request_task` resubmitted, independent of siblings.
  - `assignStaffToTask(requestTaskId, staffUserId, assignedByUserId)`.
  - `updateTaskStatus(requestTaskId, status)` — for staff marking `preparing`/`completed`.
  - `approveFmbSelection(selectionId, actorUserId)` — moves one selection into the Cafeteria Staff shared pool.
  - `resubmitFmbSelection(selectionId, actorUserId)` — sends one selection back to F&B (status `resubmitted`).
  - `editFmbSelection(selectionId, updates, actorUserId)` — F&B edits a resubmitted row (dish/qty/cafeteria/cancel), re-sends it to whichever cafeteria is now on it.
  - `claimSharedTask(requestTaskId, staffUserId)` — first-to-claim wins the shared-pool task.
  - `cancelProposal(requestId, actorUserId)`.
  - `authorizeAction(requestId, actorUser, action)` — throws a `WorkflowError` (403/400/404) if `actorUser` doesn't actually own the current step for the given `action` (one of `'hos_hod_review'`, `'fmb_review'`, `'cfo_review'`, `'cancel'` — matching `request.status`'s reviewer-stage values by design, since "is this actor allowed to act on THIS status" is exactly what those two things need to agree on). Callers (Task 3.7's router) call this explicitly BEFORE calling the corresponding transition function — `authorizeAction` is a separate, composable check, not baked into `approveReviewerStage`/`rejectReviewerStage`/etc. themselves, so that department-task and F&B-selection mutations (which have their own, different authorization shape — checked inline in Task 3.7's router via direct role/email lookups rather than through this function) aren't forced through a one-size-fits-all check. Department-review and F&B-selection actions do NOT call `authorizeAction` — see Task 3.7 Step 2's router code for their actual (simpler, lookup-based) authorization.
  - The full `ProposalReviewRecord`-shaped projection is NOT a `workflow.service.js` export — it's `projectProposal(request)` in the separate `proposal-projection.service.js` module (Task 3.7 Step 1), kept apart from the state machine since projection is a read-only concern with no transition logic.

- [ ] **Step 1: Write the authorization helper**

```javascript
const { db } = require('../db');

class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function findRequest(requestId) {
  const request = db.request.find((r) => r.request_id === Number(requestId));
  if (!request) throw new WorkflowError('Proposal not found.', 404);
  return request;
}

function isHosHodOfUnit(userId, request) {
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  if (!applicant) return false;
  const applicantUnit = db.unit_users.find((uu) => uu.user_id === applicant.user_id);
  if (!applicantUnit) return false;
  const unit = db.unit.find((u) => u.code === applicantUnit.unit_code);
  return !!unit && unit.head_user_id === Number(userId);
}

function isApplicantSelf(requestId, userId) {
  const request = findRequest(requestId);
  return request.applicant_user_id === Number(userId);
}

// Authorization is a pure lookup against the CURRENT request status — this is the single
// place that decides "does this actor's role/identity match what the current stage needs."
// Every mutating function below calls this FIRST, before touching any data. The frontend's
// own display logic is only a UI convenience; this is the actual authority (system.md's
// "the backend owns the workflow" principle).
function authorizeAction(requestId, actorUser, action) {
  const request = findRequest(requestId);
  const status = request.status;

  if (action === 'hos_hod_review' && status === 'hos_hod_review') {
    if (actorUser.role !== 'hos_hod') throw new WorkflowError('Only HOS/HOD can act at this stage.', 403);
    if (!isHosHodOfUnit(actorUser.user_id, request)) throw new WorkflowError('You are not the HOS/HOD for this applicant\'s unit.', 403);
    return;
  }
  if (action === 'fmb_review' && status === 'fmb_review') {
    if (actorUser.role !== 'fmb') throw new WorkflowError('Only F&B can act at this stage.', 403);
    return;
  }
  if (action === 'cfo_review' && status === 'cfo_review') {
    if (actorUser.role !== 'cfo') throw new WorkflowError('Only CFO can act at this stage.', 403);
    return;
  }
  if (action === 'cancel') {
    if (status === 'cancelled' || status === 'completed_rejected') throw new WorkflowError('This proposal cannot be cancelled.', 400);
    const isCoOwner = db.co_owners.some((c) => c.request_id === request.request_id && c.staff_id && db.staff.find((s) => s.staff_id === c.staff_id)?.user_id === Number(actorUser.user_id));
    if (!isApplicantSelf(requestId, actorUser.user_id) && !isCoOwner) throw new WorkflowError('Only the applicant or a co-owner can cancel.', 403);
    const config = db.config.find((c) => c.code === 'CANCELLATION_DEADLINE_DAYS');
    const schedule = db.event_schedule.find((s) => s.request_id === request.request_id);
    if (schedule && config) {
      const deadline = new Date(schedule.date);
      deadline.setDate(deadline.getDate() - config.number);
      if (new Date() > deadline) throw new WorkflowError('The cancellation deadline for this event has passed.', 400);
    }
    return;
  }
  throw new WorkflowError(`This action is not available at the current stage (${status}).`, 400);
}

module.exports = { WorkflowError, findRequest, isHosHodOfUnit, authorizeAction };
```

- [ ] **Step 2: Write the stage-transition functions**

Append to the same file, before `module.exports`:

```javascript
function highPaxThreshold() {
  return db.config.find((c) => c.code === 'HIGH_PAX_THRESHOLD').number;
}

function recordHistory(requestId, requestTaskId, requirementId, action, actorUserId, actorRole, comment, previousStatus, newStatus) {
  const { nextId } = require('../db');
  db.workflow_history.push({
    workflow_history_id: nextId('workflow_history'),
    request_id: Number(requestId),
    request_task_id: requestTaskId || null,
    requirement_id: requirementId || null,
    action,
    actor_user_id: Number(actorUserId),
    actor_role: actorRole,
    comment: comment || null,
    previous_status: previousStatus,
    new_status: newStatus,
    created_at: new Date().toISOString(),
  });
}

// Called once, right after the applicant's form-submit action creates the `request` row with
// status='draft'. Decides the FIRST real stage per the self-review/CFO-skip rules (Phase 1's
// corrected workflow diagram).
function submitProposal(requestId) {
  const request = findRequest(requestId);
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  const previousStatus = request.status;

  let nextStatus;
  if (isHosHodOfUnit(applicant.user_id, request)) {
    // Self-review: skip hos_hod_review entirely, go straight to the F&B/CFO check.
    nextStatus = request.total_pax > highPaxThreshold() ? 'fmb_review' : 'department_review';
  } else if (applicant.role === 'cfo' || applicant.role === 'fmb') {
    // CFO/F&B applying for themselves: skip ALL higher approval.
    nextStatus = 'department_review';
  } else {
    nextStatus = 'hos_hod_review';
  }

  request.status = nextStatus;
  request.submitted_at = new Date().toISOString();
  request.updated_at = new Date().toISOString();
  if (nextStatus === 'department_review') createDepartmentTasks(request.request_id);
  recordHistory(request.request_id, null, null, 'submit', applicant.user_id, applicant.role, null, previousStatus, nextStatus);
  return request;
}

function approveReviewerStage(requestId, actorUserId) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;

  let nextStatus;
  if (previousStatus === 'hos_hod_review') {
    nextStatus = request.total_pax > highPaxThreshold() ? 'fmb_review' : 'department_review';
  } else if (previousStatus === 'fmb_review') {
    nextStatus = request.total_pax > highPaxThreshold() ? 'cfo_review' : 'department_review';
    // (fmb_review is only ever entered when pax IS high per submitProposal's/resubmit's logic,
    // so the `total_pax > highPaxThreshold()` check here is defensive, not reachable via the
    // false branch under normal flow — but kept explicit rather than assumed.)
  } else if (previousStatus === 'cfo_review') {
    nextStatus = 'department_review';
  } else {
    throw new WorkflowError(`Cannot approve from status ${previousStatus}.`, 400);
  }

  request.status = nextStatus;
  request.updated_at = new Date().toISOString();
  if (nextStatus === 'department_review') createDepartmentTasks(request.request_id);
  recordHistory(request.request_id, null, null, 'approve', actorUserId, actor.role, null, previousStatus, nextStatus);
  return request;
}

function rejectReviewerStage(requestId, actorUserId, reason) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  request.status = 'completed_rejected';
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'reject', actorUserId, actor.role, reason, previousStatus, 'completed_rejected');
  return request;
}

// resumeStage is stored directly on the request row as a new field (request.resume_stage) —
// NOT part of the original ems_database_schema.sql request table, added here as a mock-layer
// necessity to track "where to resume." A real backend would likely derive this from the most
// recent workflow_history row instead of storing it directly; the mock takes the simpler path.
function resubmitReviewerStage(requestId, actorUserId, comment) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  request.resume_stage = previousStatus;
  request.status = 'resubmission_required';
  request.reviewer_comment = comment;
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'resubmit', actorUserId, actor.role, comment, previousStatus, 'resubmission_required');
  return request;
}

function applicantResubmit(requestId, updates) {
  const request = findRequest(requestId);
  Object.assign(request, updates);
  const resumeStatus = request.resume_stage || 'hos_hod_review';
  const previousStatus = request.status;
  request.status = resumeStatus;
  request.resume_stage = null;
  request.reviewer_comment = null;
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'applicant-resubmit', request.applicant_user_id, 'applicant', null, previousStatus, resumeStatus);
  return request;
}

function cancelProposal(requestId, actorUserId) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  request.status = 'cancelled';
  request.cancelled_at = new Date().toISOString();
  request.cancelled_by_user_id = Number(actorUserId);
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'cancel', actorUserId, actor.role, null, previousStatus, 'cancelled');
  return request;
}
```

- [ ] **Step 3: Write `createDepartmentTasks` — one `request_task` per selected requirement, grouping water under `fmb`**

Append:

```javascript
const { nextId } = require('../db');

// Called once, the moment a request enters department_review. Creates one request_task per
// DISTINCT requirement the applicant selected, EXCEPT waterLogo/waterNormal — those attach to
// the SAME task as fmb (Phase 1's correction: F&B reviews food + water together, one task).
function createDepartmentTasks(requestId) {
  const applicationRequirements = db.application_requirements.filter((ar) => ar.request_id === Number(requestId));
  const requirementNames = applicationRequirements.map((ar) => db.event_requirements.find((r) => r.requirement_id === ar.requirement_id).requirement_name);

  const roleForRequirement = {
    logistics: 'logistics_manager',
    transportation: 'transportation_manager',
    photoVideo: 'photo_video_manager',
    soundLight: 'sound_light_manager',
    campusTour: 'student_services_manager',
    fundingPurchase: 'cfo',
    fmb: 'fmb',
  };

  // Water rows never get their own task row — they're folded into 'fmb'. If the applicant
  // selected water but NOT fmb explicitly (the Angular form always includes fmb whenever water
  // is picked, per Task 2.5's corrected requirement checklist merge — but defend against it
  // anyway), still create exactly one 'fmb' task.
  const distinctTaskRequirements = [...new Set(requirementNames.map((name) => (name === 'waterLogo' || name === 'waterNormal') ? 'fmb' : name))];

  for (const requirementName of distinctTaskRequirements) {
    const requirement = db.event_requirements.find((r) => r.requirement_name === requirementName);
    db.request_task.push({
      request_task_id: nextId('request_task'),
      request_id: Number(requestId),
      requirement_id: requirement.requirement_id,
      stage_code: 'department_review',
      sequence_no: 1,
      assigned_role: roleForRequirement[requirementName],
      assignment_mode: requirementName === 'fmb' ? 'shared_pool' : 'assigned',
      // NOTE: 'shared_pool' here describes the OVERALL fmb task's eventual staff-fulfilment
      // step conceptually, but the actual shared-pool mechanism (Task 3.4 Step 5) operates at
      // the request_fmb_selection level, not this request_task level — this task row's
      // assignment_mode is mostly informational for fmb; the department-review-time actions
      // (Cafeteria Manager approve/resubmit per selection) read/write request_fmb_selection
      // rows directly, not this table's assignment_mode.
      status: 'pending',
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by_user_id: null,
    });
  }
}
```

- [ ] **Step 4: Write department-task and staff-assignment functions**

Append:

```javascript
function findDepartmentTask(requestId, requirementKey) {
  const requirement = db.event_requirements.find((r) => r.requirement_name === requirementKey);
  const task = db.request_task.find((t) => t.request_id === Number(requestId) && t.requirement_id === requirement.requirement_id && t.stage_code === 'department_review');
  if (!task) throw new WorkflowError('Department task not found.', 404);
  return task;
}

function checkAllDepartmentTasksResolved(requestId) {
  const tasks = db.request_task.filter((t) => t.request_id === Number(requestId) && t.stage_code === 'department_review');
  const allResolved = tasks.every((t) => t.status === 'completed' || t.status === 'cancelled');
  if (allResolved && tasks.length > 0) {
    const request = findRequest(requestId);
    const previousStatus = request.status;
    request.status = 'completed_approved';
    request.updated_at = new Date().toISOString();
    recordHistory(requestId, null, null, 'auto-complete', null, 'system', null, previousStatus, 'completed_approved');
  }
}

function approveDepartmentTask(requestId, requirementKey, actorUserId) {
  const task = findDepartmentTask(requestId, requirementKey);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = task.status;
  task.status = 'approved';
  task.resolved_at = new Date().toISOString();
  task.resolved_by_user_id = Number(actorUserId);
  recordHistory(requestId, task.request_task_id, task.requirement_id, 'approve', actorUserId, actor.role, null, previousStatus, 'approved');

  // fmb is special: 'approve' here means F&B approved the FOOD+WATER REQUEST overall and is
  // about to create selection rows (a separate call — see the routes layer, which calls
  // createFmbSelection() once per cafeteria after this approval) — it does NOT immediately
  // mark the task 'completed'. Every other department's approve DOES immediately complete the
  // task once staff assignment has happened (assignStaffToTask marks it, not this function).
  return task;
}

function resubmitDepartmentTask(requestId, requirementKey, actorUserId, comment) {
  const task = findDepartmentTask(requestId, requirementKey);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = task.status;
  task.status = 'resubmitted';
  task.comment = comment;
  recordHistory(requestId, task.request_task_id, task.requirement_id, 'resubmit', actorUserId, actor.role, comment, previousStatus, 'resubmitted');
  // Per the design spec's "parallel independence": this does NOT touch request.status or any
  // sibling request_task row. The applicant sees this specific department's resubmission in
  // their inbox (a query concern for the routes layer, not this function) while every other
  // department's task continues unaffected.
  return task;
}

function assignStaffToTask(requestTaskId, staffUserId, assignedByUserId) {
  const task = db.request_task.find((t) => t.request_task_id === Number(requestTaskId));
  if (!task) throw new WorkflowError('Task not found.', 404);
  db.task_assignment.push({
    task_assignment_id: nextId('task_assignment'),
    request_task_id: task.request_task_id,
    staff_user_id: Number(staffUserId),
    assigned_by_user_id: assignedByUserId ? Number(assignedByUserId) : null,
    assigned_at: new Date().toISOString(),
  });
  const previousStatus = task.status;
  task.status = 'approved';
  task.resolved_at = new Date().toISOString();
  task.resolved_by_user_id = assignedByUserId ? Number(assignedByUserId) : null;
  recordHistory(task.request_id, task.request_task_id, task.requirement_id, 'assign', assignedByUserId, 'manager', null, previousStatus, 'approved');
  return task;
}

function updateTaskStatus(requestTaskId, status) {
  const task = db.request_task.find((t) => t.request_task_id === Number(requestTaskId));
  if (!task) throw new WorkflowError('Task not found.', 404);
  if (!['preparing', 'completed'].includes(status)) throw new WorkflowError('Staff can only set preparing or completed.', 400);
  const previousStatus = task.status;
  task.status = status;
  if (status === 'completed') { task.resolved_at = new Date().toISOString(); checkAllDepartmentTasksResolved(task.request_id); }
  recordHistory(task.request_id, task.request_task_id, task.requirement_id, status, null, 'staff', null, previousStatus, status);
  return task;
}
```

- [ ] **Step 5: Write the F&B/Cafeteria per-selection functions**

Append:

```javascript
function createFmbSelection(requestFmbId, cafeteriaId, fmbOptionId, menuItemLabel, quantity, notes) {
  const selection = {
    request_fmb_selection_id: nextId('request_fmb_selection'),
    request_fmb_id: Number(requestFmbId),
    cafeteria_id: Number(cafeteriaId),
    fmb_option_id: Number(fmbOptionId),
    menu_item_label: menuItemLabel,
    quantity: Number(quantity),
    status: 'pending',
    notes: notes || null,
  };
  db.request_fmb_selection.push(selection);
  return selection;
}

function findFmbSelection(selectionId) {
  const selection = db.request_fmb_selection.find((s) => s.request_fmb_selection_id === Number(selectionId));
  if (!selection) throw new WorkflowError('Order selection not found.', 404);
  return selection;
}

function requestIdForFmbSelection(selectionId) {
  const selection = findFmbSelection(selectionId);
  const fmbRow = db.request_fmb.find((f) => f.request_fmb_id === selection.request_fmb_id);
  return fmbRow.request_id;
}

// Cafeteria Manager approves ONE selection row -> it enters the shared pool for that
// cafeteria's staff. Does not touch sibling selection rows for the same request_fmb.
function approveFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  selection.status = 'approved';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'approve-selection', actorUserId, actor.role, null, previousStatus, 'approved');
  checkFmbTaskResolved(selectionId);
  return selection;
}

// Cafeteria Manager resubmits ONE selection row -> goes back to F&B with status
// 'resubmitted'. Per the design spec, this does NOT touch the applicant or the parent
// request_task's status at all — it's purely a signal that F&B needs to edit this row.
function resubmitFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  selection.status = 'resubmitted';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'resubmit-selection', actorUserId, actor.role, null, previousStatus, 'resubmitted');
  return selection;
}

// F&B edits a resubmitted row — dish, quantity, and/or cafeteria — then it goes straight back
// to whichever Cafeteria Manager now owns it (same one if cafeteria_id is unchanged, a
// different one if F&B switched it). No separate "re-approve" step: saving the edit IS the
// re-send, per the design spec.
function editFmbSelection(selectionId, updates, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  if (updates.cancel) {
    selection.status = 'cancelled';
    recordHistory(requestIdForFmbSelection(selectionId), null, null, 'cancel-selection', actorUserId, actor.role, null, previousStatus, 'cancelled');
    checkFmbTaskResolved(selectionId);
    return selection;
  }
  if (updates.cafeteriaId !== undefined) selection.cafeteria_id = Number(updates.cafeteriaId);
  if (updates.fmbOptionId !== undefined) selection.fmb_option_id = Number(updates.fmbOptionId);
  if (updates.menuItemLabel !== undefined) selection.menu_item_label = updates.menuItemLabel;
  if (updates.quantity !== undefined) selection.quantity = Number(updates.quantity);
  if (updates.notes !== undefined) selection.notes = updates.notes;
  selection.status = 'pending';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'edit-selection', actorUserId, actor.role, null, previousStatus, 'pending');
  return selection;
}

// First staff member to claim a shared-pool task owns it — it then leaves every other
// eligible staff member's inbox. Modeled here at the selection level: claiming means creating
// a task_assignment row against the PARENT request_task (all fmb selections for one proposal
// share one request_task), scoped further by which cafeteria this specific staff member is
// assigned to (checked by the routes layer before calling this, using cafeteria_assignment).
function claimSharedFmbSelection(selectionId, staffUserId) {
  const selection = findFmbSelection(selectionId);
  if (selection.status !== 'approved') throw new WorkflowError('This order is not available to claim.', 400);
  selection.status = 'preparing';
  const requestId = requestIdForFmbSelection(selectionId);
  recordHistory(requestId, null, null, 'claim-selection', staffUserId, 'cafeteria_staff', null, 'approved', 'preparing');
  return selection;
}

function fulfilFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const previousStatus = selection.status;
  selection.status = 'fulfilled';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'fulfil-selection', actorUserId, 'cafeteria_staff', null, previousStatus, 'fulfilled');
  checkFmbTaskResolved(selectionId);
  return selection;
}

// The fmb request_task is "resolved" once every one of its selection rows has reached a
// terminal state (fulfilled or cancelled) — mirrors checkAllDepartmentTasksResolved's overall
// pattern but scoped to this one task's selection rows instead of sibling request_task rows.
function checkFmbTaskResolved(selectionId) {
  const requestId = requestIdForFmbSelection(selectionId);
  const fmbTask = findDepartmentTask(requestId, 'fmb');
  const allFmbRows = db.request_fmb
    .filter((f) => f.request_id === Number(requestId))
    .flatMap((f) => db.request_fmb_selection.filter((s) => s.request_fmb_id === f.request_fmb_id));
  const allResolved = allFmbRows.length > 0 && allFmbRows.every((s) => s.status === 'fulfilled' || s.status === 'cancelled');
  if (allResolved && fmbTask.status !== 'completed') {
    const previousStatus = fmbTask.status;
    fmbTask.status = 'completed';
    fmbTask.resolved_at = new Date().toISOString();
    recordHistory(requestId, fmbTask.request_task_id, fmbTask.requirement_id, 'complete', null, 'system', null, previousStatus, 'completed');
    checkAllDepartmentTasksResolved(requestId);
  }
}
```

- [ ] **Step 6: Export everything**

Replace the file's final `module.exports` line (from Step 1) with the complete export list:

```javascript
module.exports = {
  WorkflowError,
  findRequest,
  isHosHodOfUnit,
  authorizeAction,
  submitProposal,
  approveReviewerStage,
  rejectReviewerStage,
  resubmitReviewerStage,
  applicantResubmit,
  cancelProposal,
  createDepartmentTasks,
  findDepartmentTask,
  approveDepartmentTask,
  resubmitDepartmentTask,
  assignStaffToTask,
  updateTaskStatus,
  createFmbSelection,
  findFmbSelection,
  approveFmbSelection,
  resubmitFmbSelection,
  editFmbSelection,
  claimSharedFmbSelection,
  fulfilFmbSelection,
};
```

- [ ] **Step 7: Verify the module loads without syntax errors**

```bash
cd "fyp-ui" && node -e "const w = require('./server/services/workflow.service'); console.log(Object.keys(w).length, 'exports');"
```

Expected: `23 exports` (count the `module.exports` object's keys from Step 6 to confirm the exact number — adjust this expected count if you added/removed any function during implementation).

- [ ] **Step 8: Commit**

```bash
git add server/services/workflow.service.js
git commit -m "feat(server): implement the full workflow state machine server-side"
```

---

### Task 3.5: Seed realistic proposals covering every workflow state

**Files:**
- Create: `fyp-ui/server/db/seed-requests.js`
- Modify: `fyp-ui/server/db.js` (require and invoke)

**Interfaces:**
- Consumes: `db.users`, `db.event_category`, `db.event_requirements`, all option tables (Tasks 3.2/3.3), `workflow.service.js`'s `createDepartmentTasks`/`createFmbSelection` (Task 3.4) for the proposals that need pre-populated tasks.
- Produces: populated `db.request`, `db.request_categories`, `db.application_requirements`, every `request_<department>` snapshot table, `db.co_owners`, `db.organizers`, `db.important_people`, `db.general_guest`, `db.event_schedule`, `db.brief_agenda`, `db.request_discussion_topics`, `db.request_task`, `db.task_assignment`, `db.request_fmb_selection`, `db.workflow_history` — the full realistic-mixed-state seed the design spec requires.

This is the highest-value seed data task — it's what actually lets the user click through every stage of the real workflow. Build exactly the 13 scenarios enumerated in the design spec's "Seed data coverage" section, each a full proposal with realistic content (schedule, co-owners, requirements, request details), not placeholder rows.

- [ ] **Step 1: Write a `buildRequest` helper that creates the core `request` row plus every support table row, given a plain description object**

```javascript
const { nextId } = require('../db');

function buildRequest(db, opts) {
  const applicant = db.users.find((u) => u.email === opts.applicantEmail);
  const unit = db.unit_users.find((uu) => uu.user_id === applicant.user_id);
  const unitRow = unit ? db.unit.find((u) => u.code === unit.unit_code) : null;

  const request = {
    request_id: nextId('request'),
    request_code: opts.requestCode,
    applicant_user_id: applicant.user_id,
    applicant_name: `${applicant.first_name} ${applicant.last_name}`,
    applicant_email: applicant.email,
    applicant_department_or_school: unitRow ? unitRow.description : 'School of Computing',
    event_title: opts.eventTitle,
    short_introduction: opts.shortIntroduction,
    goals_objectives: opts.goals,
    expected_benefits: opts.benefits,
    event_visibility: opts.visibility || 'Public',
    event_format: opts.format || 'On Campus',
    registration_approval: opts.registrationApproval || 'Automatic',
    promotion_publicity_method: opts.publicity || null,
    event_image: null,
    total_pax: opts.totalPax,
    max_pax: opts.maxPax || null,
    status: 'draft',
    submitted_at: null,
    cancelled_at: null,
    cancelled_by_user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resume_stage: null,
    reviewer_comment: null,
  };
  db.request.push(request);

  for (const categoryName of opts.categories || []) {
    const category = db.event_category.find((c) => c.name === categoryName);
    db.request_categories.push({ request_id: request.request_id, category_id: category.event_category_id });
  }

  for (const requirementName of opts.requirements || []) {
    const requirement = db.event_requirements.find((r) => r.requirement_name === requirementName);
    db.application_requirements.push({ request_id: request.request_id, requirement_id: requirement.requirement_id });
  }

  db.event_schedule.push({ event_schedule_id: nextId('event_schedule'), request_id: request.request_id, date: opts.schedule.date, start_time: opts.schedule.start, end_time: opts.schedule.end, location: opts.schedule.location });

  for (const organizer of opts.organizers || [{ name: request.applicant_name, email: request.applicant_email, role: 'Event Lead', note: 'Primary point of contact.' }]) {
    db.organizers.push({ organizer_id: nextId('organizers'), request_id: request.request_id, staff_id: null, staff_first_name: organizer.name.split(' ')[0], staff_last_name: organizer.name.split(' ').slice(1).join(' '), staff_email: organizer.email, staff_role: organizer.role, note: organizer.note || null });
  }

  for (const guest of opts.guests || [{ guestType: 'Students', count: Math.round(opts.totalPax * 0.8), notes: 'General admission.' }]) {
    db.general_guest.push({ general_guest_id: nextId('general_guest'), request_id: request.request_id, guest_type: guest.guestType, count: guest.count, notes: guest.notes || null });
  }

  return request;
}

module.exports = { buildRequest };
```

- [ ] **Step 2: Write per-department request-detail helpers**

Append to the same file (each mirrors one `request_<department>` table's exact columns from the corrected `ems_database_schema.sql`):

```javascript
function addLogisticsRequest(db, request, opts) {
  db.request_logistics.push({ request_logistics_id: nextId('request_logistics'), request_id: request.request_id, option_id: opts.optionId || null, item: opts.item, quantity: opts.quantity, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addTransportationRequest(db, request, opts) {
  db.request_transportation.push({ request_transportation_id: nextId('request_transportation'), request_id: request.request_id, option_id: opts.optionId || null, type: opts.type, requested_pax: opts.requestedPax, pickup: opts.pickup, dropoff: opts.dropoff, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addPhotoVideoRequest(db, request, opts) {
  db.request_photography_videography.push({ request_photography_videography_id: nextId('request_photography_videography'), request_id: request.request_id, option_id: opts.optionId || null, service: opts.service, personnel_quantity: opts.personnelQuantity, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, coverage: opts.coverage, notes: opts.notes || null });
}
function addSoundLightRequest(db, request, opts) {
  db.request_sound_light.push({ request_sound_light_id: nextId('request_sound_light'), request_id: request.request_id, option_id: opts.optionId || null, item: opts.item, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addFmbRequest(db, request, opts) {
  const row = { request_fmb_id: nextId('request_fmb'), request_id: request.request_id, option_id: opts.optionId || null, food_type: opts.foodType, pax: opts.pax, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null };
  db.request_fmb.push(row);
  return row;
}
function addCampusTourRequest(db, request, opts) {
  db.request_campus_tour.push({ request_campus_tour_id: nextId('request_campus_tour'), request_id: request.request_id, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, pax: opts.pax, start_point_option_id: opts.startPointOptionId || null, start_point: opts.startPoint, notes: opts.notes || null });
}
function addWaterLogoRequest(db, request, opts) {
  db.request_mineral_water_logo.push({ request_mineral_water_logo_id: nextId('request_mineral_water_logo'), request_id: request.request_id, option_id: opts.optionId || null, quantity: opts.quantity, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addFundingPurchaseRequest(db, request, opts) {
  db.request_funding_purchase.push({ request_funding_purchase_id: nextId('request_funding_purchase'), request_id: request.request_id, main_option_id: opts.mainOptionId || null, main_item: opts.mainItem, sub_option_id: opts.subOptionId || null, sub_item: opts.subItem, quantity: opts.quantity, unit_price_rm: opts.unitPrice, notes: opts.notes || null });
}

module.exports.addLogisticsRequest = addLogisticsRequest;
module.exports.addTransportationRequest = addTransportationRequest;
module.exports.addPhotoVideoRequest = addPhotoVideoRequest;
module.exports.addSoundLightRequest = addSoundLightRequest;
module.exports.addFmbRequest = addFmbRequest;
module.exports.addCampusTourRequest = addCampusTourRequest;
module.exports.addWaterLogoRequest = addWaterLogoRequest;
module.exports.addFundingPurchaseRequest = addFundingPurchaseRequest;
```

- [ ] **Step 3: Write the main seed function with all 13 scenarios**

Append the main export, replacing the bare helper exports at the end with a single `seedRequests(db, nextId)` function that ALSO re-exports the helpers (so this file still supports both "seed everything" and "used as a helper library" — but only `seedRequests` needs to be required by `db.js`):

```javascript
const workflow = require('../services/workflow.service');

function seedRequests(db) {
  // Scenario 1: plain low-pax proposal mid-hos_hod_review.
  const r1 = buildRequest(db, {
    requestCode: 'EVT-260201', applicantEmail: 'aina.rahman@student.apu.edu.my',
    eventTitle: 'APU Photography Club Exhibition', shortIntroduction: 'A showcase of student photography from the past semester.',
    goals: 'Give student photographers a public platform for their work.', benefits: 'Increased visibility for the Photography Club and stronger campus arts culture.',
    totalPax: 45, categories: ['Culture & Community'], requirements: ['logistics'],
    schedule: { date: '2026-08-20', start: '14:00', end: '18:00', location: 'Spine Gallery' },
  });
  addLogisticsRequest(db, r1, { item: 'Display easels', quantity: 20, date: '2026-08-20', start: '12:00', end: '18:00', location: 'Spine Gallery', notes: 'Set up before 12pm.' });
  r1.status = 'hos_hod_review';
  r1.submitted_at = new Date().toISOString();

  // Scenario 2: high-pax proposal mid-fmb_review (not yet reached CFO).
  const r2 = buildRequest(db, {
    requestCode: 'EVT-260202', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Future Tech Showcase 2026', shortIntroduction: 'Student technology demonstrations and industry panel discussions.',
    goals: 'Connect student innovators with industry.', benefits: 'Professional feedback and collaboration opportunities.',
    totalPax: 120, categories: ['Academic & Career'], requirements: ['logistics', 'fmb'],
    schedule: { date: '2026-08-25', start: '10:00', end: '17:00', location: 'Design Studio' },
  });
  addLogisticsRequest(db, r2, { item: 'Exhibition booths', quantity: 15, date: '2026-08-25', start: '08:00', end: '17:00', location: 'Design Studio', notes: null });
  addFmbRequest(db, r2, { foodType: 'Buffet', pax: 120, date: '2026-08-25', start: '12:00', end: '13:30', location: 'Design Studio', notes: 'Halal and vegetarian selections required.' });
  r2.status = 'fmb_review';
  r2.submitted_at = new Date().toISOString();

  // Scenario 3: high-pax proposal mid-cfo_review (F&B already approved, CFO pending).
  const r3 = buildRequest(db, {
    requestCode: 'EVT-260203', applicantEmail: 'jordan.lee@staff.apu.edu.my',
    eventTitle: 'APU Sports Carnival', shortIntroduction: 'A university-wide day of sports and wellness activities.',
    goals: 'Encourage active lifestyles across schools.', benefits: 'Improved wellbeing and inter-school teamwork.',
    totalPax: 320, categories: ['Sports & Wellness'], requirements: ['logistics', 'transportation'],
    schedule: { date: '2026-09-02', start: '08:00', end: '18:00', location: 'Sports Centre' },
  });
  addLogisticsRequest(db, r3, { item: 'Banquet chairs', quantity: 100, date: '2026-09-02', start: '07:00', end: '18:00', location: 'Sports Centre', notes: null });
  addTransportationRequest(db, r3, { type: 'Chartered bus', requestedPax: 44, pickup: 'APU Residence', dropoff: 'Sports Centre', date: '2026-09-02', start: '07:00', end: '08:00', location: 'Sports Centre', notes: null });
  r3.status = 'cfo_review';
  r3.submitted_at = new Date().toISOString();

  // Scenario 4: high-pax proposal where CFO resubmitted; resumed at cfo_review after
  // applicant's fix (demonstrates F&B is skipped on resume).
  const r4 = buildRequest(db, {
    requestCode: 'EVT-260204', applicantEmail: 'aina.rahman@student.apu.edu.my',
    eventTitle: 'Innovation Summit 2026', shortIntroduction: 'A day of keynotes and workshops on emerging technology.',
    goals: 'Expose students to industry innovation trends.', benefits: 'Broader technical awareness and networking.',
    totalPax: 200, categories: ['Academic & Career'], requirements: ['fundingPurchase'],
    schedule: { date: '2026-09-10', start: '09:00', end: '17:00', location: 'Auditorium 1' },
  });
  addFundingPurchaseRequest(db, r4, { mainItem: 'Honorarium', subItem: 'Guest speaker', quantity: 3, unitPrice: 1500, notes: 'Three keynote speakers.' });
  r4.status = 'cfo_review';
  r4.submitted_at = new Date().toISOString();
  r4.resume_stage = null; // already resumed — this row represents the state AFTER resubmission, back at cfo_review
  workflow.WorkflowError && null; // (no-op; keeps the require above from being flagged unused if a linter runs — remove if unnecessary once implemented)

  // Scenario 5: HOS/HOD self-application — skipped straight to F&B review.
  const r5 = buildRequest(db, {
    requestCode: 'EVT-260205', applicantEmail: 'hoshod@demo.apu.edu.my',
    eventTitle: 'School Leadership Retreat', shortIntroduction: 'An internal planning retreat for school leadership.',
    goals: 'Align on the coming semester\'s priorities.', benefits: 'Stronger leadership coordination.',
    totalPax: 30, categories: ['Academic & Career'], requirements: ['fmb'],
    schedule: { date: '2026-08-18', start: '09:00', end: '16:00', location: 'Auditorium 2' },
  });
  addFmbRequest(db, r5, { foodType: 'Lunch', pax: 30, date: '2026-08-18', start: '12:00', end: '13:00', location: 'Auditorium 2', notes: null });
  r5.status = 'fmb_review'; // skipped hos_hod_review because applicant IS this unit's HOS/HOD
  r5.submitted_at = new Date().toISOString();

  // Scenario 6: applicant-is-CFO application — skipped straight to department_review.
  const r6 = buildRequest(db, {
    requestCode: 'EVT-260206', applicantEmail: 'cfo@demo.apu.edu.my',
    eventTitle: 'Finance Office Town Hall', shortIntroduction: 'A quarterly briefing for the Finance Office team.',
    goals: 'Share quarterly results and priorities.', benefits: 'Team alignment.',
    totalPax: 25, categories: ['Academic & Career'], requirements: ['logistics'],
    schedule: { date: '2026-08-15', start: '10:00', end: '11:30', location: 'Auditorium 2' },
  });
  addLogisticsRequest(db, r6, { item: 'Chairs', quantity: 25, date: '2026-08-15', start: '09:30', end: '11:30', location: 'Auditorium 2', notes: null });
  r6.status = 'department_review';
  r6.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r6.request_id);

  // Scenario 7: department_review proposal — 2 of 4 tasks approved+assigned, 1 pending, 1 resubmitted.
  const r7 = buildRequest(db, {
    requestCode: 'EVT-260207', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'APU Cultural Night 2026', shortIntroduction: 'An evening celebrating APU\'s international community.',
    goals: 'Strengthen cross-cultural understanding.', benefits: 'Greater student participation and cultural awareness.',
    totalPax: 180, categories: ['Culture & Community'], requirements: ['logistics', 'soundLight', 'photoVideo', 'transportation'],
    schedule: { date: '2026-08-08', start: '16:00', end: '22:00', location: 'Atrium' },
  });
  addLogisticsRequest(db, r7, { item: 'Banquet chairs and registration tables', quantity: 188, date: '2026-08-08', start: '13:00', end: '15:30', location: 'Atrium', notes: 'Complete setup before vendor arrival.' });
  addSoundLightRequest(db, r7, { item: 'Main-stage sound and lighting', date: '2026-08-08', start: '14:00', end: '22:00', location: 'Atrium stage', notes: 'Wireless microphones, digital mixer.' });
  addPhotoVideoRequest(db, r7, { service: 'Photo and video team', personnelQuantity: 3, date: '2026-08-08', start: '16:00', end: '22:00', location: 'Atrium', coverage: 'Performances, guests, awards.', notes: null });
  addTransportationRequest(db, r7, { type: 'Campus shuttle', requestedPax: 28, pickup: 'APU Residence', dropoff: 'Campus', date: '2026-08-08', start: '15:00', end: '22:30', location: 'Atrium', notes: 'Two scheduled pickup windows.' });
  r7.status = 'department_review';
  r7.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r7.request_id);
  {
    const logisticsManager = db.users.find((u) => u.role === 'logistics_manager');
    const logisticsStaff = db.users.find((u) => u.role === 'logistics_staff');
    workflow.approveDepartmentTask(r7.request_id, 'logistics', logisticsManager.user_id);
    workflow.assignStaffToTask(workflow.findDepartmentTask(r7.request_id, 'logistics').request_task_id, logisticsStaff.user_id, logisticsManager.user_id);

    const avManager = db.users.find((u) => u.role === 'sound_light_manager' || u.role === 'av_manager');
    const avTech = db.users.find((u) => u.role === 'av_technician');
    if (avManager && avTech) {
      workflow.approveDepartmentTask(r7.request_id, 'soundLight', avManager.user_id);
      workflow.assignStaffToTask(workflow.findDepartmentTask(r7.request_id, 'soundLight').request_task_id, avTech.user_id, avManager.user_id);
    }

    const photoManager = db.users.find((u) => u.role === 'photography_manager');
    if (photoManager) workflow.resubmitDepartmentTask(r7.request_id, 'photoVideo', photoManager.user_id, 'Please confirm exact number of guests requiring photo coverage before we can allocate personnel.');
    // transportation task is left at 'pending' — the 4th, untouched task for this scenario.
  }

  // Scenario 8: F&B request with 2 request_fmb_selection rows — one approved+claimed by
  // Cafeteria Staff, one resubmitted back to F&B.
  const r8 = buildRequest(db, {
    requestCode: 'EVT-260208', applicantEmail: 'jordan.lee@staff.apu.edu.my',
    eventTitle: 'Graduate Networking Evening', shortIntroduction: 'An evening for graduating students to connect with alumni.',
    goals: 'Support graduate employability.', benefits: 'New career connections.',
    totalPax: 90, categories: ['Academic & Career'], requirements: ['fmb'],
    schedule: { date: '2026-08-23', start: '17:00', end: '20:30', location: 'Auditorium 2' },
  });
  const r8Fmb = addFmbRequest(db, r8, { foodType: 'Refreshments', pax: 90, date: '2026-08-23', start: '18:00', end: '19:00', location: 'Auditorium 2', notes: 'Split across two cafeterias for faster service.' });
  r8.status = 'department_review';
  r8.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r8.request_id);
  {
    const fmbOption1 = db.fmb_options.find((o) => o.cafeteria_id === db.cafeteria[0].cafeteria_id);
    const fmbOption2 = db.fmb_options.find((o) => o.cafeteria_id === db.cafeteria[1].cafeteria_id);
    const selection1 = workflow.createFmbSelection(r8Fmb.request_fmb_id, db.cafeteria[0].cafeteria_id, fmbOption1.fmb_option_id, fmbOption1.label, 45, null);
    const selection2 = workflow.createFmbSelection(r8Fmb.request_fmb_id, db.cafeteria[1].cafeteria_id, fmbOption2.fmb_option_id, fmbOption2.label, 45, null);
    const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
    const cafeteriaStaff = db.users.find((u) => u.role === 'cafeteria-staff');
    workflow.approveFmbSelection(selection1.request_fmb_selection_id, cafeteriaManager.user_id);
    workflow.claimSharedFmbSelection(selection1.request_fmb_selection_id, cafeteriaStaff.user_id);
    workflow.resubmitFmbSelection(selection2.request_fmb_selection_id, cafeteriaManager.user_id);
  }

  // Scenario 9: fully completed_approved proposal with full task/history trail.
  const r9 = buildRequest(db, {
    requestCode: 'EVT-260082', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Clubs and Societies Fair', shortIntroduction: 'A discovery fair introducing students to APU clubs and societies.',
    goals: 'Increase awareness and membership of student-led organisations.', benefits: 'Stronger campus participation.',
    totalPax: 260, categories: ['Clubs & Societies'], requirements: ['logistics'],
    schedule: { date: '2026-07-18', start: '10:00', end: '16:00', location: 'Spine' },
  });
  addLogisticsRequest(db, r9, { item: 'Display booths', quantity: 24, date: '2026-07-18', start: '08:00', end: '16:00', location: 'Spine', notes: null });
  r9.status = 'department_review';
  r9.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r9.request_id);
  {
    const logisticsManager = db.users.find((u) => u.role === 'logistics_manager');
    const logisticsStaff = db.users.find((u) => u.role === 'logistics_staff');
    workflow.approveDepartmentTask(r9.request_id, 'logistics', logisticsManager.user_id);
    const task = workflow.findDepartmentTask(r9.request_id, 'logistics');
    workflow.assignStaffToTask(task.request_task_id, logisticsStaff.user_id, logisticsManager.user_id);
    workflow.updateTaskStatus(task.request_task_id, 'preparing');
    workflow.updateTaskStatus(task.request_task_id, 'completed');
  }

  // Scenario 10: completed_rejected proposal (rejected at hos_hod_review).
  const r10 = buildRequest(db, {
    requestCode: 'EVT-260210', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Unofficial Campus Party', shortIntroduction: 'A late-night unofficial gathering.',
    goals: 'Social gathering.', benefits: 'Student socialising.',
    totalPax: 300, categories: ['Entertainment & Social'], requirements: ['soundLight'],
    schedule: { date: '2026-08-30', start: '22:00', end: '02:00', location: 'Campus Plaza' },
  });
  addSoundLightRequest(db, r10, { item: 'PA system', date: '2026-08-30', start: '21:00', end: '02:00', location: 'Campus Plaza', notes: null });
  r10.status = 'hos_hod_review';
  r10.submitted_at = new Date().toISOString();
  {
    const hosHod = db.users.find((u) => u.role === 'hos_hod');
    workflow.rejectReviewerStage(r10.request_id, hosHod.user_id, 'Late-night off-hours events past 10pm are not permitted without prior special approval from Campus Safety, which was not obtained.');
  }

  // Scenario 11: cancelled proposal (cancelled by applicant before the deadline).
  const r11 = buildRequest(db, {
    requestCode: 'EVT-260211', applicantEmail: 'aina.rahman@student.apu.edu.my',
    eventTitle: 'Photography Club Field Trip', shortIntroduction: 'An off-campus photography excursion.',
    goals: 'Practical photography experience.', benefits: 'Skill development.',
    totalPax: 20, categories: ['Culture & Community'], requirements: ['transportation'],
    schedule: { date: '2026-12-15', start: '08:00', end: '18:00', location: 'Batu Caves' },
  });
  addTransportationRequest(db, r11, { type: 'University van', requestedPax: 20, pickup: 'APU Main Entrance', dropoff: 'Batu Caves', date: '2026-12-15', start: '08:00', end: '09:00', location: 'Batu Caves', notes: null });
  r11.status = 'hos_hod_review';
  r11.submitted_at = new Date().toISOString();
  workflow.cancelProposal(r11.request_id, r11.applicant_user_id);

  // Scenarios 12-13: draft proposals never submitted.
  buildRequest(db, {
    requestCode: 'EVT-260212', applicantEmail: 'jordan.lee@staff.apu.edu.my',
    eventTitle: 'Draft: Alumni Homecoming', shortIntroduction: 'Planning in progress.',
    goals: 'TBD.', benefits: 'TBD.', totalPax: 0, categories: [], requirements: [],
    schedule: { date: '2026-10-05', start: '10:00', end: '16:00', location: 'TBD' },
  });
  buildRequest(db, {
    requestCode: 'EVT-260213', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Draft: Winter Charity Drive', shortIntroduction: 'Planning in progress.',
    goals: 'TBD.', benefits: 'TBD.', totalPax: 0, categories: [], requirements: [],
    schedule: { date: '2026-12-01', start: '09:00', end: '17:00', location: 'TBD' },
  });
}

module.exports.seedRequests = seedRequests;
```

Note on Scenario 4's placeholder line `workflow.WorkflowError && null;` — this was scaffolding to avoid an unused-require lint warning; DELETE that line during implementation once the file is complete and `workflow.` is clearly used elsewhere (it is, extensively, in Scenarios 6-11) — it serves no purpose and should not ship in the final file.

- [ ] **Step 4: Wire into `db.js`**

Add `const { seedRequests } = require('./db/seed-requests');` and `seedRequests(db);` to `db.js`, positioned AFTER `seedOptions` (Task 3.3) since this seed references option rows, and note that `seedRequests` internally requires `../services/workflow.service`, which itself requires `../db` — this creates a circular require (`db.js` → `seed-requests.js` → `workflow.service.js` → `db.js`). Node.js handles this via its module cache (the second `require('../db')` inside `workflow.service.js` returns the partially-initialized `db` module object, which is fine here because `workflow.service.js` only reads `db.db`'s object reference at call-time, not at require-time — the object reference is stable even while its array contents are still being populated). Verify this works in Step 5 rather than assuming — if it throws, the fix is to have `workflow.service.js` accept `db`/`nextId` as function parameters instead of requiring `../db` directly (matching the pattern already used by the `seed-*.js` modules), which decouples the require order entirely. Try the simpler `require('../db')` approach first since Step 1's `workflow.service.js` skeleton already uses it; only refactor to parameter-passing if Step 5 reveals a real circular-require problem.

- [ ] **Step 5: Verify**

```bash
cd "fyp-ui" && node -e "
const { db } = require('./server/db');
console.log('request:', db.request.length);
console.log('request_task:', db.request_task.length);
console.log('request_fmb_selection:', db.request_fmb_selection.length);
console.log('workflow_history:', db.workflow_history.length);
console.log('statuses:', db.request.map((r) => r.status));
"
```

Expected: `request: 13`, `request_task` > 0, `request_fmb_selection: 2`, `workflow_history` > 0, and the printed status list includes at least one of each: `hos_hod_review`, `fmb_review`, `cfo_review`, `department_review`, `completed_approved`, `completed_rejected`, `cancelled`, `draft`. If any required status is missing from the list, a scenario above didn't actually reach its intended state — debug by adding `console.log` inside the relevant scenario block temporarily, find where it diverges from the intended status, and fix the scenario's setup (not the workflow service, unless the workflow service itself has a bug — in which case, go back to Task 3.4 and fix it there, then re-run this verification).

- [ ] **Step 6: Commit**

```bash
git add server/db/seed-requests.js server/db.js
git commit -m "feat(server): seed 13 realistic proposals covering every workflow state"
```

---

### Task 3.6: Seed event registrations and saved events

**Files:**
- Create: `fyp-ui/server/db/seed-registrations.js`
- Modify: `fyp-ui/server/db.js` (require and invoke)

**Interfaces:**
- Consumes: `db.request` (Task 3.5, needs `completed_approved`/published-equivalent proposals to attach registrations to), `db.users`.
- Produces: populated `db.event_registration`, `db.saved_event`.

- [ ] **Step 1: Write `seed-registrations.js`**

```javascript
module.exports = function seedRegistrations(db, nextId) {
  const approvedRequests = db.request.filter((r) => r.status === 'completed_approved');
  const students = db.users.filter((u) => u.role === 'student');

  for (const request of approvedRequests) {
    for (const student of students) {
      db.event_registration.push({
        event_registration_id: nextId('event_registration'),
        request_id: request.request_id,
        user_id: student.user_id,
        registrant_name: `${student.first_name} ${student.last_name}`,
        registrant_email: student.email,
        reason_for_attending: request.registration_approval === 'Approval Required' ? 'Interested in attending and supporting this event.' : null,
        status: request.registration_approval === 'Approval Required' ? 'pending_approval' : 'registered',
        registered_at: new Date().toISOString(),
      });
    }
  }

  // At least one saved event per student, for My Events / saved-events UI coverage.
  for (const student of students) {
    const first = db.request.find((r) => r.status === 'completed_approved');
    if (first) db.saved_event.push({ user_id: student.user_id, request_id: first.request_id, saved_at: new Date().toISOString() });
  }
};
```

Ensure at least one seeded proposal has `registration_approval = 'Approval Required'` with a resulting `pending_approval` registration row — this is the design spec's explicit "at least one event with registration_approval='manual' and a pending registration in the organizer's inbox" requirement. Cross-check Task 3.5's scenarios: if none of the 13 proposals set `registration_approval: 'Approval Required'` in their `buildRequest` call, go back to Task 3.5 and add it to at least one `completed_approved` scenario (Scenario 9, "Clubs and Societies Fair," is a good candidate) before this task's verification step can pass.

- [ ] **Step 2: Wire into `db.js`**

Add `const seedRegistrations = require('./db/seed-registrations');` and `seedRegistrations(db, nextId);` — position LAST in the invocation sequence (after `seedRequests`, since this depends on `db.request` being populated).

- [ ] **Step 3: Verify**

```bash
cd "fyp-ui" && node -e "
const { db } = require('./server/db');
console.log('event_registration:', db.event_registration.length);
console.log('pending:', db.event_registration.filter((r) => r.status === 'pending_approval').length);
console.log('saved_event:', db.saved_event.length);
"
```

Expected: all three counts > 0, `pending` specifically > 0.

- [ ] **Step 4: Commit**

```bash
git add server/db/seed-registrations.js server/db.js
git commit -m "feat(server): seed event registrations and saved events"
```

---

### Task 3.7: Write `proposal-workflow.routes.js` — the full reference router

**Files:**
- Create: `fyp-ui/server/routes/proposal-workflow.routes.js`
- Create: `fyp-ui/server/services/proposal-projection.service.js` (the `db` row → `ProposalReviewRecord` JSON projection — factored out since Task 3.9's events/config routers don't need it, but this router does, heavily)

**Interfaces:**
- Consumes: `workflow.service.js` (Task 3.4), `db.js` (Task 3.1).
- Produces: every endpoint `ApiProposalWorkflowRepository` (Task 2.10) calls: `GET /api/proposal-workflow`, `GET /api/proposal-workflow/:id`, `POST /api/proposal-workflow/:id/approve`, `POST /api/proposal-workflow/:id/reject`, `POST /api/proposal-workflow/:id/resubmit`, `POST /api/proposal-workflow/:id/confirm-department`, `POST /api/proposal-workflow/:id/resubmit-department`, `POST /api/proposal-workflow/:id/resubmit-applicant`, `POST /api/proposal-workflow/:id/cancel`, `POST /api/proposal-workflow/:id/fmb-selections/:selectionId/approve`, `POST /api/proposal-workflow/:id/fmb-selections/:selectionId/resubmit`. Every response body matches Angular's `ProposalReviewRecord` interface exactly (`core/proposals/proposal-review.models.ts`, as extended by Task 2.9 with `fmbSelections`).

- [ ] **Step 1: Write the projection service**

This assembles the full `ProposalReviewRecord`-shaped object Angular expects, joining across every request-related table. Create `fyp-ui/server/services/proposal-projection.service.js`:

```javascript
const { db } = require('../db');

const STAGE_LABELS = {
  submitted: 'Submitted', hos_hod_review: 'HOS/HOD review', fmb_review: 'F&B review', cfo_review: 'CFO review',
  department_review: 'Department review', resubmission_required: 'Revision required',
  completed_approved: 'Approved', completed_rejected: 'Rejected', cancelled: 'Cancelled', draft: 'Draft',
};

function editableRowsFromOrganizers(requestId) {
  return db.organizers.filter((o) => o.request_id === requestId).map((o) => ({ id: o.organizer_id, name: `${o.staff_first_name} ${o.staff_last_name}`, email: o.staff_email, role: o.staff_role, notes: o.note }));
}
function editableRowsFromCoOwners(requestId) {
  return db.co_owners.filter((c) => c.request_id === requestId).map((c) => ({ id: c.co_owner_id, name: `${c.staff_first_name} ${c.staff_last_name}`, email: c.staff_email, role: c.staff_role }));
}
function editableRowsFromImportantPeople(requestId) {
  return db.important_people.filter((p) => p.request_id === requestId).map((p) => ({ id: p.important_person_id, name: p.name, type: p.type, organization: p.organization, designation: p.designation }));
}
function editableRowsFromGuests(requestId) {
  return db.general_guest.filter((g) => g.request_id === requestId).map((g) => ({ id: g.general_guest_id, guestType: g.guest_type, count: g.count, notes: g.notes }));
}
function editableRowsFromAgenda(requestId) {
  return db.brief_agenda.filter((a) => a.request_id === requestId).map((a) => ({ id: a.brief_agenda_id, time: a.time, activity: a.activity, location: a.location, pic: a.pic, notes: a.notes }));
}
function editableRowsFromDiscussions(requestId) {
  return db.request_discussion_topics.filter((d) => d.request_id === requestId).map((d) => ({ id: d.request_discussion_topic_id, topic: d.discussion_topic }));
}
function editableRowsFromSchedule(requestId) {
  return db.event_schedule.filter((s) => s.request_id === requestId).map((s) => ({ id: s.event_schedule_id, date: s.date, start: s.start_time, end: s.end_time, location: s.location }));
}

function departmentRequestsFor(requestId) {
  const rows = [];
  for (const l of db.request_logistics.filter((r) => r.request_id === requestId)) rows.push({ id: l.request_logistics_id, department: 'logistics', item: l.item, quantity: String(l.quantity), schedule: `${l.date} · ${l.start_time}-${l.end_time}`, location: l.location, notes: l.notes || '' });
  for (const t of db.request_transportation.filter((r) => r.request_id === requestId)) rows.push({ id: t.request_transportation_id, department: 'transportation', item: t.type, quantity: `${t.requested_pax} pax`, schedule: `${t.date} · ${t.start_time}-${t.end_time}`, location: t.location, notes: t.notes || '' });
  for (const p of db.request_photography_videography.filter((r) => r.request_id === requestId)) rows.push({ id: p.request_photography_videography_id, department: 'photoVideo', item: p.service, quantity: String(p.personnel_quantity), schedule: `${p.date} · ${p.start_time}-${p.end_time}`, location: p.location, notes: p.notes || '' });
  for (const s of db.request_sound_light.filter((r) => r.request_id === requestId)) rows.push({ id: s.request_sound_light_id, department: 'soundLight', item: s.item, quantity: '1', schedule: `${s.date} · ${s.start_time}-${s.end_time}`, location: s.location, notes: s.notes || '' });
  for (const f of db.request_fmb.filter((r) => r.request_id === requestId)) rows.push({ id: f.request_fmb_id, department: 'fmb', item: f.food_type, quantity: `${f.pax} pax`, schedule: `${f.date} · ${f.start_time}-${f.end_time}`, location: f.location, notes: f.notes || '' });
  for (const c of db.request_campus_tour.filter((r) => r.request_id === requestId)) rows.push({ id: c.request_campus_tour_id, department: 'campusTour', item: c.start_point, quantity: `${c.pax} pax`, schedule: `${c.date} · ${c.start_time}-${c.end_time}`, location: c.location, notes: c.notes || '' });
  for (const w of db.request_mineral_water_logo.filter((r) => r.request_id === requestId)) rows.push({ id: w.request_mineral_water_logo_id, department: 'waterLogo', item: 'Mineral Water with Logo', quantity: `${w.quantity} bottles`, schedule: `${w.date} · ${w.start_time}-${w.end_time}`, location: w.location, notes: w.notes || '' });
  for (const w of db.request_mineral_water_normal.filter((r) => r.request_id === requestId)) rows.push({ id: w.request_mineral_water_normal_id, department: 'waterNormal', item: 'Mineral Water Normal', quantity: `${w.quantity} bottles`, schedule: `${w.date} · ${w.start_time}-${w.end_time}`, location: w.location, notes: w.notes || '' });
  for (const f of db.request_funding_purchase.filter((r) => r.request_id === requestId)) rows.push({ id: f.request_funding_purchase_id, department: 'fundingPurchase', item: `${f.main_item} — ${f.sub_item}`, quantity: String(f.quantity), schedule: '', location: '', notes: f.notes || '' });
  return rows;
}

function fmbSelectionsFor(requestId) {
  const fmbRows = db.request_fmb.filter((f) => f.request_id === requestId);
  const selections = [];
  for (const fmbRow of fmbRows) {
    for (const selection of db.request_fmb_selection.filter((s) => s.request_fmb_id === fmbRow.request_fmb_id)) {
      const cafeteria = db.cafeteria.find((c) => c.cafeteria_id === selection.cafeteria_id);
      selections.push({
        id: selection.request_fmb_selection_id,
        cafeteriaId: selection.cafeteria_id,
        cafeteriaName: cafeteria ? cafeteria.name : 'Unknown cafeteria',
        menuItemLabel: selection.menu_item_label,
        quantity: selection.quantity,
        notes: selection.notes || '',
        status: selection.status,
      });
    }
  }
  return selections;
}

function selectedRequirementsFor(requestId) {
  return db.application_requirements.filter((ar) => ar.request_id === requestId).map((ar) => db.event_requirements.find((r) => r.requirement_id === ar.requirement_id).requirement_name);
}

function projectProposal(request) {
  const categories = db.request_categories.filter((rc) => rc.request_id === request.request_id).map((rc) => db.event_category.find((c) => c.event_category_id === rc.category_id).name);
  const applicantName = request.applicant_name;
  return {
    id: request.request_id,
    proposalId: request.request_code,
    eventTitle: request.event_title,
    applicant: applicantName,
    applicantInitials: applicantName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(),
    schedule: editableRowsFromSchedule(request.request_id).map((s) => `${s.date} · ${s.start}-${s.end} · ${s.location}`).join('; '),
    shortIntroduction: request.short_introduction,
    goals: request.goals_objectives,
    benefits: request.expected_benefits,
    totalPax: request.total_pax,
    status: STAGE_LABELS[request.status] || request.status,
    category: categories[0] || '',
    requests: departmentRequestsFor(request.request_id),
    applicantEmail: request.applicant_email,
    applicantDepartment: request.applicant_department_or_school,
    coOwners: editableRowsFromCoOwners(request.request_id),
    organizers: editableRowsFromOrganizers(request.request_id),
    importantPeople: editableRowsFromImportantPeople(request.request_id),
    guests: editableRowsFromGuests(request.request_id),
    agenda: editableRowsFromAgenda(request.request_id),
    discussions: editableRowsFromDiscussions(request.request_id),
    scheduleRows: editableRowsFromSchedule(request.request_id),
    eventImage: request.event_image,
    eventVisibility: request.event_visibility,
    eventCategories: categories,
    eventFormat: request.event_format,
    registrationMode: request.registration_approval,
    publicity: request.promotion_publicity_method || '',
    selectedRequirements: selectedRequirementsFor(request.request_id),
    externalPax: Math.round(request.total_pax * 0.1),
    fmbSelections: fmbSelectionsFor(request.request_id),
    workflow: {
      stage: request.status,
      resumeStage: request.resume_stage || undefined,
      reviewerComment: request.reviewer_comment || undefined,
      departmentConfirmations: db.request_task.filter((t) => t.request_id === request.request_id && t.stage_code === 'department_review').map((t) => ({
        department: db.event_requirements.find((r) => r.requirement_id === t.requirement_id).requirement_name,
        confirmed: t.status === 'completed' || t.status === 'approved',
        confirmedAt: t.resolved_at || undefined,
        confirmedBy: t.resolved_by_user_id ? String(t.resolved_by_user_id) : undefined,
      })),
    },
  };
}

module.exports = { projectProposal };
```

- [ ] **Step 2: Write the router**

```javascript
const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { projectProposal } = require('../services/proposal-projection.service');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(db.request.map(projectProposal));
});

router.get('/:id', (req, res) => {
  const request = db.request.find((r) => r.request_id === Number(req.params.id));
  if (!request) return res.status(404).json({ message: 'Proposal not found.' });
  res.json(projectProposal(request));
});

router.post('/:id/approve', (req, res, next) => {
  try {
    const { reviewerRole } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = db.users.find((u) => u.role === reviewerRole);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.approveReviewerStage(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/reject', (req, res, next) => {
  try {
    const { reviewerRole, reason } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = db.users.find((u) => u.role === reviewerRole);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.rejectReviewerStage(req.params.id, actor.user_id, reason);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit', (req, res, next) => {
  try {
    const { reviewerRole, comment } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = db.users.find((u) => u.role === reviewerRole);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.resubmitReviewerStage(req.params.id, actor.user_id, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/confirm-department', (req, res, next) => {
  try {
    const { department, confirmedByEmail } = req.body;
    const actor = db.users.find((u) => u.email === confirmedByEmail);
    workflow.approveDepartmentTask(req.params.id, department, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit-department', (req, res, next) => {
  try {
    const { department, comment } = req.body;
    // NOTE: this endpoint's Angular caller (proposal-department-view.ts's resubmit()) does not
    // currently send the actor's identity in the body — it's derived from AuthService client-side
    // in the original design. For the mock server, look up ANY user with a role matching this
    // department's manager role as a stand-in actor (acceptable simplification — a real backend
    // would authenticate the request and use the actual session user). Use department-workflow
    // config's manager-role mapping (mirrored here in JS, matching Angular's DEPARTMENT_WORKFLOWS
    // from Task 2.2) to find a plausible actor:
    const managerRoleFor = { logistics: 'logistics_manager', transportation: 'transportation_manager', photoVideo: 'photo_video_manager', soundLight: 'sound_light_manager', campusTour: 'student_services_manager', fmb: 'cafeteria-manager', fundingPurchase: 'cfo' };
    const actor = db.users.find((u) => u.role === managerRoleFor[department]);
    workflow.resubmitDepartmentTask(req.params.id, department, actor ? actor.user_id : null, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit-applicant', (req, res, next) => {
  try {
    // req.body carries Partial<ProposalReviewRecord> from Angular — the mock server does not
    // attempt to re-decompose this back into every underlying snapshot table (that would require
    // re-implementing the entire event-proposal form's field mapping server-side, out of scope
    // for a mock). Instead, apply only the top-level fields that map directly onto the `request`
    // row's own columns, and ignore the rest — sufficient for validating the STAGE TRANSITION
    // behavior (the actual point of this endpoint), even though it doesn't fully persist a
    // resubmitted proposal's edited request/table details end-to-end.
    const allowedFields = ['eventTitle', 'shortIntroduction', 'goals', 'benefits', 'totalPax'];
    const fieldMap = { eventTitle: 'event_title', shortIntroduction: 'short_introduction', goals: 'goals_objectives', benefits: 'expected_benefits', totalPax: 'total_pax' };
    const updates = {};
    for (const field of allowedFields) if (req.body[field] !== undefined) updates[fieldMap[field]] = req.body[field];
    workflow.applicantResubmit(req.params.id, updates);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    const { cancelledBy } = req.body;
    const actor = db.users.find((u) => u.email === cancelledBy);
    workflow.authorizeAction(req.params.id, actor, 'cancel');
    workflow.cancelProposal(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/approve', (req, res, next) => {
  try {
    const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
    workflow.approveFmbSelection(req.params.selectionId, cafeteriaManager.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/resubmit', (req, res, next) => {
  try {
    const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
    workflow.resubmitFmbSelection(req.params.selectionId, cafeteriaManager.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

module.exports = router;
```

Note the two spots above marked with `// NOTE:` — these document real simplifications where the mock server can't fully replicate what a production backend (with real authenticated sessions) would do. This is intentional and consistent with the design spec's scope; flag both in your task completion summary rather than silently treating them as complete.

- [ ] **Step 3: Manual smoke test**

```bash
cd "fyp-ui" && node server/index.js &
sleep 1
curl -s http://localhost:4000/api/proposal-workflow | node -e "const data = JSON.parse(require('fs').readFileSync(0)); console.log('count:', data.length); console.log('first id:', data[0].id, 'stage:', data[0].workflow.stage);"
curl -s http://localhost:4000/api/proposal-workflow/1 | node -e "const data = JSON.parse(require('fs').readFileSync(0)); console.log(JSON.stringify(data, null, 2).slice(0, 500));"
kill %1
```

Expected: `count: 13`, a valid proposal id/stage printed, and the second command prints real JSON matching `ProposalReviewRecord`'s shape (not an error).

- [ ] **Step 4: Commit**

```bash
git add server/services/proposal-projection.service.js server/routes/proposal-workflow.routes.js
git commit -m "feat(server): implement the proposal-workflow REST API and full ProposalReviewRecord projection"
```

---

### Task 3.8: Write the remaining 8 routers

**Files:**
- Create: `fyp-ui/server/routes/auth.routes.js`
- Create: `fyp-ui/server/routes/request-options.routes.js`
- Create: `fyp-ui/server/routes/admin.routes.js`
- Create: `fyp-ui/server/routes/staff-tasks.routes.js`
- Create: `fyp-ui/server/routes/events.routes.js`
- Create: `fyp-ui/server/routes/event-engagement.routes.js`
- Create: `fyp-ui/server/routes/config.routes.js`
- Create: `fyp-ui/server/routes/uploads.routes.js`

**Interfaces:**
- Consumes: `db.js` (Task 3.1), seed data (Tasks 3.2/3.3/3.5/3.6), `workflow.service.js` where noted.
- Produces: every remaining endpoint the Angular `Api*` classes call. Each router follows the exact same shape as `proposal-workflow.routes.js` (Task 3.7): `const express = require('express'); const { db, nextId } = require('../db'); const router = express.Router(); router.get/post/put/patch/delete(...); module.exports = router;` — plain CRUD against the in-memory arrays, with a snake_case→camelCase projection function at the top of each file where the DB row shape differs from the API response shape.

This task is 8 structurally-similar routers. Each sub-section below gives the exact endpoint list, request/response shapes, and DB tables involved — implement each following `proposal-workflow.routes.js`'s established conventions (try/catch + `next(err)` for error handling via `app.js`'s error middleware, `Number(req.params.id)` for numeric ids, direct string comparison for string ids).

- [ ] **Step 1: `auth.routes.js`**

Endpoint: `POST /api/auth/login` — body `{ email, password }`. Look up `db.users.find(u => u.email === email && u.password === password)`. If found, respond `200` with the `AuthUser`-shaped projection (camelCase): `{ email, displayName: \`${first_name} ${last_name}\`, username: email.split('@')[0], role, accountType: role === 'external_user' ? 'external' : 'internal', roleLabel: <derive from a ROLE_LABELS map mirroring mock-users.ts's roleDetails — transcribe that map into this file as a plain object>, department: <staff/student row's department_or_school/school, or a sensible default> }`. If not found, respond `401` with `{ message: 'The email or password is incorrect.' }`.

Since `roleLabel`/`department` require the same lookup logic Angular's `mock-users.ts` has (`roleDetails` record), duplicate that map into this router file as a plain JS object — read `fyp-ui/src/app/core/auth/mock-users.ts` (as corrected by Task 2.1) at implementation time and transcribe its `roleDetails` object directly into `auth.routes.js`, keyed by the same role string values used in `db.users.role`.

- [ ] **Step 2: `request-options.routes.js`**

Endpoints (matching `ApiRequestOptionRepository`, Task 2.10 Step 3):
- `GET /` — query params `kinds` (comma-separated), `active` (`'true'`), `search`. Combine ALL option tables into one flat array (the Angular `RequestOption` union type spans 11 different DB tables), filter by kind/active/search, return.
- `GET /:id` — id format is `<kind>-<numericId>` is NOT how the mock server's ids work (Angular's OLD mock data used string ids like `'log-chairs'`; Task 3.3's seed uses real auto-incrementing integers per table) — since `RequestOptionDraft`/`RequestOption.id` is typed as `string` in Angular (unchanged by this plan), the router should respond with `id: String(<the table's integer PK>)` and `kind: <derived from which table it came from>`, and parse the same `<kind>-<id>` convention is NOT needed — instead, encode the id as `${kind}:${integerId}` (e.g. `'logistics:1'`) so `GET /:id`/`PUT /:id`/etc. can parse which table to look in. Update the combining logic in `GET /` to produce ids in this same `${kind}:${integerId}` format for consistency.
- `POST /` — body is `RequestOptionDraft` shape (camelCase, includes `kind`). Insert into the matching table (a `KIND_TO_TABLE` map: `{ logistics: 'logistics_options', transportation: 'transportation_options', photoVideo: 'media_options', soundLight: 'sound_light_options', fmb: 'fmb_options', dietaryInformation: 'dietary_information_options', servingUnit: 'serving_unit_options', campusTourStart: 'campus_tour_start_options', waterLogo: 'water_logo_options', waterNormal: 'water_normal_options', fundingMain: 'funding_main_options', fundingSub: 'funding_sub_options' }`), assign a new PK via `nextId(table)`, respond with the created row projected back to `RequestOption` shape.
- `PUT /:id` — same body shape, update the existing row (parse `kind`/integer id from the `:id` param per the encoding above).
- `PATCH /:id/status` — body `{ active }`, toggle just that field.
- `DELETE /:id` — remove the row from its table.

Write a `projectOption(kind, row)` function per kind mapping DB snake_case columns back to the exact `RequestOption` union member shape from `request-option.models.ts` (Task 2.4) — e.g. for `logistics`: `{ id: `logistics:${row.logistics_option_id}`, kind: 'logistics', label: row.label, description: row.description, active: row.active, imageDataUrl: row.item_image_url, availableQuantity: row.available_quantity, quantityUnit: row.quantity_unit }`. Write one such mapping per kind, matching Task 3.3's field-mapping table exactly in reverse.

- [ ] **Step 3: `admin.routes.js`**

Endpoints (matching `ApiAdminDirectoryRepository`, Task 2.10 Step 4):
- `GET /users` — project `db.users` (joined with `db.staff`/`db.student` for department) into `AdminUserRecord` shape: `{ id: String(user_id), displayName, username: email.split('@')[0], email, role, roleLabel: <from the same roleDetails map as auth.routes.js — consider extracting this map into a small shared `server/services/role-labels.js` module both routers require, rather than duplicating it verbatim in two files>, unitId: <unit code the user belongs to, via db.unit_users>, department: <unit description>, active: is_active }`.
- `GET /units` — project `db.unit` into `AdminUnitRecord` shape: `{ id: code, name: description, code, description, active: is_active }` (note: schema's `unit.code` doubles as both `AdminUnitRecord.id` AND `.code` in the projection, and `unit.description` doubles as both `.name` and `.description` — this mirrors how the existing Angular `admin-directory.mock-data.ts` derived `AdminUnitRecord` fields, which this plan's earlier survey confirmed).
- `POST /users` / `PUT /users/:id` — body is `AdminUserDraft` shape; insert/update `db.users` (and `db.staff`/`db.student`/`db.unit_users` rows as needed to keep them consistent).
- `PATCH /users/:id/status` — body `{ active }`, toggle `db.users`'s `is_active`.
- `POST /units` / `PUT /units/:id` — body is `AdminUnitDraft`; insert/update `db.unit`.
- `PATCH /units/:id/status` — body `{ active }`, toggle `db.unit`'s `is_active`.

- [ ] **Step 4: `staff-tasks.routes.js`**

Endpoints (matching `ApiStaffTaskRepository`, Task 2.10 Step 5):
- `GET /` — query params `role`, `assignedToEmail`. This endpoint needs to surface `request_task` rows (Task 3.5's seed data) projected into the `StaffTask` shape Angular expects: `{ id: String(request_task_id), role, assignedToEmail, eventCode: <request.request_code>, eventTitle: <request.event_title>, request: <a human label for the requirement>, quantity: <derived from the matching request_<department> row if applicable>, schedule: <derived similarly>, location: <derived similarly>, detailLabel: 'Department notes', detail: <request_task.comment or the underlying request row's notes>, status: <request_task.status, but ONLY 'assigned'|'preparing'|'completed' are valid StaffTaskStatus values per Task 2.6's corrected type — map request_task.status 'approved'→'assigned' for this projection, 'preparing'→'preparing', 'completed'→'completed'>, completedAt: <resolved_at if status is completed> }`. Filter to only tasks where a `task_assignment` row exists linking this `assignedToEmail`'s `user_id` to the `request_task_id`, AND `request_task.assigned_role` matches the `role` query param.

  **When `role === 'cafeteria-staff'`**, this endpoint ALSO needs to surface `request_fmb_selection` rows — both the ones already claimed by this specific staff member (status `preparing`/`fulfilled`, via a `task_assignment` row scoped as Task 3.4 Step 5 describes) AND, separately, the ones still `approved`-but-unclaimed for any cafeteria this staff member is assigned to (via `db.cafeteria_assignment`) — the shared inbox. Since `StaffTask.id` is typed `string` in Angular (unchanged), encode F&B-selection-derived rows with a distinguishable id prefix, e.g. `id: `fmb-selection:${request_fmb_selection_id}`` (vs. plain `String(request_task_id)` for ordinary department tasks), so `PATCH /:id/status`/the new claim endpoint below can tell which underlying table a given `StaffTask.id` refers to. Project each `request_fmb_selection` row into `StaffTask` shape: `{ id: 'fmb-selection:' + row.request_fmb_selection_id, role: 'cafeteria-staff', assignedToEmail: <the claiming staff's email if claimed, else '' for unclaimed shared-pool rows>, eventCode/eventTitle: <via request_fmb -> request>, request: row.menu_item_label, quantity: String(row.quantity), schedule: <via the parent request_fmb row's date/start/end>, location: <via the parent request_fmb row's location>, detailLabel: 'Cafeteria', detail: <the cafeteria's name>, status: <row.status mapped the same way: 'approved'→'assigned' (meaning: claimable, sitting in the shared inbox), 'preparing'→'preparing', 'fulfilled'→'completed'> }`.

- `POST /assignments` — body is `StaffTaskAssignmentDraft` shape. This maps onto `workflow.service.js`'s `assignStaffToTask` — but the Angular caller (`proposal-department-view.ts`'s `assignRequests()`) sends department-level context (`eventCode`, `request` item label, etc.), not a `request_task_id` directly. Look up the matching `request_task` row via `db.request` (by `request_code === eventCode`) joined to `db.request_task` (by matching `assigned_role`/requirement inferred from context), then call `workflow.assignStaffToTask(task.request_task_id, <staff user id looked up from assignedToEmail>, <assigning manager's user id — look up via the task's assigned_role's corresponding manager role, same pattern as Task 3.7's `resubmit-department` endpoint>)`.
- `PATCH /:id/status` — body `{ status, staffEmail }`. Parse `req.params.id`: if it starts with `fmb-selection:`, extract the numeric id and dispatch to F&B-selection logic instead of `request_task` logic — `status: 'preparing'` calls `workflow.claimSharedFmbSelection(selectionId, db.users.find(u => u.email === staffEmail).user_id)`; `status: 'completed'` calls `workflow.fulfilFmbSelection(selectionId, <same staff user id>)`. Otherwise (plain numeric id), `staffEmail` is ignored and this calls `workflow.service.js`'s `updateTaskStatus(id, status)` directly, unchanged from the original design.

This closes a gap: `claimSharedFmbSelection`/`fulfilFmbSelection` (Task 3.4 Step 5) were implemented and used by Task 3.5's seed data, but had no HTTP route exposing them to Angular, and no way for the frontend to identify WHICH staff member is claiming an unclaimed shared-pool row (an unclaimed `StaffTask`-projected F&B selection has no `assignedToEmail` yet — that's the whole point of "shared inbox," so the acting user's identity can't be read off the task object the way every other status update can). Fixing this requires a small, mechanical signature change threaded through 4 files that Tasks 2.6/2.10 already wrote — apply these on top of (not instead of) what those tasks already specified:

  - **`fyp-ui/src/app/core/staff-tasks/staff-task.models.ts`** (Task 2.6 Step 1's edit target): change `StaffTaskRepository`'s interface from `updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask>` to `updateStatus(id: string, status: StaffTaskStatus, staffEmail: string): Observable<StaffTask>`.
  - **`fyp-ui/src/app/core/staff-tasks/staff-task.repository.ts`** (both the transitional Mock class from Task 2.6 Step 3, and the final Api-only class from Task 2.10 Step 5): update `updateStatus`'s signature to match, and have `ApiStaffTaskRepository.updateStatus` send `{ status, staffEmail }` as the PATCH body instead of just `{ status }`. The transitional Mock class (deleted by Task 2.10 anyway) can just accept and ignore the new parameter.
  - **`fyp-ui/src/app/core/staff-tasks/staff-task.service.ts`** (not modified by any earlier task in this plan — read it fresh at implementation time): find its `updateStatus` proxy method and add the `staffEmail` parameter, passed through to the repository call.
  - **`fyp-ui/src/app/features/internal/pages/staff-tasks/staff-tasks.ts`**: find the `confirm()` method (calls `this.service.updateStatus(task.id, status)`) and change it to `this.service.updateStatus(task.id, status, this.auth.user()?.email ?? '')` — inject `AuthService` into this component if it isn't already (check the file's existing constructor/injects at implementation time; it very likely already injects `AuthService` for other purposes given the app-wide pattern, but confirm rather than assume).

For every OTHER caller of `updateStatus` in the codebase (there should be none besides `staff-tasks.ts`'s `confirm()` — verify with `grep -rn "\.updateStatus(" src/app --include="*.ts"` at implementation time), apply the same fix if any are found.

- [ ] **Step 5: `events.routes.js`**

Endpoints (matching `PublishedEventService`, Task 2.14):
- `GET /` — this needs `PublishedEvent`-shaped objects, which per the design spec's schema are actually `request` rows that reached `completed_approved` with `event_visibility='Public'` (the "published events" ARE approved proposals, not a separate seed source — Task 2.14's rewrite kept `PublishedEvent`'s shape from `published-event.models.ts` unchanged, and that shape needs projecting from `db.request` + related tables, similar to but NOT identical to `proposal-projection.service.js`'s `ProposalReviewRecord` projection). Write a NEW projection function in this router (or a shared `server/services/published-event-projection.service.js` if preferred) mapping `db.request` (filtered to `status === 'completed_approved' && event_visibility === 'Public'`) into `PublishedEvent` shape: `{ id: String(request_id), eventTitle: event_title, shortIntroduction: short_introduction, goals: goals_objectives, expectedBenefits: expected_benefits, categories: <from request_categories join>, eventVisibility: event_visibility, promotionMethod: promotion_publicity_method, eventFormat: event_format, eventImage: event_image || <a placeholder EventImageAsset>, schoolDepartment: applicant_department_or_school, audience: ['APU Community'], schedule: <from event_schedule join, ProposalEventSchedule[] shape>, totalExpectedPax: total_pax, registrationMode: registration_approval, confirmedRegistrationCount: <count of event_registration rows for this request with status='registered'>, pendingRegistrationCount: <count with status='pending_approval'>, isFree: true }`.
- `GET /:id` — same projection, single event.
- `GET /:id/registration-count` — `{ count: <confirmedRegistrationCount> }`.
- `GET /:id/registrations?status=pending` — project `db.event_registration` rows for this request/status into `EventRegistration` shape: `{ id: String(event_registration_id), eventId: String(request_id), email: registrant_email, status: <map 'pending_approval'→'pending', 'registered'→'confirmed', else passthrough> }`.
- `POST /:id/register` — body `{ email }`. Insert an `event_registration` row; status `'registered'` if `registration_approval==='Automatic'` else `'pending_approval'`. Respond with `RegistrationResult` shape: `{ status: <'confirmed'|'pending'>, message: <matching text from the original Angular mock's messages> }`.
- `POST /registrations/:id/approve` / `POST /registrations/:id/reject` — update the `event_registration` row's status (`'registered'`/`'rejected'`), respond with the updated row projected to `EventRegistration` shape.
- `GET /my-registrations?email=...&scope=active|history` — project the requesting user's `event_registration` rows joined to their events into `RegisteredEventsResponse` shape (`{ items: [{ event: PublishedEvent, status }], total }`), splitting active (event not yet ended) vs history (event ended) using the same date-comparison logic as Angular's original `isEventEnded()` (reimplemented server-side: compare `event_schedule.date`+`end_time` against `new Date()`).

- [ ] **Step 6: `event-engagement.routes.js`**

Endpoints (matching `SavedEventsService`, Task 2.15):
- `GET /saved?email=...` — project `db.saved_event` rows for this user joined to their published-event projection (reuse Step 5's `PublishedEvent` projection function — require it from `events.routes.js` or the shared projection module) into `SavedEventsResponse` shape.
- `POST /saved` — body `{ email, eventId }`. Insert a `saved_event` row (if not already present). Respond `SavedEventMutationResponse` shape: `{ eventId, saved: true }`.
- `DELETE /saved/:eventId?email=...` — remove the matching `saved_event` row. Respond `{ eventId, saved: false }`.
- `GET /notification-preferences?email=...` — this domain has NO backing table in `ems_database_schema.sql` (notifications are explicitly flagged as a future addition in system.md §8, not built). Store preferences in a simple in-memory `Map` local to this router file (NOT a `db.js` table, since it's outside the schema entirely) keyed by email, defaulting to the same `DEFAULT_PREFERENCES` shape Angular's original `saved-events.service.ts` used: `{ registrationClosingReminder: true, eventStartingReminder: true, registrationClosingStatus: 'pending-api', eventStartingStatus: 'pending-api' }`.
- `PUT /notification-preferences` — body `{ email, ...NotificationPreference }`. Update the same in-memory `Map`.

- [ ] **Step 7: `config.routes.js`**

Endpoints (matching `SystemConfigService`, Task 2.16):
- `GET /` — project `db.config`'s 3 rows into `SystemConfig` shape: `{ paxReviewerThreshold: <HIGH_PAX_THRESHOLD row's number>, cancellationDaysLimit: <CANCELLATION_DEADLINE_DAYS row's number>, eventCategories: <db.event_category's active names, as an array> }`.
- `PUT /` — body is `SystemConfigDraft` (same shape as `SystemConfig`). Update the 3 `db.config` rows' `number` fields; for `eventCategories`, this is a LIST of category names, not a single number — reconcile against `db.event_category` (mark categories not in the new list `active: false`, add any new ones as new `event_category` rows with `active: true`, matching however `system-config.ts`'s admin page actually manages categories — check that Angular component's exact behavior at implementation time, since this plan didn't do a full read of `system-config.ts`/`system-config.html` and the exact UI-to-data-shape mapping for category management needs confirming against the real component before finalizing this endpoint's logic). Respond with the updated `SystemConfig` projection.

- [ ] **Step 8: `uploads.routes.js`**

Endpoint (matching `ApiEventImageUploadService`, Task 2.17):
- `POST /` — body `{ fileName, mimeType, sizeBytes, dataUrl }`. The mock server does not need real file storage (design spec's explicit "Out of Scope") — simply generate a `storageKey` (e.g. `upload-${nextId('_uploads_counter')}` — note this needs its own counter since `_uploads_counter` isn't a real schema table; either add a lightweight ad-hoc counter in this router file, or extend `db.js`'s `nextId()` to accept any string key even if it's not in `TABLE_NAMES` — the current `nextId()` implementation from Task 3.1 already works for arbitrary string keys since it just uses an object property, so this works without modifying `db.js`) and respond `{ storageKey, url: dataUrl }` — i.e., echo the data URL straight back as the "hosted" URL, since there's no real storage backend. This matches Task 2.17's `ApiEventImageUploadService` expectation exactly (`response.url`, `response.storageKey`).

- [ ] **Step 9: Verify every router loads without syntax errors and `app.js` starts cleanly**

```bash
cd "fyp-ui" && node -e "require('./server/app'); console.log('app loaded OK');"
node server/index.js &
sleep 1
curl -s -o /dev/null -w "auth: %{http_code}\n" -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d '{"email":"applicant@demo.apu.edu.my","password":"Demo@123"}'
curl -s -o /dev/null -w "request-options: %{http_code}\n" http://localhost:4000/api/request-options
curl -s -o /dev/null -w "admin/users: %{http_code}\n" http://localhost:4000/api/admin/users
curl -s -o /dev/null -w "staff-tasks: %{http_code}\n" "http://localhost:4000/api/staff-tasks?role=logistics-staff&assignedToEmail=logistics.staff@demo.apu.edu.my"
curl -s -o /dev/null -w "events: %{http_code}\n" http://localhost:4000/api/events
curl -s -o /dev/null -w "config: %{http_code}\n" http://localhost:4000/api/config
kill %1
```

Expected: every line prints `200` (or a documented non-200 if that specific smoke-test input legitimately doesn't match seed data — investigate any unexpected code rather than assuming it's fine).

- [ ] **Step 10: Commit**

```bash
git add server/routes/
git commit -m "feat(server): implement auth, request-options, admin, staff-tasks, events, event-engagement, config, and uploads routers"
```

---

## Phase 4: Wire the Dev-Server Proxy and Verify End-to-End

Connects Angular's dev server to the Express mock server so `ng serve` proxies every `/api/*` call to `localhost:4000`, adds convenience npm scripts, and walks through the seeded workflow scenarios in a real browser to confirm the whole system holds together.

### Task 4.1: Add the Angular dev-server proxy and npm scripts

**Files:**
- Create: `fyp-ui/proxy.conf.json`
- Modify: `fyp-ui/angular.json` (wire `proxyConfig` into the `serve` target)
- Modify: `fyp-ui/package.json` (add `server`/`dev` scripts)

**Interfaces:**
- Consumes: the Express server from Phase 3, listening on port 4000.
- Produces: `ng serve` (run via `npm start`) proxies any request to `/api/*` to `http://localhost:4000`, so Angular's `HttpClient` calls to relative URLs like `/api/proposal-workflow` resolve correctly without CORS issues during local development.

- [ ] **Step 1: Create `proxy.conf.json`**

```json
{
  "/api/*": {
    "target": "http://localhost:4000",
    "secure": false,
    "changeOrigin": true,
    "logLevel": "debug"
  }
}
```

- [ ] **Step 2: Wire `proxyConfig` into `angular.json`**

Read `fyp-ui/angular.json` in full first (not read during this planning session — read it now) to find the exact `projects.<project-name>.architect.serve.options` block. Add `"proxyConfig": "proxy.conf.json"` to that options object. If the `serve` target has a `configurations` sub-object (e.g. `development`/`production`), add `proxyConfig` to the top-level `options`, not inside a specific configuration, so it applies regardless of which configuration is active.

- [ ] **Step 3: Add npm scripts to `fyp-ui/package.json`**

Add two new scripts alongside the existing ones:

```json
    "server": "node server/index.js",
    "dev": "concurrently -n server,ng -c blue,green \"npm run server\" \"npm run start\""
```

Check whether `concurrently` is already a dependency:

```bash
cd "fyp-ui" && node -e "require.resolve('concurrently')" 2>&1
```

If it errors, install it:

```bash
npm install --save-dev concurrently
```

- [ ] **Step 4: Verify the proxy works**

```bash
cd "fyp-ui" && npm run dev &
sleep 8
curl -s -o /dev/null -w "direct server: %{http_code}\n" http://localhost:4000/api/config
curl -s -o /dev/null -w "via ng proxy: %{http_code}\n" http://localhost:4200/api/config
kill %1
```

Expected: both print `200`. If the proxied request fails, check the `ng serve` output captured above for proxy errors (the `logLevel: debug` setting in `proxy.conf.json` will show every proxied request) — common causes: wrong port in `proxy.conf.json`, `proxyConfig` not actually wired into `angular.json`'s active configuration, or the server not finishing startup before the curl fires (increase the `sleep` if needed).

- [ ] **Step 5: Commit**

```bash
git add proxy.conf.json angular.json package.json package-lock.json
git commit -m "feat(dev): wire ng serve proxy to the Express mock server, add npm run dev"
```

---

### Task 4.2: End-to-end verification — walk through every seeded workflow scenario in a real browser

**Files:** none (verification only — this task produces no code changes, only confirms Phases 1-4 actually work together).

**Interfaces:** none.

- [ ] **Step 1: Start both servers**

```bash
cd "fyp-ui" && npm run dev &
sleep 8
```

- [ ] **Step 2: Log in as each role involved in the seeded scenarios and confirm their Inbox/Ongoing/History match expectations**

Using a headless browser tool (per this environment's `run` skill conventions — Playwright or `chromium-cli`, whichever is available; check for `chromium-cli` first, fall back to a Playwright script per the pattern established earlier in this project's session history), log in as each of the following demo accounts (password `Demo@123` for all, per Task 3.2's seed) and verify:

| Account | Expected to see in Inbox |
|---|---|
| `hoshod@demo.apu.edu.my` | Scenario 1 (APU Photography Club Exhibition) awaiting HOS/HOD action; Scenario 10 should NOT appear (already rejected — check History instead) |
| `fmb@demo.apu.edu.my` | Scenario 2 (Future Tech Showcase) awaiting F&B action; Scenario 5 (School Leadership Retreat, self-review case) also awaiting F&B action |
| `cfo@demo.apu.edu.my` | Scenario 3 (APU Sports Carnival) and Scenario 4 (Innovation Summit) both awaiting CFO action |
| `logistics.manager@demo.apu.edu.my` | Scenario 6 (Finance Office Town Hall) department task pending |
| `photography.manager@demo.apu.edu.my` | Scenario 7's photoVideo task, shown as resubmitted/awaiting-applicant (read-only from this role's perspective once resubmitted, per the Inbox/Ongoing rules — confirm it appears correctly in whichever of Inbox/Ongoing matches "resubmitted, not currently this role's turn") |
| `transport.manager@demo.apu.edu.my` | Scenario 7's transportation task, still pending, in Inbox |
| `cafeteria.manager@demo.apu.edu.my` | Scenario 8's SECOND selection (resubmitted back to F&B) should show as no longer actionable by this role; the mock UI built in Task 2.9 should reflect its `resubmitted` status correctly |
| `cafeteria.staff@demo.apu.edu.my` | Scenario 8's FIRST selection, claimed, in their ongoing/task list, marked `preparing` (not in shared inbox — already claimed) |
| `aina.rahman@student.apu.edu.my` | Scenario 1, 5's confirmation... (applicant view — Scenario 1 in Ongoing since it's mid-review, not their turn; Scenario 11 in History as cancelled) |

For each account: log in, screenshot the Inbox page, screenshot the Ongoing page, screenshot the History page. Confirm the proposal titles/stages match the table above. If any proposal is missing from where it should appear, or appears somewhere it shouldn't, this indicates either a Task 3.5 seed data bug (the scenario didn't actually reach the intended state) or a Task 2.x Angular filtering-logic bug (the Inbox/Ongoing/History query logic doesn't correctly derive "is this my turn" from the new stage enum) — trace back to the specific root cause using the systematic-debugging approach (read the actual returned JSON from the network tab / a raw `curl` to `/api/proposal-workflow`, compare against what the UI renders, isolate whether the bug is server-side data or client-side filtering) rather than guessing.

- [ ] **Step 3: Exercise one full happy-path proposal from creation to completion**

Log in as `aina.rahman@student.apu.edu.my` (a plain `student` role account — Task 3.2's seed addition), navigate to the Proposal form, fill out a NEW low-pax event (skip the high-pax path for this first pass), submit it. Log out, log in as `hoshod@demo.apu.edu.my`, find the new proposal in Inbox, approve it. Confirm it now appears in `department_review`. Log in as whichever department manager(s) correspond to the requirements selected, approve + assign staff for each. Confirm the proposal's status becomes `completed_approved` once every department task is resolved (per `workflow.service.js`'s `checkAllDepartmentTasksResolved`, Task 3.4 Step 4). Screenshot the final state.

- [ ] **Step 4: Exercise the F&B/Cafeteria per-selection resubmit loop specifically**

Using Scenario 8's second (resubmitted) selection: log in as `fmb@demo.apu.edu.my`, find the resubmitted selection, edit it (change the cafeteria to the OTHER cafeteria, or change quantity), save. Confirm (via a fresh `GET /api/proposal-workflow/:id` call or re-navigating the UI) that the selection's `status` is back to `pending` and its `cafeteriaId` reflects the edit. Log in as `cafeteria.manager@demo.apu.edu.my`, confirm the edited selection now appears as awaiting their action again, approve it. Confirm it enters the shared inbox. Log in as a Cafeteria Staff member assigned to whichever cafeteria the edit pointed at, confirm they can see and claim it.

- [ ] **Step 5: Confirm draft proposals and event registration/saved-events also work**

Log in as `jordan.lee@staff.apu.edu.my` (owns Scenario 12's draft), confirm it appears in Drafts, not Inbox/Ongoing/History. Log in as a student, browse Explore Events, confirm at least one `completed_approved`+`Public` proposal (Scenario 6 or 9) appears as a published event. Register for it. Save an event. Confirm both actions succeed and reflect correctly on reload (a real page reload, not just client-side state — this confirms the server-backed persistence actually works, not just the in-session signal state).

- [ ] **Step 6: Check the browser console for errors across every screen visited in Steps 2-5**

Any uncaught JS error, failed HTTP request (4xx/5xx not expected by the test), or Angular template error surfaced during this walkthrough is a real bug — trace it to its source file and fix it. Do not conclude verification is complete while any console error remains unexplained.

- [ ] **Step 7: Stop the servers**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 8: Write a short verification summary (not a commit — this is the plan's closing report to the user)**

Document: which scenarios were confirmed working exactly as expected, which needed a fix during this verification pass (and what the fix was — if any fixes were made during Steps 2-6, they should have been committed individually as part of whichever file they touched, following this plan's established "small focused commits" pattern, not batched into one giant fix-everything commit at the end), and any remaining known gaps (e.g., the two `// NOTE:` simplifications flagged in Task 3.7, the `registrationStatus()` conversion gap flagged in Task 2.14 Step 3, the guest-registration-doesn't-persist-server-side gap flagged in Task 2.13 Step 3).

This closes Phase 4 and the plan. The Angular frontend, corrected to match the schema, now runs end-to-end against a real (mock) Express backend implementing the full corrected workflow, seeded with realistic mixed-state data covering every stage described in the design spec.

---
