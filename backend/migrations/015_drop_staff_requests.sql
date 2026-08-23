-- ============================================================================
-- Migration 015 - Remove the cafeteria staff request/approval workflow.
--
-- The Manager -> Admin approval chain (migrations 001, 007, 009, 011) is
-- retired: a Cafeteria Manager may now create, edit, suspend/restore, and
-- remove their own cafeteria's staff directly (backend/app/api/cafeterias.py
-- assignment endpoints), the same write path Cafeteria Admin already used.
-- There is nothing left to approve, so no approval table/status/history is
-- kept for this workflow.
--
-- Drops, in dependency order: the nav rows for the two Admin-facing pages
-- this workflow had (Staff Requests, Staff Request History), the Manager's
-- now-pointless request-history page, then the table itself.
-- ============================================================================

DELETE FROM nav_page_grant_roles WHERE grant_id IN (
    SELECT grant_id FROM nav_page_grants WHERE page_code IN (
        'cafeteria-staff-requests', 'cafeteria-staff-requests-history', 'cafeteria-my-staff-history'
    )
);
DELETE FROM nav_page_grants WHERE page_code IN (
    'cafeteria-staff-requests', 'cafeteria-staff-requests-history', 'cafeteria-my-staff-history'
);
DELETE FROM nav_page WHERE page_code IN (
    'cafeteria-staff-requests', 'cafeteria-staff-requests-history', 'cafeteria-my-staff-history'
);

DROP TABLE IF EXISTS cafeteria_staff_requests;
