-- ============================================================================
-- Migration 039 - when a registration decision was actually made.
--
-- History > Events dated every row by `registered_at`, the moment the person
-- asked to attend. That is not when the record became history: a rejected
-- registration entered history when the organiser turned it down, which can be
-- days later. The date column therefore answered a question nobody asked.
--
-- `decided_by_user_id` (migration 019) already models WHO decided; this adds
-- WHEN. The pair is written together by decide_registration() from now on -
-- until this migration, nothing in the app wrote decided_by_user_id at all,
-- so History > Events showed a blank "Decided by" for every row it had not
-- been handed by the seed.
--
-- Deliberately NOT backfilled. A decision that has already happened left no
-- record of its timestamp anywhere - not in event_registration, not in
-- workflow_history, which tracks proposal approvals rather than registration
-- ones. Any value invented here would be a guess presented as a fact, so the
-- column stays NULL for historical rows and the history query falls back to
-- registered_at for them, which is at least a real timestamp from the right
-- request.
--
-- The confirmed-and-ended half of history needs no column: that record entered
-- history the day its event finished, which event_schedule already knows.
-- ============================================================================

ALTER TABLE event_registration
    ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP NULL;

-- History > Events orders by the decision date across the caller's own
-- registrations and every registration they decided as organiser. Without this
-- the union's ORDER BY sorts a sequential scan of the whole table.
CREATE INDEX IF NOT EXISTS ix_event_registration_decided_at
    ON event_registration (decided_at)
 WHERE decided_at IS NOT NULL;
