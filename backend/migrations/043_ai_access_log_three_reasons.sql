-- Six outcomes down to four, and the conversation that makes a refused question judgeable.
--
-- WHY. The log ran for three days and produced 93 rows, and the categories did not survive it:
--   out_of_scope       42 rows (45%), of which 17 were `SQL pipeline failed: Did not converge` -
--                      retrieval crashes on perfectly ordinary questions ("what are the events im
--                      registered to ?"), filed as though somebody had been told no on purpose;
--   unsupported        16 rows, 11 of them the name resolver missing a function that exists
--                      (save_event, register_event, manage_clubs);
--   page_denied        24 rows, including "are you freaking stupid" and "no i wont login" - the
--                      conversation continuing, logged as fresh permission decisions;
--   harmful             4 rows, all four false positives, every one a quality complaint about an
--                      answer rather than an attack.
-- So the single question an administrator opens this page to ask - is the assistant refusing
-- correctly, or is it broken? - could not be read off it.
--
-- THE FOUR. Three say why a question was REFUSED, and the fourth says it was not refused at all:
--   no_access       they asked for something in this system and cannot have it - their role does
--                   not reach it, or nobody does. One category for both, because to an
--                   administrator they are one fact. The asker still hears two different
--                   sentences; that distinction lives in the wording, not in the log.
--   harmful         an attempt on the assistant itself: injection, "ignore your instructions",
--                   probing the schema, claiming authority, pushing after a refusal. INTENT is the
--                   test, not subject matter - wanting a roster you cannot have is no_access.
--   unrelated       nothing to do with this app.
--   system_failure  NOT a refusal. The assistant meant to answer and broke.
--
-- CONVERSATION CONTEXT. The single largest reason the old rows cannot be judged: a question is
-- stored alone. "u do not know ?" and "no i wont login" are meaningless by themselves and obvious
-- with the turn before them, and the difference between curiosity and pressure is only ever
-- visible across turns. Backfilled as NULL, which reads as "opening turn, or logged before this
-- column existed" - both true of every existing row.

ALTER TABLE ai_access_denial
    ADD COLUMN IF NOT EXISTS conversation_context TEXT;

-- Remap in dependency order. The two pipeline/resolver rules run FIRST, because they are carved
-- out of out_of_scope and unsupported respectively and would otherwise be swept into no_access by
-- the broader rules below.
UPDATE ai_access_denial
   SET outcome = 'system_failure'
 WHERE outcome IN ('out_of_scope', 'unsupported')
   AND (reason ILIKE '%pipeline failed%'
     OR reason ILIKE '%no matching guide%'
     OR reason ILIKE '%matching no function%'
     OR reason ILIKE '%matches no area%'
     OR reason ILIKE '%matches no page%');

UPDATE ai_access_denial
   SET outcome = 'no_access'
 WHERE outcome IN ('page_denied', 'how_to_page_denied', 'out_of_scope', 'unsupported');

UPDATE ai_access_denial
   SET outcome = 'unrelated'
 WHERE outcome = 'unrelated_question';

-- `harmful` keeps its name and its four rows. They are false positives, and they stay: rewriting
-- an audit trail to look better than it was is worse than a wrong row, and the fixed reviewer
-- prompt is what stops the next four being wrong.

-- Fail closed on anything unrecognised from here on, so a typo'd outcome cannot quietly become a
-- category the admin page does not filter and nobody ever sees.
ALTER TABLE ai_access_denial
    DROP CONSTRAINT IF EXISTS chk_ai_access_denial_outcome;
ALTER TABLE ai_access_denial
    ADD CONSTRAINT chk_ai_access_denial_outcome
    CHECK (outcome IN ('no_access', 'harmful', 'unrelated', 'system_failure'));

CREATE INDEX IF NOT EXISTS ix_ai_access_denial_outcome
    ON ai_access_denial (outcome);
