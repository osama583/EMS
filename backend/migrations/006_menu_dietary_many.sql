-- ============================================================================
-- Migration 006 - a menu item carries one OR MORE dietary tags.
--
-- fmb_options.dietary_information_option_id is a single NOT NULL FK, so a dish
-- can be tagged "Vegetarian" or "Nut-free" but never both - which real menu
-- items routinely are.
--
-- Modelled as a junction table rather than an array column: the tag is an
-- entity in dietary_information_options with its own lifecycle, and a real FK
-- per pairing is what stops an item from referencing a tag that was deleted.
-- ON DELETE CASCADE on the option side means removing a menu item takes its
-- pairings with it; the tag side is left to the FK's default (RESTRICT), so a
-- dietary tag still in use cannot be deleted out from under a menu.
--
-- The old column is dropped in the same migration. Keeping it as a "primary
-- tag" alongside the table would leave two places stating the same fact, and
-- they would drift the first time anyone wrote to only one of them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fmb_option_dietary_information (
    fmb_option_id                 BIGINT NOT NULL
        REFERENCES fmb_options(fmb_option_id) ON DELETE CASCADE,
    dietary_information_option_id  BIGINT NOT NULL
        REFERENCES dietary_information_options(dietary_information_option_id),
    PRIMARY KEY (fmb_option_id, dietary_information_option_id)
);

-- Carry every existing pairing across before the column goes, so no menu item
-- silently loses the tag it already had.
INSERT INTO fmb_option_dietary_information (fmb_option_id, dietary_information_option_id)
SELECT fmb_option_id, dietary_information_option_id
  FROM fmb_options
 WHERE dietary_information_option_id IS NOT NULL
    ON CONFLICT DO NOTHING;

ALTER TABLE fmb_options DROP COLUMN dietary_information_option_id;

-- Listing a cafeteria's menu reads every item's tags at once; without this the
-- junction is scanned per item.
CREATE INDEX IF NOT EXISTS idx_fmb_option_dietary_option
    ON fmb_option_dietary_information (fmb_option_id);
