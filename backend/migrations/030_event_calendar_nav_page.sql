-- ============================================================================
-- Migration 030 - the master Event Calendar gets its nav page.
--
-- The page itself (/app/event-calendar) is a new internal surface showing every
-- event that has reached department_review or completed_approved, university
-- wide. Like every other internal page its ACCESS is governed by nav_page /
-- nav_page_grants rather than anything hardcoded in the client, so it also shows
-- up in Page Visibility (/app/admin/page-visibility) for an admin to retune.
--
-- Also added to seed/nav.py so a fresh seed creates it; this block is what gives
-- an EXISTING database the page without a reseed.
--
-- WHO GETS IT. Deliberately broad - every internal role, plus Cafeteria Managers
-- (scoped to real cafeteria units, never every unit). A broad PAGE grant is not
-- a broad DATA grant: which events a viewer actually sees, and in how much
-- detail, is decided per row server-side in app/api/events.py's master_calendar()
--   * Public / Internal -> full detail
--   * Club Only         -> full detail for members of the named club(s) only;
--                          everyone else gets a redacted placeholder
--   * Private           -> never sent as a row at all, only a per-date count
--   * CFO and the F&B head bypass all of the above by design (requirement 4)
-- so granting the page widely exposes nothing that the row rules would not.
--
-- grant_id is a plain INTEGER (not a sequence), so the next id is computed
-- rather than defaulted - same shape as migration 025.
-- ============================================================================

INSERT INTO nav_page (page_code, label, entry_type, icon, route_path, parent_page_code, sort_order)
VALUES ('event-calendar', 'Event Calendar', 'page', 'calendar_month',
        '/app/event-calendar', 'events', 3)
ON CONFLICT (page_code) DO NOTHING;

-- Grant 1 - the flat (unit-less) internal roles.
INSERT INTO nav_page_grants (grant_id, page_code, grant_type)
SELECT COALESCE((SELECT MAX(grant_id) FROM nav_page_grants), 0) + 1,
       'event-calendar', 'role'
WHERE NOT EXISTS (
    SELECT 1 FROM nav_page_grants
     WHERE page_code = 'event-calendar' AND grant_type = 'role'
);

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, r.role_code
  FROM nav_page_grants g
  CROSS JOIN (VALUES ('cfo'), ('cafeteria-admin'), ('system-admin')) AS r(role_code)
 WHERE g.page_code = 'event-calendar' AND g.grant_type = 'role'
ON CONFLICT (grant_id, role_code) DO NOTHING;

-- Grant 2 - the unit-scoped roles, across every unit. Written as unit_role
-- (roles x units) rather than a bare 'unit' grant because cafeteria-manager is
-- granted separately below against cafeteria units only.
INSERT INTO nav_page_grants (grant_id, page_code, grant_type)
SELECT COALESCE((SELECT MAX(grant_id) FROM nav_page_grants), 0) + 1,
       'event-calendar', 'unit_role'
WHERE NOT EXISTS (
    SELECT 1 FROM nav_page_grants
     WHERE page_code = 'event-calendar' AND grant_type = 'unit_role'
);

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, r.role_code
  FROM nav_page_grants g
  CROSS JOIN (VALUES ('head-of-school'), ('head-of-department'), ('lecturer'),
                     ('staff'), ('student'), ('cafeteria-staff'),
                     ('cafeteria-manager')) AS r(role_code)
 WHERE g.page_code = 'event-calendar' AND g.grant_type = 'unit_role'
ON CONFLICT (grant_id, role_code) DO NOTHING;

-- Every unit that exists, resolved from the table rather than enumerated - an
-- enumerated list is exactly what went stale before and left new units without
-- access.
INSERT INTO nav_page_grant_units (grant_id, unit_code)
SELECT g.grant_id, u.code
  FROM nav_page_grants g
  CROSS JOIN unit u
 WHERE g.page_code = 'event-calendar' AND g.grant_type = 'unit_role'
ON CONFLICT (grant_id, unit_code) DO NOTHING;
