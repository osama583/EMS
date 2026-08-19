-- ============================================================================
-- Migration 008 - an assignment can be suspended without being deleted.
--
-- A Cafeteria Manager can ask for a staff member to be removed, but not to be
-- stood down temporarily - someone on leave had to be deleted and re-added,
-- losing assigned_at and the fact they were ever on the roster.
--
-- Recorded on the assignment, not on the user: suspending someone at one
-- cafeteria must not touch their account or any role they hold elsewhere.
--
-- Defaults TRUE so every existing assignment stays active, and NOT NULL so
-- "suspended" is always an explicit answer rather than an absent one.
-- ============================================================================

ALTER TABLE user_unit_roles
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Page visibility and every permission check read a user's assignments on each
-- request, and now filter on this column.
CREATE INDEX IF NOT EXISTS idx_user_unit_roles_active
    ON user_unit_roles (user_id) WHERE is_active;
