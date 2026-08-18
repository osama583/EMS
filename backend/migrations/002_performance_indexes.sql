-- ============================================================================
-- Migration 002 - indexes the API's hot paths depend on.
--
-- 001 is ems_database_schema.sql verbatim (the source of truth). It declares
-- keys and constraints but few secondary indexes, so every index the API
-- actually needs lives here instead of being smuggled into the source file.
--
-- Each one below backs a query the API runs on nearly every request:
-- resolving an actor's roles, listing a user's proposals, fanning out a
-- proposal's child rows, and filtering department task inboxes.
-- ============================================================================

-- Principal resolution: runs on EVERY authenticated request.
CREATE INDEX IF NOT EXISTS idx_user_unit_roles_user     ON user_unit_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_unit_roles_unit     ON user_unit_roles (unit_code) WHERE unit_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_unit_roles_role     ON user_unit_roles (role_code);
CREATE INDEX IF NOT EXISTS idx_users_email_lower        ON users (lower(email));

-- Proposal listing, scoped per applicant and per status.
CREATE INDEX IF NOT EXISTS idx_request_applicant        ON request (applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_request_status           ON request (status);
CREATE INDEX IF NOT EXISTS idx_request_created_at       ON request (created_at DESC);
-- co_owners holds SNAPSHOT rows, not a users FK: ownership is matched by staff_id when the
-- co-owner was picked from the staff directory, and by the email snapshot otherwise. Both
-- paths are indexed because isProposalOwner() runs on every applicant-side mutation.
CREATE INDEX IF NOT EXISTS idx_co_owners_request        ON co_owners (request_id);
CREATE INDEX IF NOT EXISTS idx_co_owners_staff          ON co_owners (staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_co_owners_email          ON co_owners (lower(staff_email));

-- Department task inboxes: "tasks routed to a unit I head" / "to my flat role".
CREATE INDEX IF NOT EXISTS idx_request_task_request     ON request_task (request_id);
CREATE INDEX IF NOT EXISTS idx_request_task_unit_status ON request_task (assigned_unit_code, status) WHERE assigned_unit_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_request_task_role_status ON request_task (assigned_role, status) WHERE assigned_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_assignment_staff    ON task_assignment (staff_user_id);

-- F&B selections: the cafeteria shared inbox and per-order lifecycle.
CREATE INDEX IF NOT EXISTS idx_fmb_selection_unit_status ON request_fmb_selection (unit_code, status);
CREATE INDEX IF NOT EXISTS idx_fmb_selection_claimed     ON request_fmb_selection (claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL;

-- Audit trail reads, newest first for one proposal.
CREATE INDEX IF NOT EXISTS idx_workflow_history_request ON workflow_history (request_id, created_at DESC);

-- Published events and registrations.
CREATE INDEX IF NOT EXISTS idx_event_registration_request ON event_registration (request_id, status);
CREATE INDEX IF NOT EXISTS idx_event_registration_email   ON event_registration (lower(registrant_email));
CREATE INDEX IF NOT EXISTS idx_saved_event_user          ON saved_event (user_id);

-- Nav tree: rebuilt on every login and /auth/me.
CREATE INDEX IF NOT EXISTS idx_nav_page_parent          ON nav_page (parent_page_code, sort_order);
CREATE INDEX IF NOT EXISTS idx_nav_page_grants_page     ON nav_page_grants (page_code);

-- Club membership and join-request inboxes.
CREATE INDEX IF NOT EXISTS idx_club_members_user        ON club_members (user_id);
CREATE INDEX IF NOT EXISTS idx_club_join_requests_club  ON club_join_requests (club_id, status);
CREATE INDEX IF NOT EXISTS idx_clubs_president          ON clubs (user_id);
