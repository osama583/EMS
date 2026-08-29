-- ============================================================================
-- Migration 032 - Venue Management: one CFO-owned source for university venues.
--
-- Before this, the list of university venues existed only as literals: a VENUES
-- array in seed/production_data.py and whatever free text an applicant typed
-- into a `location` field. There was no way for the CFO to add a hall, retire
-- one, or decide what order they appear in, and nothing tied the text on a
-- proposal to the text on its logistics request.
--
-- WHAT THIS ADDS
--   1. venue_options - a catalogue table shaped exactly like the other twelve
--      dropdown catalogues (label/description/active/archived_at), so it is
--      served by the same generic /options resource and managed by the same
--      page. Its two additions are `sort_order` (the CFO decides the order
--      venues appear in every dropdown) and the CFO ownership, which it shares
--      with funding_main_options.
--   2. venue_option_id on every table that records where something happens,
--      plus location_kind on event_schedule (the one place an OUTSIDE address
--      is still allowed).
--   3. The nav page, so the CFO gets the entry and Page Visibility can retune
--      it like any other page.
--   4. A backfill converting the location text already in the database.
--
-- WHY `location` STAYS. Every request_* table in this schema already keeps a
-- frozen label beside a live FK (request_logistics.item next to option_id,
-- request_mineral_water.option_label next to option_id) precisely so archiving
-- or renaming a catalogue row cannot rewrite what a submitted proposal says.
-- `location` becomes exactly that snapshot for venues: venue_option_id is the
-- live link used by new dropdowns, `location` is what the record displays
-- forever. That is what makes archived venues keep rendering correctly in old
-- proposals, and it means no existing read path had to change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The catalogue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venue_options (
    venue_option_id  BIGSERIAL PRIMARY KEY,
    label               VARCHAR(150) NOT NULL,
    description           TEXT,
    active                  BOOLEAN NOT NULL DEFAULT TRUE,
    building                  VARCHAR(150),
    capacity                    INTEGER,
    -- The CFO's display order. Ties break on venue_option_id so the order is
    -- always total, even before anyone has reordered anything.
    sort_order                    INTEGER NOT NULL DEFAULT 0,
    archived_at                     TIMESTAMP NULL
);

-- Two venues cannot share a name while both are live. Archived rows are exempt:
-- retiring "Main Hall" must not stop a future CFO creating a new one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_venue_options_live_label
    ON venue_options (lower(label)) WHERE archived_at IS NULL;

-- The hot path: every venue dropdown in the system reads the live set in order.
CREATE INDEX IF NOT EXISTS ix_venue_options_live
    ON venue_options (sort_order, venue_option_id) WHERE archived_at IS NULL;

-- Matches the sweep index every other soft-deletable table carries (see 022).
CREATE INDEX IF NOT EXISTS ix_venue_options_archived_at
    ON venue_options (archived_at) WHERE archived_at IS NOT NULL;

-- The starting catalogue. This is the list that used to be hardcoded in
-- seed/production_data.py's VENUES, moved into the database where the CFO can
-- actually manage it. sort_order matches the order it was written in.
-- ON CONFLICT DO NOTHING so re-running the migration is safe and so a database
-- whose CFO has already curated the list is never overwritten.
INSERT INTO venue_options (label, description, active, sort_order)
VALUES
    ('Auditorium',               'Main auditorium, tiered seating.',                TRUE,  0),
    ('Grand Hall',               'Largest flat-floor hall, full staging supported.', TRUE,  1),
    ('Main Hall',                'Flat-floor hall for fairs and exhibitions.',       TRUE,  2),
    ('Level 6 Multipurpose Hall','Divisible hall on level 6.',                       TRUE,  3),
    ('Seminar Room 1',           'Seminar room, boardroom or theatre layout.',       TRUE,  4),
    ('Seminar Room 2',           'Seminar room, boardroom or theatre layout.',       TRUE,  5),
    ('Lecture Theatre 3',        'Tiered lecture theatre.',                          TRUE,  6),
    ('Lecture Theatre 5',        'Tiered lecture theatre.',                          TRUE,  7),
    ('Innovation Lab',           'Project space with workbenches and power.',        TRUE,  8),
    ('Campus Green',             'Outdoor lawn, weather dependent.',                 TRUE,  9),
    ('Basketball Court',         'Outdoor court, also used for large gatherings.',   TRUE, 10),
    ('Library Discussion Zone',  'Group study area on the library floor.',           TRUE, 11),
    ('Atrium Concourse',         'Central concourse, high footfall.',                TRUE, 12),
    ('Block D Studio',           'Studio space with lighting rig.',                  TRUE, 13),
    ('Sports Complex',           'Indoor sports hall.',                              TRUE, 14),
    ('Boardroom A',              'Executive boardroom, seats 20.',                   TRUE, 15)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Structured location on every table that records one
--
-- event_schedule is the only one that gets location_kind: the Event Schedule
-- step is where an applicant may legitimately hold an event off campus, so it
-- carries Inside/Outside. The four request tables are venue-only by
-- requirement - Logistics, Sound & Light, Food and Mineral Water are delivered
-- BY the university, so there is nowhere to deliver to but a university venue,
-- and free text there is what let a request name a place Logistics could not
-- find.
-- ----------------------------------------------------------------------------
ALTER TABLE event_schedule
    ADD COLUMN IF NOT EXISTS venue_option_id BIGINT NULL REFERENCES venue_options(venue_option_id),
    -- 'inside' | 'outside'. Defaults to 'inside' because that is what every row
    -- written before this migration meant; the backfill below corrects the ones
    -- whose text turns out not to name a venue.
    ADD COLUMN IF NOT EXISTS location_kind VARCHAR(8) NOT NULL DEFAULT 'inside';

ALTER TABLE event_schedule
    DROP CONSTRAINT IF EXISTS ck_event_schedule_location_kind;
ALTER TABLE event_schedule
    ADD CONSTRAINT ck_event_schedule_location_kind
    CHECK (location_kind IN ('inside', 'outside'));

ALTER TABLE request_logistics
    ADD COLUMN IF NOT EXISTS venue_option_id BIGINT NULL REFERENCES venue_options(venue_option_id);
ALTER TABLE request_sound_light
    ADD COLUMN IF NOT EXISTS venue_option_id BIGINT NULL REFERENCES venue_options(venue_option_id);
ALTER TABLE request_fmb
    ADD COLUMN IF NOT EXISTS venue_option_id BIGINT NULL REFERENCES venue_options(venue_option_id);
ALTER TABLE request_mineral_water
    ADD COLUMN IF NOT EXISTS venue_option_id BIGINT NULL REFERENCES venue_options(venue_option_id);
-- Photography is not in the required set, but it carries the same location
-- field and the same dropdown, so leaving it on free text would have recreated
-- the problem in one corner of the form.
ALTER TABLE request_photography_videography
    ADD COLUMN IF NOT EXISTS venue_option_id BIGINT NULL REFERENCES venue_options(venue_option_id);

CREATE INDEX IF NOT EXISTS ix_event_schedule_venue ON event_schedule (venue_option_id);
CREATE INDEX IF NOT EXISTS ix_request_logistics_venue ON request_logistics (venue_option_id);
CREATE INDEX IF NOT EXISTS ix_request_sound_light_venue ON request_sound_light (venue_option_id);
CREATE INDEX IF NOT EXISTS ix_request_fmb_venue ON request_fmb (venue_option_id);
CREATE INDEX IF NOT EXISTS ix_request_mineral_water_venue ON request_mineral_water (venue_option_id);
CREATE INDEX IF NOT EXISTS ix_request_photo_video_venue ON request_photography_videography (venue_option_id);

-- ----------------------------------------------------------------------------
-- 3. Backfill the location text already in the database
--
-- Matching is on trimmed, case-folded label, which is what the old free-text
-- field actually produced: the seed wrote venue names verbatim, and a typed
-- "auditorium " is the same room as "Auditorium". Anything that does not match
-- a venue is an external address and stays exactly as typed - for
-- event_schedule that means flipping it to 'outside', and for the request
-- tables it means a NULL venue_option_id and the original `location` snapshot,
-- which is still what the record renders.
-- ----------------------------------------------------------------------------
UPDATE event_schedule s
   SET venue_option_id = v.venue_option_id,
       location_kind   = 'inside'
  FROM venue_options v
 WHERE s.venue_option_id IS NULL
   AND lower(btrim(s.location)) = lower(v.label);

UPDATE event_schedule
   SET location_kind = 'outside'
 WHERE venue_option_id IS NULL;

UPDATE request_logistics r
   SET venue_option_id = v.venue_option_id
  FROM venue_options v
 WHERE r.venue_option_id IS NULL AND lower(btrim(r.location)) = lower(v.label);

UPDATE request_sound_light r
   SET venue_option_id = v.venue_option_id
  FROM venue_options v
 WHERE r.venue_option_id IS NULL AND lower(btrim(r.location)) = lower(v.label);

UPDATE request_fmb r
   SET venue_option_id = v.venue_option_id
  FROM venue_options v
 WHERE r.venue_option_id IS NULL AND lower(btrim(r.location)) = lower(v.label);

UPDATE request_mineral_water r
   SET venue_option_id = v.venue_option_id
  FROM venue_options v
 WHERE r.venue_option_id IS NULL AND lower(btrim(r.location)) = lower(v.label);

UPDATE request_photography_videography r
   SET venue_option_id = v.venue_option_id
  FROM venue_options v
 WHERE r.venue_option_id IS NULL AND lower(btrim(r.location)) = lower(v.label);

-- Any location text left over on a REQUEST row after the pass above named a
-- place that is not a university venue. Those requests are venue-only now, so
-- the text has no structured home - but deleting it would blank what an
-- already-submitted proposal displays. It stays as the snapshot, and the venue
-- link stays NULL: history renders, and the next edit has to pick a real venue.
-- Recorded here rather than silently, so the count is visible in the migration
-- log rather than discovered later.
DO $$
DECLARE
    unmatched INTEGER;
BEGIN
    SELECT (SELECT COUNT(*) FROM request_logistics WHERE venue_option_id IS NULL)
         + (SELECT COUNT(*) FROM request_sound_light WHERE venue_option_id IS NULL)
         + (SELECT COUNT(*) FROM request_fmb WHERE venue_option_id IS NULL)
         + (SELECT COUNT(*) FROM request_mineral_water WHERE venue_option_id IS NULL)
         + (SELECT COUNT(*) FROM request_photography_videography WHERE venue_option_id IS NULL)
      INTO unmatched;
    IF unmatched > 0 THEN
        RAISE NOTICE 'Migration 032: % request row(s) kept a free-text location that matches no venue; they display from the snapshot and will need a venue on next edit.', unmatched;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. The nav page
--
-- Registered exactly like the other dropdown catalogues (see seed/nav.py's
-- dropdown_kinds and migration 030): a child of the Dropdown Settings folder,
-- routed at /app/dropdown-options/venue, granted to the CFO's flat role. Being
-- a nav_page row is what puts it in Page Visibility and under the role
-- permission framework - nothing about access is special-cased in the client.
--
-- sort_order 11 puts it after the two funding catalogues, which currently end
-- the list at 9 and 10.
-- ----------------------------------------------------------------------------
INSERT INTO nav_page (page_code, label, entry_type, icon, route_path, parent_page_code, sort_order)
VALUES ('dropdown-venue', 'Venue Management', 'page', 'location_city',
        '/app/dropdown-options/venue', 'dropdown-settings', 11)
ON CONFLICT (page_code) DO NOTHING;

INSERT INTO nav_page_grants (grant_id, page_code, grant_type)
SELECT COALESCE((SELECT MAX(grant_id) FROM nav_page_grants), 0) + 1,
       'dropdown-venue', 'role'
WHERE NOT EXISTS (
    SELECT 1 FROM nav_page_grants
     WHERE page_code = 'dropdown-venue' AND grant_type = 'role'
);

INSERT INTO nav_page_grant_roles (grant_id, role_code)
SELECT g.grant_id, 'cfo'
  FROM nav_page_grants g
 WHERE g.page_code = 'dropdown-venue' AND g.grant_type = 'role'
ON CONFLICT (grant_id, role_code) DO NOTHING;
