-- ============================================================================
-- Migration 017 - Club President Change Request workflow.
--
-- A club President cannot leave their own club or be removed via the normal
-- membership endpoint (DELETE /clubs/{id}/members/{user_id} already blocks
-- this - see clubs.py's remove_member()). To stop being President, they
-- submit a request naming a replacement; a Club Admin (or System Admin)
-- approves or rejects it. Approval swaps clubs.user_id to the new President
-- in the same transaction as the decision. Same shape/lifecycle as
-- club_join_requests (status/comment/resolved_at/resolved_by_user_id), one
-- pending request per club at a time.
-- ============================================================================

CREATE TABLE club_president_change_requests (
    club_president_change_request_id  BIGSERIAL PRIMARY KEY,
    club_id                            BIGINT NOT NULL REFERENCES clubs(club_id),
    current_president_user_id              BIGINT NOT NULL REFERENCES users(user_id),
    requested_president_user_id                BIGINT NOT NULL REFERENCES users(user_id),
    status                                         VARCHAR(20) NOT NULL DEFAULT 'pending',
    comment                                            TEXT,  -- populated on rejection
    created_at                                             TIMESTAMP NOT NULL DEFAULT now(),
    resolved_at                                                TIMESTAMP,
    resolved_by_user_id                                            BIGINT REFERENCES users(user_id),
    CONSTRAINT chk_pcr_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Only one pending change request per club at a time (same partial-unique-index
-- pattern as uq_club_join_request_pending) - a rejected request can be resubmitted.
CREATE UNIQUE INDEX uq_pcr_pending_per_club
    ON club_president_change_requests (club_id)
    WHERE status = 'pending';

-- The admin inbox's default view (pending, newest first) and the President's
-- own history view (their submitted requests, newest first).
CREATE INDEX ix_pcr_status_created ON club_president_change_requests (status, created_at DESC);
CREATE INDEX ix_pcr_current_president ON club_president_change_requests (current_president_user_id, created_at DESC);
