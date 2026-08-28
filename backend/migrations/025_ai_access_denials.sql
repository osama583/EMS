-- Audit log of every chat question refused by the Page Visibility check
-- (app/ai/topic_access.py). One row per denied topic per question, so a single
-- question touching two blocked topics logs two rows - the point of this table
-- is "who tried to reach what", and collapsing that loses which topic was the
-- one they actually wanted.
--
-- Reviewed by a System Admin at /app/admin/ai-access-log (nav page
-- 'admin-ai-access-log'). Rows are kept indefinitely and cleared manually from
-- that page - there is no automatic retention window, deliberately: this is an
-- access-audit trail, and silently ageing entries out would defeat the reason
-- for keeping it.
--
-- user_id is nullable: a signed-out guest asking a gated question is a real,
-- loggable denial, and has no user row to reference. The FK is intentionally
-- NOT ON DELETE CASCADE - a deleted user's past access attempts stay in the
-- audit trail; users are soft-deleted (archived_at) anyway, so this only
-- matters for a genuine hard delete.
CREATE TABLE IF NOT EXISTS ai_access_denial (
    denial_id      BIGSERIAL PRIMARY KEY,
    user_id        BIGINT NULL REFERENCES users(user_id),
    user_email     VARCHAR(150),          -- snapshot, so the log stays readable if the account goes
    topic          VARCHAR(60)  NOT NULL, -- query_router class, e.g. 'clubs_admin'
    topic_label    VARCHAR(100) NOT NULL, -- human-readable, e.g. 'club administration'
    required_pages TEXT         NOT NULL, -- comma-separated page_codes any ONE of which would have allowed it
    question       TEXT         NOT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT now()
);

-- The page lists newest-first and filters by user/topic/question text.
CREATE INDEX IF NOT EXISTS ix_ai_access_denial_created_at
    ON ai_access_denial (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ai_access_denial_user_id
    ON ai_access_denial (user_id);


-- The nav page that shows this log, System-Admin-only. Also added to
-- seed/nav.py so a fresh seed creates it; this block is what gives an EXISTING
-- database the page without a reseed. grant_id is a plain INTEGER (not a
-- sequence), so the next id is computed rather than defaulted.
INSERT INTO nav_page (page_code, label, entry_type, icon, route_path, parent_page_code, sort_order)
VALUES ('admin-ai-access-log', 'AI Access Log', 'page', 'gpp_maybe',
        '/app/admin/ai-access-log', 'admin-directory', 4)
ON CONFLICT (page_code) DO NOTHING;

INSERT INTO nav_page_grants (grant_id, page_code, grant_type)
SELECT COALESCE((SELECT MAX(grant_id) FROM nav_page_grants), 0) + 1,
       'admin-ai-access-log', 'role'
WHERE NOT EXISTS (
    SELECT 1 FROM nav_page_grants
     WHERE page_code = 'admin-ai-access-log' AND grant_type = 'role'
);

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, 'system-admin'
  FROM nav_page_grants g
 WHERE g.page_code = 'admin-ai-access-log' AND g.grant_type = 'role'
ON CONFLICT (grant_id, role_code) DO NOTHING;
