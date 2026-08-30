-- ============================================================================
-- Migration 036 - event reminders that can actually be sent.
--
-- THE PROBLEM. notification_preference has existed since 001 with two toggles
-- (registration_closing_reminder, event_starting_reminder) and two "was it
-- sent" columns. Nothing ever wrote the status columns and nothing ever read
-- the toggles: there was no UI to set them, no service method to call the API
-- that reads them, and no job to act on them. 73 rows exist purely because the
-- production seed fabricated them.
--
-- Worse, the two columns cannot express what the feature actually needs. They
-- are a single global pair keyed by email, but a reader wants separate control
-- over the two lists they own:
--
--   SAVED events      - "I am interested but have not registered."
--                       Useful reminders: this is filling up; the date is close
--                       and you still have not registered.
--   REGISTERED events - "I am going."
--                       Useful reminder: your event starts soon.
--
-- A single "event_starting_reminder" flag cannot distinguish "remind me about
-- things I am attending" from "nag me about things I only bookmarked", and
-- those are different appetites. Conflating them is why one global toggle would
-- be turned off entirely by anyone who found either half annoying.
--
-- THE SHAPE. Three named toggles, one per reminder the system can send:
--
--   saved_capacity_reminder  - a saved event passes SAVED_CAPACITY_PERCENT full
--   saved_starting_reminder  - a saved event is near and you are NOT registered
--   registered_starting_reminder - an event you ARE registered for is near
--
-- The two original columns are migrated rather than dropped: their intent maps
-- cleanly (registration_closing -> the saved-event warnings, event_starting ->
-- the registered-event reminder), so a person who had set them keeps their
-- answer instead of being silently reset to defaults.
--
-- WHY A SEPARATE SEND-LOG. The old status columns were per-PERSON, which can
-- only record "we sent something once", not "we already told this person about
-- THIS event". A daily job needs the latter or it re-sends every run. Hence
-- event_reminder_sent below, and the two dead columns are dropped.
-- ============================================================================

-- --- 1. The toggles ---------------------------------------------------------
ALTER TABLE notification_preference
    ADD COLUMN IF NOT EXISTS saved_capacity_reminder      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS saved_starting_reminder      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS registered_starting_reminder BOOLEAN NOT NULL DEFAULT TRUE;

-- Carry the old answers forward. Both saved-list reminders inherit the
-- registration_closing answer (it was the "you have not acted yet" nudge), and
-- the registered reminder inherits event_starting (it was the "it is about to
-- happen" one). Only touches rows that actually exist.
UPDATE notification_preference
   SET saved_capacity_reminder      = registration_closing_reminder,
       saved_starting_reminder      = registration_closing_reminder,
       registered_starting_reminder = event_starting_reminder;

-- The originals are now redundant: every read path uses the three above.
ALTER TABLE notification_preference
    DROP COLUMN IF EXISTS registration_closing_reminder,
    DROP COLUMN IF EXISTS event_starting_reminder,
    -- Per-person "status" strings that were never written and cannot express
    -- per-event state. Replaced by event_reminder_sent.
    DROP COLUMN IF EXISTS registration_closing_status,
    DROP COLUMN IF EXISTS event_starting_status;


-- --- 2. The send log --------------------------------------------------------
-- One row per (person, event, reminder kind) that has been sent. This is the
-- idempotency guard: the daily job inserts before/as it sends and skips anything
-- already present, so re-running it - or running it twice on the same day, or
-- resuming after a crash - never double-sends.
--
-- Keyed by EMAIL for the same reason notification_preference is: a guest who
-- registered with an email alone may have no users row.
--
-- ON DELETE CASCADE on request: purging an event should take its send log with
-- it rather than leaving rows pointing at nothing.
CREATE TABLE IF NOT EXISTS event_reminder_sent (
    email       VARCHAR(150) NOT NULL,
    request_id  BIGINT       NOT NULL REFERENCES request(request_id) ON DELETE CASCADE,
    -- 'saved_capacity' | 'saved_starting' | 'registered_starting'
    kind        VARCHAR(30)  NOT NULL,
    sent_at     TIMESTAMP    NOT NULL DEFAULT now(),
    PRIMARY KEY (email, request_id, kind),
    CONSTRAINT chk_event_reminder_kind
        CHECK (kind IN ('saved_capacity', 'saved_starting', 'registered_starting'))
);

-- The job's own lookup is "what have I already sent for this event", which the
-- PK's leading email column does not serve.
CREATE INDEX IF NOT EXISTS idx_event_reminder_sent_request
    ON event_reminder_sent (request_id, kind);


-- --- 3. Tunables ------------------------------------------------------------
-- Admin-editable rather than hardcoded, consistent with HIGH_PAX_THRESHOLD and
-- the rest of `config`. The job reads them live, so changing one takes effect on
-- the next run with no deploy.
-- A saved event triggers an "almost full" email once this percent of its
-- capacity is taken.
INSERT INTO config (code, number) VALUES ('SAVED_CAPACITY_PERCENT', 70)
ON CONFLICT (code) DO NOTHING;

-- How many days before an event its reminder emails are sent.
INSERT INTO config (code, number) VALUES ('EVENT_REMINDER_LEAD_DAYS', 3)
ON CONFLICT (code) DO NOTHING;
