-- AI security reviewer: record what the assistant ANSWERED, not just that it refused.
--
-- Migrations 025/026 built ai_access_denial around refusals the backend made BEFORE generating an
-- answer (Page Visibility said no; nothing classified). The reviewer added in the Text-to-SQL
-- refactor works the other way round: the answer already exists, and an independent model decides
-- after the fact whether it should be released. Logging that decision needs the one thing the
-- table has never held - the generated response itself - because "was this answer acceptable" is
-- unreviewable by an administrator who can only see the question.
--
-- The three reviewer categories (out_of_scope, harmful, unrelated_question) go in the existing
-- `outcome` column rather than a parallel one: an administrator reading /app/admin/ai-access-log
-- is asking a single question - "why did this interaction not go through?" - and splitting the
-- answer across two columns would mean every reader has to know which column to look at for which
-- kind of row. out_of_scope already exists with exactly the reviewer's meaning (on-domain but
-- unsupported), so it is reused rather than duplicated. `reason` is likewise reused: it already
-- holds free text for the outcomes with no page list.
--
--   out_of_scope        (existing, extended) on-domain question the assistant cannot support -
--                       whether detected before generation (nothing classified) or after it
--                       (the reviewer judged the answer a non-answer). Same meaning either way.
--   harmful             (new) the question attempted to manipulate, bypass or exploit the system,
--                       or the answer leaked outside the asker's scope.
--   unrelated_question  (new) nothing to do with this application at all.
--
-- ai_response is nullable because every pre-existing row, and every pre-generation refusal that
-- will keep being written, genuinely has no generated answer to record.

ALTER TABLE ai_access_denial
    ADD COLUMN IF NOT EXISTS ai_response TEXT;

-- Which role the asker held at the time. The user's roles can change afterwards, and an audit row
-- that silently re-reads today's roles would misrepresent the interaction it is recording - so it
-- is snapshotted here, exactly like user_email already is.
ALTER TABLE ai_access_denial
    ADD COLUMN IF NOT EXISTS user_roles VARCHAR(300);

-- The admin page filters by category; `outcome` is already indexed by migration 026, so the three
-- new values need no new index of their own.
