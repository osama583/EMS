-- ============================================================================
-- Migration 042 - align the live Page Visibility grants with the role scopes
-- ai/scope.py now states, so the assistant's answers and the sidebar agree.
--
-- WHY THIS EXISTS. seed/nav.py is the DEFINITION of who sees what, but it only
-- runs on a fresh seed; an existing database carries whatever an administrator
-- has since set by hand at /app/admin/page-visibility. The two had drifted, and
-- the drift is what the 2026-09-01 role sweep surfaced:
--
--   club-admin had `events` and `event-calendar` granted by hand, which
--   seed/nav.py has never granted it (ALL_INTERNAL_ROLES excludes club-admin).
--   A Club Admin administers clubs; it does not browse, register for, or
--   organise events, and the grant made every event question askable for a role
--   with nothing to do with events.
--
--   club-admin was MISSING `inbox`, `history` and the `my-requests` folder in
--   the seed while holding them live - and it genuinely needs them, because the
--   president-change requests it decides are tabs inside those two hubs
--   (records-hub.ts's showPresidentChangeTab), not pages of their own. The seed
--   is corrected in the same commit; this migration is the half an existing
--   database needs.
--
-- WHAT IT DOES NOT DO. It does not touch clubs-discover / clubs-my, which the
-- live database has already had revoked from club-admin (the seed is corrected
-- to match in the same commit), and it does not touch external-user, which
-- correctly holds no nav page at all - an external account never enters the
-- /app shell, and its capabilities live on the public landing page instead
-- (ai/scope.py's VISITOR areas).
--
-- IDEMPOTENT: every statement is a no-op on a database already in this state,
-- so re-running it is safe.
-- ============================================================================

-- --- 1. Revoke the event pages from club-admin ------------------------------
-- Removes the role from the grant ROW rather than deleting the row, which other
-- roles share. A grant left with no roles at all would hide the page from
-- everyone, so the row itself is untouched.
DELETE FROM nav_page_grant_roles
 WHERE role_code = 'club-admin'
   AND grant_id IN (
       SELECT grant_id FROM nav_page_grants WHERE page_code IN ('events', 'event-calendar')
   );

-- --- 2. Grant Inbox / My Requests / History to club-admin -------------------
-- Each page already has a 'role' grant row (cfo and friends), so the role only
-- has to be added to it. The WHERE NOT EXISTS creates the row for a database
-- where it is somehow absent; grant_id is a plain INTEGER rather than a
-- sequence, so the next id is computed - same shape as migrations 025 and 030.
INSERT INTO nav_page_grants (grant_id, page_code, grant_type)
SELECT COALESCE((SELECT MAX(grant_id) FROM nav_page_grants), 0) + row_number() OVER (ORDER BY p.page_code),
       p.page_code, 'role'
  FROM (VALUES ('inbox'), ('my-requests'), ('history')) AS p(page_code)
 WHERE NOT EXISTS (
     SELECT 1 FROM nav_page_grants g
      WHERE g.page_code = p.page_code AND g.grant_type = 'role'
 );

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, 'club-admin'
  FROM nav_page_grants g
 WHERE g.page_code IN ('inbox', 'my-requests', 'history')
   AND g.grant_type = 'role'
ON CONFLICT (grant_id, role_code) DO NOTHING;
