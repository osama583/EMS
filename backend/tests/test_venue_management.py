"""Venue Management against the real seeded database.

Each test opens a transaction and ROLLS BACK, so they exercise the real table,
the real constraints and the real seed rows without leaving anything behind.

What is worth asserting here is the part of the feature that is a promise
rather than a mechanism. The CRUD itself is the generic /options resource and
is already covered by that resource's own tests; what is specific to venues is:

  * the CFO owns the catalogue and nobody else does,
  * the order the CFO sets is the order every dropdown reads,
  * archiving removes a venue from NEW selections without touching what
    already-submitted records display, and
  * the four university-delivered requests cannot carry a free-text location.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.api.options import CATALOGUES
from app.db import fetch_all, fetch_one, get_connection
from app.errors import ValidationError
from app.security.principal import Principal
from app.services import proposals


@pytest.fixture()
def cur():
    with get_connection() as conn:
        with conn.cursor() as c:
            yield c
        conn.rollback()


def principal_for(cur, email: str) -> Principal:
    user = fetch_one(cur, "SELECT * FROM users WHERE email = %s", (email,))
    assert user, f"seed account missing: {email}"
    cur.execute(
        "SELECT role_code, unit_code FROM user_unit_roles WHERE user_id = %s", (user["user_id"],)
    )
    assignments = tuple((r["role_code"], r["unit_code"]) for r in cur.fetchall())
    return Principal(
        user_id=user["user_id"], full_name=user["full_name"], email=user["email"],
        is_active=True, assignments=assignments,
    )


def live_venues(cur) -> list[dict]:
    """Exactly what every venue dropdown in the system reads: live, active, in
    the CFO's order."""
    return [
        dict(r) for r in fetch_all(
            cur,
            "SELECT venue_option_id, label, sort_order FROM venue_options "
            "WHERE active AND archived_at IS NULL ORDER BY sort_order, venue_option_id",
        )
    ]


def payload_with(cur, venue_ref: str, **overrides) -> dict:
    day = (date.today() + timedelta(days=30)).isoformat()
    payload = {
        "eventTitle": "Venue Test Event",
        "shortIntroduction": "An introduction.",
        "goals": "Some goals.",
        "benefits": "Some benefits.",
        "eventVisibility": "Private",
        "registrationMode": "Automatic",
        "totalPax": 20,
        "scheduleRows": [{"date": day, "start": "09:00", "end": "17:00",
                          "locationKind": "inside", "venueId": venue_ref}],
        "selectedRequirements": ["logistics"],
    }
    payload.update(overrides)
    return payload


def create(cur, email: str, payload: dict) -> int:
    principal = principal_for(cur, email)
    applicant = proposals.load_applicant(cur, principal.user_id)
    return proposals.create(cur, applicant, payload, draft=False)


# --- The catalogue -------------------------------------------------------
def test_venues_are_a_cfo_owned_catalogue_like_any_other():
    """Registered in the same registry as the other twelve, so it gets the same
    page, permissions and CRUD rather than a parallel implementation."""
    catalogue = CATALOGUES["venue"]
    assert catalogue.table == "venue_options"
    assert catalogue.owner_role == "cfo"
    assert catalogue.owner_unit is None
    # A venue is not scoped to one department's request - it is where any of
    # them happen.
    assert catalogue.has_requirement is False
    # The one thing venues have that no other catalogue does.
    assert catalogue.ordered is True


def test_the_seeded_catalogue_is_not_empty_and_is_totally_ordered(cur):
    venues = live_venues(cur)
    assert venues, "migration 032 seeds the starting venue list"
    positions = [(v["sort_order"], v["venue_option_id"]) for v in venues]
    assert positions == sorted(positions), "the read order must be the stored order"


def test_two_live_venues_cannot_share_a_name(cur):
    import psycopg2

    label = live_venues(cur)[0]["label"]
    with pytest.raises(psycopg2.errors.UniqueViolation):
        cur.execute("INSERT INTO venue_options (label) VALUES (%s)", (label,))


def test_an_archived_venue_may_reuse_a_live_name(cur):
    """The uniqueness rule is scoped to live rows: retiring "Main Hall" must not
    stop a future CFO creating a new one."""
    label = live_venues(cur)[0]["label"]
    cur.execute(
        "INSERT INTO venue_options (label, archived_at) VALUES (%s, now()) "
        "RETURNING venue_option_id",
        (label,),
    )
    assert cur.fetchone()["venue_option_id"]


# --- Order ----------------------------------------------------------------
def test_reordering_changes_what_every_dropdown_reads(cur):
    """The dropdowns have no order of their own - they render the rows in the
    order this query returns them, so moving a venue here moves it everywhere."""
    before = live_venues(cur)
    assert len(before) >= 2
    last, first = before[-1], before[0]

    # Put the last venue in front of the first, the way PUT /options/reorder does.
    for position, venue in enumerate([last, *[v for v in before if v is not last]]):
        cur.execute(
            "UPDATE venue_options SET sort_order = %s WHERE venue_option_id = %s",
            (position, venue["venue_option_id"]),
        )

    after = live_venues(cur)
    assert after[0]["venue_option_id"] == last["venue_option_id"]
    assert after[1]["venue_option_id"] == first["venue_option_id"]


# --- Archiving ------------------------------------------------------------
def test_archiving_a_venue_hides_it_from_new_dropdowns_but_not_from_history(cur):
    """The promise that makes archiving safe: a record keeps the venue name it
    was submitted with, because the name is frozen onto the row at save time."""
    venue = live_venues(cur)[0]
    request_id = create(
        cur, "student.computing@demo.apu.edu.my",
        payload_with(cur, f"venue:{venue['venue_option_id']}"),
    )
    saved = fetch_one(
        cur,
        "SELECT location, venue_option_id, location_kind FROM event_schedule "
        "WHERE request_id = %s",
        (request_id,),
    )
    assert saved["venue_option_id"] == venue["venue_option_id"]
    assert saved["location"] == venue["label"], "the label is snapshotted, not looked up later"

    cur.execute(
        "UPDATE venue_options SET archived_at = now(), active = FALSE WHERE venue_option_id = %s",
        (venue["venue_option_id"],),
    )

    # Gone from what a new dropdown offers...
    assert venue["venue_option_id"] not in {v["venue_option_id"] for v in live_venues(cur)}
    # ...and unchanged on the record that already used it.
    still = fetch_one(
        cur, "SELECT location FROM event_schedule WHERE request_id = %s", (request_id,)
    )
    assert still["location"] == venue["label"]


# --- Inside / Outside -----------------------------------------------------
def test_an_outside_university_schedule_keeps_its_typed_address(cur):
    day = (date.today() + timedelta(days=30)).isoformat()
    request_id = create(
        cur, "student.computing@demo.apu.edu.my",
        payload_with(
            cur, "", scheduleRows=[{
                "date": day, "start": "09:00", "end": "17:00",
                "locationKind": "outside",
                "location": "Kuala Lumpur Convention Centre, Hall 5",
            }],
        ),
    )
    row = fetch_one(
        cur,
        "SELECT location, venue_option_id, location_kind FROM event_schedule "
        "WHERE request_id = %s",
        (request_id,),
    )
    assert row["location_kind"] == "outside"
    assert row["venue_option_id"] is None
    assert row["location"] == "Kuala Lumpur Convention Centre, Hall 5"


def test_an_inside_schedule_row_without_a_venue_is_rejected(cur):
    day = (date.today() + timedelta(days=30)).isoformat()
    with pytest.raises(ValidationError):
        create(
            cur, "student.computing@demo.apu.edu.my",
            payload_with(cur, "", scheduleRows=[{
                "date": day, "start": "09:00", "end": "17:00",
                "locationKind": "inside", "location": "Somewhere on campus",
            }]),
        )


def test_an_outside_schedule_row_without_an_address_is_rejected(cur):
    day = (date.today() + timedelta(days=30)).isoformat()
    with pytest.raises(ValidationError):
        create(
            cur, "student.computing@demo.apu.edu.my",
            payload_with(cur, "", scheduleRows=[{
                "date": day, "start": "09:00", "end": "17:00", "locationKind": "outside",
            }]),
        )


# --- Venue-only requests --------------------------------------------------
@pytest.mark.parametrize(
    "requirement,row",
    [
        ("logistics", {"item": "logistics:1", "quantity": 5, "start": "09:00", "end": "10:00"}),
        ("soundLight", {"item": "soundLight:1", "start": "09:00", "end": "10:00"}),
        ("fmb", {"foodType": "fmb:1", "quantity": 20, "start": "12:00"}),
        ("waterNormal", {"quantity": 48, "withLogo": "no", "start": "09:00", "end": "10:00"}),
    ],
)
def test_a_university_delivered_request_cannot_use_a_free_text_location(cur, requirement, row):
    """These four are delivered BY the university, so the only place they can be
    delivered to is a university venue. Typed text is refused even though the
    old column that held it still exists."""
    venue = live_venues(cur)[0]
    day = (date.today() + timedelta(days=30)).isoformat()
    with pytest.raises(ValidationError) as raised:
        create(
            cur, "student.computing@demo.apu.edu.my",
            payload_with(
                cur, f"venue:{venue['venue_option_id']}",
                selectedRequirements=[requirement],
                requestRows={requirement: [{**row, "date": day, "location": "Behind the library"}]},
            ),
        )
    assert "venue" in str(raised.value).lower()


def test_a_request_row_freezes_the_venue_label_it_was_saved_with(cur):
    venue = live_venues(cur)[0]
    day = (date.today() + timedelta(days=30)).isoformat()
    request_id = create(
        cur, "student.computing@demo.apu.edu.my",
        payload_with(
            cur, f"venue:{venue['venue_option_id']}",
            selectedRequirements=["logistics"],
            requestRows={"logistics": [{
                "item": "logistics:1", "quantity": 5, "date": day,
                "start": "09:00", "end": "10:00",
                "venueId": f"venue:{venue['venue_option_id']}",
            }]},
        ),
    )
    row = fetch_one(
        cur,
        "SELECT location, venue_option_id FROM request_logistics WHERE request_id = %s",
        (request_id,),
    )
    assert row["venue_option_id"] == venue["venue_option_id"]
    assert row["location"] == venue["label"]


# --- The page -------------------------------------------------------------
def test_the_page_is_registered_and_granted_like_every_other_page(cur):
    """Being a nav_page row is what puts Venue Management under Page Visibility
    and the role permission framework - nothing about its access is special."""
    page = fetch_one(
        cur, "SELECT * FROM nav_page WHERE page_code = 'dropdown-venue'"
    )
    assert page, "migration 032 registers the page"
    assert page["route_path"] == "/app/dropdown-options/venue"
    assert page["parent_page_code"] == "dropdown-settings"

    roles = [
        r["role_code"] for r in fetch_all(
            cur,
            "SELECT r.role_code FROM nav_page_grants g "
            "JOIN nav_page_grant_roles r ON r.grant_id = g.grant_id "
            "WHERE g.page_code = 'dropdown-venue'",
        )
    ]
    assert roles == ["cfo"]


# --- The migration's own promise ------------------------------------------
def test_no_inside_schedule_row_is_left_without_a_venue(cur):
    """After migration 032 there is no leftover old-format data: every row that
    claims to be Inside University resolves to a real venue, and everything that
    did not match one was reclassified as Outside rather than left ambiguous."""
    stranded = fetch_one(
        cur,
        "SELECT count(*) AS n FROM event_schedule "
        "WHERE location_kind = 'inside' AND venue_option_id IS NULL",
    )
    assert stranded["n"] == 0
