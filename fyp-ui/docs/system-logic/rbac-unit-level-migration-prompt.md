# Implementation Prompt: Unit + Level RBAC Migration

Paste this prompt to Claude Code (or follow it directly) to execute the full migration described below, end to end.

---

## Goal

Replace the current flat, per-department role strings (`logistics-manager`, `logistics-staff`, `av-manager`, `av-technician`, `photography-manager`, `photography-staff`, `transport-manager`, `transport-staff`, `student-services-manager`, `student-services-member`, `lecturer`, `student`, `staff`, `applicant`, `fmb`) with a **Unit + Level** model:

- Every person who belongs to an organizational Unit (School or Service Department) is defined by **two independent fields**: `unit_code` (which unit) and `function_level` (their level within it) — never a single combined string.
- A person's unit and level can never contradict each other, because they are no longer encoded in one field that can drift out of sync with a separate unit assignment.

This must **never break existing behavior** for the roles that stay flat: `system-admin`, `cfo`, `cafeteria-admin`, `external-user`, `cafeteria-manager`, `cafeteria-staff` (cafeteria already uses the correct scoped pattern via `cafeteria_assignment` — leave it untouched).

---

## Final data model

### Units and their levels

| Unit kind | Manager-level | Staff-level | Other member level |
|---|---|---|---|
| **School** (academic — e.g. School of Computing) | `hos-hod` | `lecturer` | `student` (belongs to the School, not manager/staff) |
| **Service department** (Logistics, A/V, Photography, Transport, Student Services, F&B) | `manager` | `staff` | — |
| **Cafeteria** (existing, untouched) | via `cafeteria_assignment.assignment_role='manager'` | via `cafeteria_assignment.assignment_role='staff'` | — |

So `function_level` is one of: `'manager' | 'staff' | 'student'` — scoped by `unit_code`. A School unit can have all three levels present among its members; a Service department unit only ever has `manager`/`staff`.

### Roles that stay flat (NOT unit-scoped, do not touch their existing behavior)

`system-admin`, `cfo`, `cafeteria-admin`, `external-user`. These have **no** `unit_code` and **no** `function_level` — exactly as today.

### Roles being deleted entirely

- `applicant` — every existing user with this role is migrated to `student` (see migration rules below).
- generic `staff` (the old unscoped "General Staff" role) — deleted; every real staff member now belongs to a School (as `lecturer`) or a Service department (as `staff`-level). If a migrated user cannot be resolved to any unit, do NOT invent a fallback role — surface it in the migration report for manual admin follow-up (see Migration section).

### F&B specifically

F&B becomes a full Service department unit like Logistics/A/V/etc. — it currently only has a manager-level person (`fmb` role); add the staff level. Existing `fmb` users migrate to `unit_code = 'FOOD_AND_BEVERAGE_SERVICES'` (or equivalent derived code), `function_level = 'manager'`.

---

## Schema changes

In `fyp-ui/docs/system-logic/ems_database_schema.sql`:

1. Add `users.function_level VARCHAR(10) NULL CHECK (function_level IN ('manager','staff','student'))`.
2. Add a `users.unit_code` FK reference is **not** new — it already exists via the `unit_users` bridge table; keep using `unit_users` as the source of truth for unit membership rather than duplicating `unit_code` directly on `users`. `function_level` lives on `users` since it's a property of the person, not the unit link (a user has exactly one unit membership relationship in this system already, per `unit_users`'s `(user_id, unit_code)` primary key).
3. Shrink `chk_users_role` — remove all the collapsed department role values (`logistics_manager`, `logistics_staff`, `transportation_manager`, `transportation_staff`, `photo_video_manager`, `photo_video_staff`, `sound_light_manager`, `sound_light_staff` [if present], `student_services_manager`, `student_services_member`, `hos_hod`, `lecturer`, `student`, `staff`, `fmb`) — these become `function_level` values instead, scoped by whichever unit they're linked to. Keep only: `'system_admin'`, `'cfo'`, `'cafeteria_admin'`, `'cafeteria_manager'`, `'cafeteria_staff'`, `'external_user'`.

   **Important nuance:** `role` still needs *some* value for unit-scoped users so existing code that reads `users.role` doesn't break everywhere at once. Use `role` to store a **generic level marker** for unit-scoped users — reuse `function_level`'s value here too (i.e., for a unit-scoped user, `role` and `function_level` hold the same string, `role` is the legacy/display-compat column, `function_level` is the new source of truth going forward). Document this clearly with a comment in the schema.

4. Add a `unit.unit_kind VARCHAR(20)` free-text field (per the admin UI requirement below) — NOT an enum/constrained field, stays free text as specified.

Update `fyp-ui/docs/system-logic/ems_mermaid_erd.mmd` and `fyp-ui/docs/system-logic/system.md` to reflect these changes.

---

## Backend changes

### `fyp-ui/server/db.js`

- Add `function_level` to the `users` table shape.
- Add `unit_kind` to the `unit` table shape.
- Rewrite `ROLE_DEPARTMENTS` / `SEED_ACCOUNTS` / `seedUsersAndUnits()`:
  - Every seed account currently using a collapsed role (see list above) must instead seed with `role` = the generic level string, `function_level` set, and a proper `unit_users` link to the correct unit.
  - Add unit rows for each School (unit_kind = derive from name containing "school", e.g. `"School of Computing"` → unit_kind note it's academic) and each Service department, using the auto-derived code format: lowercase, spaces/dashes → underscores (e.g. `"School of Computing"` → `school_of_computing`).
  - Add at least one F&B staff-level seed account (new — didn't exist before).
  - Delete the `applicant` seed account entries — convert them to `student` role + School unit membership instead.
  - Delete generic `staff` seed accounts that have no clear School/Service department mapping, OR migrate them if derivable (e.g. `jordan.lee@staff.apu.edu.my` with `department: 'Marketing'` — Marketing isn't a School or one of the 6 listed Service departments, so this is genuinely ambiguous; list it in a migration report comment rather than guessing).

### `fyp-ui/server/routes/admin.routes.js`

- `projectUser()`: derive `roleLabel` for unit-scoped users as `` `${unit.description} ${capitalize(function_level)}` `` (e.g. "School of Computing Lecturer", "Logistics and Facilities Manager") instead of a flat lookup table. Keep the flat lookup only for `system-admin`/`cfo`/`cafeteria-admin`/`external-user`.
- `POST /users` and `PUT /users/:id`: accept `unitCode` + `functionLevel` for unit-scoped roles instead of (or in addition to, during transition) a free-text `role`. Add server-side validation: reject the combination if `functionLevel` isn't valid for the target unit's kind (e.g. `'student'` level is invalid for a Service department unit) — this is the non-negotiable integrity check from the original requirement, do not skip it.
- `POST /units` and `PUT /units/:id`: accept `unit_kind` as free text (per requirement). `code` becomes **server-derived and read-only** — computed from `description`/name the same way as the frontend preview (lowercase, non-alphanumeric → underscore), never accepted from the client as free input, to guarantee client and server never disagree on the derivation.

### `fyp-ui/server/routes/auth.routes.js`

- Login response: compose `roleLabel` and `department` the same derived way as `projectUser()` above. Add `functionLevel` and keep `unitId` (already present via `department`/unit lookup logic) in the response payload.

### `fyp-ui/server/services/role-labels.js`

- Keep `ROLE_LABELS` only for the flat roles (`system-admin`, `cfo`, `cafeteria-admin`, `external-user`, `cafeteria-manager`, `cafeteria-staff`).
- Add a new small helper, e.g. `unitRoleLabel(unitDescription, functionLevel)`, used everywhere the old per-department entries used to be looked up.

---

## Frontend changes

### `fyp-ui/src/app/core/auth/auth.models.ts`

- Shrink `UserRole` enum: remove `Applicant`, `Staff`, `Lecturer`, `HosHod`, `LogisticsManager`, `LogisticsStaff`, `AvManager`, `AvTechnician`, `PhotographyManager`, `PhotographyStaff`, `TransportManager`, `TransportStaff`, `StudentServicesManager`, `StudentServicesMember`, `Fmb`, `Student` — these are no longer distinct enum members; they become `(unit, functionLevel)` pairs.
  - **Decide representation carefully:** either (a) keep `UserRole` only for the flat roles and add `functionLevel: 'manager'|'staff'|'student'|null` + `unitId` to `AuthUser` as the source of truth for unit-scoped users, with a synthetic/derived role string kept only for backward-compat display, OR (b) keep a minimal generic `UserRole.UnitManager`/`UnitStaff`/`UnitMember` tri-state and always pair it with `unitId`. Prefer (a) — it matches the schema decision above (role holds a generic marker, function_level is the real source of truth) and requires fewer conditional branches in `role-navigation.ts`.
- Add `functionLevel?: 'manager' | 'staff' | 'student'` to `AuthUser`.
- `unitId` already exists conceptually via `department` — confirm/add an explicit `unitId: string` field on `AuthUser` if not already present, since navigation/permission logic will need to key off it directly rather than parsing `department` text.

### `fyp-ui/src/app/core/auth/role-navigation.ts`

- Re-key `ROLE_NAVIGATION`: the existing `managerRole()`, `proposalRole()`, and the `{ myTasks, taskHistory }` shape for staff-level users **already match** what's needed — this is a re-keying exercise, not new nav design. Replace direct `UserRole` enum lookups with a function that takes `(user: AuthUser)` and switches on `functionLevel` (+ a check for School vs Service unit kind, since School managers/staff get `proposalRole()`-shaped nav while Service dept managers/staff get `managerRole()`-shaped nav — check unit kind via a lookup, not by parsing the unit name at runtime).
- `roleCanAccess()`: update to use the new derived navigation lookup.
- `roleCanUseSavedEvents()`: update the flat role list — School-affiliated `student`/`lecturer`/`hos-hod` levels and the flat roles that already appear here keep the same access; just update which field is being checked.

### `fyp-ui/src/app/core/auth/mock-users.ts`

- Rewrite demo picker accounts to match the new shape (this is the source `db.js`'s `SEED_ACCOUNTS` comment says it was transcribed from — keep them in sync).

### `fyp-ui/src/app/core/auth/auth.service.ts`

- No structural change expected — `navigation` computed already reads `user.role`; update once `role-navigation.ts`'s lookup signature changes to take the full `AuthUser` (it already does for `clubNavigationSections`, so this is consistent with the existing pattern).

### `fyp-ui/src/app/core/auth/role-navigation.spec.ts`

- Update all test fixtures using deleted `UserRole` members to the new `(unitId, functionLevel)` shape.

---

## Admin UI changes (System Admin pages)

Find the existing user-create/edit form and unit-create/edit form (search `fyp-ui/src/app/features` for the admin Users/Units pages referenced in `role-navigation.ts`'s `/app/users` and `/app/units` routes).

### Unit create/edit form

- **Unit Name**: free text, as today.
- **Unit Code**: read-only field, auto-computed live from Unit Name — lowercase, all non-alphanumeric characters (spaces, dashes) replaced with underscores. Recompute on every Unit Name keystroke; never editable directly.
- **Unit Kind**: free text field (not a dropdown), as specified.
- **Warning note**: if the word "school" appears anywhere in Unit Name or the derived Unit Code (case-insensitive), show a non-blocking inline warning: something like *"This will be treated as an academic School (HOS/HOD + Lecturer + Student levels). If that's not correct, update the Unit Kind."* Does not block save.

### User create/edit form

- For flat roles (System Admin, CFO, Cafeteria Admin, External User): keep today's simple role dropdown, unchanged.
- For everyone else: **Unit dropdown first**, populated from existing units. **Function Level dropdown second**, enabled only after a Unit is chosen, options filtered by that unit's kind (School → HOS/HOD, Lecturer, Student; Service department → Manager, Staff). This directly satisfies the original requirement: the UI structurally cannot produce a unit/level mismatch, and the dropdown options are always valid for the chosen unit.
- Cafeteria manager/staff assignment stays on its existing separate flow (`cafeteria_assignment` management), untouched by this change.

---

## Migration script (one-time, run against existing `server/data/db.json`)

Write a Node script (e.g. `fyp-ui/server/scripts/migrate-unit-level-roles.js`) that:

1. **Backs up** `db.json` first (copy to `db.json.pre-unit-level-migration.bak`) before writing anything.
2. For every user with a collapsed department role (`logistics-manager`, `logistics-staff`, `av-manager`, `av-technician`, `photography-manager`, `photography-staff`, `transport-manager`, `transport-staff`, `student-services-manager`, `student-services-member`, `fmb`):
   - Derive `unit_code` from the existing `ROLE_DEPARTMENTS` mapping (already maps role → department name) and `unit_users` link if present; create the `unit_users` row if missing.
   - Set `function_level` = `'manager'` or `'staff'` based on the role name.
   - Set `role` = the generic level marker per the schema decision above.
3. For every user with role `hos-hod`, `lecturer`, `student`: derive their School unit from `staff.department_or_school` / `student.school`, ensure a matching `unit` row exists (create if missing, with auto-derived code), link via `unit_users`, and set `function_level` accordingly (`hos-hod`→manager, `lecturer`→staff, `student`→student).
4. For every user with role `applicant`: convert `role` to `student`, `function_level` to `'student'`, and resolve their School unit the same way as step 3 (using any existing `student`/`staff` extension row, or default to a sensible fallback School if truly unresolvable — flag these in the report).
5. For every user with generic role `staff` that has no matching School or one of the 6 Service departments in `department_or_school`: **do not guess** — leave `function_level` null and write their `user_id` + current `department_or_school` value to a migration report file (`fyp-ui/server/data/migration-report-unit-level.json`) for manual admin review after migration.
6. Add F&B as a proper unit if not already present; ensure the existing `fmb` manager account(s) get `unit_code` + `function_level='manager'`.
7. Print a summary to console: how many users migrated cleanly, how many need manual review, and the backup file location.

Run the script once against the current `db.json`, review its report output, and confirm the resulting data before moving on — do not silently overwrite without showing the report.

---

## Validation checklist (must pass before considering this done)

- [ ] Every seeded user in `db.js` has either a flat role (System Admin/CFO/Cafeteria Admin/External User/Cafeteria Manager/Cafeteria Staff) OR a valid `(unit_code, function_level)` pair — no user is left in an undefined state.
- [ ] No user can exist with `function_level` set but no `unit_users` row, or vice versa.
- [ ] `function_level='student'` never appears paired with a Service department unit; `function_level` in `('manager','staff')` never appears paired with a School unit's `hos-hod`/`lecturer`-only levels being conflated with `student`.
- [ ] Admin UI Unit form: changing Unit Name live-updates the read-only Unit Code preview correctly (dashes/spaces → underscores, lowercase).
- [ ] Admin UI Unit form: creating a unit named e.g. "School of Law" shows the warning note; creating "Logistics" does not.
- [ ] Admin UI User form: Function Level dropdown options change correctly when switching between a School unit and a Service department unit.
- [ ] Login as a migrated user (e.g. a former `logistics-manager`) still lands on the correct dashboard with the correct nav sections — behavior must be identical to before the migration from the end user's perspective.
- [ ] Login as a migrated former-`applicant` user now behaves as a `student`.
- [ ] `role-navigation.spec.ts` passes with updated fixtures.
- [ ] `chk_users_role` constraint in the schema file only lists the flat roles.
- [ ] Migration report correctly flags any user it couldn't confidently resolve, rather than guessing.

---

## Explicitly out of scope for this change

- Cafeteria's existing `cafeteria_assignment`-based manager/staff scoping — already correct, do not touch.
- Club Admin / Club President — already data-driven via `club_admins`/`clubs.user_id`, not role-based; unaffected.
- Any workflow/approval routing logic that currently keys off role strings for department routing (e.g. `workflow.service.js`) — audit it for any hardcoded references to the deleted role strings (`logistics-manager`, `applicant`, `staff`, etc.) and update those specific lookups to use `(unit_code, function_level)` instead, but do not redesign the workflow engine itself.
