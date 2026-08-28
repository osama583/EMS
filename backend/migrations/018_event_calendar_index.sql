-- ============================================================================
-- Migration 018 - Index to support the events calendar's range query.
--
-- GET /events/calendar (backend/app/api/events.py) filters/joins on
-- event_schedule.date for a given [start, end] window every time the guest
-- calendar's visible month/week changes. No index previously existed on this
-- column at all (002_performance_indexes.sql covers `request`, not
-- `event_schedule`).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_event_schedule_date ON event_schedule ("date");
