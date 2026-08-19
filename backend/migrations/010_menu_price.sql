-- ============================================================================
-- Migration 010 - a menu item has a price.
--
-- fmb_options carried a serving unit, dietary tags and ordering notes but no
-- price, so a cafeteria menu could not say what anything costs and an event's
-- food budget had nothing to compute from.
--
-- NUMERIC(10,2), matching request_funding_purchase.unit_price_rm and
-- request.cost_amount - money is never stored as a float, where 0.1 + 0.2 is
-- not 0.3 and a total drifts from the sum of its lines.
--
-- Nullable rather than DEFAULT 0: the ten existing menu items genuinely have no
-- price recorded, and zero would claim they are free. "Not priced yet" and
-- "free" are different facts and the column has to be able to tell them apart.
--
-- Non-negative is enforced here as well as in the API, because the database is
-- the only place that holds when the API is bypassed.
-- ============================================================================

ALTER TABLE fmb_options
    ADD COLUMN IF NOT EXISTS unit_price_rm NUMERIC(10, 2);

ALTER TABLE fmb_options
    DROP CONSTRAINT IF EXISTS chk_fmb_options_price_non_negative;

ALTER TABLE fmb_options
    ADD CONSTRAINT chk_fmb_options_price_non_negative
    CHECK (unit_price_rm IS NULL OR unit_price_rm >= 0);
