-- ============================================================================
-- Migration 018 - support for the role-based dashboards at /app/dashboard.
--
-- Three independent pieces, in the order a rollback would want to unwind them:
--
--   1. config codes    - every SLA target, capacity assumption, risk window and
--                        forecast horizon the dashboards read. None of these
--                        lives in code (rule R11 in docs/dashboards/01-*.md), so
--                        an administrator retunes a department's SLA without a
--                        deploy, exactly the way HIGH_PAX_THRESHOLD already
--                        works.
--   2. G1 timestamps   - request_fmb_selection carried only delivered_at
--                        (migration 013). Order acceptance latency (M17) and
--                        claim latency (M18) need the two timestamps either
--                        side of them, and order volume (M08) needs a creation
--                        time. Backfilled from workflow_history so the columns
--                        are not simply NULL for every existing row.
--   3. indexes         - the existing indexes cover point lookups. A dashboard
--                        does time-series scans over the same tables, which is
--                        a different access pattern and wants its own indexes.
--
-- Idempotent throughout: ON CONFLICT DO NOTHING on the config seed, IF NOT
-- EXISTS on every column and index. The runner records a checksum, but a
-- migration that can be re-applied by hand without damage is worth more than
-- one that relies on the bookkeeping being intact.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Config codes
-- ---------------------------------------------------------------------------
-- Per-unit overrides use a `__<unit_code>` suffix on the same code; the
-- resolver tries the suffixed form first and falls back to the bare one, so
-- only the defaults need seeding here. Longest possible key,
-- SLA_DECISION_HOURS__logistics_and_facilities, is 44 characters and fits
-- config.code's VARCHAR(50).

INSERT INTO config (code, number) VALUES
    ('SLA_DECISION_HOURS',        48),    -- M10 target: task created -> first decision
    ('SLA_ASSIGNMENT_HOURS',      24),    -- M12 target: approved -> first assignment
    ('SLA_FULFILMENT_LEAD_DAYS',   3),    -- M16 floor: notice a department is given
    ('SLA_ORDER_ACCEPT_HOURS',    12),    -- M17 target (cafeteria)
    ('SLA_ORDER_CLAIM_HOURS',      4),    -- M18 target (cafeteria shared pool)
    ('STAFF_SHIFT_HOURS',          8),    -- M35 denominator - assumption, gap G2
    ('CAPACITY_WARN_RATIO',     0.85),    -- M30/M35 amber threshold
    ('AT_RISK_WINDOW_DAYS',        7),    -- M70 window
    ('STALL_MULTIPLIER',           2),    -- M72: x the unit's median M10
    ('FORECAST_HORIZON_DAYS',     60),    -- M40/M41 horizon
    ('DASHBOARD_TREND_WEEKS',     12),    -- default trend window
    ('ANOMALY_SIGMA',              2),    -- M77 sensitivity
    ('MIN_BUCKET_SIZE',            5),    -- R8 bucket floor
    ('SEND_BACK_WARN_RATE',       15),    -- M20 amber, whole percent
    -- Two thresholds the role documents call "configurable" without naming a
    -- code. Both are department-specific judgements rather than universal
    -- constants, so they belong here rather than in a query.
    ('VENUE_TEARDOWN_MINUTES',    60),    -- Logistics KPI 2 / AI-10 turnaround gap
    ('START_POINT_MAX_TOURS',      2)     -- Student Services KPI 2 / AI-28 crowding
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. Gap G1 - request_fmb_selection lifecycle timestamps
-- ---------------------------------------------------------------------------
-- Without these, "how long did the manager take to accept this order" and "how
-- long did it sit unclaimed" can only be derived from workflow_history rows
-- scoped to request_id, which cannot tell concurrently-claimed sibling
-- selections apart (see request_fmb_selection.claimed_by_user_id's comment in
-- 001_initial_schema.sql). The columns make the per-selection answer exact.

ALTER TABLE request_fmb_selection
    ADD COLUMN IF NOT EXISTS created_at   TIMESTAMP,
    ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMP,
    ADD COLUMN IF NOT EXISTS ready_at     TIMESTAMP;

-- Backfill from the selection-level workflow_history actions written by
-- services/workflow/fmb.py. Those rows carry request_id but no selection id -
-- which is precisely why these columns are needed - so a proposal with several
-- sibling orders gets the same approximated timestamp on each. That is the best
-- the existing history can support, and the widgets reading M17/M18 label
-- pre-migration rows approximate rather than presenting them as measured.
--
-- Deliberately not now(): stamping every historical row with the migration time
-- would make acceptance and claim latency read as instant on all of them.
UPDATE request_fmb_selection sel
   SET created_at = COALESCE(
        (SELECT min(wh.created_at)
           FROM workflow_history wh
           JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
          WHERE wh.request_id = f.request_id
            AND wh.action = 'create-selection'),
        (SELECT r.submitted_at
           FROM request_fmb f
           JOIN request r ON r.request_id = f.request_id
          WHERE f.request_fmb_id = sel.request_fmb_id),
        sel.delivered_at)
 WHERE sel.created_at IS NULL;

-- approved_at only for rows that have demonstrably passed the manager's accept
-- step. A row still 'pending' has not been accepted, and guessing a timestamp
-- for it would invent an SLA measurement out of nothing.
UPDATE request_fmb_selection sel
   SET approved_at = (
        SELECT min(wh.created_at)
          FROM workflow_history wh
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE wh.request_id = f.request_id
           AND wh.action = 'approve-selection')
 WHERE sel.approved_at IS NULL
   AND sel.status IN ('approved', 'preparing', 'ready', 'fulfilled');

-- ready_at from the staff "Done Preparing" action, falling back to the delivery
-- time for fulfilled rows that predate it. Left NULL otherwise - the widgets
-- treat NULL as "not measured" and say so, which is honest, where a fabricated
-- value would not be.
UPDATE request_fmb_selection sel
   SET ready_at = COALESCE(
        (SELECT min(wh.created_at)
           FROM workflow_history wh
           JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
          WHERE wh.request_id = f.request_id
            AND wh.action = 'ready-selection'),
        CASE WHEN sel.status = 'fulfilled' THEN sel.delivered_at END)
 WHERE sel.ready_at IS NULL
   AND sel.status IN ('ready', 'fulfilled');

-- New rows get their creation time automatically from here on, so the backfill
-- above is a one-off rather than a permanent approximation.
ALTER TABLE request_fmb_selection
    ALTER COLUMN created_at SET DEFAULT now();


-- ---------------------------------------------------------------------------
-- 3. Indexes for the time-series scans
-- ---------------------------------------------------------------------------
-- Partial where the dashboard's predicate is always the same (resolved rows,
-- open tasks, submitted proposals), because a partial index is smaller and the
-- planner reaches it on exactly the queries that need it.

CREATE INDEX IF NOT EXISTS ix_request_task_unit_created
    ON request_task (assigned_unit_code, created_at DESC)
    WHERE assigned_unit_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_request_task_unit_resolved
    ON request_task (assigned_unit_code, resolved_at DESC)
    WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_request_task_open
    ON request_task (assigned_unit_code, status)
    WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX IF NOT EXISTS ix_workflow_history_task
    ON workflow_history (request_task_id, created_at)
    WHERE request_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_workflow_history_actor_time
    ON workflow_history (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_workflow_history_request_time
    ON workflow_history (request_id, created_at);
CREATE INDEX IF NOT EXISTS ix_request_submitted
    ON request (submitted_at DESC)
    WHERE submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_event_schedule_date
    ON event_schedule ("date");
CREATE INDEX IF NOT EXISTS ix_row_assignment_assigned
    ON request_row_assignment (staff_user_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS ix_request_logistics_date
    ON request_logistics ("date");
CREATE INDEX IF NOT EXISTS ix_request_transportation_date
    ON request_transportation ("date");
CREATE INDEX IF NOT EXISTS ix_request_sound_light_date
    ON request_sound_light ("date");
CREATE INDEX IF NOT EXISTS ix_request_photo_date
    ON request_photography_videography ("date");
CREATE INDEX IF NOT EXISTS ix_request_campus_tour_date
    ON request_campus_tour ("date");
CREATE INDEX IF NOT EXISTS ix_request_fmb_date
    ON request_fmb ("date");
CREATE INDEX IF NOT EXISTS ix_request_mineral_water_date
    ON request_mineral_water ("date");
CREATE INDEX IF NOT EXISTS ix_fmb_selection_unit_status
    ON request_fmb_selection (unit_code, status);
CREATE INDEX IF NOT EXISTS ix_fmb_selection_created
    ON request_fmb_selection (created_at DESC)
    WHERE created_at IS NOT NULL;
