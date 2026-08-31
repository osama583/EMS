-- ============================================================================
-- Migration 040 - a club remembers who came and went.
--
-- club_members is a snapshot, not a history: (club_id, user_id, date_joined)
-- with a composite PK, and leaving DELETEs the row. Once someone left, nothing
-- anywhere recorded that they had ever been a member - not the table, not
-- audit(), which writes to a log file the application cannot query. That made
-- two things impossible to build: Previous Clubs (the clubs I used to belong
-- to) and the President's member log (who joined, who left, who handed over).
--
-- WHY ONLY MEMBERSHIP LIVES HERE. The President's log has three tabs, and the
-- other two already have real sources:
--   * Events   - request_clubs JOIN request, every proposal addressed to the
--                club, with its real submitted_at.
--   * Requests - club_join_requests and club_president_change_requests, both
--                of which already carry created_at and resolved_at.
-- Copying those into a log would create a second, drifting version of a fact
-- the database already holds. Only membership transitions have no source, so
-- only they are recorded here.
--
-- BACKFILL. The 'joined' rows below are copied from club_members.date_joined -
-- a real recorded date, not a reconstruction. Departures are NOT backfilled and
-- cannot be: nothing recorded them. So the log is complete from today forward,
-- and before today it knows arrivals only. A club whose members have all stayed
-- therefore has a truthful, complete log immediately; one that has seen people
-- leave will look like nobody ever left until someone does.
--
-- occurred_at is a TIMESTAMP while date_joined is a DATE, so a backfilled row
-- lands at midnight of the day it happened. That is the precision the source
-- had; inventing a time of day would be inventing data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS club_membership_log (
    club_membership_log_id  BIGSERIAL PRIMARY KEY,
    club_id                 BIGINT NOT NULL REFERENCES clubs(club_id),
    -- Who the entry is ABOUT. Never null: every transition happens to someone.
    subject_user_id         BIGINT NOT NULL REFERENCES users(user_id),
    -- Who caused it. Null for a backfilled row, whose actor was never recorded,
    -- and equal to subject_user_id when someone acts on themselves (joining,
    -- leaving). Not merged into one column: "X left" and "the President removed
    -- X" are different facts and the log has to be able to tell them apart.
    actor_user_id           BIGINT REFERENCES users(user_id),
    action                  VARCHAR(32) NOT NULL,
    -- Frozen at write time, like request_clubs.club_name and every other
    -- snapshot in this schema: a President who later leaves must not turn every
    -- row they caused into a dangling name, and renaming a role later must not
    -- silently rewrite what the log says happened.
    role_label              VARCHAR(32) NOT NULL DEFAULT 'Member',
    occurred_at             TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_club_membership_log_action CHECK (
        action IN ('joined', 'left', 'removed', 'president_assigned', 'president_stepped_down')
    )
);

-- The President's member log: this club's entries, newest first.
CREATE INDEX IF NOT EXISTS ix_club_membership_log_club
    ON club_membership_log (club_id, occurred_at DESC);

-- Previous Clubs: "which clubs did THIS person leave?" - a per-user lookup that
-- would otherwise scan every club's entire history.
CREATE INDEX IF NOT EXISTS ix_club_membership_log_subject
    ON club_membership_log (subject_user_id, occurred_at DESC);

-- Backfill: every CURRENT membership, dated by the day it started. Guarded by
-- NOT EXISTS so re-applying this file by hand cannot duplicate the rows.
INSERT INTO club_membership_log (club_id, subject_user_id, actor_user_id, action, role_label, occurred_at)
SELECT m.club_id, m.user_id, NULL, 'joined', 'Member', m.date_joined::timestamp
  FROM club_members m
 WHERE NOT EXISTS (
        SELECT 1 FROM club_membership_log l
         WHERE l.club_id = m.club_id AND l.subject_user_id = m.user_id AND l.action = 'joined'
       );

-- Sitting Presidents, dated by the club's creation. A club has exactly one
-- President and clubs.user_id is the only record of who it is - there is no
-- column saying when they took the role, so a club whose presidency has changed
-- dates its current President from the club's founding rather than from the
-- handover. Recorded anyway because the alternative is a member log with no
-- President in it at all, which reads as though the club has never had one.
INSERT INTO club_membership_log (club_id, subject_user_id, actor_user_id, action, role_label, occurred_at)
SELECT c.club_id, c.user_id, NULL, 'president_assigned', 'President', c.created_at
  FROM clubs c
 WHERE NOT EXISTS (
        SELECT 1 FROM club_membership_log l
         WHERE l.club_id = c.club_id AND l.subject_user_id = c.user_id
           AND l.action = 'president_assigned'
       );
