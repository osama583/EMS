-- ============================================================================
-- Migration 005 - finish what 004 started: the SHARED pages.
--
-- PROBLEM
-- 004 converted the four cafeteria-only pages, but cafeteria staff also reach
-- pages they share with departments. Those rows list roles AND units together:
--
--     inbox | unit_role
--       roles = [cafeteria-manager, head-of-department, ..., student]
--       units = [2 cafeterias] + [8 departments]
--
-- The cafeteria half goes stale exactly like the pages 004 fixed. Measured
-- against the live database before this migration:
--
--     cafeteria-manager  existing outlet: 8 pages   new outlet: 4
--                        lost: history, inbox, my-requests, ongoing
--     cafeteria-staff    existing outlet: 2 pages   new outlet: 0
--                        lost: events, explore-events
--
-- A new outlet's staff saw NOTHING at all.
--
-- WHY NOT JUST CONVERT THE ROW
-- These rows serve departments too, and a page holds at most one grant per
-- type. Turning the row into 'cafeteria' would strip every lecturer, student
-- and head of department. So each row is SPLIT: the departmental audience stays
-- in the unit_role row, and the cafeteria roles move to a new 'cafeteria' row
-- on the same page. The two sets are disjoint, so nobody's access changes.
--
-- Note events/explore-events grant cafeteria-STAFF while the rest grant
-- cafeteria-MANAGER. That asymmetry is preserved exactly - it is a real access
-- decision, not an inconsistency to tidy up.
--
-- After this, no grant enumerates a cafeteria unit anywhere, and a new outlet
-- needs no page-visibility edit at all.
-- ============================================================================

-- 1. Create a 'cafeteria' grant on every page whose unit_role row mixes
--    cafeteria roles with cafeteria units. Skips pages that already have one
--    (none today, but this keeps the migration honest if re-derived).
INSERT INTO nav_page_grants (page_code, grant_type, is_active)
SELECT DISTINCT g.page_code, 'cafeteria', TRUE
  FROM nav_page_grants g
  JOIN nav_page_grant_roles gr ON gr.grant_id = g.grant_id
  JOIN nav_page_grant_units gu ON gu.grant_id = g.grant_id
 WHERE g.grant_type = 'unit_role'
   AND g.archived_at IS NULL
   AND gr.role_code LIKE 'cafeteria-%'
   AND gu.unit_code LIKE 'cafeteria\_\_%'
   AND NOT EXISTS (
        SELECT 1 FROM nav_page_grants x
         WHERE x.page_code = g.page_code
           AND x.grant_type = 'cafeteria'
           AND x.archived_at IS NULL
   );

-- 2. Move each page's cafeteria roles onto its new 'cafeteria' grant, keeping
--    per-page role sets distinct (manager on inbox, staff on events).
INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT DISTINCT caf.grant_id, gr.role_code
  FROM nav_page_grants caf
  JOIN nav_page_grants src
    ON src.page_code = caf.page_code
   AND src.grant_type = 'unit_role'
   AND src.archived_at IS NULL
  JOIN nav_page_grant_roles gr ON gr.grant_id = src.grant_id
 WHERE caf.grant_type = 'cafeteria'
   AND caf.archived_at IS NULL
   AND gr.role_code LIKE 'cafeteria-%'
   AND NOT EXISTS (
        SELECT 1 FROM nav_page_grant_roles x
         WHERE x.grant_id = caf.grant_id AND x.role_code = gr.role_code
   );

-- 3. Drop the cafeteria roles from the unit_role rows - they are served by the
--    cafeteria grant now, and leaving them would imply the enumerated unit list
--    still governs cafeteria access.
DELETE FROM nav_page_grant_roles gr
 USING nav_page_grants g
 WHERE gr.grant_id = g.grant_id
   AND g.grant_type = 'unit_role'
   AND g.archived_at IS NULL
   AND gr.role_code LIKE 'cafeteria-%';

-- 4. Drop cafeteria UNITS from unit_role rows. No cafeteria role remains on
--    them, so these entries can only mislead: a department role can never be
--    held in a cafeteria unit, making the pairing unreachable.
DELETE FROM nav_page_grant_units gu
 USING nav_page_grants g
 WHERE gu.grant_id = g.grant_id
   AND g.grant_type = 'unit_role'
   AND g.archived_at IS NULL
   AND gu.unit_code LIKE 'cafeteria\_\_%';

-- 5. A unit_role row stripped of every role (or every unit) matches nobody and
--    is just clutter on the Permissions tab. None exist today - every affected
--    row keeps its departmental audience - but a page whose ONLY audience was
--    cafeteria roles would end up empty, and an empty row reads as a mistake.
DELETE FROM nav_page_grants g
 WHERE g.grant_type = 'unit_role'
   AND g.archived_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM nav_page_grant_roles r WHERE r.grant_id = g.grant_id)
   AND NOT EXISTS (SELECT 1 FROM nav_page_grant_units u WHERE u.grant_id = g.grant_id);
