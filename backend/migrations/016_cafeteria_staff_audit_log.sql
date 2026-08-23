-- ============================================================================
-- Migration 016 - Cafeteria staff action audit log.
--
-- Now that staff management is a direct action (migration 015 dropped the
-- Manager -> Admin approval workflow), there is no request table to read a
-- history from. This is a straight audit log: one row per create/edit/
-- suspend/restore/remove, written in the same transaction as the write it
-- records (see backend/app/api/cafeterias.py's assignment endpoints).
--
-- Deliberately NOT sourced from the `audit()` log line (backend/app/
-- logging_setup.py) - that writes structured log output, not a queryable
-- table, and this page needs server-side search/filter/sort/pagination.
--
-- No FK to user_unit_roles: an assignment can be deleted (the 'remove'
-- action does exactly that), and the audit trail must survive it.
-- ============================================================================

CREATE TABLE cafeteria_staff_audit_log (
    cafeteria_staff_audit_log_id  BIGSERIAL PRIMARY KEY,
    cafeteria_code                 VARCHAR(40) NOT NULL REFERENCES unit(code),
    action                              VARCHAR(10) NOT NULL,
    target_user_id                         BIGINT NOT NULL REFERENCES users(user_id),
    target_display_name                        VARCHAR(255) NOT NULL,  -- snapshot: survives the target account changing name later
    target_email                                   VARCHAR(255) NOT NULL,
    role_code                                          VARCHAR(40) NOT NULL,
    actor_user_id                                          BIGINT NOT NULL REFERENCES users(user_id),
    actor_display_name                                         VARCHAR(255) NOT NULL,  -- snapshot, same reasoning
    actor_role                                                     VARCHAR(20) NOT NULL,  -- 'cafeteria-admin' | 'cafeteria-manager' | 'system-admin'
    created_at                                                         TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_cafeteria_staff_audit_action
        CHECK (action IN ('create', 'edit', 'suspend', 'restore', 'remove')),
    CONSTRAINT chk_cafeteria_staff_audit_actor_role
        CHECK (actor_role IN ('cafeteria-admin', 'cafeteria-manager', 'system-admin'))
);

-- The page's default view and its two most common filters: one cafeteria's
-- timeline, and "did I do this" scoped to one actor.
CREATE INDEX ix_cafeteria_staff_audit_cafeteria ON cafeteria_staff_audit_log (cafeteria_code, created_at DESC);
CREATE INDEX ix_cafeteria_staff_audit_actor ON cafeteria_staff_audit_log (actor_user_id, created_at DESC);

-- --- Page Visibility: register the page, grantable to Cafeteria Admin (all
-- outlets) and Cafeteria Manager (their own outlet only) -------------------
INSERT INTO nav_page (page_code, label, entry_type, icon, route_path, parent_page_code, sort_order, is_active)
VALUES
    ('cafeteria-staff-requests-history', 'Staff Action History', 'page', 'history',
     '/app/cafeterias/staff-requests-history', 'cafeteria-admin-folder', 3, TRUE)
ON CONFLICT (page_code) DO NOTHING;

-- Cafeteria Admin: a flat role, so a plain 'role' grant (same shape as
-- cafeteria-manage / cafeteria-staff-assignments above it in the folder).
INSERT INTO nav_page_grants (page_code, grant_type, is_active)
SELECT 'cafeteria-staff-requests-history', 'role', TRUE
 WHERE NOT EXISTS (
        SELECT 1 FROM nav_page_grants
         WHERE page_code = 'cafeteria-staff-requests-history' AND grant_type = 'role' AND archived_at IS NULL
 );

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, 'cafeteria-admin'
  FROM nav_page_grants g
 WHERE g.page_code = 'cafeteria-staff-requests-history'
   AND g.grant_type = 'role'
   AND g.archived_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM nav_page_grant_roles r
         WHERE r.grant_id = g.grant_id AND r.role_code = 'cafeteria-admin'
 );

-- Cafeteria Manager: scoped to real cafeteria units only (migration 005's
-- rule - nothing enumerates a cafeteria unit by hand), same 'cafeteria'
-- grant type cafeteria-my-staff already uses. A 'cafeteria' grant still
-- names its role(s) via nav_page_grant_roles - only the unit list is
-- implicit (the cafeteria__ prefix), not the role.
INSERT INTO nav_page_grants (page_code, grant_type, is_active)
SELECT 'cafeteria-staff-requests-history', 'cafeteria', TRUE
 WHERE NOT EXISTS (
        SELECT 1 FROM nav_page_grants
         WHERE page_code = 'cafeteria-staff-requests-history' AND grant_type = 'cafeteria' AND archived_at IS NULL
 );

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, 'cafeteria-manager'
  FROM nav_page_grants g
 WHERE g.page_code = 'cafeteria-staff-requests-history'
   AND g.grant_type = 'cafeteria'
   AND g.archived_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM nav_page_grant_roles r
         WHERE r.grant_id = g.grant_id AND r.role_code = 'cafeteria-manager'
 );
