-- ============================================================================
-- Migration 011 - Staff Requests gets its own pages.
--
-- The Cafeteria Admin's queue of pending Manager requests lived as a panel
-- stapled to the top of Staff Assignments, which made it invisible until you
-- navigated to a page about something else, and gave it no room for the
-- filtering, paging and card/table views every other list surface has.
--
-- Two pages, matching how the rest of the app splits work from record:
--   cafeteria-staff-requests           - pending, the queue you act on
--   cafeteria-staff-requests-history   - approved/rejected, the record
--
-- Registered here rather than hard-coded in the sidebar because visibility is
-- data: an Admin can retarget or disable them from Page Visibility like any
-- other page, and they are covered by the same grant machinery.
--
-- Granted with the 'cafeteria' type only where it makes sense. Deciding a
-- request is cafeteria-admin's alone (a flat role, so a plain 'role' grant),
-- and migration 005's rule holds: nothing enumerates a cafeteria unit.
-- ============================================================================

INSERT INTO nav_page (page_code, label, entry_type, icon, route_path, parent_page_code, sort_order, is_active)
VALUES
    ('cafeteria-staff-requests', 'Staff Requests', 'page', 'inbox',
     '/app/cafeterias/staff-requests', 'cafeteria-admin-folder', 3, TRUE),
    ('cafeteria-staff-requests-history', 'Staff Request History', 'page', 'history',
     '/app/cafeterias/staff-requests-history', 'cafeteria-admin-folder', 4, TRUE)
ON CONFLICT (page_code) DO NOTHING;

-- Cafeteria Admin is a flat role (no unit), so this is a 'role' grant - the
-- same shape the folder's other pages already use.
INSERT INTO nav_page_grants (page_code, grant_type, is_active)
SELECT p.page_code, 'role', TRUE
  FROM (VALUES ('cafeteria-staff-requests'), ('cafeteria-staff-requests-history')) AS p(page_code)
 WHERE NOT EXISTS (
        SELECT 1 FROM nav_page_grants g
         WHERE g.page_code = p.page_code AND g.grant_type = 'role' AND g.archived_at IS NULL
 );

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, 'cafeteria-admin'
  FROM nav_page_grants g
 WHERE g.page_code IN ('cafeteria-staff-requests', 'cafeteria-staff-requests-history')
   AND g.grant_type = 'role'
   AND g.archived_at IS NULL
   AND NOT EXISTS (
        SELECT 1 FROM nav_page_grant_roles r
         WHERE r.grant_id = g.grant_id AND r.role_code = 'cafeteria-admin'
 );
