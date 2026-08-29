-- ============================================================================
-- Migration 029 - "Club Only" gets an actual audience.
--
-- THE BUG. Until now `request.event_visibility = 'Club Only'` was a bare
-- string with nothing behind it. Nothing recorded WHICH club the event was
-- for, so nothing could enforce it:
--
--   * A president of two clubs (say Dancing and Photography) filing a
--     Club Only event produced a row indistinguishable from either club's.
--     Both clubs' members saw it. There was no field that could have said
--     otherwise.
--   * Worse, because no server-side check existed at all (see the comment
--     on _published_clause in app/api/events.py), the discovery endpoints
--     returned Club Only rows to EVERYONE - every student, every lecturer,
--     and guests, who are not club members and are not even signed in. The
--     only gate was a client-side filter that asked "is this a student or
--     lecturer?", which is not a membership test.
--
-- THE FIX. One join table naming the club(s) a Club Only event is addressed
-- to, and a CHECK-backed rule that a Club Only request must name at least
-- one. Read enforcement then becomes a membership EXISTS against this table
-- (app/api/events.py), which is what actually closes the leak.
--
-- Shape deliberately mirrors request_categories (SECTION 8 of 001):
-- (request_id, club_id) PK plus a FROZEN club_name. Same reasoning as the
-- category snapshot - renaming or archiving a club later must not rewrite
-- the audience label on a proposal that was already submitted and approved.
--
-- Note what is NOT snapshotted: membership. The frozen name is for display
-- only; who can SEE the event is always resolved live against club_members,
-- so a student who joins the Dancing Club tomorrow gains access to that
-- club's already-published events, and one who leaves loses it. Freezing
-- membership would have meant an audience that silently rots.
-- ============================================================================

CREATE TABLE request_clubs (
    request_id  BIGINT NOT NULL REFERENCES request(request_id),
    club_id     BIGINT NOT NULL REFERENCES clubs(club_id),
    club_name   VARCHAR(150) NOT NULL,  -- frozen label at submission time; NOT re-resolved from clubs on read (see header)
    PRIMARY KEY (request_id, club_id)
);

-- The read path is "given this event, which clubs is it for?" (detail view) and
-- "given these clubs, which events?" (the membership EXISTS in discovery). The PK
-- serves the first; this index serves the second.
CREATE INDEX idx_request_clubs_club ON request_clubs (club_id);

-- Backfill. Existing Club Only rows predate the audience concept and name no
-- club, which under the new read rule would make them invisible to everybody -
-- silently disappearing published events. The honest reconstruction is the one
-- fact these rows DO carry: their applicant. Where that applicant presides over
-- clubs, address the event to those clubs.
INSERT INTO request_clubs (request_id, club_id, club_name)
SELECT r.request_id, c.club_id, c.club_name
  FROM request r
  JOIN clubs c ON c.user_id = r.applicant_user_id AND c.active
 WHERE r.event_visibility = 'Club Only'
ON CONFLICT DO NOTHING;

-- Any Club Only row whose applicant presides over no club at all cannot be
-- reconstructed - there is no club to point it at. Leaving it as an unaddressed
-- Club Only row would trip the constraint below, so demote it to Internal: still
-- APU-only, never public, which is the closest truthful tier available.
UPDATE request
   SET event_visibility = 'Internal'
 WHERE event_visibility = 'Club Only'
   AND NOT EXISTS (SELECT 1 FROM request_clubs rc WHERE rc.request_id = request.request_id);

-- The invariant, enforced by the database rather than trusted from the app: a
-- Club Only request names at least one club. Written as a NOT VALID-free trigger
-- rather than a CHECK because the rule spans two tables (a CHECK cannot see
-- request_clubs). Deferred to statement end so the app can INSERT the request
-- and its clubs in either order inside one transaction.
CREATE OR REPLACE FUNCTION assert_club_only_has_audience() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM request r
         WHERE r.event_visibility = 'Club Only'
           AND r.status <> 'draft'          -- a draft is allowed to be incomplete
           AND NOT EXISTS (SELECT 1 FROM request_clubs rc WHERE rc.request_id = r.request_id)
    ) THEN
        RAISE EXCEPTION 'A "Club Only" request must name at least one club';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A draft is exempt above because the proposal form saves partial work: a
-- president may pick "Club Only" and save before choosing the clubs. The rule
-- bites at submission, which is the point the audience actually has to exist.
CREATE CONSTRAINT TRIGGER trg_request_club_only_audience
    AFTER INSERT OR UPDATE ON request
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_club_only_has_audience();
