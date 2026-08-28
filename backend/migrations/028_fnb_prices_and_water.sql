-- ============================================================================
-- Migration 028 - F&B rename, menu prices on the existing menu, and the
-- removal of the waterNormal catalogue.
--
-- Four pieces, in the order a rollback would want to unwind them:
--
--   1. rename        - the unit is called "F&B" everywhere it is shown. The
--                      label is data, not code: unit.description is what the
--                      sidebar, the review header, the dashboard title and the
--                      assistant all read, so one UPDATE renames it in all of
--                      them at once.
--   2. menu prices   - migration 010 added fmb_options.unit_price_rm and left
--                      it NULL, correctly: it could not invent what the ten
--                      seeded items cost. But every order placed against them
--                      therefore multiplies out to nothing, so the F&B and CFO
--                      cost cards read RM 0 against 64 real portions. These are
--                      demo menu items with demo prices; the point of pricing
--                      them is that the money columns have something true to
--                      compute from.
--   3. water columns - request_mineral_water.option_id / option_label existed
--                      only because the quantity was picked from a dropdown.
--                      The quantity is now typed in directly, so both columns
--                      describe a choice that is no longer made.
--   4. drop table    - water_normal_options is then unreferenced. Its
--                      available_stock and number_of_bottles went with it, and
--                      so did the two widgets built on them (fmb_water_runway,
--                      fmb_water_meter) - the replacement chart reports what
--                      was REQUESTED, which is the question actually being
--                      asked of it.
--
-- Idempotent throughout: IF EXISTS on every drop, and the price backfill is
-- keyed on the label being unpriced, so re-running it never overwrites a price
-- a manager has since typed in.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Food & Beverage Services -> F&B
-- ---------------------------------------------------------------------------
UPDATE unit
   SET description = 'F&B'
 WHERE code = 'food_beverage_services';


-- ---------------------------------------------------------------------------
-- 2. Prices for the menu items that already exist
--
-- WHERE unit_price_rm IS NULL, so a manager who has already priced an item
-- keeps their number. Matched on label AND unit_code: "Fruit Platter" at one
-- outlet is a different row from the same dish at another, and only the seeded
-- pair should be touched.
-- ---------------------------------------------------------------------------
UPDATE fmb_options AS o
   SET unit_price_rm = v.price
  FROM (VALUES
        ('cafeteria__atrium_cafeteria',  'Nasi Lemak Set',      8.50),
        ('cafeteria__atrium_cafeteria',  'Mee Goreng Mamak',    7.00),
        ('cafeteria__atrium_cafeteria',  'Chicken Rice Box',    9.50),
        ('cafeteria__atrium_cafeteria',  'Assorted Kuih Tray', 45.00),
        ('cafeteria__atrium_cafeteria',  'Teh Tarik Urn',      30.00),
        ('cafeteria__level_3_food_court', 'Sandwich Platter',  55.00),
        ('cafeteria__level_3_food_court', 'Pasta Aglio Olio',  10.00),
        ('cafeteria__level_3_food_court', 'Fruit Platter',     40.00),
        ('cafeteria__level_3_food_court', 'Curry Puff Box',    24.00),
        ('cafeteria__level_3_food_court', 'Fresh Orange Juice', 18.00)
       ) AS v(unit_code, label, price)
 WHERE o.unit_code = v.unit_code
   AND o.label = v.label
   AND o.unit_price_rm IS NULL;


-- ---------------------------------------------------------------------------
-- 3. The mineral-water request no longer points at a catalogue row
--
-- quantity stays and changes meaning: it used to be copied from the chosen
-- option's number_of_bottles, and is now the number the applicant typed. Rows
-- written before this migration already hold a real bottle count, so no
-- backfill is needed - the column means the same thing either way.
-- ---------------------------------------------------------------------------
ALTER TABLE request_mineral_water DROP COLUMN IF EXISTS option_id;
ALTER TABLE request_mineral_water DROP COLUMN IF EXISTS option_label;

-- The typed quantity is a count of bottles and cannot be negative. Enforced in
-- the API too; this is the half that holds when the API is bypassed.
ALTER TABLE request_mineral_water
    DROP CONSTRAINT IF EXISTS chk_mineral_water_quantity_non_negative;

ALTER TABLE request_mineral_water
    ADD CONSTRAINT chk_mineral_water_quantity_non_negative
    CHECK (quantity >= 0);


-- ---------------------------------------------------------------------------
-- 4. The catalogue itself
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS water_normal_options;
