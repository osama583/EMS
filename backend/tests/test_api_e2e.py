"""HTTP-level tests: the API as a client actually uses it.

These commit real rows, so each test cleans up the proposals it created. They
cover what the service-level tests cannot: authentication, the scoping of list
endpoints, and the status codes.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app import create_app
from app.db import fetch_one, transaction

PASSWORD = "Demo@1234"


@pytest.fixture(scope="module")
def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture(autouse=True)
def cleanup():
    """Remove proposals these tests create, leaving the seed data intact."""
    yield
    with transaction() as cur:
        cur.execute("SELECT request_id FROM request WHERE event_title LIKE 'APITEST%%'")
        ids = [r["request_id"] for r in cur.fetchall()]
        for request_id in ids:
            for table in (
                "workflow_history", "task_assignment", "request_fmb_selection",
                "request_task", "application_requirements", "request_categories",
                "event_schedule", "co_owners", "organizers", "important_people",
                "general_guest", "brief_agenda", "request_discussion_topics",
                "request_logistics", "request_transportation",
                "request_photography_videography", "request_sound_light",
                "request_fmb", "request_campus_tour", "request_mineral_water",
                "request_funding_purchase", "event_registration", "saved_event",
            ):
                if table == "task_assignment":
                    cur.execute(
                        "DELETE FROM task_assignment WHERE request_task_id IN "
                        "(SELECT request_task_id FROM request_task WHERE request_id = %s)",
                        (request_id,),
                    )
                elif table == "request_fmb_selection":
                    cur.execute(
                        "DELETE FROM request_fmb_selection WHERE request_fmb_id IN "
                        "(SELECT request_fmb_id FROM request_fmb WHERE request_id = %s)",
                        (request_id,),
                    )
                else:
                    cur.execute(f"DELETE FROM {table} WHERE request_id = %s", (request_id,))
            cur.execute("DELETE FROM request WHERE request_id = %s", (request_id,))


# Auth endpoints are rate-limited to 10/minute, which is correct in production
# and hostile to a test suite that logs in per assertion. Each account logs in
# once and the token is reused; the limiter itself is covered separately.
_TOKENS: dict[str, str] = {}


def token_for(client, email: str) -> str:
    if email not in _TOKENS:
        res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
        assert res.status_code == 200, res.get_json()
        _TOKENS[email] = res.get_json()["accessToken"]
    return _TOKENS[email]


def auth(client, email: str) -> dict:
    return {"Authorization": f"Bearer {token_for(client, email)}"}



def a_venue() -> str:
    """The "venue:{n}" id of any live venue, read from the catalogue rather than
    named here — there is one source for the venue list and a test fixture is
    not allowed to be a second copy of it."""
    with transaction() as cur:
        row = fetch_one(
            cur,
            "SELECT venue_option_id FROM venue_options WHERE active AND archived_at IS NULL "
            "ORDER BY sort_order, venue_option_id LIMIT 1",
        )
    assert row is not None, "no live venues - run `python -m migrations.run` and reseed"
    return f"venue:{row['venue_option_id']}"


def payload(**overrides) -> dict:
    day = (date.today() + timedelta(days=45)).isoformat()
    base = {
        "eventTitle": "APITEST Event",
        "shortIntroduction": "Intro.",
        "goals": "Goals.",
        "benefits": "Benefits.",
        "eventVisibility": "Private",
        "registrationMode": "Automatic",
        "totalPax": 25,
        # Inside University + a real venue id: schedule rows reference the venue
        # catalogue rather than typing a location (migration 032).
        "scheduleRows": [{"date": day, "start": "10:00", "end": "12:00",
                          "locationKind": "inside", "venueId": a_venue()}],
        "selectedRequirements": ["logistics"],
    }
    base.update(overrides)
    return base


# --- Authentication -------------------------------------------------------
def test_endpoints_require_a_token(client):
    for path in ("/api/v1/proposals", "/api/v1/tasks", "/api/v1/admin/users", "/api/v1/catalog/config"):
        assert client.get(path).status_code == 401, path


def test_public_event_discovery_needs_no_token(client):
    assert client.get("/api/v1/events").status_code == 200


def test_admin_routes_reject_a_non_admin(client):
    res = client.get("/api/v1/admin/users", headers=auth(client, "student.computing@demo.apu.edu.my"))
    assert res.status_code == 403


def test_admin_routes_accept_an_admin(client):
    res = client.get("/api/v1/admin/users", headers=auth(client, "system.admin@demo.apu.edu.my"))
    assert res.status_code == 200
    users = res.get_json()
    assert len(users) > 30
    # The directory must never carry password material.
    assert all("password" not in u for u in users)


def test_internal_directory_is_available_without_admin_access(client):
    """Picker data must not be fetched through the admin-only user API."""
    res = client.get(
        "/api/v1/auth/internal-users",
        headers=auth(client, "student.computing@demo.apu.edu.my"),
    )
    assert res.status_code == 200
    users = res.get_json()
    assert users
    assert all("password" not in user and "id" not in user for user in users)
    assert all("external-user" not in {role["roleCode"] for role in user["roles"]} for user in users)


# --- Proposal lifecycle over HTTP ----------------------------------------
def test_full_proposal_lifecycle(client):
    student = auth(client, "student.computing@demo.apu.edu.my")
    hos = auth(client, "hoshod@demo.apu.edu.my")
    logistics_head = auth(client, "logistics.manager@demo.apu.edu.my")

    created = client.post("/api/v1/proposals", json=payload(), headers=student)
    assert created.status_code == 201, created.get_json()
    proposal = created.get_json()
    request_id = proposal["id"]
    assert proposal["status"] == "hos_hod_review"
    assert proposal["proposalId"].startswith("EVT-")

    # The wrong reviewer cannot act.
    wrong = client.post(
        f"/api/v1/proposals/{request_id}/decision",
        json={"decision": "approve"},
        headers=auth(client, "hos.business@demo.apu.edu.my"),
    )
    assert wrong.status_code in (403, 404)

    approved = client.post(
        f"/api/v1/proposals/{request_id}/decision", json={"decision": "approve"}, headers=hos
    )
    assert approved.status_code == 200
    assert approved.get_json()["status"] == "department_review"

    tasks = client.get(f"/api/v1/proposals/{request_id}/tasks", headers=student).get_json()
    assert [t["requirement_name"] for t in tasks] == ["logistics"]
    task_id = tasks[0]["request_task_id"]

    staff = client.get(f"/api/v1/tasks/{task_id}/assignable-staff", headers=logistics_head)
    assert staff.status_code == 200
    staff_id = staff.get_json()[0]["user_id"]

    assigned = client.post(
        f"/api/v1/tasks/{task_id}/assignments", json={"staffUserId": staff_id}, headers=logistics_head
    )
    assert assigned.status_code == 201

    history = client.get(f"/api/v1/proposals/{request_id}/history", headers=student).get_json()
    assert [h["action"] for h in history][:2] == ["task-created", "submit"] or "submit" in [
        h["action"] for h in history
    ]


def test_send_back_and_resubmit_over_http(client):
    student = auth(client, "student.computing@demo.apu.edu.my")
    hos = auth(client, "hoshod@demo.apu.edu.my")

    request_id = client.post("/api/v1/proposals", json=payload(), headers=student).get_json()["id"]

    sent_back = client.post(
        f"/api/v1/proposals/{request_id}/decision",
        json={"decision": "send-back", "comment": "Please add a budget."},
        headers=hos,
    )
    assert sent_back.status_code == 200
    body = sent_back.get_json()
    assert body["status"] == "resubmission_required"
    assert body["workflow"]["reviewerComment"] == "Please add a budget."

    # An empty comment is refused.
    request_id2 = client.post("/api/v1/proposals", json=payload(), headers=student).get_json()["id"]
    bad = client.post(
        f"/api/v1/proposals/{request_id2}/decision",
        json={"decision": "send-back", "comment": "  "},
        headers=hos,
    )
    assert bad.status_code == 409

    # A resubmission with no reply comment is refused - the applicant must
    # answer the reviewer, not just silently resend edited content.
    no_comment = client.post(
        f"/api/v1/proposals/{request_id}/resubmission",
        json=payload(shortIntroduction="Now with a budget."),
        headers=student,
    )
    assert no_comment.status_code == 409

    resubmitted = client.post(
        f"/api/v1/proposals/{request_id}/resubmission",
        json={**payload(shortIntroduction="Now with a budget."), "comment": "Added the budget."},
        headers=student,
    )
    assert resubmitted.status_code == 200
    assert resubmitted.get_json()["status"] == "hos_hod_review"

    # The reply joins the same conversation as the HOS/HOD's original comment,
    # visible to both the applicant and the HOS/HOD, chronologically ordered.
    convos = client.get(f"/api/v1/proposals/{request_id}/conversations", headers=student).get_json()
    assert len(convos) == 1
    texts = [m["text"] for m in convos[0]["messages"]]
    assert texts == ["Please add a budget.", "Added the budget."]
    sides = [m["senderSide"] for m in convos[0]["messages"]]
    assert sides == ["authority", "applicant"]

    hos_convos = client.get(f"/api/v1/proposals/{request_id}/conversations", headers=hos).get_json()
    assert hos_convos == convos

    # A CFO who never touched this proposal sees no threads on it at all.
    cfo_convos = client.get(
        f"/api/v1/proposals/{request_id}/conversations", headers=auth(client, "cfo@demo.apu.edu.my")
    ).get_json()
    assert cfo_convos == []


def test_an_unknown_decision_is_refused(client):
    student = auth(client, "student.computing@demo.apu.edu.my")
    request_id = client.post("/api/v1/proposals", json=payload(), headers=student).get_json()["id"]
    res = client.post(
        f"/api/v1/proposals/{request_id}/decision",
        json={"decision": "delete-everything"},
        headers=auth(client, "hoshod@demo.apu.edu.my"),
    )
    assert res.status_code == 409


# --- Scoping: the bug this API exists to fix ------------------------------
def test_list_proposals_is_scoped_to_the_caller(client):
    """The mock returned every proposal to everyone. An unrelated student must
    not see another student's submission."""
    owner = auth(client, "student.computing@demo.apu.edu.my")
    stranger = auth(client, "student.business@demo.apu.edu.my")

    request_id = client.post(
        "/api/v1/proposals", json=payload(eventTitle="APITEST Private Thing"), headers=owner
    ).get_json()["id"]

    mine = client.get("/api/v1/proposals", headers=owner).get_json()
    assert any(p["id"] == request_id for p in mine["items"])

    theirs = client.get("/api/v1/proposals", headers=stranger).get_json()
    assert not any(p["id"] == request_id for p in theirs["items"])


def test_reading_someone_elses_proposal_is_a_404(client):
    """404 rather than 403 - confirming a proposal exists is itself a disclosure."""
    owner = auth(client, "student.computing@demo.apu.edu.my")
    stranger = auth(client, "student.business@demo.apu.edu.my")
    request_id = client.post("/api/v1/proposals", json=payload(), headers=owner).get_json()["id"]
    assert client.get(f"/api/v1/proposals/{request_id}", headers=stranger).status_code == 404


def test_the_reviewer_can_see_a_proposal_awaiting_their_decision(client):
    owner = auth(client, "student.computing@demo.apu.edu.my")
    request_id = client.post("/api/v1/proposals", json=payload(), headers=owner).get_json()["id"]
    res = client.get(f"/api/v1/proposals/{request_id}", headers=auth(client, "hoshod@demo.apu.edu.my"))
    assert res.status_code == 200


# --- Drafts ---------------------------------------------------------------
def test_draft_save_update_and_delete(client):
    student = auth(client, "student.computing@demo.apu.edu.my")

    created = client.post("/api/v1/proposals/drafts", json=payload(eventTitle="APITEST Draft"), headers=student)
    assert created.status_code == 201
    draft_id = created.get_json()["id"]
    assert created.get_json()["status"] == "draft"

    updated = client.post(
        "/api/v1/proposals/drafts",
        json=payload(eventTitle="APITEST Draft v2", draftRequestId=draft_id),
        headers=student,
    )
    assert updated.status_code == 200
    # Updating reuses the row rather than accumulating duplicates.
    assert updated.get_json()["id"] == draft_id
    assert updated.get_json()["eventTitle"] == "APITEST Draft v2"

    assert client.delete(f"/api/v1/proposals/{draft_id}", headers=student).status_code == 204


def test_a_submitted_proposal_cannot_be_deleted(client):
    student = auth(client, "student.computing@demo.apu.edu.my")
    request_id = client.post("/api/v1/proposals", json=payload(), headers=student).get_json()["id"]
    assert client.delete(f"/api/v1/proposals/{request_id}", headers=student).status_code == 409


def test_validation_reports_every_problem_at_once(client):
    student = auth(client, "student.computing@demo.apu.edu.my")
    res = client.post(
        "/api/v1/proposals",
        json={"eventTitle": "", "totalPax": 0, "scheduleRows": []},
        headers=student,
    )
    assert res.status_code == 422
    errors = res.get_json()["error"]["details"]["errors"]
    assert len(errors) >= 4


# --- Catalogue and option ownership --------------------------------------
def test_catalogue_reads(client):
    headers = auth(client, "student.computing@demo.apu.edu.my")
    config = client.get("/api/v1/catalog/config", headers=headers).get_json()
    assert config["HIGH_PAX_THRESHOLD"] == 50
    assert len(client.get("/api/v1/catalog/event-categories", headers=headers).get_json()) == 7
    assert len(client.get("/api/v1/catalog/requirements", headers=headers).get_json()) == 8
    assert len(client.get("/api/v1/catalog/cafeterias", headers=headers).get_json()) == 2


def test_a_department_head_cannot_edit_another_departments_catalogue(client):
    logistics = auth(client, "logistics.manager@demo.apu.edu.my")
    av = auth(client, "av.manager@demo.apu.edu.my")

    mine = client.post(
        "/api/v1/options/logistics",
        json={"label": "APITEST Item", "availableQuantity": 5, "quantityUnit": "unit"},
        headers=logistics,
    )
    assert mine.status_code == 201
    option_id = mine.get_json()["id"]

    theirs = client.patch(
        f"/api/v1/options/logistics/{option_id}", json={"label": "Hijacked"}, headers=av
    )
    assert theirs.status_code == 403

    assert client.delete(f"/api/v1/options/logistics/{option_id}", headers=logistics).status_code == 204


def test_an_unknown_option_kind_is_a_404(client):
    headers = auth(client, "logistics.manager@demo.apu.edu.my")
    assert client.get("/api/v1/options?kind=pg_catalog", headers=headers).status_code == 404


# --- Clubs ----------------------------------------------------------------
def test_club_directory_carries_viewer_flags(client):
    president = auth(client, "student.computing@demo.apu.edu.my")
    clubs = client.get("/api/v1/clubs", headers=president).get_json()
    assert clubs
    coding = next(c for c in clubs if c["name"] == "APU Coding Society")
    assert coding["viewerIsPresident"] is True
    assert coding["viewerIsMember"] is True
    assert coding["memberCount"] >= 1


def test_only_a_club_admin_can_create_a_club(client):
    student = auth(client, "student.computing@demo.apu.edu.my")
    res = client.post(
        "/api/v1/clubs",
        json={"name": "APITEST Club", "presidentUserId": 1, "categories": [1]},
        headers=student,
    )
    assert res.status_code == 403


def test_join_request_rejects_an_existing_member(client):
    president = auth(client, "student.computing@demo.apu.edu.my")
    clubs = client.get("/api/v1/clubs", headers=president).get_json()
    club_id = next(c["id"] for c in clubs if c["name"] == "APU Coding Society")
    res = client.post(
        f"/api/v1/clubs/{club_id}/join-requests", json={"reason": "I would like to join."},
        headers=president,
    )
    assert res.status_code == 409
