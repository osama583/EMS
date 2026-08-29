"""End-to-end workflow tests against the real seeded database.

Each test opens a transaction, drives the state machine through it, and ROLLS
BACK - so they exercise real SQL, real constraints and real seed data without
leaving anything behind.

Covers the branches that are easy to get wrong: the two self-review skips, the
high-pax F&B->CFO chain, resume_stage semantics, department parallel
independence, and the F&B cafeteria order lifecycle.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.db import fetch_one, get_connection
from app.security.principal import Principal
from app.services import proposals
from app.services import workflow as wf


@pytest.fixture()
def cur():
    """A cursor in a transaction that is always rolled back."""
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
        user_id=user["user_id"],
        full_name=user["full_name"],
        email=user["email"],
        is_active=True,
        assignments=assignments,
    )


def a_venue(cur) -> str:
    """The "venue:{n}" id of any live venue.

    Schedule rows and the university-delivered requests reference the venue
    catalogue rather than typing a location (migration 032), so a payload that
    reaches submission has to name a real one. Read from the table rather than
    hardcoded here for the same reason the feature exists: there is one source
    for the venue list and this is not a second copy of it.
    """
    row = fetch_one(
        cur,
        "SELECT venue_option_id FROM venue_options WHERE active AND archived_at IS NULL "
        "ORDER BY sort_order, venue_option_id LIMIT 1",
    )
    assert row is not None, "no live venues - run `python -m migrations.run` and reseed"
    return f"venue:{row['venue_option_id']}"


def make_payload(venue: str, **overrides) -> dict:
    """A valid submission. Scheduled far enough out that cancellation stays open."""
    day = (date.today() + timedelta(days=30)).isoformat()
    payload = {
        "eventTitle": "Test Event",
        "shortIntroduction": "An introduction.",
        "goals": "Some goals.",
        "benefits": "Some benefits.",
        "eventVisibility": "Private",
        "registrationMode": "Automatic",
        "totalPax": 20,
        "scheduleRows": [{"date": day, "start": "09:00", "end": "17:00",
                          "locationKind": "inside", "venueId": venue}],
        # Defaults to one routed requirement so a proposal REACHES department
        # review and stops there. With no requirements it would auto-complete
        # immediately - correct behaviour, covered by its own test below.
        "selectedRequirements": ["logistics"],
    }
    payload.update(overrides)
    return payload


def create_proposal(cur, applicant_email: str, **overrides) -> int:
    principal = principal_for(cur, applicant_email)
    applicant = proposals.load_applicant(cur, principal.user_id)
    return proposals.create(cur, applicant, make_payload(a_venue(cur), **overrides), draft=False)


def status_of(cur, request_id: int) -> str:
    return fetch_one(cur, "SELECT status FROM request WHERE request_id = %s", (request_id,))["status"]


# --- Entry into the workflow ---------------------------------------------
def test_ordinary_applicant_starts_at_hos_hod_review(cur):
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "hos_hod_review"


def test_applicant_who_heads_their_own_school_skips_hos_hod(cur):
    """Self-review guard: the HOS would otherwise review their own proposal."""
    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my")
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "department_review"


def test_cfo_applicant_skips_the_entire_approval_chain(cur):
    """The CFO is the last approval gate, so their own proposal cannot use it."""
    request_id = create_proposal(cur, "cfo@demo.apu.edu.my", totalPax=500)
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "department_review"


def test_fmb_head_applicant_skips_the_approval_chain(cur):
    request_id = create_proposal(cur, "fmb@demo.apu.edu.my", totalPax=500)
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "department_review"


# --- The high-pax chain ---------------------------------------------------
def test_low_pax_goes_straight_to_department_review(cur):
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my", totalPax=10)
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"


def test_high_pax_runs_fmb_then_cfo_then_departments(cur):
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my", totalPax=500)
    wf.submit(cur, request_id)

    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "fmb_review"

    wf.approve(cur, request_id, principal_for(cur, "fmb@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "cfo_review"

    wf.approve(cur, request_id, principal_for(cur, "cfo@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"


# --- Authorisation --------------------------------------------------------
def test_the_wrong_head_of_school_cannot_approve(cur):
    """A Business HOS has no authority over a Computing student's proposal."""
    from app.errors import Forbidden

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    with pytest.raises(Forbidden):
        wf.approve(cur, request_id, principal_for(cur, "hos.business@demo.apu.edu.my"))


def test_a_student_cannot_approve_their_own_proposal(cur):
    from app.errors import Forbidden

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    with pytest.raises(Forbidden):
        wf.approve(cur, request_id, principal_for(cur, "student.computing@demo.apu.edu.my"))


def test_cfo_cannot_act_at_the_hos_hod_stage(cur):
    from app.errors import Forbidden

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    with pytest.raises(Forbidden):
        wf.approve(cur, request_id, principal_for(cur, "cfo@demo.apu.edu.my"))


# --- Rejection and send-back ---------------------------------------------
def test_rejection_ends_the_proposal(cur):
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    wf.reject(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"), "Not this year.")
    assert status_of(cur, request_id) == "completed_rejected"


def test_rejection_requires_a_reason(cur):
    from app.errors import WorkflowError

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    with pytest.raises(WorkflowError):
        wf.reject(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"), "   ")


def test_send_back_from_cfo_resumes_at_cfo_not_at_the_start(cur):
    """The whole point of resume_stage. F&B already approved; it must not be
    asked again just because the CFO wanted a change."""
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my", totalPax=500)
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    wf.approve(cur, request_id, principal_for(cur, "fmb@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "cfo_review"

    wf.send_back(cur, request_id, principal_for(cur, "cfo@demo.apu.edu.my"), "Budget unclear.")
    row = fetch_one(cur, "SELECT status, resume_stage, reviewer_comment FROM request WHERE request_id = %s", (request_id,))
    assert row["status"] == "resubmission_required"
    assert row["resume_stage"] == "cfo_review"
    assert row["reviewer_comment"] == "Budget unclear."

    wf.applicant_resubmit(cur, request_id, principal_for(cur, "student.computing@demo.apu.edu.my"))
    row = fetch_one(cur, "SELECT status, resume_stage, reviewer_comment FROM request WHERE request_id = %s", (request_id,))
    assert row["status"] == "cfo_review"
    assert row["resume_stage"] is None
    assert row["reviewer_comment"] is None


def test_send_back_requires_a_comment(cur):
    from app.errors import WorkflowError

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    with pytest.raises(WorkflowError):
        wf.send_back(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"), "")


def test_only_an_owner_can_resubmit(cur):
    from app.errors import Forbidden

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    wf.send_back(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"), "Fix the dates.")
    with pytest.raises(Forbidden):
        wf.applicant_resubmit(cur, request_id, principal_for(cur, "student.business@demo.apu.edu.my"))


# --- Department review ----------------------------------------------------
def test_department_tasks_are_created_per_selected_requirement(cur):
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics", "soundLight"]
    )
    wf.submit(cur, request_id)
    tasks = wf.tasks_for_request(cur, request_id)
    routed = {t["requirement_name"]: t["assigned_unit_code"] for t in tasks}
    assert routed == {
        "logistics": "logistics_and_facilities",
        "soundLight": "a_v_services",
    }


def test_water_folds_into_the_single_fmb_task(cur):
    """F&B reviews food and water together - water never gets its own task."""
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["fmb", "waterNormal"]
    )
    wf.submit(cur, request_id)
    names = [t["requirement_name"] for t in wf.tasks_for_request(cur, request_id)]
    assert names == ["fmb"]


def test_a_proposal_needing_nothing_auto_completes(cur):
    """No requirements selected means no department has anything to do."""
    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my", selectedRequirements=[])
    wf.submit(cur, request_id)
    assert wf.tasks_for_request(cur, request_id) == []
    assert status_of(cur, request_id) == "completed_approved"


def test_funding_purchase_alone_auto_completes(cur):
    """Funding is recorded but never routed, so there is nothing left to fulfil.
    Without the auto-complete it would sit in department_review forever."""
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["fundingPurchase"]
    )
    wf.submit(cur, request_id)
    assert wf.tasks_for_request(cur, request_id) == []
    assert status_of(cur, request_id) == "completed_approved"


def test_a_department_cannot_act_on_another_departments_task(cur):
    from app.errors import Forbidden

    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"])
    wf.submit(cur, request_id)
    with pytest.raises(Forbidden):
        wf.approve_task(cur, request_id, "logistics", principal_for(cur, "av.manager@demo.apu.edu.my").user_id)


def test_department_send_back_leaves_siblings_untouched(cur):
    """Parallel independence: one department asking for changes must not stall
    the others, and must not move the proposal out of department_review."""
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics", "soundLight"]
    )
    wf.submit(cur, request_id)
    logistics_head = principal_for(cur, "logistics.manager@demo.apu.edu.my").user_id
    av_head = principal_for(cur, "av.manager@demo.apu.edu.my").user_id

    wf.approve_task(cur, request_id, "soundLight", av_head)
    wf.send_task_back(cur, request_id, "logistics", logistics_head, "Need exact quantities.")

    by_name = {t["requirement_name"]: t for t in wf.tasks_for_request(cur, request_id)}
    assert by_name["logistics"]["status"] == "resubmitted"
    assert by_name["soundLight"]["status"] == "approved"
    assert status_of(cur, request_id) == "department_review"


def test_applicant_resubmit_resets_only_the_sent_back_task(cur):
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics", "soundLight"]
    )
    wf.submit(cur, request_id)
    wf.approve_task(cur, request_id, "soundLight", principal_for(cur, "av.manager@demo.apu.edu.my").user_id)
    wf.send_task_back(
        cur, request_id, "logistics",
        principal_for(cur, "logistics.manager@demo.apu.edu.my").user_id, "More detail please.",
    )

    wf.applicant_resubmit(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    by_name = {t["requirement_name"]: t for t in wf.tasks_for_request(cur, request_id)}
    assert by_name["logistics"]["status"] == "pending"
    assert by_name["logistics"]["comment"] is None
    assert by_name["soundLight"]["status"] == "approved"


def test_department_send_back_requires_a_comment(cur):
    from app.errors import WorkflowError

    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"])
    wf.submit(cur, request_id)
    with pytest.raises(WorkflowError):
        wf.send_task_back(
            cur, request_id, "logistics",
            principal_for(cur, "logistics.manager@demo.apu.edu.my").user_id, "  ",
        )


# --- Per-partner conversations ---------------------------------------------
def test_conversations_group_a_reviewer_stage_thread_across_cycles(cur):
    """Two resubmit cycles at the same stage, same person, stay ONE thread -
    with every message preserved in order, none overwritten."""
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    hos = principal_for(cur, "hoshod@demo.apu.edu.my")
    applicant = principal_for(cur, "student.computing@demo.apu.edu.my")

    wf.send_back(cur, request_id, hos, "Please add a budget.")
    wf.applicant_resubmit(cur, request_id, applicant, comment="Added the budget.")
    wf.send_back(cur, request_id, hos, "The transportation cost still needs clarification.")
    wf.applicant_resubmit(cur, request_id, applicant, comment="Clarified the transportation cost.")

    request = wf.load_request(cur, request_id)
    threads = wf.conversations_for(cur, request, applicant.user_id)
    assert len(threads) == 1
    texts = [m["text"] for m in threads[0]["messages"]]
    assert texts == [
        "Please add a budget.",
        "Added the budget.",
        "The transportation cost still needs clarification.",
        "Clarified the transportation cost.",
    ]
    assert threads[0]["partnerName"] == "Rahim Abdullah" or threads[0]["partnerRoleLabel"] == "HOS/HOD"


def test_conversations_are_scoped_per_authority(cur):
    """A department thread and a reviewer-stage thread on the same proposal
    stay separate, and each authority sees only their own."""
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"]
    )
    wf.submit(cur, request_id)
    applicant = principal_for(cur, "hoshod@demo.apu.edu.my")
    logistics_head = principal_for(cur, "logistics.manager@demo.apu.edu.my")

    wf.send_task_back(cur, request_id, "logistics", logistics_head.user_id, "Need exact quantities.")
    wf.applicant_resubmit_task(cur, request_id, "logistics", applicant.user_id, comment="Set to 50.")

    request = wf.load_request(cur, request_id)

    applicant_threads = wf.conversations_for(cur, request, applicant.user_id)
    assert len(applicant_threads) == 1
    assert applicant_threads[0]["conversationId"].startswith("task:")

    logistics_threads = wf.conversations_for(cur, request, logistics_head.user_id)
    assert logistics_threads == applicant_threads

    # A different department head, never involved, sees nothing.
    av_head = principal_for(cur, "av.manager@demo.apu.edu.my")
    assert wf.conversations_for(cur, request, av_head.user_id) == []


def test_reject_does_not_appear_in_conversations(cur):
    """A rejection is terminal, not a back-and-forth - it must not surface as
    a conversation thread."""
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    hos = principal_for(cur, "hoshod@demo.apu.edu.my")
    applicant = principal_for(cur, "student.computing@demo.apu.edu.my")

    wf.reject(cur, request_id, hos, "Does not meet policy.")

    request = wf.load_request(cur, request_id)
    assert wf.conversations_for(cur, request, applicant.user_id) == []


# --- Staff assignment and completion --------------------------------------
def test_staff_assignment_and_completion_finishes_the_proposal(cur):
    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"])
    wf.submit(cur, request_id)
    head = principal_for(cur, "logistics.manager@demo.apu.edu.my")
    staff = principal_for(cur, "logistics.staff@demo.apu.edu.my")

    task = wf.find_task(cur, request_id, "logistics")
    wf.assign_staff(cur, task["request_task_id"], staff.user_id, head.user_id)
    wf.update_task_status(cur, task["request_task_id"], "preparing", staff.user_id)
    wf.update_task_status(cur, task["request_task_id"], "completed", staff.user_id)

    assert status_of(cur, request_id) == "completed_approved"


def test_staff_cannot_progress_a_task_they_are_not_assigned_to(cur):
    from app.errors import WorkflowError

    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"])
    wf.submit(cur, request_id)
    head = principal_for(cur, "logistics.manager@demo.apu.edu.my")
    assigned = principal_for(cur, "logistics.staff@demo.apu.edu.my")
    other = principal_for(cur, "logistics.staff2@demo.apu.edu.my")

    task = wf.find_task(cur, request_id, "logistics")
    wf.assign_staff(cur, task["request_task_id"], assigned.user_id, head.user_id)
    with pytest.raises(WorkflowError):
        wf.update_task_status(cur, task["request_task_id"], "preparing", other.user_id)


def test_staff_from_another_department_cannot_be_assigned(cur):
    from app.errors import WorkflowError

    request_id = create_proposal(cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"])
    wf.submit(cur, request_id)
    head = principal_for(cur, "logistics.manager@demo.apu.edu.my")
    outsider = principal_for(cur, "av.technician@demo.apu.edu.my")

    task = wf.find_task(cur, request_id, "logistics")
    with pytest.raises(WorkflowError):
        wf.assign_staff(cur, task["request_task_id"], outsider.user_id, head.user_id)


# --- Cancellation ---------------------------------------------------------
def test_cancel_cascades_to_open_department_tasks(cur):
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics", "soundLight"]
    )
    wf.submit(cur, request_id)
    wf.cancel(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))

    assert status_of(cur, request_id) == "cancelled"
    assert all(t["status"] == "cancelled" for t in wf.tasks_for_request(cur, request_id))


def test_only_an_owner_can_cancel(cur):
    from app.errors import Forbidden

    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my")
    wf.submit(cur, request_id)
    with pytest.raises(Forbidden):
        wf.cancel(cur, request_id, principal_for(cur, "student.business@demo.apu.edu.my"))


def test_cancellation_closes_near_the_event_date(cur):
    """CANCELLATION_DEADLINE_DAYS is 3, so an event tomorrow is already locked."""
    from app.errors import WorkflowError

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    request_id = create_proposal(
        cur,
        "student.computing@demo.apu.edu.my",
        scheduleRows=[{"date": tomorrow, "start": "09:00", "end": "17:00",
                       "locationKind": "inside", "venueId": a_venue(cur)}],
    )
    wf.submit(cur, request_id)
    with pytest.raises(WorkflowError):
        wf.cancel(cur, request_id, principal_for(cur, "student.computing@demo.apu.edu.my"))


def test_a_completed_proposal_cannot_be_cancelled(cur):
    from app.errors import WorkflowError

    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["fundingPurchase"]
    )
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    with pytest.raises(WorkflowError):
        wf.cancel(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))


# --- Audit trail ----------------------------------------------------------
def test_every_transition_is_recorded(cur):
    request_id = create_proposal(cur, "student.computing@demo.apu.edu.my", totalPax=500)
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    wf.approve(cur, request_id, principal_for(cur, "fmb@demo.apu.edu.my"))

    actions = [h["action"] for h in wf.history_for(cur, request_id)]
    assert actions.count("submit") == 1
    assert actions.count("approve") == 2

    last = wf.history_for(cur, request_id)[-1]
    assert last["previous_status"] == "fmb_review"
    assert last["new_status"] == "cfo_review"
    assert last["actor_name"] == "Nadia Hashim"


# --- Cafeteria order lifecycle (request_fmb_selection) --------------------
# Previously untested end to end (migration 013 adds the 'ready' status and delivery photo
# requirement) - these exercise the full staff-facing chain: create (F&B) -> approve (cafeteria
# manager) -> claim/"Start Preparing" -> ready/"Done Preparing" -> fulfil/"Delivered" (staff).
def _place_and_approve_order(cur, **create_overrides) -> tuple[int, int]:
    """A food proposal through fmb_review, with one cafeteria order approved
    and sitting in the Atrium Cafeteria's shared staff pool. Returns
    (request_id, selection_id)."""
    day = (date.today() + timedelta(days=30)).isoformat()
    request_id = create_proposal(
        cur, "student.computing@demo.apu.edu.my", selectedRequirements=["fmb"],
        requestRows={"fmb": [{
            "foodType": "fmb:1", "quantity": 20, "date": day,
            "start": "12:00", "venueId": a_venue(cur),
        }]},
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    # Below the high-pax threshold, hos_hod_review goes straight to department_review - fmb_review
    # only gates high-pax proposals (see test_high_pax_runs_fmb_then_cfo_then_departments above).
    assert status_of(cur, request_id) == "department_review"

    fmb_principal = principal_for(cur, "fmb@demo.apu.edu.my")
    selection = wf.create_selection(
        cur, request_id, fmb_principal.user_id,
        cafeteria_unit_code="cafeteria__atrium_cafeteria", fmb_option_id=1, quantity=10,
        **create_overrides,
    )
    selection_id = selection["id"]

    manager = principal_for(cur, "cafeteria.manager@demo.apu.edu.my")
    approved = wf.approve_selection(cur, selection_id, manager.user_id)
    assert approved["status"] == "approved"
    return request_id, selection_id


def test_cafeteria_order_lifecycle_reaches_delivered(cur):
    _request_id, selection_id = _place_and_approve_order(cur)
    staff = principal_for(cur, "cafeteria.staff2@demo.apu.edu.my")

    claimed = wf.claim_selection(cur, selection_id, staff.user_id)
    assert claimed["status"] == "preparing"
    assert claimed["claimed_by_user_id"] == staff.user_id

    ready = wf.mark_selection_ready(cur, selection_id, staff.user_id)
    assert ready["status"] == "ready"

    delivered = wf.fulfil_selection(cur, selection_id, staff.user_id, "/api/v1/uploads/deadbeef.jpg")
    assert delivered["status"] == "fulfilled"
    assert delivered["delivery_photo_url"] == "/api/v1/uploads/deadbeef.jpg"
    assert delivered["delivered_at"] is not None


def test_fulfilment_is_refused_without_going_through_ready(cur):
    """Delivered must be reached via Ready, not straight from Start Preparing."""
    from app.errors import WorkflowError

    _request_id, selection_id = _place_and_approve_order(cur)
    staff = principal_for(cur, "cafeteria.staff2@demo.apu.edu.my")
    wf.claim_selection(cur, selection_id, staff.user_id)

    with pytest.raises(WorkflowError):
        wf.fulfil_selection(cur, selection_id, staff.user_id, "/api/v1/uploads/deadbeef.jpg")


def test_fulfilment_is_refused_without_a_delivery_photo(cur):
    from app.errors import WorkflowError

    _request_id, selection_id = _place_and_approve_order(cur)
    staff = principal_for(cur, "cafeteria.staff2@demo.apu.edu.my")
    wf.claim_selection(cur, selection_id, staff.user_id)
    wf.mark_selection_ready(cur, selection_id, staff.user_id)

    with pytest.raises(WorkflowError):
        wf.fulfil_selection(cur, selection_id, staff.user_id, "")


def test_ready_is_refused_for_a_non_claimant(cur):
    from app.errors import Forbidden

    _request_id, selection_id = _place_and_approve_order(cur)
    claimant = principal_for(cur, "cafeteria.staff2@demo.apu.edu.my")
    other = principal_for(cur, "cafeteria.staff3@demo.apu.edu.my")
    wf.claim_selection(cur, selection_id, claimant.user_id)

    with pytest.raises(Forbidden):
        wf.mark_selection_ready(cur, selection_id, other.user_id)


def test_shared_pool_for_staff_carries_serve_date_and_time(cur):
    """The staff queue needs the raw serve date/time for same-day-start gating
    and the deadline reminder countdown - list_orders() (the manager's
    equivalent) already surfaces these; shared_pool_for_staff must too."""
    _request_id, selection_id = _place_and_approve_order(cur)
    staff = principal_for(cur, "cafeteria.staff2@demo.apu.edu.my")

    pool = wf.shared_pool_for_staff(cur, staff.user_id)
    mine = next(row for row in pool if row["request_fmb_selection_id"] == selection_id)
    assert mine["serve_date"] is not None
    assert mine["serve_time"] is not None


def test_flatten_requests_carries_a_raw_deadline_for_row_assignable_kinds(cur):
    """flatten_requests() must emit a real ISO deadline alongside the display
    'schedule' string, for the My Tasks calendar/same-day-start feature."""
    day = (date.today() + timedelta(days=30)).isoformat()
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my", selectedRequirements=["logistics"],
        requestRows={"logistics": [{
            "item": "logistics:1", "quantity": 5, "date": day,
            "start": "09:00", "end": "10:00", "venueId": a_venue(cur),
        }]},
    )
    rows = proposals.flatten_requests(cur, request_id)
    logistics_row = next(row for row in rows if row["department"] == "logistics")
    assert "deadline" in logistics_row
    assert logistics_row["deadline"] == f"{day}T09:00:00"
