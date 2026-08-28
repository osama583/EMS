-- ============================================================================
-- Migration 019 - Track who decided a manual-approval event registration.
--
-- event_registration previously recorded THAT a registration was approved/
-- rejected (status) but not WHO decided it - any organiser or co-owner could
-- act via POST /events/{id}/registrations/{rid}/decision (events.py's
-- decide_registration()), but nothing distinguished which of them actually
-- did it. Needed so Inbox -> Registrations can show whether a decision was
-- made by the event's applicant (Owner) or a co-owner.
-- ============================================================================

ALTER TABLE event_registration
    ADD COLUMN IF NOT EXISTS decided_by_user_id BIGINT REFERENCES users(user_id);
