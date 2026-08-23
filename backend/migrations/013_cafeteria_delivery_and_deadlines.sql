-- ============================================================================
-- Migration 013 - cafeteria delivery confirmation (photo proof) + a 'ready'
-- status between claim and delivery.
--
-- Staff-facing lifecycle becomes: approved -> preparing (claim, "Start
-- Preparing") -> ready ("Done Preparing") -> fulfilled ("Delivered", requires
-- delivery_photo_url). The DB value stays 'fulfilled' - F&B's existing
-- read-only order-status view (proposal-department-view.ts) already renders
-- that value and is untouched by this migration; only the staff-facing UI
-- copy calls it "Delivered".
-- ============================================================================

ALTER TABLE request_fmb_selection
    DROP CONSTRAINT chk_fmb_selection_status,
    ADD CONSTRAINT chk_fmb_selection_status
        CHECK (status IN ('pending', 'approved', 'resubmitted', 'preparing', 'ready', 'fulfilled', 'cancelled'));

ALTER TABLE request_fmb_selection
    ADD COLUMN IF NOT EXISTS delivery_photo_url VARCHAR(255),
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
