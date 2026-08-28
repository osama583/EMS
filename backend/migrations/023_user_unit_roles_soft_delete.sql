-- user_unit_roles joins the shared soft-delete convention (2026-08-25).
--
-- user_unit_roles is the single most central table in the system: every
-- permission a user has flows through it (user_id, unit_code, role_code,
-- is_active). Every other admin-managed entity (users, unit, role, nav_page,
-- club_categories, clubs, and every *_options catalogue) already carries
-- archived_at - user_unit_roles was the one outlier still hard-deleted, in
-- two places (DELETE /admin/users/{id}/assignments/{id} and DELETE
-- /catalog/cafeterias/assignments/{id}), with no way to undo a mis-click.
--
-- Column semantics match every other soft-deletable table exactly:
-- archived_at NULL = live, non-NULL = in the bin. `is_active` already exists
-- on user_unit_roles (migration 008) and stays what it has always been - the
-- suspend/restore toggle a manager uses to take someone off the active
-- roster without discarding the assignment. The two are independent: an
-- archived assignment is always treated as suspended too (every permission
-- read already filters `is_active`, and the delete path leaves is_active
-- exactly as it was rather than flipping it), but suspending alone never
-- sets archived_at.
ALTER TABLE user_unit_roles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;

-- Every permission read filters on `archived_at IS NULL` - this is the
-- hottest path in the whole system (every authorization decision reads
-- through it), so the live set gets its own partial index.
CREATE INDEX IF NOT EXISTS ix_user_unit_roles_live
    ON user_unit_roles (user_id) WHERE archived_at IS NULL;

-- The purge sweep scans for rows past the retention window across every
-- soft-deletable table; this keeps that scan from sequentially reading the
-- whole table on each run.
CREATE INDEX IF NOT EXISTS ix_user_unit_roles_archived_at
    ON user_unit_roles (archived_at) WHERE archived_at IS NOT NULL;
