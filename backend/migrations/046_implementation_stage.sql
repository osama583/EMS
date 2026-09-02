-- ============================================================================
-- Migration 045 - the implementation stage.
--
-- department_review used to cover two phases with two different owners: the
-- departments deciding (managers approve and assign), and the staff carrying
-- the work out. An applicant saw "Department review" long after every manager
-- had approved, and the event stayed out of Explore until the last staff
-- member ticked their final row.
--
-- 'implementation' names the second half. A request enters it once no
-- department task is 'pending' or 'resubmitted' AND no cafeteria order is
-- still awaiting its manager - F&B and the cafeteria are both departments
-- deciding, so their hand-off belongs to the first half.
--
-- From implementation the event is PUBLISHED (see _published_clause in
-- api/events.py) and registration opens. Nothing sends a request back out of
-- it: send_task_back and send_selection_back both refuse there.
-- ============================================================================

ALTER TABLE request DROP CONSTRAINT IF EXISTS chk_request_status;
ALTER TABLE request ADD CONSTRAINT chk_request_status CHECK (status IN (
    'draft', 'submitted', 'hos_hod_review', 'fmb_review', 'cfo_review',
    'department_review', 'implementation', 'resubmission_required',
    'completed_approved', 'completed_rejected', 'cancelled',
    'overdue_hos_hod', 'overdue_fmb', 'overdue_cfo', 'overdue_department'
));

-- Backfill: every request already past the deciding half. Mirrors
-- recompute_department_phase() so old and new requests agree on the rule.
--
-- The first EXISTS carries two jobs at once: it proves the request HAS
-- department tasks, and that at least one is still live. A request whose tasks
-- were all terminal would already have auto-completed, so it must not land
-- here.
UPDATE request r
   SET status = 'implementation', updated_at = now()
 WHERE r.status = 'department_review'
   AND EXISTS (SELECT 1 FROM request_task t
                WHERE t.request_id = r.request_id
                  AND t.stage_code = 'department_review'
                  AND t.status NOT IN ('completed', 'cancelled'))
   AND NOT EXISTS (SELECT 1 FROM request_task t
                    WHERE t.request_id = r.request_id
                      AND t.stage_code = 'department_review'
                      AND t.status IN ('pending', 'resubmitted'))
   AND NOT EXISTS (SELECT 1 FROM request_fmb_selection s
                     JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                    WHERE f.request_id = r.request_id
                      AND s.status IN ('pending', 'resubmitted'));
