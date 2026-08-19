-- ============================================================================
-- Migration 009 - a staffing request carries the details it proposes.
--
-- A Manager can now propose creating a staff account, editing someone's
-- details, or suspending them - but the request table could only name a target
-- and an action. The proposed VALUES had nowhere to live, so the Cafeteria
-- Admin would be approving a change without being able to see what it was.
--
-- 'suspend' and 'restore' join the action list. Suspending is not removing:
-- it clears the roster without discarding the assignment (migration 008), so
-- the two need to be distinguishable in the audit trail.
--
-- PASSWORD. An 'add' request creates the account only once it is approved, so
-- the credential has to survive until then. It is stored as a BCRYPT HASH,
-- never plaintext: the column is copied straight into users.password on
-- approval, so nothing that reads this table ever sees a usable secret. The
-- column is nullable because a request that names no password still creates a
-- working account - it just gets a random one nobody holds, exactly as
-- POST /admin/users does today.
-- ============================================================================

ALTER TABLE cafeteria_staff_requests
    ADD COLUMN IF NOT EXISTS payload_username      VARCHAR(80),
    ADD COLUMN IF NOT EXISTS payload_password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS payload_active        BOOLEAN;

ALTER TABLE cafeteria_staff_requests
    DROP CONSTRAINT IF EXISTS chk_cafeteria_staff_request_action;

ALTER TABLE cafeteria_staff_requests
    ADD CONSTRAINT chk_cafeteria_staff_request_action
    CHECK (action IN ('add', 'edit', 'remove', 'suspend', 'restore'));
