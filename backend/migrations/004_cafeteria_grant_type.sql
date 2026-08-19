-- ============================================================================
-- Migration 004 - add the 'cafeteria' grant type.
--
-- PROBLEM
-- A 'unit_role' grant names units by an explicit list. Every cafeteria outlet is
-- its own unit, so the four pages that only Cafeteria Managers and Cafeteria
-- Staff can see each enumerated every outlet:
--
--     cafeteria-my-staff | unit_role | roles=[cafeteria-manager]
--                        | units=[cafeteria__atrium_cafeteria,
--                                 cafeteria__level_3_food_court]
--
-- Creating a new outlet therefore made it invisible until an admin hand-edited
-- every one of those lists. The failure is silent: nothing errors, the new
-- outlet's manager simply logs in to an empty sidebar. That had already happened
-- to cafeteria__test1, which existed in zero grants.
--
-- SOLUTION
-- A grant type that names the GROUP rather than its current members. A
-- 'cafeteria' grant carries roles only; it matches any of those roles held in
-- any unit whose code starts with 'cafeteria__'. New outlets are covered the
-- moment they exist, with no backfill and nothing to run on create or delete.
--
-- The prefix is assigned server-side by the cafeteria create endpoint
-- (app/api/cafeterias.py CAFETERIA_PREFIX), so "code starts with cafeteria__"
-- and "is a cafeteria" are the same statement.
--
-- Every cafeteria manager sees exactly the same pages as every other cafeteria
-- manager, and likewise for staff, so the enumerated list was never expressing a
-- per-outlet decision - it was restating "all of them" and going stale.
-- ============================================================================

ALTER TABLE nav_page_grants
    DROP CONSTRAINT IF EXISTS chk_nav_page_grants_type;

ALTER TABLE nav_page_grants
    ADD CONSTRAINT chk_nav_page_grants_type
    CHECK (grant_type IN ('role', 'unit_role', 'unit', 'cafeteria'));

-- Convert the grants that exist only to serve cafeteria staff. Each already
-- listed every outlet, so switching to the group changes who can see the page
-- today for exactly one user set: nobody. It only changes what happens next time
-- an outlet is created.
--
-- Scoped by page_code rather than "any grant mentioning a cafeteria unit": the
-- shared pages (inbox, events, dashboard...) also list cafeteria units, but they
-- list every department too and mean "everyone", not "cafeteria staff". Folding
-- those into a cafeteria grant would drop their departmental audience.
UPDATE nav_page_grants
   SET grant_type = 'cafeteria'
 WHERE archived_at IS NULL
   AND grant_type = 'unit_role'
   AND page_code IN (
        'my-cafeteria-folder',
        'menu',
        'cafeteria-my-staff',
        'cafeteria-my-staff-history'
   );

-- A 'cafeteria' grant carries no unit links: the prefix decides membership, and
-- a stale list left behind would be misleading to anyone reading the row.
DELETE FROM nav_page_grant_units
 WHERE grant_id IN (
        SELECT grant_id FROM nav_page_grants WHERE grant_type = 'cafeteria'
 );
