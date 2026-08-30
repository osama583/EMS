-- ============================================================================
-- Migration 034 - MIN_EVENT_LEAD_DAYS config code.
--
-- Minimum notice between the day a proposal is created and the event start
-- date. The proposal date picker disables anything earlier and submit
-- re-checks it server-side, so the value has to be readable by both.
--
-- Seeded at 0 - no notice required - deliberately: any positive default would
-- retroactively invalidate in-flight proposals whose dates were legal when
-- they were drafted. An administrator opts in from the policies page.
--
-- ON CONFLICT DO NOTHING keeps this file re-appliable by hand and preserves a
-- value an administrator has already set.
-- ============================================================================

INSERT INTO config (code, number) VALUES ('MIN_EVENT_LEAD_DAYS', 0)
    ON CONFLICT (code) DO NOTHING;
