-- ============================================================================
-- Migration 035 - remove the dead dashboard-threshold config codes.
--
-- Migration 018 seeded sixteen threshold codes (SLA targets, capacity
-- assumptions, risk/forecast windows, reporting rules) for the role dashboards
-- at /app/dashboard. Those dashboards and the metrics that read these codes
-- have since been removed, and 018's header records the seed block being
-- deleted from that file - but deleting the INSERT statements never deleted
-- the rows from a database that had already run it.
--
-- The result was a policies page rendering sixteen editable fields over values
-- nothing reads: the API stopped mapping these codes, so the form showed 0 for
-- every one and "saving" them wrote nowhere. Dropping the rows is what
-- actually removes them.
--
-- No application code references these codes; verified by grep over app/ and
-- fyp-ui/src before writing this. CANCELLATION_DEADLINE_DAYS, HIGH_PAX_THRESHOLD,
-- MAX_EVENT_CATEGORIES and MIN_EVENT_LEAD_DAYS are the live policies and stay.
-- ============================================================================

DELETE FROM config WHERE code IN (
    'SLA_DECISION_HOURS',
    'SLA_ASSIGNMENT_HOURS',
    'SLA_FULFILMENT_LEAD_DAYS',
    'SLA_ORDER_ACCEPT_HOURS',
    'SLA_ORDER_CLAIM_HOURS',
    'STAFF_SHIFT_HOURS',
    'CAPACITY_WARN_RATIO',
    'VENUE_TEARDOWN_MINUTES',
    'START_POINT_MAX_TOURS',
    'AT_RISK_WINDOW_DAYS',
    'STALL_MULTIPLIER',
    'FORECAST_HORIZON_DAYS',
    'DASHBOARD_TREND_WEEKS',
    'ANOMALY_SIGMA',
    'MIN_BUCKET_SIZE',
    'SEND_BACK_WARN_RATE'
);
