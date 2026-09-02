"""Turns a workflow event into the right emails, for the right people.

Why this sits between the workflow and `notifications.py`:

  * `notifications.py` takes plain values and knows nothing about the schema.
  * `recipients.py` answers "who should be told" from the database.
  * The workflow knows only that a transition happened.

Something has to load the request row, resolve the audience, and format the
schedule line. Doing that inline in `stages.py`/`tasks.py` would put SELECTs
and copy-formatting into the state machine, so it lives here instead - the
workflow calls one function per transition and stays about state.

EVERY function here is best-effort. An email must never fail the transaction
that triggered it: `client.send()` already swallows SMTP errors, and
`_safe()` additionally swallows anything raised while GATHERING the data (a
missing head of unit, a deleted user). A proposal approval that 500s because
nobody heads a department would be a far worse bug than a missing email.

These are called INSIDE the workflow transaction, which is deliberate: the
cursor is live, the rows are the ones just written, and a rollback that
un-does an approval should not leave an email claiming it happened. The
trade-off is that a slow SMTP server slows the request; `client.send()` caps
that with a 10s socket timeout.
"""
from __future__ import annotations

import logging

from ...db import fetch_all, fetch_one
from . import notifications, recipients

logger = logging.getLogger(__name__)


def _safe(what: str, fn, *args, **kwargs) -> None:
    """Run a notification step, logging and swallowing anything it raises."""
    try:
        fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see module docstring
        logger.error("email.dispatch_failed", extra={"trigger": what, "reason": str(exc)})


def _request(cur, request_id: int) -> dict | None:
    return fetch_one(cur, "SELECT * FROM request WHERE request_id = %s", (request_id,))


def _schedule_line(cur, request_id: int) -> str:
    """"12 Sep 2026, 09:00-17:00 at Grand Hall" - the one-line summary every
    template's "When" row shows. Multi-day events collapse to their first row
    plus a count, which is what the detail block has space for."""
    rows = fetch_all(
        cur,
        'SELECT "date", start_time, end_time, location FROM event_schedule '
        "WHERE request_id = %s ORDER BY event_schedule_id",
        (request_id,),
    )
    if not rows:
        return "To be confirmed"
    first = rows[0]
    line = (
        f"{first['date']:%d %b %Y}, {str(first['start_time'])[:5]}-{str(first['end_time'])[:5]}"
        f" at {first['location']}"
    )
    return line if len(rows) == 1 else f"{line} (+{len(rows) - 1} more session(s))"


def _venue_line(cur, request_id: int) -> str:
    row = fetch_one(
        cur,
        'SELECT location FROM event_schedule WHERE request_id = %s ORDER BY event_schedule_id LIMIT 1',
        (request_id,),
    )
    return (row and row["location"]) or "To be confirmed"


def _co_owners(cur, request_id: int) -> list[dict]:
    return fetch_all(
        cur,
        "SELECT trim(staff_first_name || ' ' || coalesce(staff_last_name, '')) AS name, "
        "       staff_email AS email "
        "  FROM co_owners WHERE request_id = %s",
        (request_id,),
    )


# --------------------------------------------------------------------------
# Proposal workflow
# --------------------------------------------------------------------------

def proposal_entered_stage(cur, request_id: int, *, is_resubmission: bool = False) -> None:
    """The proposal moved INTO a single-actor review stage - tell whoever now
    owns it. No-ops for department_review (that fans out per task instead) and
    for every terminal status, because reviewers_for_stage returns [] there."""
    request = _request(cur, request_id)
    if request is None:
        return
    audience = recipients.reviewers_for_stage(cur, request["status"], request["applicant_user_id"])
    schedule = _schedule_line(cur, request_id)
    for person in audience:
        _safe(
            "proposal_awaiting_review",
            notifications.proposal_awaiting_review,
            reviewer_email=person["email"],
            reviewer_name=person["full_name"],
            proposal_id=request["request_code"],
            event_title=request["event_title"],
            applicant=request["applicant_name"],
            applicant_email=request["applicant_email"],
            applicant_department=request["applicant_department_or_school"] or "",
            schedule=schedule,
            is_resubmission=is_resubmission,
        )


def proposal_rejected(cur, request_id: int, reason: str) -> None:
    request = _request(cur, request_id)
    if request is None:
        return
    _safe(
        "proposal_rejected",
        notifications.proposal_rejected,
        applicant_email=request["applicant_email"],
        applicant_name=request["applicant_name"],
        proposal_id=request["request_code"],
        event_title=request["event_title"],
        reviewer_comment=reason,
    )


def proposal_sent_back(cur, request_id: int, comment: str) -> None:
    request = _request(cur, request_id)
    if request is None:
        return
    _safe(
        "proposal_sent_back",
        notifications.proposal_sent_back,
        applicant_email=request["applicant_email"],
        applicant_name=request["applicant_name"],
        proposal_id=request["request_code"],
        event_title=request["event_title"],
        reviewer_comment=comment,
    )


def proposal_fully_approved(cur, request_id: int) -> None:
    """Every department has signed off - tell the applicant AND every
    co-owner, since a co-owner is an owner of the event, not a bystander."""
    request = _request(cur, request_id)
    if request is None:
        return
    schedule = _schedule_line(cur, request_id)
    people = [{"name": request["applicant_name"], "email": request["applicant_email"]}]
    people.extend({"name": c["name"], "email": c["email"]} for c in _co_owners(cur, request_id))
    for person in people:
        if not person["email"]:
            continue
        _safe(
            "proposal_fully_approved",
            notifications.proposal_fully_approved,
            recipient_email=person["email"],
            recipient_name=person["name"],
            proposal_id=request["request_code"],
            event_title=request["event_title"],
            schedule=schedule,
        )


def open_items_by_user(cur, open_tasks: list[dict]) -> dict[int, str]:
    """Map each department head to the requirement they were still holding.

    Must be built BEFORE the caller cancels those task rows, which is why the
    workflow gathers it rather than this module re-reading them afterwards.
    """
    items: dict[int, str] = {}
    for task in open_tasks:
        head = recipients.department_head_for_task(cur, task)
        if not head:
            continue
        requirement = fetch_one(
            cur,
            "SELECT requirement_name FROM event_requirements WHERE requirement_id = %s",
            (task["requirement_id"],),
        )
        items[head["user_id"]] = (
            (requirement and requirement["requirement_name"]) or "your pending review"
        )
    return items


def proposal_cancelled(cur, request_id: int, open_items_by_user: dict[int, str] | None = None) -> None:
    """The applicant pulled the event - tell everyone still holding open work
    on it so it stops sitting in their queue."""
    request = _request(cur, request_id)
    if request is None:
        return
    open_items_by_user = open_items_by_user or {}
    for person in recipients.department_heads_for_request(cur, request_id):
        _safe(
            "proposal_cancelled",
            notifications.proposal_cancelled,
            recipient_email=person["email"],
            recipient_name=person["full_name"],
            proposal_id=request["request_code"],
            event_title=request["event_title"],
            applicant=request["applicant_name"],
            open_item=open_items_by_user.get(person["user_id"], "your pending review"),
        )


# --------------------------------------------------------------------------
# Department tasks
# --------------------------------------------------------------------------

def department_tasks_created(cur, request_id: int) -> None:
    """The proposal reached department_review - tell each routed department
    head about their own requirement (one email each, not one per proposal)."""
    request = _request(cur, request_id)
    if request is None:
        return
    schedule = _schedule_line(cur, request_id)
    tasks = fetch_all(
        cur,
        "SELECT t.*, rq.requirement_name FROM request_task t "
        "JOIN event_requirements rq ON rq.requirement_id = t.requirement_id "
        "WHERE t.request_id = %s AND t.status = 'pending'",
        (request_id,),
    )
    for task in tasks:
        head = recipients.department_head_for_task(cur, task)
        if not head:
            continue
        _safe(
            "department_task_awaiting_review",
            notifications.department_task_awaiting_review,
            department_head_email=head["email"],
            department_head_name=head["full_name"],
            proposal_code=request["request_code"],
            event_title=request["event_title"],
            applicant=request["applicant_name"],
            applicant_email=request["applicant_email"],
            unit_description=head.get("unit_description") or "the department",
            requirement_name=task["requirement_name"],
            schedule=schedule,
        )


def department_task_resubmitted(cur, request_id: int, task: dict) -> None:
    """The applicant fixed one department's requirement - tell only that
    department, since the others' reviews were never affected."""
    request = _request(cur, request_id)
    if request is None:
        return
    head = recipients.department_head_for_task(cur, task)
    if not head:
        return
    requirement = fetch_one(
        cur,
        "SELECT requirement_name FROM event_requirements WHERE requirement_id = %s",
        (task["requirement_id"],),
    )
    _safe(
        "department_task_awaiting_review",
        notifications.department_task_awaiting_review,
        department_head_email=head["email"],
        department_head_name=head["full_name"],
        proposal_code=request["request_code"],
        event_title=request["event_title"],
        applicant=request["applicant_name"],
        applicant_email=request["applicant_email"],
        unit_description=head.get("unit_description") or "the department",
        requirement_name=(requirement and requirement["requirement_name"]) or "the requirement",
        schedule=_schedule_line(cur, request_id),
        is_resubmission=True,
    )


def department_task_sent_back(cur, request_id: int, task: dict, comment: str) -> None:
    request = _request(cur, request_id)
    if request is None:
        return
    head = recipients.department_head_for_task(cur, task)
    _safe(
        "department_task_sent_back",
        notifications.department_task_sent_back,
        applicant_email=request["applicant_email"],
        applicant_name=request["applicant_name"],
        proposal_id=request["request_code"],
        event_title=request["event_title"],
        unit_description=(head and head.get("unit_description")) or "A department",
        comment=comment,
    )


def cafeteria_order_created(cur, request_id: int, cafeteria_code: str, order_summary: str) -> None:
    """F&B routed food to a specific cafeteria - tell that cafeteria's
    manager(s), who are the only ones who can act on it."""
    request = _request(cur, request_id)
    if request is None:
        return
    for manager in recipients.cafeteria_managers_of(cur, cafeteria_code):
        _safe(
            "cafeteria_order_awaiting_review",
            notifications.cafeteria_order_awaiting_review,
            manager_email=manager["email"],
            manager_name=manager["full_name"],
            proposal_id=request["request_code"],
            event_title=request["event_title"],
            order_summary=order_summary,
        )


# --------------------------------------------------------------------------
# Event registration (attendee side)
# --------------------------------------------------------------------------

def registration_created(cur, request_id: int, *, registrant_name: str,
                         registrant_email: str, pending: bool, reason: str = "") -> None:
    """Someone registered for a published event.

    Two emails, deliberately: the registrant always hears what happened, and
    for an approval-based event the ORGANISER is told a decision is waiting -
    otherwise the request sits in a queue nobody was told to open.
    """
    if not registrant_email:
        return
    request = _request(cur, request_id)
    if request is None:
        return
    schedule = _schedule_line(cur, request_id)
    venue = _venue_line(cur, request_id)

    if pending:
        _safe(
            "registration_pending_approval",
            notifications.registration_pending_approval,
            registrant_email=registrant_email,
            registrant_name=registrant_name,
            event_title=request["event_title"],
            schedule=schedule,
            venue=venue,
        )
        if request["applicant_email"]:
            _safe(
                "registration_awaiting_decision",
                notifications.registration_awaiting_decision,
                organiser_email=request["applicant_email"],
                organiser_name=request["applicant_name"],
                event_title=request["event_title"],
                registrant_name=registrant_name,
                registrant_email=registrant_email,
                reason=reason,
            )
        return

    _safe(
        "registration_confirmed",
        notifications.registration_confirmed,
        registrant_email=registrant_email,
        registrant_name=registrant_name,
        event_title=request["event_title"],
        schedule=schedule,
        venue=venue,
        organiser=request["applicant_name"],
    )


def registration_decided(cur, request_id: int, *, registrant_name: str,
                         registrant_email: str, approved: bool) -> None:
    """The organiser approved or rejected a pending registration."""
    if not registrant_email:
        return
    request = _request(cur, request_id)
    if request is None:
        return
    if approved:
        _safe(
            "registration_approved",
            notifications.registration_approved,
            registrant_email=registrant_email,
            registrant_name=registrant_name,
            event_title=request["event_title"],
            schedule=_schedule_line(cur, request_id),
            venue=_venue_line(cur, request_id),
            organiser=request["applicant_name"],
        )
        return
    _safe(
        "registration_rejected",
        notifications.registration_rejected,
        registrant_email=registrant_email,
        registrant_name=registrant_name,
        event_title=request["event_title"],
    )


# --------------------------------------------------------------------------
# Clubs
# --------------------------------------------------------------------------

def club_join_requested(cur, club_id: int, *, requester_name: str,
                        requester_email: str, reason: str) -> None:
    """Tell the club's President - the only person who can decide."""
    club = fetch_one(
        cur,
        "SELECT c.club_name, u.full_name AS president_name, u.email AS president_email "
        "FROM clubs c LEFT JOIN users u ON u.user_id = c.user_id WHERE c.club_id = %s",
        (club_id,),
    )
    if club is None or not club["president_email"]:
        return
    _safe(
        "club_join_request_received",
        notifications.club_join_request_received,
        president_email=club["president_email"],
        president_name=club["president_name"],
        club_name=club["club_name"],
        requester_name=requester_name,
        requester_email=requester_email,
        reason=reason,
    )


def club_join_decided(cur, join_request_id: int, *, approved: bool, comment: str) -> None:
    """Tell the applicant the President's decision."""
    row = fetch_one(
        cur,
        "SELECT c.club_name, u.full_name AS requester_name, u.email AS requester_email "
        "FROM club_join_requests j "
        "JOIN clubs c ON c.club_id = j.club_id "
        "JOIN users u ON u.user_id = j.requester_user_id "
        "WHERE j.club_join_request_id = %s",
        (join_request_id,),
    )
    if row is None or not row["requester_email"]:
        return
    if approved:
        _safe(
            "club_join_request_approved",
            notifications.club_join_request_approved,
            requester_email=row["requester_email"],
            requester_name=row["requester_name"],
            club_name=row["club_name"],
        )
        return
    _safe(
        "club_join_request_rejected",
        notifications.club_join_request_rejected,
        requester_email=row["requester_email"],
        requester_name=row["requester_name"],
        club_name=row["club_name"],
        comment=comment,
    )


def club_member_removed(cur, club_id: int, member_user_id: int, *, by_president: bool) -> None:
    """Tell someone their club membership was ended for them.

    Only ever called for a removal performed by SOMEONE ELSE. Walking out is not
    being shown out (the same distinction club_membership_log records), and
    mailing a person to report an action they just took themselves is noise.
    """
    row = fetch_one(
        cur,
        "SELECT c.club_name, u.full_name AS member_name, u.email AS member_email "
        "  FROM clubs c JOIN users u ON u.user_id = %s WHERE c.club_id = %s",
        (member_user_id, club_id),
    )
    if row is None or not row["member_email"]:
        return
    _safe(
        "club_membership_removed",
        notifications.club_membership_removed,
        member_email=row["member_email"],
        member_name=row["member_name"],
        club_name=row["club_name"],
        removed_by="the club's President" if by_president else "a Club Administrator",
    )


# --- Approval escalation (migration 037) ------------------------------------
# Unlike everything above, these are called from the daily job rather than from
# inside a workflow transaction. They are still best-effort for the same reason:
# a mailbox problem must not stop the job marking the rest of the batch.

_STAGE_LABEL = {
    "hos_hod_review": "HOS/HOD review",
    "fmb_review": "F&B review",
    "cfo_review": "CFO review",
    "department_review": "department review",
    "implementation": "implementation",
}


def _fmb_contacts(cur) -> list[dict]:
    """The F&B office, copied on every overdue notice so the applicant has a
    person to talk to rather than a dead end.

    Resolved through the same routing department_head_for_task() uses, so the
    F&B head here is always the one the rest of the system would email.
    """
    head = recipients.department_head_for_task(cur, {"assigned_role": "fmb"})
    return [head] if head else []


def escalation_decision_due(cur, proposal: dict, *, urgent: bool) -> int:
    """Chase whoever is holding an undecided proposal. Returns emails sent.

    At department_review the holders are the departments that have not
    responded - each gets its own email about its own task, since none of them
    can act for another. Implementation is chased the same way: the department
    head owns their staff's delivery, and it is still their task that has not
    reached 'completed'.
    """
    stage = proposal["status"]
    label = _STAGE_LABEL.get(stage, stage)
    schedule = _schedule_line(cur, proposal["request_id"])
    sent = 0

    if stage in ("department_review", "implementation"):
        targets = recipients.department_heads_for_request(cur, proposal["request_id"])
    else:
        targets = recipients.reviewers_for_stage(cur, stage, proposal["applicant_user_id"])

    # The applicant is copied only once it is urgent: at that point they may
    # still be able to chase the approver themselves, which is worth the
    # interruption. Copying them on every routine reminder would not be.
    also = []
    if urgent:
        applicant = fetch_one(
            cur,
            "SELECT email FROM users WHERE user_id = %s",
            (proposal["applicant_user_id"],),
        )
        if applicant and applicant["email"]:
            also = [applicant["email"]]

    for person in targets:
        if not person.get("email"):
            continue
        _safe(
            "escalation_decision_due",
            notifications.proposal_decision_due,
            approver_email=person["email"],
            approver_name=person.get("full_name") or "there",
            proposal_id=proposal["request_code"],
            event_title=proposal["event_title"],
            stage_label=label,
            days_until_event=int(proposal["days_until_event"]),
            schedule_line=schedule,
            urgent=urgent,
            also_notify=also,
        )
        sent += 1
    return sent


def escalation_proposal_overdue(cur, proposal: dict) -> int:
    """Apologise to the applicant, and copy F&B so there is a human to contact.

    No call to action beyond that: the proposal is not handed back for editing,
    because the event date is gone and only a conversation can decide what
    happens next.
    """
    applicant = fetch_one(
        cur,
        "SELECT full_name, email FROM users WHERE user_id = %s",
        (proposal["applicant_user_id"],),
    )
    if not applicant or not applicant["email"]:
        return 0

    fmb = [p["email"] for p in _fmb_contacts(cur) if p.get("email")]
    contact = (
        "Please contact the F&B office, who are copied on this email, to discuss "
        "rescheduling or resubmitting this event."
    )
    _safe(
        "escalation_proposal_overdue",
        notifications.proposal_overdue_applicant,
        applicant_email=applicant["email"],
        applicant_name=applicant["full_name"] or "there",
        proposal_id=proposal["request_code"],
        event_title=proposal["event_title"],
        stage_label=_STAGE_LABEL.get(proposal["status"], proposal["status"]),
        event_date_label=f"{proposal['first_date']:%d %b %Y}",
        contact_line=contact,
        also_notify=fmb,
    )
    return 1
