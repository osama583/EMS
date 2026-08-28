-- AI access log: record WHY the assistant did not answer, not just page denials.
--
-- ai_access_denial (025) recorded exactly one kind of refusal: Page Visibility does not grant the
-- caller the pages a topic's data lives on. That answered "who was blocked", but not the question
-- the admin page actually needs to answer - "why did the assistant not answer this?" - because a
-- question the router simply never matched was written nowhere at all. From the log's point of
-- view an unsupported question and a perfectly-answered one were indistinguishable, so there was
-- no way to tell a permissions problem (fix the grant) from a capability gap (write the feature).
--
-- outcome values:
--   page_denied         Page Visibility does not grant the topic's pages. The only kind that
--                       existed before this migration, hence the DEFAULT - every pre-existing row
--                       is exactly this and is backfilled correctly by it.
--   how_to_page_denied  The caller asked how to DO something whose action page is not theirs.
--                       Distinct from page_denied because the fix is different: it is about one
--                       action's page, not a whole data topic.
--   out_of_scope        Nothing matched. The question is outside clubs/events/system/how-to.
--   unsupported         A how-to shape with no guide behind it yet. The most actionable row here:
--                       it names the guide somebody should write.
--
-- The three topic columns become nullable because an out_of_scope/unsupported refusal genuinely
-- has no topic - there was no classification to record. Forcing a placeholder string would make
-- the column lie, and every reader would have to know the placeholder.
--
-- The table keeps its name. "denial" is now slightly narrow for what it holds, but it is
-- referenced by app/api/admin.py, app/ai/admin_retrieval.py, app/ai/topic_access.py and the
-- frontend service - renaming buys nothing and touches four more files for a cosmetic gain.

ALTER TABLE ai_access_denial
    ADD COLUMN IF NOT EXISTS outcome VARCHAR(30) NOT NULL DEFAULT 'page_denied';

ALTER TABLE ai_access_denial
    ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE ai_access_denial ALTER COLUMN topic          DROP NOT NULL;
ALTER TABLE ai_access_denial ALTER COLUMN topic_label    DROP NOT NULL;
ALTER TABLE ai_access_denial ALTER COLUMN required_pages DROP NOT NULL;

-- The admin page filters/groups by outcome, and the AI's own "what have you refused" answer
-- (admin_retrieval.ai_denials_document) reads the newest rows per outcome.
CREATE INDEX IF NOT EXISTS ix_ai_access_denial_outcome ON ai_access_denial (outcome);
