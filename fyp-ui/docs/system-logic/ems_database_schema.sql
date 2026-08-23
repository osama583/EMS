-- ============================================================================
-- APU Event Management System (EMS) — Database Schema (v2)
-- ============================================================================
-- Dialect: PostgreSQL. Port to MySQL 8+ by swapping BIGSERIAL -> BIGINT
-- AUTO_INCREMENT and now() -> CURRENT_TIMESTAMP.
--
-- CHANGES IN THIS VERSION (vs. the previous file):
--   - Every table's primary key is now named <table>_id, not a bare `id`.
--   - Dropped the "add a username column" idea — user_id + email is the
--     login/identity story, per your instruction.
--   - Dropped request.applicant_staff_username entirely — it had no source
--     column anywhere once the username idea was dropped.
--   - Renamed request.applicant_department -> applicant_department_or_school
--     (students can apply now too, and students have a school, not a dept).
--   - Added is_active to `users` and `unit`.
--   - Renamed staff's PK: id -> staff_id.
--   - Removed cafeteria.location.
--   - Full rebuild of the manager-options tables using your real field list:
--     one dedicated table per dropdown "page" instead of a shared generic
--     shape, because the real fields differ too much between pages to
--     merge cleanly.
--   - fmb_options is now "My Menu" — scoped to a specific cafeteria via
--     cafeteria_id, with FKs into two new shared lookup tables
--     (dietary_information_options, serving_unit_options).
--     [SUPERSEDED 2026-08-18: cafeteria_id -> unit_code.]
--   - request_fmb_selection now properly FKs into fmb_options (the real
--     menu item) instead of a free-text guess.
--   - request_fmb.quantity renamed to pax (it's "how many people", not a
--     quantity of food units).
--   - Added cafeteria_admin / cafeteria_manager / cafeteria_staff roles,
--     and a cafeteria_assignment bridge table (a manager/staff can run
--     more than one cafeteria; Cafeteria Admin makes the assignment).
--     [SUPERSEDED 2026-08-18: the roles stayed (as 'cafeteria-admin',
--     'cafeteria-manager', 'cafeteria-staff' in `role`), but the
--     cafeteria_assignment table was dropped — assignments are ordinary
--     user_unit_roles rows now. See SECTION 2.]
--   - Added config row MAX_EVENT_CATEGORIES (admin-settable, same table
--     used for the pax threshold and cancellation deadline).
--   - Added request.max_pax (organizer-set registration capacity cap —
--     ASSUMPTION, flag if this isn't what you meant).
--   - event_registration expanded: registrant_name, registrant_email,
--     reason_for_attending (used only when registration_approval='manual').
--   - Fixed event_registration's unique constraint so cancelling and
--     re-registering is actually possible (partial unique index).
--
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
--
-- WORKFLOW RULES CONFIRMED THIS ROUND (backend logic, not schema changes):
--   - Applicant = HOS/HOD of their own unit -> skip HOS_HOD_REVIEW,
--     F&B reviews instead (unconditionally).
--   - Applicant = CFO or F&B -> skip ALL higher approval, straight to
--     department_review.
--   - Cafeteria "shared inbox" = a request_task with assignment_mode=
--     'shared_pool' and zero task_assignment rows is visible to every
--     cafeteria_staff assigned (via a user_unit_roles row) to that specific
--     cafeteria unit. The first one to claim it owns it — it then leaves
--     everyone else's inbox and enters that person's ongoing/history. For
--     F&B orders the claim is recorded per SELECTION
--     (request_fmb_selection.claimed_by_user_id), not per task.
--
-- CHANGES IN THIS SESSION (2026-08-18 — realigned against the running app;
-- every item below was verified column-by-column against server/db.js's
-- TABLE_NAMES, the seeded server/data/db.json, and the code that writes each
-- table, so this file now matches the application rather than the plan):
--   - DROPPED `cafeteria` and `cafeteria_assignment`. A Cafeteria is a `unit`
--     row (code prefixed 'cafeteria__') and its Manager/Staff are ordinary
--     user_unit_roles rows. This removes the app's second, parallel way of
--     modelling both an org unit and a staffing assignment. See SECTION 2.
--   - fmb_options.cafeteria_id -> unit_code (FK to unit(code)), following
--     the same change.
--   - request_fmb_selection.cafeteria_id -> unit_code, plus two new columns:
--     manager_comment (per-order pushback text from the Cafeteria Manager)
--     and claimed_by_user_id (which staff member claimed this order out of
--     the shared pool).
--   - request gained resume_stage and reviewer_comment — the two columns that
--     make "reviewer sends it back, applicant fixes it, it resumes at the
--     SAME stage" work. Without resume_stage a CFO-rejected proposal would
--     restart at HOS/HOD review.
--   - request_mineral_water gained option_label, the frozen catalog-label
--     snapshot every other request_* table already had.
--   - ADDED notification_preference (per-user event reminder settings). The
--     table was live in the application with no DDL here at all.
--   - nav_page_grant_roles / nav_page_grant_units: kept as the DDL of record,
--     with a note that the JSON mock denormalises them into array columns on
--     nav_page_grants. Shape difference only, not a model change.
--   - Verified as ALREADY CORRECT, left untouched: every status value domain
--     (chk_request_status, chk_task_status, chk_fmb_selection_status,
--     chk_registration_status, chk_registration_payment_status), the config
--     codes (HIGH_PAX_THRESHOLD / CANCELLATION_DEADLINE_DAYS /
--     MAX_EVENT_CATEGORIES), and the column list of all 55 other tables.
-- ============================================================================


-- ============================================================================
-- SECTION 1: IDENTITY & ORGANIZATION
-- ============================================================================

-- RBAC model (2026-08-13 redesign, Role<->Unit refactored 2026-08-17 — see the larger comment
-- above CREATE TABLE users below): identity is `users` (who) + `user_unit_roles` (which (unit,
-- role) pairs they hold). Whether a role is unit-linked or flat/global is now derived purely from
-- `role_unit` (zero rows = flat, e.g. "cfo"; one or more rows = unit-linked, e.g. "lecturer" on
-- whichever units its role_unit rows name, such as "school_of_computing"). There is no more
-- `function_level` column and no more `unit.unit_kind` column. "Is this unit a School" is a pure
-- runtime string check on `unit.code` (role-eligibility.service.js's isSchoolUnit()), not stored
-- data.
-- ============================================================================
-- RBAC REDESIGN (2026-08-13, see docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-
-- design.md): role and function_level are GONE from users. Identity is now purely: who the
-- user is (this table) + which (unit, role) pairs they hold (user_unit_roles below). unit_kind
-- is also gone from `unit` — "is this a School" is now a pure string check on `unit.code`
-- containing "school" (role-eligibility.service.js's isSchoolUnit()), never a stored column,
-- and never surfaced to the admin UI.
-- ============================================================================

-- archived_at (2026-08-14, Admin Settings deletion workflow): soft-delete marker shared by every
-- System-Admin-managed entity — see server/services/soft-delete.service.js's comment for the full
-- lifecycle (delete = stamp archived_at after a dependency check; restore = clear it; 7 days after
-- archived_at, an automatic sweep permanently removes the row unless something references it
-- again by then). NULL = active/never deleted.
CREATE TABLE users (
    user_id        BIGSERIAL PRIMARY KEY,
    full_name      VARCHAR(150) NOT NULL,
    username       VARCHAR(80)  NOT NULL UNIQUE,
    email          VARCHAR(150) NOT NULL UNIQUE,
    password       VARCHAR(255) NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at    TIMESTAMP NULL
);
-- Club President is NOT a role value — it's a data fact derived from the clubs table (see
-- SECTION 1's comment above CREATE TABLE clubs). Club Admin, unlike President, IS the
-- 'club-admin' flat role (2026-08-17 refactor) — both unaffected by the 2026-08-13 redesign
-- itself, but Club Admin's own mechanism changed afterward.

CREATE TABLE staff (
    staff_id               BIGSERIAL PRIMARY KEY,
    user_id                BIGINT NOT NULL UNIQUE REFERENCES users(user_id),
    department_or_school   VARCHAR(150)
);

CREATE TABLE student (
    student_id  BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE REFERENCES users(user_id),
    school      VARCHAR(150)
);

-- 1:1 extension of users for role='external-user' self-registered guest accounts (mirrors the
-- staff/student extension pattern above). Holds demographic data collected at registration that
-- no current feature reads yet, but is kept separate from `users` so future guest-demographics
-- reporting/dashboards can query it without adding write-only columns to the shared users table.
CREATE TABLE external_user_profile (
    external_user_profile_id  BIGSERIAL PRIMARY KEY,
    user_id                       BIGINT NOT NULL UNIQUE REFERENCES users(user_id),
    age                               INTEGER,
    gender                                VARCHAR(30),
    registered_at                            TIMESTAMP NOT NULL DEFAULT now()
);

-- unit.code is IMMUTABLE once created (app-layer enforced — the admin UI never offers to edit
-- it after save). description remains editable. No unit_kind column — see the block comment
-- above CREATE TABLE users.
CREATE TABLE unit (
    code          VARCHAR(40) PRIMARY KEY,
    description   VARCHAR(200) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at   TIMESTAMP NULL
);

-- role_code is IMMUTABLE once created, same as unit.code. The 9 seed roles (head-of-school,
-- head-of-department, lecturer, staff, student, cfo, cafeteria-admin, external-user,
-- system-admin) have is_protected=TRUE: role_name/description stay editable, but their Unit
-- associations (role_unit rows below) can never change via the API and the row can never be
-- deleted. Any role an admin creates afterward has is_protected=FALSE and is fully
-- editable/deletable (subject to the "zero users assigned" delete guard enforced at the app
-- layer, with soft-delete via archived_at + 7-day purge).
CREATE TABLE role (
    role_code        VARCHAR(40) PRIMARY KEY,
    role_name        VARCHAR(100) NOT NULL,
    description      VARCHAR(200),
    is_protected     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at      TIMESTAMP NULL
);

-- 2026-08-17 refactor: direct many-to-many between Role and Unit, replacing the old
-- is_unit_scoped/unit_eligibility category flag on `role`. A role with zero role_unit rows is a
-- "Flat Role" (assignable to a user with no unit); a role with one or more rows is
-- "Unit-related" and assignable to a user only paired with one of its linked units. Same
-- composite-PK junction-table shape as nav_page_grant_roles/nav_page_grant_units — no surrogate
-- id, deletion of the `role` or `unit` row itself stays app-layer blocked (see
-- user_unit_roles-based dependency checks), never DB-cascaded.
CREATE TABLE role_unit (
    role_code  VARCHAR(40) NOT NULL REFERENCES role(role_code),
    unit_code  VARCHAR(40) NOT NULL REFERENCES unit(code),
    PRIMARY KEY (role_code, unit_code)
);

-- The single assignment table for BOTH unit-linked and flat/global roles. A flat-role row (role
-- has zero role_unit rows, e.g. cfo/system-admin) has unit_code = NULL. A unit-linked row (e.g.
-- lecturer @ school_of_computing) has unit_code set to one of that role's linked units. One user
-- can hold many rows: multiple roles in one unit, the same role in multiple units, or a mix of
-- unit-linked and flat roles.
-- App-layer enforced (this mock backend has no partial-unique support): at most one row per
-- unit_code where role_code IN ('head-of-school','head-of-department') — a unit may have at
-- most one head at a time.
CREATE TABLE user_unit_roles (
    user_unit_role_id  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(user_id),
    unit_code            VARCHAR(40) NULL REFERENCES unit(code),
    role_code             VARCHAR(40) NOT NULL REFERENCES role(role_code),
    assigned_at             TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (user_id, unit_code, role_code)
);

-- Admin-managed sidebar/page catalog — replaces the old hardcoded role-navigation.ts nav maps.
-- page_code is IMMUTABLE once created; label/icon/sort_order/parent/grants are all editable.
-- entry_type='folder' rows have route_path=NULL, nest exactly one level deep (a folder's
-- parent_page_code is always NULL — the UI does not offer folder-in-folder nesting), and may
-- themselves carry nav_page_grants rows that gate all their children as a group (a user who fails
-- the folder's own check sees none of its children). entry_type='page' rows always have
-- route_path = '/app/' || page_code (auto-derived server-side, never client-supplied — see
-- admin.routes.js's deriveNavRoutePath()); pages admin-created with no real Angular
-- route/component behind that path yet render the shared placeholder until a developer wires the
-- real one up. icon holds raw inline SVG markup (an uploaded .svg file's contents, validated
-- server-side) rendered at a fixed size with fill: currentColor so it inherits the sidebar/table's
-- text color — NOT a Material Symbols ligature name (that convention was used before the RBAC
-- redesign's icon-upload pass; every remaining Material-icon reference elsewhere in the app is
-- unrelated to nav_page).
-- archived_at: soft-delete marker (see users' comment above) — a folder blocks deletion while it
-- still has non-archived children; purging a page cascades to its own nav_page_grants rows.
CREATE TABLE nav_page (
    page_code         VARCHAR(60) PRIMARY KEY,
    label             VARCHAR(100) NOT NULL,
    entry_type        VARCHAR(10) NOT NULL,
    icon              TEXT,
    parent_page_code  VARCHAR(60) REFERENCES nav_page(page_code),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    route_path        VARCHAR(200),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at       TIMESTAMP NULL,
    CONSTRAINT chk_nav_page_entry_type CHECK (entry_type IN ('page', 'folder'))
);

-- One row = one independent permission grant for a page — a user sees the page if they match ANY
-- row belonging to it (rows are OR'd together across grants; a page is capped at one row per
-- grant_type, so at most 3 rows total — enforced in admin.routes.js, not the schema itself).
-- Removed 2026-08-14 (multi-select redesign): the original one-role-code/one-unit-code-per-row
-- shape meant selecting N roles for the same page took N rows (e.g. "How It Works" needed two
-- identical role-only rows, one each for Lecturer and Student) — every seeded page had ended up
-- Role-only purely because that was the only type cheap enough to add repeatedly. Each row now
-- holds a SET of roles and/or units via the junction tables below, so "Lecturer + Student, any
-- unit" is one row, not two. grant_type decides which junction table is meaningful:
--   role:      nav_page_grant_roles rows only — holds ANY of those roles, in any unit (each role
--              must be flat/non-unit-scoped; a unit-scoped role has no meaning without a unit).
--   unit_role: BOTH junction tables populated — cross-product WITHIN the row: holds any of its
--              roles AND is in any of its units (e.g. roles {staff, lecturer} + units {finance,
--              school_of_computing} grants all 4 combinations at once, not just 2 specific pairs).
--   unit:      nav_page_grant_units rows only — holds ANY role, in any of those units.
-- is_active (added 2026-08-13, Permissions-tab active/inactive toggle): lets an admin temporarily
-- disable a grant row without deleting it — nav-tree.service.js's userSatisfiesPage() only
-- considers rows where is_active = true, mirroring nav_page.is_active's same fail-closed pattern.
-- archived_at (added 2026-08-14): a grant row is individually soft-deletable too (undoing "remove
-- permission" within the 7-day window), independent of is_active's on/off toggle. userSatisfiesPage()
-- excludes rows where either is_active = false OR archived_at is set.
CREATE TABLE nav_page_grants (
    grant_id    INTEGER PRIMARY KEY,
    page_code   VARCHAR(60) NOT NULL REFERENCES nav_page(page_code),
    grant_type  VARCHAR(20) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMP NULL,
    CONSTRAINT chk_nav_page_grants_type CHECK (grant_type IN ('role', 'unit_role', 'unit')),
    UNIQUE (page_code, grant_type)
);

-- The role side of a grant row's set — one row per (grant, role) pair. Populated when
-- grant_type IN ('role', 'unit_role'); empty for 'unit' grants.
CREATE TABLE nav_page_grant_roles (
    grant_id   INTEGER NOT NULL REFERENCES nav_page_grants(grant_id) ON DELETE CASCADE,
    role_code  VARCHAR(40) NOT NULL REFERENCES role(role_code),
    PRIMARY KEY (grant_id, role_code)
);

-- The unit side of a grant row's set — one row per (grant, unit) pair. Populated when
-- grant_type IN ('unit_role', 'unit'); empty for 'role' grants.
CREATE TABLE nav_page_grant_units (
    grant_id   INTEGER NOT NULL REFERENCES nav_page_grants(grant_id) ON DELETE CASCADE,
    unit_code  VARCHAR(40) NOT NULL REFERENCES unit(code),
    PRIMARY KEY (grant_id, unit_code)
);
-- REPRESENTATION NOTE (2026-08-18): the JSON mock backend does not create these two junction
-- tables. It stores the same two sets inline on the grant row as arrays:
--     nav_page_grants.role_codes[]  <-> nav_page_grant_roles
--     nav_page_grants.unit_codes[]  <-> nav_page_grant_units
-- That is a storage-engine shortcut in a document store, not a model change — the data, the
-- grant_type semantics and nav-tree.service.js's userSatisfiesPage() logic are identical either
-- way. The junction tables above stay the DDL of record because a relational port needs them for
-- the FKs into role(role_code) and unit(code); a real deployment should create them and expand
-- the arrays. Same reasoning, opposite direction, to SECTION 2's cafeteria note: that one WAS a
-- model change and the tables are gone for good, this one is only a shape difference.

-- Club President is data-driven, not role-driven: nobody holds a 'club-president' row in the
-- `role` table. A student or lecturer becomes a club's president simply by having their user_id
-- placed in clubs.user_id (same "who's the head" pattern as user_unit_roles'
-- head-of-school/head-of-department rows for a unit) — their own user_unit_roles rows
-- (student/lecturer/etc.) never change, and app-layer checks ("is this viewer the president of
-- club X?") query this table by user_id, not by role. A club has exactly one President and it
-- isn't assignable from the Roles system — this stays a plain FK, not a role.
--
-- Club Admin (system-wide: create/delete/deactivate any club, manage club categories) IS a role —
-- the 'club-admin' flat/global protected role in `role` (2026-08-17 refactor, replacing the
-- earlier bespoke club_admins flag table). Granted/revoked via a normal user_unit_roles row
-- through the Users -> Assignments flow, same mechanism as every other role.
--
-- created_by_user_id names the Club Admin who created/manages the club — separate from the
-- president, who need not be the creator.
-- Club categories are admin-managed lookup values (same pattern as event_category /
-- request-options catalogs): a Club Admin creates the list, and a club's President may only
-- pick from it (not invent new categories) when editing their own club.
-- archived_at: soft-delete marker (see users' comment above) — blocked while any club still
-- references this category (via club_category_links below).
CREATE TABLE club_categories (
    club_category_id  BIGSERIAL PRIMARY KEY,
    name               VARCHAR(100) NOT NULL UNIQUE,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMP NOT NULL DEFAULT now(),
    archived_at        TIMESTAMP NULL
);

CREATE TABLE clubs (
    club_id          BIGSERIAL PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(user_id),   -- the President (student or lecturer)
    club_name        VARCHAR(150) NOT NULL,
    description      TEXT,
    image_url        VARCHAR(255),
    created_by_user_id  BIGINT NOT NULL REFERENCES users(user_id),  -- the Club Admin who created this club
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMP NOT NULL DEFAULT now()
);

-- A club may carry 1 to 3 categories (app-layer enforces the 1-3 count; the join table itself
-- just models the many-to-many). Replaces the earlier single clubs.club_category_id FK.
CREATE TABLE club_category_links (
    club_id           BIGINT NOT NULL REFERENCES clubs(club_id),
    club_category_id  BIGINT NOT NULL REFERENCES club_categories(club_category_id),
    PRIMARY KEY (club_id, club_category_id)
);

-- Generalized membership — keyed on user_id (not student_id) so both students AND lecturers can
-- be members of a club, per the join-request flow below. Replaces the earlier student-only
-- student_clubs design.
CREATE TABLE club_members (
    club_id      BIGINT NOT NULL REFERENCES clubs(club_id),
    user_id      BIGINT NOT NULL REFERENCES users(user_id),
    date_joined  DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (club_id, user_id)
);

-- A student or lecturer's request to join a club, reviewed by that club's President from their
-- inbox. Approval inserts a club_members row; rejection just records a comment — no
-- resubmission workflow (matches the simplicity of this table, unlike the heavier
-- request_task/workflow_history pattern used for event proposals).
-- reason: required at submission time — why the requester wants to join, so the President has
-- something to base approve/reject on instead of a bare request. comment: required on rejection
-- (app layer enforces >= 20 characters) — the President's reason for turning the request down.
CREATE TABLE club_join_requests (
    club_join_request_id  BIGSERIAL PRIMARY KEY,
    club_id                   BIGINT NOT NULL REFERENCES clubs(club_id),
    requester_user_id            BIGINT NOT NULL REFERENCES users(user_id),
    reason                            TEXT NOT NULL,
    status                           VARCHAR(20) NOT NULL DEFAULT 'pending',
    comment                              TEXT,  -- populated on rejection, >= 20 characters
    created_at                              TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at                                 TIMESTAMP,
    resolved_by_user_id                             BIGINT REFERENCES users(user_id),
    CONSTRAINT chk_club_join_request_status CHECK (status IN ('pending', 'approved', 'rejected'))
);
-- Partial unique index (same pattern as uq_event_registration_active above): blocks a second
-- pending request to the same club, while still allowing a rejected request to be resubmitted
-- as a new pending row.
CREATE UNIQUE INDEX uq_club_join_request_pending
    ON club_join_requests (club_id, requester_user_id)
    WHERE status = 'pending';

-- (2026-08-23: the cafeteria_staff_requests approval table that used to live here is gone —
-- see SECTION 2's cafeteria domain note below. A Cafeteria Manager now writes user_unit_roles
-- for their own outlet directly, same as Cafeteria Admin, via migration 015_drop_staff_requests.)


-- ============================================================================
-- SECTION 2: CAFETERIA DOMAIN
-- ============================================================================

-- NO `cafeteria` TABLE, AND NO `cafeteria_assignment` TABLE (2026-08-18 alignment pass — both
-- were dropped, not renamed). A Cafeteria IS a `unit` row and cafeteria staffing IS a
-- `user_unit_roles` row. The earlier design gave the cafeteria domain its own parallel
-- entity + its own parallel assignment table, which meant two ways to model "an organizational
-- unit" and two ways to model "this user works there" — with the cafeteria copy excluded from
-- everything the unit/role system already provides (role_unit eligibility, nav_page_grants
-- visibility, the soft-delete window, the Users -> Assignments admin flow).
--
-- Cafeterias are told apart from Schools and Service departments by a code prefix, enforced
-- server-side at creation and never by name matching (services/unit-code.js):
--
--     CAFETERIA_UNIT_PREFIX = 'cafeteria__'
--     unit.code = 'cafeteria__' || deriveUnitCode(name)   e.g. cafeteria__atrium_cafeteria
--
--   * A cafeteria           -> unit WHERE code LIKE 'cafeteria\_\_%'  (isCafeteriaUnitCode())
--   * Its Manager / Staff   -> user_unit_roles (user_id, unit_code, role_code) where role_code
--                              IN ('cafeteria-manager','cafeteria-staff'). Multi-cafeteria
--                              staffing is just multiple rows, exactly as before.
--   * Cafeteria Admin       -> a FLAT role ('cafeteria-admin', unit_code NULL) — oversight
--                              across every cafeteria, so it is not scoped to one unit.
--
-- Deactivating a cafeteria is unit.is_active; deleting one is unit.archived_at (the shared 7-day
-- soft-delete window). Both come for free from `unit` and needed bespoke reimplementation under
-- the old `cafeteria` table.
--
-- A Cafeteria Manager changing their own cafeteria's staff IS a plain user_unit_roles write
-- (2026-08-23): they create/edit/suspend/restore/remove staff directly, scoped to their own
-- unit_code and to role_code = 'cafeteria-staff', through the same assignment endpoints
-- Cafeteria Admin uses. There is no approval step and no request/history table for this anymore.


-- ============================================================================
-- SECTION 3: CATEGORIES & REQUIREMENTS
-- ============================================================================

-- event_category / event_format (id-backed admin-managed catalogs, redesigned 2026-08-16 — see
-- routes/event-catalog.routes.js): `code` is server-derived from `name` via deriveUnitCode(), same
-- slug convention as unit.code/role.role_code/nav_page.page_code (lowercase_with_underscores,
-- immutable once created). `archived_at` is the shared 7-day soft-delete marker (see users'
-- comment near the top of this file). Neither table is ever a delete-blocking dependency for
-- `request`/`request_categories` — both freeze the category/format NAME into a snapshot column at
-- proposal-save time (request_categories.category_name, request.event_format_snapshot below), so
-- renaming, archiving, or purging a row here can never change what an already-submitted proposal
-- displays. This is the same "snapshot, not live FK, so never a blocking dependency" reasoning
-- documented for request_* option tables in SECTION 4 below.

CREATE TABLE event_category (
    event_category_id  BIGSERIAL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL UNIQUE,
    code                VARCHAR(100) NOT NULL UNIQUE,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at         TIMESTAMP NULL
);

CREATE TABLE event_format (
    event_format_id  BIGSERIAL PRIMARY KEY,
    name              VARCHAR(100) NOT NULL UNIQUE,
    code              VARCHAR(100) NOT NULL UNIQUE,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at       TIMESTAMP NULL
);

CREATE TABLE event_requirements (
    requirement_id    BIGSERIAL PRIMARY KEY,
    requirement_name  VARCHAR(100) NOT NULL UNIQUE
);


-- ============================================================================
-- SECTION 4: MANAGER-CONFIGURED OPTIONS (one table per dropdown "page")
-- ============================================================================
-- Common fields on every option table: label, description, active, plus
-- requirement_id linking it to the relevant event_requirements row.
-- archived_at (added 2026-08-14, on every table in this section): soft-delete marker — see users'
-- comment near the top of this file for the full 7-day retention/restore lifecycle. Real
-- dependency checks before delete are limited to what's actually enforced at the app layer:
-- funding_sub_options -> funding_main_options, and fmb_options -> serving_unit_options /
-- dietary_information_options. request_* snapshot rows store option LABELS at submission time
-- (see workflow.service.js), not the option's numeric id, so they are never a real blocking
-- dependency for these tables despite superficially having an option_id-shaped column.

CREATE TABLE logistics_options (
    logistics_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id        BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                  VARCHAR(150) NOT NULL,
    description             TEXT,
    active                   BOOLEAN NOT NULL DEFAULT TRUE,
    available_quantity        INTEGER NOT NULL CHECK (available_quantity >= 0),
    quantity_unit               VARCHAR(50) NOT NULL,
    item_image_url                 VARCHAR(255),
    archived_at                       TIMESTAMP NULL
);

CREATE TABLE transportation_options (
    transportation_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id             BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                       VARCHAR(150) NOT NULL,
    description                  TEXT,
    active                        BOOLEAN NOT NULL DEFAULT TRUE,
    passenger_capacity             INTEGER NOT NULL CHECK (passenger_capacity >= 1),
    available_vehicle_count          INTEGER NOT NULL CHECK (available_vehicle_count >= 0),
    instructions                       TEXT,
    vehicle_image_url                     VARCHAR(255),
    archived_at                              TIMESTAMP NULL
);

CREATE TABLE media_options (  -- Photography / Videography
    media_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id     BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                VARCHAR(150) NOT NULL,
    description            TEXT,
    active                   BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at                TIMESTAMP NULL
    -- max_personnel was dropped — the Photographer/Videographer Manager decides how many
    -- personnel to assign when reviewing, not the applicant, and it isn't an option attribute.
);

CREATE TABLE sound_light_options (
    sound_light_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id           BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                     VARCHAR(150) NOT NULL,
    description                 TEXT,
    active                       BOOLEAN NOT NULL DEFAULT TRUE,
    technical_description           TEXT NOT NULL,
    archived_at                        TIMESTAMP NULL
    -- available_quantity was dropped — the Sound & Light Manager decides how much equipment
    -- to allocate when reviewing the proposal, not the applicant; no availability is shown here.
);

-- Shared lookup lists used by fmb_options below (editable by Cafeteria
-- Manager and F&B/FMB Manager both — that's a permissions detail, not a
-- schema one; there's just one shared table either way).
CREATE TABLE dietary_information_options (
    dietary_information_option_id  BIGSERIAL PRIMARY KEY,
    label                            VARCHAR(150) NOT NULL,
    description                        TEXT,
    active                               BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at                            TIMESTAMP NULL
);

CREATE TABLE serving_unit_options (
    serving_unit_option_id  BIGSERIAL PRIMARY KEY,
    label                     VARCHAR(150) NOT NULL,
    description                 TEXT,
    active                       BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at                     TIMESTAMP NULL
);

-- "My Menu" — scoped to ONE cafeteria. This is what F&B picks from when
-- fulfilling a food request (see request_fmb_selection further down).
-- unit_code (was cafeteria_id, 2026-08-18): a cafeteria is a `unit` row now, so the menu hangs off
-- the unit code rather than a dropped cafeteria table. The owning Cafeteria Manager is whoever
-- holds a 'cafeteria-manager' user_unit_roles row for this same unit_code — see SECTION 2.
CREATE TABLE fmb_options (
    fmb_option_id                  BIGSERIAL PRIMARY KEY,
    requirement_id                   BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    unit_code                          VARCHAR(40) NOT NULL REFERENCES unit(code),
    label                                VARCHAR(150) NOT NULL,
    description                            TEXT,
    active                                   BOOLEAN NOT NULL DEFAULT TRUE,
    serving_unit_option_id                     BIGINT NOT NULL REFERENCES serving_unit_options(serving_unit_option_id),
    dietary_information_option_id                 BIGINT NOT NULL REFERENCES dietary_information_options(dietary_information_option_id),
    availability_ordering_notes                      TEXT,
    menu_image_url                                      VARCHAR(255),
    archived_at                                            TIMESTAMP NULL
);

-- Campus Tour — Starting Point.
CREATE TABLE campus_tour_start_options (
    campus_tour_start_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id                 BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                            VARCHAR(150) NOT NULL,
    description                        TEXT,
    active                               BOOLEAN NOT NULL DEFAULT TRUE,
    meeting_instructions                  TEXT,
    max_group_size                          INTEGER CHECK (max_group_size >= 1),
    archived_at                                TIMESTAMP NULL
);

-- Campus Tour — Type of Tour (manager-configured, mirrors Starting Point).
CREATE TABLE campus_tour_type_options (
    campus_tour_type_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id                BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                           VARCHAR(150) NOT NULL,
    description                       TEXT,
    active                              BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at                           TIMESTAMP NULL
);

-- Mineral Water — merged into a single table. water_logo_options used to be separate (it had
-- one extra field); it's gone now — Logo vs Normal is an applicant-facing "With Logo?" toggle
-- on ONE Mineral Water request (see request_mineral_water.with_logo below), not a separate
-- option kind, so there is exactly one source of truth for mineral water catalog entries.
CREATE TABLE water_normal_options (
    water_normal_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id             BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                       VARCHAR(150) NOT NULL,
    description                   TEXT,
    active                         BOOLEAN NOT NULL DEFAULT TRUE,
    number_of_bottles               INTEGER NOT NULL CHECK (number_of_bottles >= 0),
    available_stock                   INTEGER NOT NULL CHECK (available_stock >= 0),
    ordering_delivery_instructions      TEXT,
    logo_branding_requirement             TEXT,
    archived_at                              TIMESTAMP NULL
);

CREATE TABLE funding_main_options (
    funding_main_option_id  BIGSERIAL PRIMARY KEY,
    requirement_id             BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    label                       VARCHAR(150) NOT NULL,
    description                   TEXT,
    active                          BOOLEAN NOT NULL DEFAULT TRUE,
    budget_category_finance_code      VARCHAR(50),
    purchasing_guidance                 TEXT,
    archived_at                            TIMESTAMP NULL
);

CREATE TABLE funding_sub_options (
    funding_sub_option_id   BIGSERIAL PRIMARY KEY,
    main_option_id             BIGINT NOT NULL REFERENCES funding_main_options(funding_main_option_id),
    label                        VARCHAR(150) NOT NULL,
    description                    TEXT,
    active                           BOOLEAN NOT NULL DEFAULT TRUE,
    finance_procurement_code           VARCHAR(50),
    default_unit_purchasing_note         TEXT,
    archived_at                             TIMESTAMP NULL
);


-- ============================================================================
-- SECTION 5: CONFIG
-- ============================================================================

CREATE TABLE config (
    code    VARCHAR(50) PRIMARY KEY,
    number  NUMERIC NOT NULL
);
-- INSERT INTO config VALUES ('HIGH_PAX_THRESHOLD', 50);
-- INSERT INTO config VALUES ('CANCELLATION_DEADLINE_DAYS', 3);
-- INSERT INTO config VALUES ('MAX_EVENT_CATEGORIES', 2);


-- ============================================================================
-- SECTION 6: REQUEST (core proposal)
-- ============================================================================

CREATE TABLE request (
    request_id                       BIGSERIAL PRIMARY KEY,
    request_code                      VARCHAR(30) NOT NULL UNIQUE,
    applicant_user_id                    BIGINT NOT NULL REFERENCES users(user_id),
    applicant_name                          VARCHAR(150) NOT NULL,   -- snapshot
    applicant_email                            VARCHAR(150) NOT NULL,   -- snapshot
    applicant_department_or_school                VARCHAR(150),            -- snapshot; works for staff dept OR student school
    event_title                                      VARCHAR(200) NOT NULL,
    short_introduction                                  TEXT NOT NULL,
    goals_objectives                                       TEXT NOT NULL,
    expected_benefits                                          TEXT NOT NULL,
    event_visibility                                              VARCHAR(20) NOT NULL,
    event_format_id                                                  BIGINT REFERENCES event_format(event_format_id),  -- nullable; snapshot below is authoritative for display
    event_format_snapshot                                               VARCHAR(30),  -- frozen label at submission time, see event_category's comment in SECTION 3
    registration_approval                                               VARCHAR(20),
    promotion_publicity_method                                             TEXT,
    event_image                                                               VARCHAR(255),
    total_pax                                                                   INTEGER NOT NULL DEFAULT 0,
    max_pax                                                                        INTEGER,  -- organizer-set registration cap; confirm this is what you meant
    cost_amount                                                                       NUMERIC(10,2),  -- null/0 = free event; only meaningful when event_visibility IN ('Public','Club Only')
    bank_account_name                                                                    VARCHAR(150),  -- populated only when cost_amount > 0 and visibility is Public/Club Only; irrelevant for free events
    bank_account_number                                                                      VARCHAR(50),
    status                                                                            VARCHAR(30) NOT NULL DEFAULT 'draft',
    resume_stage                                                                          VARCHAR(30),
    reviewer_comment                                                                          TEXT,
    submitted_at        TIMESTAMP,
    cancelled_at         TIMESTAMP,
    cancelled_by_user_id  BIGINT REFERENCES users(user_id),
    created_at              TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_request_status CHECK (status IN (
        'draft','submitted','hos_hod_review','fmb_review','cfo_review',
        'department_review','resubmission_required',
        'completed_approved','completed_rejected','cancelled'
    ))
);
-- resume_stage (2026-08-18): while status = 'resubmission_required', the stage the proposal
-- returns to once the applicant resubmits — 'hos_hod_review', 'fmb_review' or 'cfo_review'.
-- Without it a proposal sent back by the CFO would restart at HOS/HOD review and be re-approved
-- by every earlier reviewer. Set when a reviewer sends the proposal back, cleared on resubmit
-- (services/workflow.service.js's resubmitReviewerStage() / applicantResubmit()). Same value
-- domain as `status`, deliberately not a second CHECK — it only ever holds one of the three
-- single-actor stages.
-- reviewer_comment (2026-08-18): the reason the reviewer sent it back, shown to the applicant on
-- the proposal form. Cleared on resubmit. Only ever set by the single-actor stages; a DEPARTMENT
-- pushback writes request_task.comment instead, because departments are reviewed in parallel and
-- one shared column on `request` could not hold several departments' comments at once.
--
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

CREATE TABLE request_categories (
    request_id     BIGINT NOT NULL REFERENCES request(request_id),
    category_id    BIGINT NOT NULL REFERENCES event_category(event_category_id),
    category_name  VARCHAR(100) NOT NULL,  -- frozen label at submission time; NOT re-resolved from event_category on read (renaming/archiving a category later must not change already-submitted proposals — see event_category's comment in SECTION 3)
    PRIMARY KEY (request_id, category_id)
);
-- Max count enforced at the app layer, reading config.MAX_EVENT_CATEGORIES.

CREATE TABLE application_requirements (
    request_id      BIGINT NOT NULL REFERENCES request(request_id),
    requirement_id  BIGINT NOT NULL REFERENCES event_requirements(requirement_id),
    PRIMARY KEY (request_id, requirement_id)
);


-- ============================================================================
-- SECTION 7: REQUEST-SPECIFIC DEPARTMENT DATA (snapshots)
-- ============================================================================

CREATE TABLE request_logistics (
    request_logistics_id  BIGSERIAL PRIMARY KEY,
    request_id               BIGINT NOT NULL REFERENCES request(request_id),
    option_id                    BIGINT REFERENCES logistics_options(logistics_option_id),
    item                             VARCHAR(150) NOT NULL,
    quantity                             INTEGER NOT NULL,
    date                                     DATE NOT NULL,
    start_time                                  TIME NOT NULL,
    end_time                                        TIME NOT NULL,
    location                                            VARCHAR(200) NOT NULL,
    notes                                                  TEXT
);

-- Moving Time is the single time the vehicle needs to be at the pickup point (renamed from
-- start_time for clarity to applicants) — end_time and location were dropped from this form per
-- the applicant-facing simplification; the Transportation Manager scopes actual duration/route
-- when reviewing.
CREATE TABLE request_transportation (
    request_transportation_id  BIGSERIAL PRIMARY KEY,
    request_id                     BIGINT NOT NULL REFERENCES request(request_id),
    option_id                          BIGINT REFERENCES transportation_options(transportation_option_id),
    type                                    VARCHAR(150) NOT NULL,
    requested_pax                              INTEGER NOT NULL,
    pickup                                          VARCHAR(200) NOT NULL,
    dropoff                                             VARCHAR(200) NOT NULL,
    date                                                    DATE NOT NULL,
    moving_time                                                 TIME NOT NULL,
    notes                                                           TEXT
);

-- personnel_quantity and coverage were dropped from this form — the Photographer/Videographer
-- Manager decides how many personnel to assign when reviewing, not the applicant.
CREATE TABLE request_photography_videography (
    request_photography_videography_id  BIGSERIAL PRIMARY KEY,
    request_id                               BIGINT NOT NULL REFERENCES request(request_id),
    option_id                                    BIGINT REFERENCES media_options(media_option_id),
    service                                          VARCHAR(150) NOT NULL,
    date                                                      DATE NOT NULL,
    start_time                                                    TIME NOT NULL,
    end_time                                                          TIME NOT NULL,
    location                                                              VARCHAR(200) NOT NULL,
    notes                                                                        TEXT
);

CREATE TABLE request_sound_light (
    request_sound_light_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    option_id                       BIGINT REFERENCES sound_light_options(sound_light_option_id),
    item                                 VARCHAR(150) NOT NULL,
    date                                     DATE NOT NULL,
    start_time                                  TIME NOT NULL,
    end_time                                        TIME NOT NULL,
    location                                            VARCHAR(200) NOT NULL,
    notes                                                  TEXT
);

-- The applicant's original food ask. end_time was dropped from this form — serve_time (renamed
-- from start_time) is the single time food should be ready/served.
CREATE TABLE request_fmb (
    request_fmb_id  BIGSERIAL PRIMARY KEY,
    request_id          BIGINT NOT NULL REFERENCES request(request_id),
    option_id                BIGINT REFERENCES fmb_options(fmb_option_id),
    food_type                    VARCHAR(150) NOT NULL,
    pax                              INTEGER NOT NULL,   -- renamed from quantity: "how many people", not units of food
    date                                 DATE NOT NULL,
    serve_time                               TIME NOT NULL,
    location                                     VARCHAR(200) NOT NULL,
    notes                                            TEXT
);

-- F&B's actual fulfilment action: picks a cafeteria + a real menu item.
CREATE TABLE request_fmb_selection (
    request_fmb_selection_id  BIGSERIAL PRIMARY KEY,
    request_fmb_id                BIGINT NOT NULL REFERENCES request_fmb(request_fmb_id),
    unit_code                         VARCHAR(40) NOT NULL REFERENCES unit(code),
    fmb_option_id                         BIGINT NOT NULL REFERENCES fmb_options(fmb_option_id),
    menu_item_label                           VARCHAR(150) NOT NULL,  -- snapshot of fmb_options.label at pick time
    quantity                                       INTEGER NOT NULL,
    status                                             VARCHAR(20) NOT NULL DEFAULT 'pending',
    notes                                                TEXT,
    manager_comment                                        TEXT,
    claimed_by_user_id                                         BIGINT REFERENCES users(user_id),
    CONSTRAINT chk_fmb_selection_status CHECK (
        status IN ('pending','approved','resubmitted','preparing','fulfilled','cancelled')
    )
);
-- unit_code (was cafeteria_id, 2026-08-18): the cafeteria this order was placed with, now a
-- `unit` row — see SECTION 2.
-- manager_comment (2026-08-18): the owning Cafeteria Manager's pushback text when THIS specific
-- order is sent back to F&B (status -> 'resubmitted'). Cleared when F&B edits and re-sends it.
-- Per-selection, not per-request: sibling orders on the same proposal are reviewed independently,
-- so request.reviewer_comment cannot carry it.
-- claimed_by_user_id (2026-08-18): which Cafeteria Staff member claimed this order out of the
-- shared pool (status -> 'preparing'/'fulfilled'). Needed because one proposal can have several
-- orders in flight at once, each claimed by a different person — workflow_history rows are scoped
-- to request_id and cannot tell concurrently-claimed sibling selections apart. This is the
-- selection-level shared-pool mechanism referred to by request_task.assignment_mode='shared_pool'
-- (that column is informational for the fmb task; the real claiming happens here).

CREATE TABLE request_campus_tour (
    request_campus_tour_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    date                             DATE NOT NULL,
    pax                                  INTEGER NOT NULL,
    start_point_option_id                    BIGINT REFERENCES campus_tour_start_options(campus_tour_start_option_id),
    start_point                                  VARCHAR(150) NOT NULL,
    tour_type_option_id                              BIGINT REFERENCES campus_tour_type_options(campus_tour_type_option_id),
    tour_type                                            VARCHAR(150) NOT NULL,
    notes                                                    TEXT
    -- start_time/end_time/location were dropped from this form — Student Services scopes
    -- the actual tour timing/route when reviewing; tour_type was added per applicant-facing
    -- request (manager-configured, mirrors start_point).
);

-- Merged applicant-facing request (was 2 tables: request_mineral_water_logo /
-- request_mineral_water_normal). The applicant makes ONE mineral-water request against
-- water_normal_options and toggles with_logo — water_logo_options no longer exists at all
-- (it was folded into water_normal_options.logo_branding_requirement, see above), so there is
-- exactly one manager-configured catalog AND one applicant request table for mineral water.
CREATE TABLE request_mineral_water (
    request_mineral_water_id  BIGSERIAL PRIMARY KEY,
    request_id                    BIGINT NOT NULL REFERENCES request(request_id),
    option_id                         BIGINT REFERENCES water_normal_options(water_normal_option_id),
    option_label                          VARCHAR(150) NOT NULL,
    quantity                                  INTEGER NOT NULL,
    with_logo                                     BOOLEAN NOT NULL DEFAULT FALSE,
    date                                          DATE NOT NULL,
    start_time                                        TIME NOT NULL,
    end_time                                              TIME NOT NULL,
    location                                                  VARCHAR(200) NOT NULL,
    notes                                                         TEXT
);
-- option_label (2026-08-18): the label snapshot every other request_* table already carried
-- (request_logistics.item, request_fmb.food_type, request_funding_purchase.main_item, …) — it was
-- missing here, so this one table had a live FK and no frozen copy, and archiving a water pack
-- would have blanked what an already-submitted proposal displayed. `quantity` is the resolved
-- bottle count copied from water_normal_options.number_of_bottles at pick time, so it survives the
-- catalog row being edited afterwards too (the picker's value IS the pack, e.g. "48 bottles").

CREATE TABLE request_funding_purchase (
    request_funding_purchase_id  BIGSERIAL PRIMARY KEY,
    request_id                       BIGINT NOT NULL REFERENCES request(request_id),
    main_option_id                       BIGINT REFERENCES funding_main_options(funding_main_option_id),
    main_item                                VARCHAR(150) NOT NULL,
    sub_option_id                                BIGINT REFERENCES funding_sub_options(funding_sub_option_id),
    sub_item                                         VARCHAR(150) NOT NULL,
    quantity                                             INTEGER NOT NULL,
    unit_price_rm                                            NUMERIC(10,2) NOT NULL,
    notes                                                         TEXT
);


-- ============================================================================
-- SECTION 8: REQUEST SUPPORT TABLES
-- ============================================================================

CREATE TABLE co_owners (
    co_owner_id       BIGSERIAL PRIMARY KEY,
    request_id            BIGINT NOT NULL REFERENCES request(request_id),
    staff_id                  BIGINT REFERENCES staff(staff_id),
    staff_first_name              VARCHAR(100) NOT NULL,
    staff_last_name                   VARCHAR(100) NOT NULL,
    staff_email                           VARCHAR(150) NOT NULL,
    staff_role                                VARCHAR(100)
);

CREATE TABLE organizers (
    organizer_id      BIGSERIAL PRIMARY KEY,
    request_id             BIGINT NOT NULL REFERENCES request(request_id),
    staff_id                   BIGINT REFERENCES staff(staff_id),
    staff_first_name               VARCHAR(100) NOT NULL,
    staff_last_name                    VARCHAR(100) NOT NULL,
    staff_email                            VARCHAR(150) NOT NULL,
    staff_role                                 VARCHAR(100),
    note                                            TEXT
);

CREATE TABLE important_people (
    important_person_id  BIGSERIAL PRIMARY KEY,
    request_id                BIGINT NOT NULL REFERENCES request(request_id),
    name                           VARCHAR(150) NOT NULL,
    type                               VARCHAR(30) NOT NULL,
    organization                          VARCHAR(150),
    designation                               VARCHAR(150),
    CONSTRAINT chk_important_people_type CHECK (
        type IN ('VIP','Speaker','Partner','Important Guest')
    )
);

CREATE TABLE general_guest (
    general_guest_id  BIGSERIAL PRIMARY KEY,
    request_id             BIGINT NOT NULL REFERENCES request(request_id),
    guest_type                 VARCHAR(30) NOT NULL,
    count                           INTEGER NOT NULL CHECK (count >= 0),
    notes                               TEXT,
    CONSTRAINT chk_general_guest_type CHECK (
        guest_type IN ('Students','APU Staff','External Guests',
                        'Parents-Guardians','Industry Partners','Alumni','Others')
    )
);

CREATE TABLE event_schedule (
    event_schedule_id  BIGSERIAL PRIMARY KEY,
    request_id              BIGINT NOT NULL REFERENCES request(request_id),
    date                        DATE NOT NULL,
    start_time                      TIME NOT NULL,
    end_time                            TIME NOT NULL,
    location                                VARCHAR(200) NOT NULL
);

CREATE TABLE brief_agenda (
    brief_agenda_id  BIGSERIAL PRIMARY KEY,
    request_id            BIGINT NOT NULL REFERENCES request(request_id),
    time                      TIME NOT NULL,
    activity                      VARCHAR(200) NOT NULL,
    location                          VARCHAR(200) NOT NULL,
    pic                                   VARCHAR(150) NOT NULL,
    notes                                     TEXT
);

CREATE TABLE request_discussion_topics (
    request_discussion_topic_id  BIGSERIAL PRIMARY KEY,
    request_id                        BIGINT NOT NULL REFERENCES request(request_id),
    discussion_topic                      VARCHAR(200) NOT NULL
);


-- ============================================================================
-- SECTION 9: EVENT DISCOVERY / REGISTRATION
-- ============================================================================

CREATE TABLE event_registration (
    event_registration_id  BIGSERIAL PRIMARY KEY,
    request_id                  BIGINT NOT NULL REFERENCES request(request_id),
    user_id                         BIGINT NOT NULL REFERENCES users(user_id),
    registrant_name                     VARCHAR(150) NOT NULL,   -- snapshot
    registrant_email                        VARCHAR(150) NOT NULL,   -- snapshot
    reason_for_attending                        VARCHAR(100),   -- collected only when registration_approval = 'manual'
    status                                          VARCHAR(20) NOT NULL DEFAULT 'registered',
    payment_proof_url                                   VARCHAR(255),   -- populated when the published event's cost_amount > 0
    payment_proof_file_name                                 VARCHAR(255),
    payment_status                                              VARCHAR(20) NOT NULL DEFAULT 'not_required',
    registered_at                                                   TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_registration_status CHECK (
        status IN ('registered','pending_approval','rejected','cancelled')
    ),
    CONSTRAINT chk_registration_payment_status CHECK (
        payment_status IN ('not_required','pending_review','approved','rejected')
    )
);
-- Partial unique index instead of a blanket UNIQUE constraint, so someone
-- can cancel and later re-register for the same event:
CREATE UNIQUE INDEX uq_event_registration_active
    ON event_registration (request_id, user_id)
    WHERE status <> 'cancelled';
-- Pending/manual approvals surface in the applicant's inbox by querying
-- event_registration WHERE request_id IN (their requests) AND
-- status='pending_approval' — no separate request_task row needed, this is
-- a much simpler single-approver flow than the request approval chain.

CREATE TABLE saved_event (
    user_id     BIGINT NOT NULL REFERENCES users(user_id),
    request_id  BIGINT NOT NULL REFERENCES request(request_id),
    saved_at    TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_id)
);

-- Per-user reminder settings for the events they follow (added 2026-08-18 — the table existed in
-- the application but had no DDL here). Two independent reminders, each with its own on/off flag
-- and its own delivery state:
--   registration_closing_* — "tell me before registration closes"
--   event_starting_*       — "tell me before the event starts"
-- Keyed by email, not user_id, because External Users register for public events by email alone
-- and may have no `users` row at the time the preference is first saved (routes/auth.routes.js
-- only creates one on full sign-up). One row per person, upserted — routes/event-engagement.routes.js
-- merges the incoming partial body over the existing row, so saving one toggle never resets the
-- other. A missing row means DEFAULT_PREFERENCES, so absence is a valid state and the row is
-- created lazily on first change.
CREATE TABLE notification_preference (
    email                         VARCHAR(150) PRIMARY KEY,
    registration_closing_reminder  BOOLEAN NOT NULL DEFAULT TRUE,
    event_starting_reminder          BOOLEAN NOT NULL DEFAULT TRUE,
    registration_closing_status        VARCHAR(20),
    event_starting_status                VARCHAR(20)
);


-- ============================================================================
-- SECTION 10: WORKFLOW — TASKS, ASSIGNMENTS, HISTORY
-- ============================================================================
-- Inbox / Ongoing / History are still queries, not tables — see the earlier
-- audit file for the exact query shape. Unchanged from the previous version
-- except for the renamed PK.

-- Departments cannot reject a proposal outright — only the earlier
-- single-actor stages (hos_hod_review / fmb_review / cfo_review) can.
-- A department's only pushback is resubmit-with-comment. 'preparing'
-- means the assigned staff has started the work but not finished.
--
-- Routing is unit-based, not role-based: `assigned_unit_code` names the Service department Unit
-- responsible for this task (e.g. the Logistics unit) — any user holding head-of-department (or
-- head-of-school) on that unit can act on it, any 'staff'-role holder on that unit can be
-- assigned to fulfil it (see role-eligibility.service.js / user-access.service.js). `assigned_role`
-- is kept ONLY for the two requirement kinds that are NOT unit-scoped Service departments — 'cfo'
-- (fundingPurchase) and the legacy 'fmb' routing token (F&B, whose staff-level fulfilment happens
-- via request_fmb_selection/cafeteria_staff, not this table; F&B's own actor-authorization check
-- is head-of-department on the food_beverage_services unit) — exactly one of the two columns is
-- non-null per row.
CREATE TABLE request_task (
    request_task_id     BIGSERIAL PRIMARY KEY,
    request_id               BIGINT NOT NULL REFERENCES request(request_id),
    requirement_id                BIGINT REFERENCES event_requirements(requirement_id),
    stage_code                        VARCHAR(40) NOT NULL,
    sequence_no                           SMALLINT NOT NULL DEFAULT 1,
    assigned_unit_code                        VARCHAR(40) REFERENCES unit(code),
    assigned_role                                 VARCHAR(30),
    assignment_mode                               VARCHAR(15) NOT NULL DEFAULT 'assigned',
    status                                            VARCHAR(20) NOT NULL DEFAULT 'pending',
    comment                                               TEXT,
    created_at                                                TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at                                                  TIMESTAMP,
    resolved_by_user_id                                              BIGINT REFERENCES users(user_id),
    CONSTRAINT chk_task_assignment_mode CHECK (assignment_mode IN ('assigned','shared_pool')),
    CONSTRAINT chk_task_status CHECK (
        status IN ('pending','approved','resubmitted','preparing','completed','cancelled')
    ),
    CONSTRAINT chk_task_routing CHECK (
        (assigned_unit_code IS NOT NULL AND assigned_role IS NULL) OR
        (assigned_unit_code IS NULL AND assigned_role IN ('cfo','fmb'))
    )
);

CREATE TABLE task_assignment (
    task_assignment_id   BIGSERIAL PRIMARY KEY,
    request_task_id          BIGINT NOT NULL REFERENCES request_task(request_task_id),
    staff_user_id                 BIGINT NOT NULL REFERENCES users(user_id),
    assigned_by_user_id               BIGINT REFERENCES users(user_id),  -- NULL = self-claimed (shared_pool)
    assigned_at                           TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (request_task_id, staff_user_id)
);

CREATE TABLE workflow_history (
    workflow_history_id  BIGSERIAL PRIMARY KEY,
    request_id                 BIGINT NOT NULL REFERENCES request(request_id),
    request_task_id                 BIGINT REFERENCES request_task(request_task_id),
    requirement_id                       BIGINT REFERENCES event_requirements(requirement_id),
    action                                    VARCHAR(30) NOT NULL,
    actor_user_id                                BIGINT NOT NULL REFERENCES users(user_id),
    actor_role                                       VARCHAR(30) NOT NULL,
    comment                                              TEXT,
    previous_status                                          VARCHAR(30),
    new_status                                                   VARCHAR(30),
    created_at                                                       TIMESTAMP NOT NULL DEFAULT now()
);
