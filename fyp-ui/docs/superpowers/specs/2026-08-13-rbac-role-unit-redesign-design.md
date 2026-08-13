# RBAC Redesign: Users / Units / Roles / Page Visibility

Date: 2026-08-13
Status: Approved by user, implementing autonomously (user stepped away, asked for end-to-end completion with a decision log)

## Why

The current system encodes identity as `users.role` + `users.function_level` + `unit.unit_kind`, with
hardcoded branching in `role-navigation.ts`, `workflow.service.js`, and `role-labels.js`. Adding a
department, changing who can review what, or adjusting nav requires editing multiple TypeScript/JS
files. The user wants this fully data-driven: an admin manages Users, Units, Roles, and Page
Visibility (sidebar nav + permissions) from the UI, with no code changes needed for routine org
changes.

## Final Decisions (from conversation)

### Role catalog (9 seed roles, protected — see below)

Unit-scoped (assignment = one row per (user, unit, role)):
- `head-of-school` — eligible only on units whose code contains "school"
- `head-of-department` — eligible only on units whose code does NOT contain "school"
- `lecturer` — eligible only on "school" units
- `staff` — eligible on any unit
- `student` — eligible only on "school" units

Flat/global (assignment = (user, role), unit_code is null):
- `cfo`
- `cafeteria-admin`
- `external-user` — assigned only via self-registration flow, never offered in the admin role picker
- `system-admin`

The F&B "reviewer" job (approves high-pax proposals at the `fmb_review` stage, sets order
quantities, approves cafeteria order selections) is ALL performed by whoever holds
`head-of-department` on the `food_beverage_services` unit. There is no separate `fmb` or
`cafeteria-manager` role — those were a mistaken split of one real job, corrected during
brainstorming. `cafeteria-staff` (order fulfillment) and `cafeteria-admin` (assigns staff to
cafeterias) remain separate, unchanged concerns from the existing `cafeteria_assignment` table.

### "School" detection

No `unit_kind` column. A unit is treated as a School purely by checking whether `unit.code` contains
the substring `"school"`. This is an internal backend helper (`isSchoolUnit(code)`), never exposed as
an admin-facing field.

### Protected vs. custom roles

The 9 seed roles above are permanently protected: name and description are editable, but
`role_code`, `is_unit_scoped`, and the unit-eligibility rule can never be changed, and they can never
be deleted. Any NEW role an admin creates beyond these 9 is fully normal: editable and deletable.

### Deletion rules

**User**: deletable only if (a) zero requests/proposals reference them AND (b) zero role/unit
assignment rows exist for them. Delete click shows a confirmation dialog; if blocked, the dialog
lists every blocking reason at once (e.g. "has 3 requests" AND "assigned to 2 roles" both shown
together, not one-at-a-time).

**Role** (non-protected only): deletable only if zero users currently hold it. Deletion is soft —
moves to an `archived_at`-stamped state, hidden from every picker and grants no permissions while
archived, but restorable by the admin from an archive view. Auto-purged (hard delete) 7 days after
archiving if not restored or manually purged sooner.

**Unit**: same pattern as Role — blocked if any user currently has an assignment row referencing it;
soft-delete to archive; 7-day auto-purge; restorable.

Toast notifications (e.g. "cannot delete: one head already assigned to this unit") appear top-right
and auto-dismiss after 7 seconds.

### Unit editing

`unit.code` is immutable once created (matches `role.role_code`). `unit.description` remains
editable after creation.

### One head per unit

A unit may have at most one `head-of-school` or `head-of-department` assignment at a time
(enforced as one partial-unique constraint spanning both head role codes per unit, since a unit is
only ever eligible for one of the two). Assigning a second head to an already-headed unit is hard
blocked with a toast error — no silent replacement.

### Page Visibility / Nav Builder

This is a full admin-managed sidebar builder, not just a permission matrix:

- Each row (`nav_page`) has: `page_code` (immutable, auto-slug), `label` (editable, this is what
  renders in the sidebar), `entry_type` (`'page' | 'folder'`), `icon` (Material icon name, chosen by
  admin), `parent_page_code` (nullable, for nesting a page under a folder), `sort_order`,
  `route_path` (nullable — a `folder` has none; a `page` created by admin with no real feature yet
  points at the shared placeholder route), `permission_mode` (`'role_only' | 'unit_and_role' |
  'unit_only'`), `is_active`.
- `nav_page_roles`: many-to-many between `nav_page` and `role` — which role(s) satisfy this page's
  gate.
- A `folder` can carry its own `permission_mode` + role list, gating all its children as a group; a
  user who fails the folder's own check sees none of its children, regardless of whether a child
  would individually pass. A user who passes the folder's check still has each child individually
  evaluated.
- `unit_and_role` mode: role is the actual gate (user must hold that role in ANY unit); unit is not
  an admin-configured allowlist — it's just context the resulting page uses to scope its own data
  query (e.g. Inbox filtering to the viewer's own unit). This mirrors how `unit_and_role` pages
  behave today, just made data-driven instead of hardcoded.
- `unit_only` mode is included as a selectable option for future use; no current page needs it.
- Creating a new page via the builder produces ONLY a nav entry + permission config; if no real
  Angular route/component exists yet for it, it links to the existing placeholder page component.
  A developer still has to build real functionality and re-point `route_path` later.
- Admin can preview the sidebar as it would render for a chosen (role, unit) combination — unit
  picker only appears/matters when the chosen role is unit-scoped.
- This table becomes the single source of truth for the internal sidebar: `role-navigation.ts`'s
  hardcoded `ROLE_NAVIGATION` / `unitNavigationFor()` logic is replaced by a runtime tree-builder
  that walks `nav_page` rows and evaluates each against the logged-in user's actual role/unit
  assignments.

## Data Model

```sql
-- Simplified: identity fields only, no role/function_level
CREATE TABLE users (
    user_id       BIGSERIAL PRIMARY KEY,
    full_name     VARCHAR(150) NOT NULL,
    username      VARCHAR(80)  NOT NULL UNIQUE,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password      VARCHAR(255) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- unit_kind dropped. code is immutable (enforced at the app layer, not SQL).
CREATE TABLE unit (
    code          VARCHAR(40) PRIMARY KEY,
    description   VARCHAR(200) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at   TIMESTAMP NULL
);

CREATE TABLE role (
    role_code           VARCHAR(40) PRIMARY KEY,
    role_name           VARCHAR(100) NOT NULL,
    description          VARCHAR(200),
    is_unit_scoped        BOOLEAN NOT NULL,
    -- 'school' | 'non_school' | NULL(any unit) -- only meaningful when is_unit_scoped
    unit_eligibility        VARCHAR(20),
    is_protected            BOOLEAN NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at             TIMESTAMP NULL
);

-- The one assignment table for BOTH unit-scoped and flat roles.
-- Flat role rows have unit_code = NULL.
CREATE TABLE user_unit_roles (
    user_unit_role_id  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(user_id),
    unit_code            VARCHAR(40) NULL REFERENCES unit(code),
    role_code             VARCHAR(40) NOT NULL REFERENCES role(role_code),
    assigned_at            TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (user_id, unit_code, role_code)
);
-- App-layer enforced (mock backend has no partial-unique support): at most one
-- (unit_code, role_code) row where role_code IN ('head-of-school','head-of-department').

CREATE TABLE nav_page (
    page_code           VARCHAR(60) PRIMARY KEY,
    label                 VARCHAR(100) NOT NULL,
    entry_type             VARCHAR(10) NOT NULL, -- 'page' | 'folder'
    icon                    VARCHAR(60),
    parent_page_code          VARCHAR(60) REFERENCES nav_page(page_code),
    sort_order                  INTEGER NOT NULL DEFAULT 0,
    route_path                    VARCHAR(200),
    permission_mode                 VARCHAR(20) NOT NULL, -- 'role_only'|'unit_and_role'|'unit_only'
    is_active                         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE nav_page_roles (
    page_code    VARCHAR(60) NOT NULL REFERENCES nav_page(page_code),
    role_code     VARCHAR(40) NOT NULL REFERENCES role(role_code),
    PRIMARY KEY (page_code, role_code)
);
```

`cafeteria`, `cafeteria_assignment` (cafeteria-admin/staff scoping) are untouched — orthogonal to
this redesign.

## Backend Services

- `unit-code.js` — slug generator, reused for both `unit.code` and `role.role_code` and
  `nav_page.page_code`.
- `role-eligibility.service.js` (new) — `isSchoolUnit(code)`, `eligibleRolesForUnit(unitCode)`
  (protected-role rules + any active custom roles with matching `unit_eligibility`),
  `flatRolesAvailable()` (excludes `external-user`).
- `user-access.service.js` (new, replaces `user-projection.service.js`) — `rolesFor(userId)`,
  `hasRole(userId, roleCode, unitCode?)`, `unitsHeadedBy(userId)`, `roleLabelsFor(userId)` (builds
  display strings from `role.role_name` + unit description, no more `unitRoleLabel()` school/service
  branching — label is just `"{role_name} — {unit.description}"` for unit-scoped, `role_name` alone
  for flat).
- `nav-tree.service.js` (new) — `navTreeFor(userId)`: loads all active `nav_page` rows, evaluates
  each against the user's role/unit assignments (using `user-access.service`), returns the filtered,
  ordered tree the frontend renders directly.
- `workflow.service.js` — every `function_level === 'manager'` / `isManagerOfUnit` check becomes
  `hasRole(userId, 'head-of-department', unitCode) || hasRole(userId, 'head-of-school', unitCode)`.
  `isHosHodOfUnit` keeps its name (external callers reference it) but its body now calls the new
  helper. The F&B `fmb_review` gate becomes `hasRole(userId, 'head-of-department',
  'food_beverage_services')`. `FLAT_ROLE_FOR_REQUIREMENT.fmb` stays `'fmb'` as a request_task
  routing token (unchanged, per the original code comment — it's a task-routing label, not a user
  role) but the actor-authorization check for acting on it changes to the head-of-department lookup
  above.

## Frontend

- `auth.models.ts` — `AuthUser` gains `roles: readonly {roleCode: string; roleName: string; unitCode:
  string | null; unitDescription: string | null}[]` replacing single `role` / `functionLevel` /
  `unitId` / `unitKind`. `UserRole` enum is deleted; role checks throughout the app become
  `user.roles.some(r => r.roleCode === 'cfo')`-style lookups via new helpers in a
  `role-access.ts` module.
- `role-navigation.ts` — `ROLE_NAVIGATION` static map and `unitNavigationFor()` are deleted.
  `navigationFor(user)` now calls the backend's `/nav-tree` (or a synchronously-fetched-at-login
  copy) and renders whatever tree comes back. Club-derived sections
  (`clubNavigationSections`/`isClubPresident`) are untouched — data-driven already, no dependency on
  role/function_level.
- New admin pages under `/app/users`, `/app/units`, `/app/roles`, `/app/admin/page-visibility`:
  - **Users**: list + create/edit form (Full Name, Username, Email, Is Active only) + a separate
    "Assignments" panel per user to add/remove (unit, role) or (role) rows, respecting
    `eligibleRolesForUnit`.
  - **Units**: list + create form (code auto-slugged from description, read-only after save) + edit
    (description, is_active) + archive/restore/delete-after-empty flow.
  - **Roles**: list showing protected vs. custom roles distinctly + create form (role_name →
    auto-slug role_code, description, is_unit_scoped, unit_eligibility) + edit (name/description
    always; other fields only if not protected) + archive/restore/delete-after-empty flow.
  - **Page Visibility**: tree editor (drag reorder via sort_order, add page/folder, icon picker,
    permission_mode + role multi-select per row) + a "Preview as" panel (role dropdown, unit
    dropdown appearing only for unit-scoped roles) rendering a live sidebar mock.

## Migration of Seed Data

`server/db.js` is rewritten: `users` rows drop `role`/`function_level`; `unit` rows drop
`unit_kind`; new `role` table seeded with the 9 protected roles; existing `unit_users` rows become
`user_unit_roles` rows (mapping each user's old `role`/`function_level` combo onto the matching new
`role_code`, using `unit.head_user_id` to determine who gets `head-of-school`/`head-of-department`
vs `staff`/`lecturer`); `nav_page`/`nav_page_roles` seeded to reproduce today's exact sidebar
structure so navigation doesn't regress.

## Explicitly Out of Scope

- Club identity (`isClubAdmin`/`presidentOfClubIds`) — already data-driven, untouched.
- Cafeteria assignment/staffing system — untouched.
- Making `unit_only` permission mode actually used by any real page — no current page needs it.
- Building real functionality behind admin-created placeholder pages — nav entry only, per user's
  explicit answer.

## Known Uncertainty (flagged for user review)

- **`assigned_role: 'fmb'` token in `request_task`**: kept as-is per its original code comment
  ("routing token, not a user role"), but the actor-check that gates acting on it now points at
  `head-of-department` of `food_beverage_services`. Worth the user double-checking this still reads
  correctly end-to-end once cafeteria flows are exercised.
- **Custom role `unit_eligibility` vocabulary**: modeled as `'school' | 'non_school' | NULL`. It's
  possible the user wants finer-grained eligibility (e.g. a specific list of units) for future
  custom roles — deferred since only the 9 protected roles need it right now and none need more than
  this three-way split.
