-- ============================================================================
-- Migration 007 - one pending staffing request per person, per outlet.
--
-- Nothing stopped a manager filing the same request twice. Verified against the
-- live database before this migration: two identical pending 'remove' rows
-- existed for assignment 10, and a third was accepted on demand.
--
-- Duplicates are not just clutter. Each pending row is an action the Admin will
-- apply, so approving both a duplicate pair means running the roster change
-- twice - the second one hitting an assignment the first already deleted.
--
-- Enforced as a partial unique index rather than a check in the endpoint: two
-- concurrent submits (a double-clicked button) both pass an application-level
-- "does one already exist" read before either inserts. Only the database can
-- refuse the second one.
--
-- Partial on status = 'pending' so history is unaffected: the same person can
-- be added, removed, and added again over time - only one request about them
-- may be awaiting a decision at any moment.
--
-- Keyed on target_user_id, not target_assignment_id: an 'add' request has no
-- assignment yet, and "this person already has a request pending" is the rule
-- regardless of which action it is.
-- ============================================================================

-- Collapse any existing duplicates first, keeping the earliest of each group -
-- the index cannot be created while they are present, and the first request is
-- the one the manager actually meant.
DELETE FROM cafeteria_staff_requests a
 USING cafeteria_staff_requests b
 WHERE a.status = 'pending'
   AND b.status = 'pending'
   AND a.target_user_id IS NOT NULL
   AND a.target_user_id = b.target_user_id
   AND a.cafeteria_code = b.cafeteria_code
   AND a.cafeteria_staff_request_id > b.cafeteria_staff_request_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_request_one_pending_per_user
    ON cafeteria_staff_requests (cafeteria_code, target_user_id)
 WHERE status = 'pending' AND target_user_id IS NOT NULL;

-- An 'add' request for someone with no account yet carries an email instead of
-- a user id, so it needs its own guard on the same rule. Lowercased because
-- addresses are matched case-insensitively when the request is applied.
DELETE FROM cafeteria_staff_requests a
 USING cafeteria_staff_requests b
 WHERE a.status = 'pending'
   AND b.status = 'pending'
   AND a.target_user_id IS NULL
   AND b.target_user_id IS NULL
   AND a.payload_email IS NOT NULL
   AND lower(a.payload_email) = lower(b.payload_email)
   AND a.cafeteria_code = b.cafeteria_code
   AND a.cafeteria_staff_request_id > b.cafeteria_staff_request_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_request_one_pending_per_email
    ON cafeteria_staff_requests (cafeteria_code, lower(payload_email))
 WHERE status = 'pending' AND target_user_id IS NULL AND payload_email IS NOT NULL;
