"""GET /events/{id}/registrations - the organiser's attendee list.

This endpoint used to return every registration for the event in one array and
leave the browser to search, sort and slice them. An event with 200 attendees
shipped 200 rows to draw the ten on screen, each carrying a freshly minted
signed receipt URL.

?q / ?order / ?page / ?pageSize now do that in SQL, which moves two properties
out of the client's reach and into these tests:

  * the page is a real slice - narrowing or paging changes `items`, and
  * `counts` does NOT follow it. The panel's tiles describe the EVENT, so they
    have to keep reading the same totals while the organiser searches and pages.

Cancelled registrations are excluded here rather than in the browser: they never
counted toward capacity, so shipping them only to have them filtered out was
work for both ends.
"""
from __future__ import annotations

import os

import pytest

from app import create_app
from app.db import fetch_one, transaction

# The seeder mints every demo account with DEMO_PASSWORD; tests read it from the
# same place rather than keeping a second copy that drifts out of step.
PASSWORD = os.environ.get("DEMO_PASSWORD", "Demo@1234")


@pytest.fixture(scope="module")
def client():
    return create_app().test_client()


@pytest.fixture(scope="module")
def event():
    """The seeded event with the most registrations, and the email of the
    organiser who may read them. Read from the data rather than named here -
    a fixture must not become a second copy of the seed."""
    with transaction() as cur:
        row = fetch_one(
            cur,
            """SELECT r.request_id AS id, u.email AS organiser, count(*) AS registrations
                 FROM event_registration er
                 JOIN request r ON r.request_id = er.request_id
                 JOIN users u ON u.user_id = r.applicant_user_id
                WHERE er.status <> 'cancelled'
             GROUP BY r.request_id, u.email
             ORDER BY count(*) DESC
                LIMIT 1""",
        )
    if row is None or row["registrations"] < 3:
        pytest.skip("seed has no event with enough registrations - reseed the database")
    return row


@pytest.fixture(scope="module")
def headers(client, event):
    res = client.post("/api/v1/auth/login", json={"email": event["organiser"], "password": PASSWORD})
    if res.status_code != 200:
        pytest.skip(f"cannot sign in as {event['organiser']} - DEMO_PASSWORD does not match the seed")
    return {"Authorization": f"Bearer {res.get_json()['accessToken']}"}


def get(client, event, headers, **params):
    res = client.get(f"/api/v1/events/{event['id']}/registrations", query_string=params, headers=headers)
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def test_the_response_is_a_page_not_the_whole_table(client, event, headers):
    body = get(client, event, headers, page=1, pageSize=2)

    assert len(body["items"]) <= 2
    assert body["pageSize"] == 2
    assert body["total"] >= len(body["items"])
    assert body["totalPages"] == max(1, -(-body["total"] // 2))


def test_paging_walks_the_list_instead_of_repeating_it(client, event, headers):
    first = get(client, event, headers, page=1, pageSize=2)
    if first["totalPages"] < 2:
        pytest.skip("event has only one page of registrations")
    second = get(client, event, headers, page=2, pageSize=2)

    assert {row["id"] for row in first["items"]}.isdisjoint({row["id"] for row in second["items"]})


def test_order_flips_the_decision_date(client, event, headers):
    newest = get(client, event, headers, order="desc", pageSize=50)["items"]
    oldest = get(client, event, headers, order="asc", pageSize=50)["items"]
    if len(newest) < 2:
        pytest.skip("event has too few registrations to order")

    def dated(row):
        return row["decidedAt"] or row["registeredAt"]

    assert dated(newest[0]) >= dated(newest[-1])
    assert dated(oldest[0]) <= dated(oldest[-1])


def test_search_narrows_the_page_and_matches_a_real_registrant(client, event, headers):
    everyone = get(client, event, headers, pageSize=50)["items"]
    target = everyone[0]["name"]

    found = get(client, event, headers, q=target, pageSize=50)

    assert found["total"] >= 1
    assert all(
        target.lower() in (row["name"] or "").lower()
        or target.lower() in (row["email"] or "").lower()
        or target.lower() in (row["reason"] or "").lower()
        for row in found["items"]
    )


def test_the_tiles_describe_the_event_not_the_page(client, event, headers):
    whole = get(client, event, headers, pageSize=50)
    one_row = get(client, event, headers, pageSize=1)
    searched = get(client, event, headers, q="zzz-no-such-registrant-zzz")

    # A page of one, and a search that matches nobody, must not move the tiles.
    assert one_row["counts"] == whole["counts"]
    assert searched["counts"] == whole["counts"]
    assert searched["total"] == 0 and searched["items"] == []


def test_cancelled_registrations_never_reach_the_client(client, event, headers):
    body = get(client, event, headers, pageSize=50)

    assert all(row["status"] in ("confirmed", "pending", "rejected") for row in body["items"])
    assert sum(body["counts"].values()) == body["total"]


def test_only_the_organiser_may_read_the_attendee_list(client, event):
    with transaction() as cur:
        outsider = fetch_one(
            cur,
            """SELECT u.email FROM users u
                WHERE u.email <> %s AND u.is_active AND NOT EXISTS (
                      SELECT 1 FROM user_unit_roles ur
                       WHERE ur.user_id = u.user_id AND ur.role_code IN ('system-admin', 'admin'))
                LIMIT 1""",
            (event["organiser"],),
        )
    if outsider is None:
        pytest.skip("seed has no non-admin account to test the refusal with")

    res = client.post("/api/v1/auth/login", json={"email": outsider["email"], "password": PASSWORD})
    if res.status_code != 200:
        pytest.skip("cannot sign in as a non-organiser - DEMO_PASSWORD does not match the seed")
    token = res.get_json()["accessToken"]

    denied = client.get(
        f"/api/v1/events/{event['id']}/registrations",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert denied.status_code == 403
