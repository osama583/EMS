-- ============================================================================
-- Migration 031 - the index the master calendar's range query actually wants.
--
-- The master calendar (app/api/events.py, _occurrence_rows) is now a single
-- statement that expands one row per (event, session) for a date window:
--
--     FROM request r JOIN event_schedule s ON s.request_id = r.request_id
--    WHERE r.status = ANY(...) AND s."date" BETWEEN %(start)s AND %(end)s
--
-- Migration 018 added idx_event_schedule_date ("date") for the guest calendar,
-- which lets Postgres find the dates in range but then forces a heap fetch per
-- matching row just to read request_id for the join. The month view asks for a
-- 42-day window on every navigation, so that is the hot path on this page.
--
-- (date, request_id) covers both: the range scan and the join key come out of
-- the index. It supersedes idx_event_schedule_date as a leading-column prefix,
-- but 018's index is left in place - dropping an index that other queries may
-- be planned against is not worth the marginal write cost of keeping it.
--
-- request_categories is already keyed (request_id, category_id), so the LATERAL
-- that picks the event's first category needs no index of its own.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_event_schedule_date_request
    ON event_schedule ("date", request_id);

-- Club Only redaction runs an EXISTS over (request_clubs -> club_members) once
-- per candidate row. request_clubs's PK (request_id, club_id) covers the outer
-- lookup and club_members's PK (club_id, user_id) covers the join, but the
-- membership probe filters on cm.user_id, and 002's idx_club_members_user is
-- (user_id) alone - so it finds the rows and then goes to the heap for club_id.
-- Adding club_id makes that probe index-only on the calendar's hottest per-row
-- predicate. Two columns of BIGINT; 002's single-column index is left alone.
CREATE INDEX IF NOT EXISTS idx_club_members_user_club
    ON club_members (user_id, club_id);
