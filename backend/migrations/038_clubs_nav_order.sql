-- ============================================================================
-- Migration 038 - Discover Clubs sorts above My Clubs.
--
-- Discovering a club has to come before the list of clubs you already belong
-- to: a member with no clubs yet opens the folder and the first thing they see
-- should be the page that lets them join one, not an empty "My Clubs".
--
-- seed/nav.py already carries the new order, so a FRESH seed is correct without
-- this file. This block is what gives an EXISTING database the swap - nav lives
-- in nav_page rows, and the seed never rewrites a row it did not just create.
--
-- Written as one UPDATE ... FROM (VALUES ...) rather than two statements
-- because sort_order has no unique constraint: two sequential UPDATEs would
-- briefly leave both pages on the same number, which is harmless here but is
-- exactly the kind of transient state a later constraint would trip over.
--
-- Scoped to parent_page_code = 'manage-clubs' so it can never touch a page that
-- happens to share a sort_order under a different folder.
-- ============================================================================

UPDATE nav_page AS p
   SET sort_order = v.sort_order
  FROM (VALUES ('clubs-discover', 1), ('clubs-my', 2)) AS v(page_code, sort_order)
 WHERE p.page_code = v.page_code
   AND p.parent_page_code = 'manage-clubs';
