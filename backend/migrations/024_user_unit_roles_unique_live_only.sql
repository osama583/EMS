-- The (user_id, unit_code, role_code) uniqueness rule must only apply to LIVE
-- rows now that user_unit_roles is soft-deletable (migration 023).
--
-- The original UNIQUE constraint (migration 001) knows nothing about
-- archived_at, so a soft-deleted assignment still occupies its
-- (user, unit, role) slot forever - re-adding that exact person to that exact
-- outlet in that exact role after deleting their old posting fails with a
-- UniqueViolation, even though the old row is sitting in the bin and the
-- person has no live assignment there at all. Discovered live: deleting a
-- cafeteria staff member's posting and immediately re-adding them the same
-- way failed outright.
--
-- Fix: drop the table-wide constraint, replace it with a partial unique index
-- that only enforces uniqueness among archived_at IS NULL rows. Two archived
-- rows for the same (user, unit, role) - e.g. someone removed and re-added
-- twice - are allowed to coexist in the bin; only one LIVE one ever can.
ALTER TABLE user_unit_roles
    DROP CONSTRAINT IF EXISTS user_unit_roles_user_id_unit_code_role_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_unit_roles_live
    ON user_unit_roles (user_id, unit_code, role_code)
    WHERE archived_at IS NULL;
