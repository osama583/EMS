-- ============================================================================
-- Migration 012 - row-level, multi-staff department task assignment.
--
-- task_assignment (one row per (request_task_id, staff_user_id)) only ever
-- let a manager assign staff to the WHOLE department task, never to a single
-- requested row within it. That doesn't match how these departments actually
-- work:
--   - Logistics: one row can need several people (a big chairs/tables setup).
--   - Transportation: exactly one driver per vehicle/row.
--   - Photography, Sound & Light, Campus Tour: a row can need one or several.
--   - Food/Water (fmb, waterNormal): NOT covered here - F&B's flow is the
--     existing cafeteria shared pool (request_fmb_selection / claim_selection),
--     untouched by this migration.
--
-- request_row_assignment replaces task_assignment for these five requirement
-- kinds: one row per (requirement_name, row_id, staff_user_id), where row_id
-- is the specific request_logistics_id / request_transportation_id /
-- request_photography_videography_id / request_sound_light_id /
-- request_campus_tour_id being assigned - not the whole request_task.
--
-- requirement_name (rather than a table-specific FK) is the discriminator
-- because these five detail tables have no common parent key to join on
-- directly; the same pattern the client and proposals.py's
-- _TABLE_FOR_REQUIREMENT already use to address "which per-requirement table"
-- a row lives in.
--
-- status is per-row (not per-assignment): every assignee on a row shares that
-- row's progress, matching "several people doing the SAME piece of work"
-- rather than tracking each assignee's own separate status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS request_row_assignment (
    request_row_assignment_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_task_id            BIGINT NOT NULL REFERENCES request_task(request_task_id) ON DELETE CASCADE,
    requirement_name           VARCHAR(40) NOT NULL,
    row_id                     BIGINT NOT NULL,
    staff_user_id               BIGINT NOT NULL REFERENCES users(user_id),
    assigned_by_user_id        BIGINT REFERENCES users(user_id),
    assigned_at                 TIMESTAMP NOT NULL DEFAULT now(),
    status                      VARCHAR(20) NOT NULL DEFAULT 'assigned',
    resolved_at                 TIMESTAMP,
    CONSTRAINT chk_row_assignment_status
        CHECK (status IN ('assigned', 'preparing', 'completed')),
    CONSTRAINT uq_row_assignment_person
        UNIQUE (requirement_name, row_id, staff_user_id)
);

CREATE INDEX IF NOT EXISTS idx_row_assignment_task
    ON request_row_assignment (request_task_id);
CREATE INDEX IF NOT EXISTS idx_row_assignment_row
    ON request_row_assignment (requirement_name, row_id);
CREATE INDEX IF NOT EXISTS idx_row_assignment_staff
    ON request_row_assignment (staff_user_id, status);
