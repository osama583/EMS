-- ============================================================================
-- Migration 037 - approval escalation, overdue proposals, and late tasks.
--
-- THE PROBLEM. Nothing in the system reacted to time running out. A proposal
-- whose event date passed while it sat in cfo_review stayed in cfo_review
-- forever: indistinguishable in the CFO's inbox from one for next March, never
-- counted as a failure, and never explained to the applicant, who simply never
-- heard back. The same held for a department task nobody actioned.
--
-- WHAT THIS ADDS.
--
--   1. Five config codes driving the escalation policy (thresholds, email
--      cadence, task grace) so an administrator tunes them from the policies
--      page instead of a developer editing constants.
--
--   2. Four overdue_* request statuses naming the STAGE that was holding the
--      proposal when its event date passed. The status itself is the
--      accountability record - no join needed to answer "who was it waiting
--      on" - and it routes the proposal into History for exactly the people
--      responsible for it.
--
--   3. request_task.is_overdue, deliberately SEPARATE from status. A task
--      finished late is status='completed' AND is_overdue - folding lateness
--      into the status would force the record to lose "it was completed" in
--      order to say "it was late". Both facts matter.
--
--   4. proposal_escalation_sent, the idempotency ledger for the daily job.
--
-- WHY THRESHOLDS ARE NOT MIN_EVENT_LEAD_DAYS. That code already means
-- something else (the notice required to CREATE a proposal) and is read by the
-- date picker and submit validation. Reusing it would couple two unrelated
-- policies: raising the lead time would silently change when approvers get
-- chased. These are their own codes.
--
-- SEEDED VALUES are conservative and re-appliable. ON CONFLICT DO NOTHING
-- preserves anything an administrator has already set, so this file can be run
-- by hand twice without resetting live policy.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Config
-- --------------------------------------------------------------------------

-- Event this many days away, still undecided -> amber in every approver's inbox.
INSERT INTO config (code, number) VALUES ('APPROVAL_WARNING_DAYS', 7)
    ON CONFLICT (code) DO NOTHING;

-- How often to re-chase the approver while amber. 0 disables the email but
-- keeps the colour - a useful way to trial a threshold without mailing anyone.
INSERT INTO config (code, number) VALUES ('APPROVAL_WARNING_EMAIL_DAYS', 2)
    ON CONFLICT (code) DO NOTHING;

-- Event this many days away -> red, and pinned to the top of the inbox.
-- Must stay BELOW the warning threshold or red would fire before amber; the
-- policies page enforces that on save.
INSERT INTO config (code, number) VALUES ('APPROVAL_URGENT_DAYS', 2)
    ON CONFLICT (code) DO NOTHING;

INSERT INTO config (code, number) VALUES ('APPROVAL_URGENT_EMAIL_DAYS', 1)
    ON CONFLICT (code) DO NOTHING;

-- Minutes past a task's own deadline before it counts as late. Absorbs the
-- ordinary gap between finishing work and recording it.
INSERT INTO config (code, number) VALUES ('TASK_GRACE_MINUTES', 5)
    ON CONFLICT (code) DO NOTHING;


-- --------------------------------------------------------------------------
-- 2. Overdue request statuses
--
-- One per approval stage, so the status answers "who was this waiting on".
-- department_review gets a single value because the stage blocks as a unit;
-- WHICH departments failed to respond is recorded in reviewer_comment, since
-- several run in parallel and naming all of them would blame the ones that
-- did respond on time.
-- --------------------------------------------------------------------------

ALTER TABLE request DROP CONSTRAINT IF EXISTS chk_request_status;
ALTER TABLE request ADD CONSTRAINT chk_request_status CHECK (status IN (
    'draft','submitted','hos_hod_review','fmb_review','cfo_review',
    'department_review','resubmission_required',
    'completed_approved','completed_rejected','cancelled',
    'overdue_hos_hod','overdue_fmb','overdue_cfo','overdue_department'
));


-- --------------------------------------------------------------------------
-- 3. Task lateness
--
-- is_overdue is a FACT ABOUT THE WORK, not a state in the task's lifecycle,
-- which is why it is a flag beside status rather than a status value:
--
--     completed + is_overdue=false   done, on time
--     completed + is_overdue=true    done, but late      <- needs both facts
--     preparing + is_overdue=true    still open and late, staff can still act
--
-- overdue_at records WHEN it tipped over, so "how late was it" is answerable
-- later without recomputing a deadline whose config may since have changed.
-- --------------------------------------------------------------------------

ALTER TABLE request_task
    ADD COLUMN IF NOT EXISTS is_overdue  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS overdue_at  TIMESTAMP;

-- The daily job scans open tasks only; this keeps that scan off a full table
-- read as completed work accumulates.
CREATE INDEX IF NOT EXISTS idx_request_task_open_overdue
    ON request_task (status)
 WHERE status NOT IN ('completed', 'cancelled');


-- --------------------------------------------------------------------------
-- 4. Escalation ledger
--
-- IDEMPOTENCY IS THE WHOLE DESIGN, exactly as event_reminder_sent is for the
-- event reminders: a daily job that re-read the same rows would re-send the
-- same emails, so every send is recorded and every query excludes what is
-- already due-checked here.
--
-- stage_code IS PART OF THE KEY on purpose. A proposal warned at fmb_review
-- that then moves to cfo_review SHOULD warn again - it is a different person's
-- responsibility now, and inheriting the previous stage's timer would let the
-- new approver's clock start already expired.
--
-- last_sent_at (not a sent/not-sent flag) is what makes "every N days" work:
-- the job re-sends only when now() - last_sent_at exceeds the configured
-- cadence, so changing the cadence takes effect on the next run.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proposal_escalation_sent (
    request_id    BIGINT      NOT NULL REFERENCES request(request_id),
    kind          VARCHAR(20) NOT NULL,   -- 'warning' | 'urgent' | 'overdue'
    stage_code    VARCHAR(40) NOT NULL,
    last_sent_at  TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, kind, stage_code),
    CONSTRAINT chk_escalation_kind CHECK (kind IN ('warning', 'urgent', 'overdue'))
);
