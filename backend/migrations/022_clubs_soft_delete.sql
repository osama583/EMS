-- Clubs join the shared soft-delete convention (2026-08-25).
--
-- Every other admin-managed entity (users, unit, role, nav_page, club_categories, and every
-- *_options catalogue) already carries archived_at: delete stamps it after a dependency check,
-- restore clears it, and a sweep permanently removes rows older than the retention window.
-- `clubs` was the one outlier - DELETE /clubs/{id} hard-deleted the row and manually cascaded
-- away its category links, join requests and members, so a mis-click destroyed the roster and
-- the entire join history with no way back.
--
-- Column semantics match users' exactly: archived_at NULL = live, non-NULL = in the bin. `active`
-- already exists on clubs and stays what it has always been - the deactivate toggle, which hides
-- the club from discovery without deleting it. The two are independent: deleting also flips
-- active FALSE (so an archived club can never appear anywhere as live), but deactivating alone
-- never sets archived_at.
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;

-- Every club listing filters on `archived_at IS NULL`, so the bin never leaks into normal reads.
-- Partial index: the live set is the hot path and stays small even as archived rows accumulate.
CREATE INDEX IF NOT EXISTS ix_clubs_live ON clubs (club_id) WHERE archived_at IS NULL;

-- The purge sweep scans for rows past the retention window across every soft-deletable table;
-- this keeps that scan from sequentially reading the whole table on each run.
CREATE INDEX IF NOT EXISTS ix_clubs_archived_at ON clubs (archived_at) WHERE archived_at IS NOT NULL;
