"""The single-actor review chain: submit, approve, reject, send back, resume, cancel.

Stage order:

    submitted
      -> hos_hod_review          (skipped when the applicant heads their own School)
      -> fmb_review              (only when total_pax > HIGH_PAX_THRESHOLD)
      -> cfo_review              (only after fmb_review)
      -> department_review       (parallel tasks; see tasks.py)
      -> completed_approved

hos_hod_review is skipped in three cases (see _skips_hos_hod): the applicant
heads their own School, the applicant is the CFO or F&B head, or the applicant
belongs to no unit at all. The first two prevent self-review; the third prevents
a deadlock, since that stage is answered by the head of a unit the applicant
belongs to and there would be nobody who qualifies.

`resume_stage` is what makes "sent back, fixed, resumed" work. It records the
exact stage that pushed back, so a CFO-stage resubmission returns to cfo_review
rather than restarting at HOS/HOD. Once F&B has approved, it never sees the
proposal again at approval level.
"""
from __future__ import annotations

from ...db import fetch_all, fetch_one
from ...errors import WorkflowError
from ...security.principal import Principal
from . import history
from .authorization import (
    assert_proposal_owner,
    authorize_cancel,
    authorize_stage_action,
    has_role,
    heads_unit,
    is_hos_hod_for_applicant,
    is_within_cancellation_window,
    load_request,
)
from .constants import (
    CANCELLED,
    CFO_REVIEW,
    COMPLETED_REJECTED,
    DEPARTMENT_REVIEW,
    FMB_REVIEW,
    FMB_UNIT_CODE,
    HOS_HOD_REVIEW,
    RESUBMISSION_REQUIRED,
    REVIEWER_STAGES,
    SEL_TERMINAL,
    TASK_TERMINAL,
    cancellation_deadline_days,
    high_pax_threshold,
)
from ..email import dispatch
from .tasks import create_department_tasks


def _touch(cur, request_id: int, **columns) -> dict:
    """Apply column updates plus updated_at, and return the fresh row."""
    if not columns:
        cur.execute("UPDATE request SET updated_at = now() WHERE request_id = %s", (request_id,))
        return load_request(cur, request_id)
    assignments = ", ".join(f"{name} = %s" for name in columns)
    params = [*columns.values(), request_id]
    cur.execute(f"UPDATE request SET {assignments}, updated_at = now() WHERE request_id = %s", params)
    return load_request(cur, request_id)


def stage_after_hos_hod(cur, request: dict) -> str:
    """The gate that runs once the HOS/HOD box resolves, whether approved or skipped.

    1. Applicant is the CFO or the F&B head -> department_review. They would
       otherwise be the reviewer at fmb_review/cfo_review for their own proposal.
    2. total_pax over the configured threshold -> fmb_review, then cfo_review.
    3. Otherwise -> department_review.
    """
    applicant_id = request["applicant_user_id"]
    if has_role(cur, applicant_id, "cfo") or heads_unit(cur, applicant_id, FMB_UNIT_CODE):
        return DEPARTMENT_REVIEW
    return FMB_REVIEW if (request["total_pax"] or 0) > high_pax_threshold(cur) else DEPARTMENT_REVIEW


def _has_no_reviewable_unit(cur, applicant_id: int) -> bool:
    """True when the applicant belongs to no unit at all.

    hos_hod_review is answered by the head of a unit the APPLICANT belongs to.
    An applicant with only flat roles (CFO, System Admin, Club Admin, Cafeteria
    Admin) belongs to none, so that stage would have no possible actor and the
    proposal would sit there permanently. Skipping is the only non-deadlocking
    answer.

    This is a correction to the mock backend, which routed such proposals into
    hos_hod_review and stranded them.
    """
    return (
        fetch_one(
            cur,
            "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND unit_code IS NOT NULL LIMIT 1",
            (applicant_id,),
        )
        is None
    )


def _skips_hos_hod(cur, request: dict) -> bool:
    """Three reasons the HOS/HOD stage does not apply.

    1. The applicant heads their own School - they would be reviewing themselves.
    2. The applicant is the CFO or the F&B head. The specification puts them
       past ALL higher approval, and they are also the actors at the later
       fmb_review/cfo_review gates, so no stage above department review has an
       impartial reviewer for their proposal.
    3. The applicant belongs to no unit, so the stage has no possible actor.
    """
    applicant_id = request["applicant_user_id"]
    if is_hos_hod_for_applicant(cur, applicant_id, request):
        return True
    if has_role(cur, applicant_id, "cfo") or heads_unit(cur, applicant_id, FMB_UNIT_CODE):
        return True
    return _has_no_reviewable_unit(cur, applicant_id)


def submit(cur, request_id: int) -> dict:
    """Move a draft into the workflow at its correct first stage."""
    request = load_request(cur, request_id)
    previous = request["status"]
    applicant_id = request["applicant_user_id"]

    next_status = stage_after_hos_hod(cur, request) if _skips_hos_hod(cur, request) else HOS_HOD_REVIEW

    cur.execute(
        "UPDATE request SET status = %s, submitted_at = now(), updated_at = now() WHERE request_id = %s",
        (next_status, request_id),
    )
    if next_status == DEPARTMENT_REVIEW:
        create_department_tasks(cur, request_id)

    history.record(
        cur,
        request_id,
        action="submit",
        actor_user_id=applicant_id,
        actor_role=history.primary_role_code(cur, applicant_id),
        previous_status=previous,
        new_status=next_status,
    )
    # Tell whoever now owns it. department_review fans out per task instead of
    # to a single reviewer, which is why the two calls are not interchangeable.
    if next_status == DEPARTMENT_REVIEW:
        dispatch.department_tasks_created(cur, request_id)
    else:
        dispatch.proposal_entered_stage(cur, request_id)
    return load_request(cur, request_id)


def approve(cur, request_id: int, principal: Principal) -> dict:
    request = load_request(cur, request_id)
    authorize_stage_action(cur, request, principal)
    previous = request["status"]

    if previous == HOS_HOD_REVIEW:
        next_status = stage_after_hos_hod(cur, request)
    elif previous == FMB_REVIEW:
        # Sequential: F&B always hands off to the CFO, the last approval gate.
        next_status = CFO_REVIEW
    elif previous == CFO_REVIEW:
        next_status = DEPARTMENT_REVIEW
    else:
        raise WorkflowError("Cannot approve from status " + previous + ".")

    _touch(cur, request_id, status=next_status)
    if next_status == DEPARTMENT_REVIEW:
        create_department_tasks(cur, request_id)

    history.record(
        cur,
        request_id,
        action="approve",
        actor_user_id=principal.user_id,
        actor_role=history.primary_role_code(cur, principal.user_id),
        previous_status=previous,
        new_status=next_status,
    )
    if next_status == DEPARTMENT_REVIEW:
        dispatch.department_tasks_created(cur, request_id)
    else:
        dispatch.proposal_entered_stage(cur, request_id)
    return load_request(cur, request_id)


def reject(cur, request_id: int, principal: Principal, reason: str) -> dict:
    request = load_request(cur, request_id)
    authorize_stage_action(cur, request, principal)
    previous = request["status"]
    if previous not in REVIEWER_STAGES:
        raise WorkflowError("Cannot reject from status " + previous + ".")

    reason = (reason or "").strip()
    if not reason:
        raise WorkflowError("A rejection needs a reason so the applicant understands the decision.")

    _touch(cur, request_id, status=COMPLETED_REJECTED, reviewer_comment=reason)
    history.record(
        cur,
        request_id,
        action="reject",
        actor_user_id=principal.user_id,
        actor_role=history.primary_role_code(cur, principal.user_id),
        comment=reason,
        previous_status=previous,
        new_status=COMPLETED_REJECTED,
    )
    dispatch.proposal_rejected(cur, request_id, reason)
    return load_request(cur, request_id)


def send_back(cur, request_id: int, principal: Principal, comment: str) -> dict:
    """Reviewer returns the proposal to the applicant for changes.

    Stamps resume_stage with the CURRENT stage, so the applicant's resubmission
    re-enters here and not at the start of the chain.
    """
    request = load_request(cur, request_id)
    authorize_stage_action(cur, request, principal)
    previous = request["status"]

    comment = (comment or "").strip()
    if not comment:
        raise WorkflowError("Explain what needs to change so the applicant can fix it.")

    _touch(
        cur,
        request_id,
        status=RESUBMISSION_REQUIRED,
        resume_stage=previous,
        reviewer_comment=comment,
    )
    history.record(
        cur,
        request_id,
        action="resubmit",
        actor_user_id=principal.user_id,
        actor_role=history.primary_role_code(cur, principal.user_id),
        comment=comment,
        previous_status=previous,
        new_status=RESUBMISSION_REQUIRED,
    )
    dispatch.proposal_sent_back(cur, request_id, comment)
    return load_request(cur, request_id)


def applicant_resubmit(cur, request_id: int, principal: Principal, comment: str | None = None) -> dict:
    """The applicant returns work that was sent back. Two distinct cases.

    Case 1 - a reviewer stage sent the whole proposal back: status is
    resubmission_required, and it resumes at resume_stage.

    Case 2 - a DEPARTMENT sent one of its tasks back: the proposal itself never
    left department_review, because sibling departments kept working. Only the
    tasks that asked for changes reset to pending; every other task's progress
    is untouched.

    Content is saved separately (see services/proposals.py) so this function
    owns the transition alone. `comment` is the applicant's reply, recorded
    alongside the transition so it joins the same per-partner conversation as
    the reviewer's/department's original send-back comment (see
    history.conversations_for).
    """
    request = load_request(cur, request_id)
    assert_proposal_owner(cur, request_id, principal.user_id)

    sent_back_tasks = fetch_all(
        cur,
        "SELECT * FROM request_task WHERE request_id = %s AND status = 'resubmitted'",
        (request_id,),
    )
    if request["status"] == DEPARTMENT_REVIEW and sent_back_tasks:
        for task in sent_back_tasks:
            cur.execute(
                "UPDATE request_task SET status = 'pending', comment = NULL WHERE request_task_id = %s",
                (task["request_task_id"],),
            )
            history.record(
                cur,
                request_id,
                action="applicant-resubmit",
                actor_user_id=principal.user_id,
                actor_role="applicant",
                request_task_id=task["request_task_id"],
                requirement_id=task["requirement_id"],
                comment=comment,
                previous_status="resubmitted",
                new_status="pending",
            )
            # Only the department that sent this task back is told - the others
            # never stopped working and have nothing new to look at.
            dispatch.department_task_resubmitted(cur, request_id, task)
        return _touch(cur, request_id)

    if request["status"] != RESUBMISSION_REQUIRED:
        raise WorkflowError("Cannot resubmit from status " + request["status"] + ".")

    resume_status = request["resume_stage"] or HOS_HOD_REVIEW
    _touch(cur, request_id, status=resume_status, resume_stage=None, reviewer_comment=None)
    history.record(
        cur,
        request_id,
        action="applicant-resubmit",
        actor_user_id=principal.user_id,
        actor_role="applicant",
        comment=comment,
        previous_status=RESUBMISSION_REQUIRED,
        new_status=resume_status,
    )
    if resume_status == DEPARTMENT_REVIEW:
        dispatch.department_tasks_created(cur, request_id)
    else:
        dispatch.proposal_entered_stage(cur, request_id, is_resubmission=True)
    return load_request(cur, request_id)


def cancel(cur, request_id: int, principal: Principal) -> dict:
    """Cancel a proposal, cascading to every open task and cafeteria order.

    The cascade matters: without it, departments and cafeteria staff mid-fulfilment
    would keep a dead event sitting in their inbox as pending work.
    """
    request = load_request(cur, request_id)
    authorize_cancel(cur, request, principal)
    if not is_within_cancellation_window(cur, request_id):
        raise WorkflowError(
            "The cancellation deadline for this event has passed (cancellation closes "
            + str(cancellation_deadline_days(cur))
            + " day(s) before the event)."
        )

    previous = request["status"]
    actor_role = history.primary_role_code(cur, principal.user_id)

    cur.execute(
        "UPDATE request SET status = %s, cancelled_at = now(), cancelled_by_user_id = %s, "
        "updated_at = now() WHERE request_id = %s",
        (CANCELLED, principal.user_id, request_id),
    )
    history.record(
        cur,
        request_id,
        action="cancel",
        actor_user_id=principal.user_id,
        actor_role=actor_role,
        previous_status=previous,
        new_status=CANCELLED,
    )

    open_tasks = fetch_all(
        cur,
        "SELECT * FROM request_task WHERE request_id = %s AND NOT (status = ANY(%s))",
        (request_id, list(TASK_TERMINAL)),
    )
    # Gather who is holding what BEFORE the loop below cancels the rows, so each
    # head can be told which of their own items just went away.
    dispatch.proposal_cancelled(cur, request_id, dispatch.open_items_by_user(cur, open_tasks))
    for task in open_tasks:
        cur.execute(
            "UPDATE request_task SET status = 'cancelled', resolved_at = now(), "
            "resolved_by_user_id = %s WHERE request_task_id = %s",
            (principal.user_id, task["request_task_id"]),
        )
        history.record(
            cur,
            request_id,
            action="cancel",
            actor_user_id=principal.user_id,
            actor_role=actor_role,
            request_task_id=task["request_task_id"],
            requirement_id=task["requirement_id"],
            comment="Cancelled because the proposal was cancelled.",
            previous_status=task["status"],
            new_status="cancelled",
        )

    open_selections = fetch_all(
        cur,
        "SELECT s.* FROM request_fmb_selection s "
        "JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id "
        "WHERE f.request_id = %s AND NOT (s.status = ANY(%s))",
        (request_id, list(SEL_TERMINAL)),
    )
    for selection in open_selections:
        cur.execute(
            "UPDATE request_fmb_selection SET status = 'cancelled' WHERE request_fmb_selection_id = %s",
            (selection["request_fmb_selection_id"],),
        )
        history.record(
            cur,
            request_id,
            action="cancel-selection",
            actor_user_id=principal.user_id,
            actor_role=actor_role,
            comment="Cancelled because the proposal was cancelled.",
            previous_status=selection["status"],
            new_status="cancelled",
        )

    return load_request(cur, request_id)
