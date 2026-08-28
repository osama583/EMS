"""Who may act, given the proposal's CURRENT state.

Single source of truth for workflow permission. Every mutation calls in here
FIRST, before touching a row, and the answer is derived from the database - the
actor comes from the JWT and the stage from the request row. Nothing the client
sends contributes to the decision.
"""
from __future__ import annotations

from datetime import date, timedelta

from ...db import fetch_all, fetch_one
from ...errors import Forbidden, NotFound, WorkflowError
from ...security.principal import Principal
from .constants import (
    CANCELLED,
    CFO_REVIEW,
    COMPLETED_APPROVED,
    COMPLETED_REJECTED,
    FMB_REVIEW,
    FMB_UNIT_CODE,
    HEAD_ROLE_CODES,
    HOS_HOD_REVIEW,
    cancellation_deadline_days,
)


def load_request(cur, request_id: int) -> dict:
    row = fetch_one(cur, "SELECT * FROM request WHERE request_id = %s", (request_id,))
    if row is None:
        raise NotFound("Proposal not found.")
    return row


def heads_unit(cur, user_id: int, unit_code: str | None) -> bool:
    if not unit_code:
        return False
    row = fetch_one(
        cur,
        "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND unit_code = %s AND role_code = ANY(%s)",
        (user_id, unit_code, list(HEAD_ROLE_CODES)),
    )
    return row is not None


def has_role(cur, user_id: int, role_code: str, unit_code: str | None = None) -> bool:
    if unit_code is None:
        sql = "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND role_code = %s"
        params: tuple = (user_id, role_code)
    else:
        sql = "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND role_code = %s AND unit_code = %s"
        params = (user_id, role_code, unit_code)
    return fetch_one(cur, sql, params) is not None


def is_school_unit(cur, unit_code: str) -> bool:
    """A School is a unit that has a head-of-school; a Service department has a
    head-of-department. The distinction lives in the role, not a column."""
    return (
        fetch_one(
            cur,
            "SELECT 1 FROM user_unit_roles WHERE unit_code = %s AND role_code = 'head-of-school'",
            (unit_code,),
        )
        is not None
    )


def is_hos_hod_for_applicant(cur, user_id: int, request: dict) -> bool:
    """True if `user_id` heads any SCHOOL unit the applicant belongs to.

    Used two ways: to decide whether a reviewer may act at hos_hod_review, and
    (with user_id = the applicant) to detect self-review and skip the stage.
    """
    applicant_units = [
        row["unit_code"]
        for row in fetch_all(
            cur,
            "SELECT DISTINCT unit_code FROM user_unit_roles WHERE user_id = %s AND unit_code IS NOT NULL",
            (request["applicant_user_id"],),
        )
    ]
    return any(
        heads_unit(cur, user_id, unit) and is_school_unit(cur, unit) for unit in applicant_units
    )


# --- Proposal ownership ---------------------------------------------------
def is_applicant(cur, request_id: int, user_id: int) -> bool:
    row = fetch_one(
        cur, "SELECT 1 FROM request WHERE request_id = %s AND applicant_user_id = %s", (request_id, user_id)
    )
    return row is not None


def is_co_owner(cur, request_id: int, user_id: int) -> bool:
    """Co-owners are snapshot rows. Match on the staff_id link when the co-owner
    was picked from the directory, and on the email snapshot otherwise - a
    co-owner typed in by hand has no staff_id at all."""
    row = fetch_one(
        cur,
        """
        SELECT 1
          FROM co_owners c
     LEFT JOIN staff s ON s.staff_id = c.staff_id
         WHERE c.request_id = %s
           AND (
                 s.user_id = %s
              OR lower(trim(c.staff_email)) = (SELECT lower(trim(email)) FROM users WHERE user_id = %s)
               )
        """,
        (request_id, user_id, user_id),
    )
    return row is not None


def is_proposal_owner(cur, request_id: int, user_id: int) -> bool:
    return is_applicant(cur, request_id, user_id) or is_co_owner(cur, request_id, user_id)


def assert_proposal_owner(cur, request_id: int, user_id: int) -> None:
    if not is_proposal_owner(cur, request_id, user_id):
        raise Forbidden("Only the applicant or a co-owner of this proposal can do that.")


# --- Cancellation window --------------------------------------------------
def earliest_event_date(cur, request_id: int) -> date | None:
    row = fetch_one(
        cur,
        # "date" is quoted: it is also a type name, so an unquoted reference is ambiguous.
        'SELECT min(s."date") AS first_date FROM event_schedule s WHERE s.request_id = %s',
        (request_id,),
    )
    return row["first_date"] if row and row["first_date"] else None


def is_within_cancellation_window(cur, request_id: int) -> bool:
    """Closes N whole days before the event's FIRST scheduled day, end of day.
    A proposal with no schedule yet is always cancellable."""
    first_day = earliest_event_date(cur, request_id)
    if first_day is None:
        return True
    return date.today() <= first_day - timedelta(days=cancellation_deadline_days(cur))


# --- Stage gates ----------------------------------------------------------
def authorize_stage_action(cur, request: dict, principal: Principal) -> None:
    """Assert `principal` may act at the request's current single-actor stage."""
    status = request["status"]

    if status == HOS_HOD_REVIEW:
        if not is_hos_hod_for_applicant(cur, principal.user_id, request):
            raise Forbidden("You are not the HOS/HOD for this applicant's unit.")
        return
    if status == FMB_REVIEW:
        if not heads_unit(cur, principal.user_id, FMB_UNIT_CODE):
            raise Forbidden("Only F&B can act at this stage.")
        return
    if status == CFO_REVIEW:
        if not has_role(cur, principal.user_id, "cfo"):
            raise Forbidden("Only the CFO can act at this stage.")
        return
    raise WorkflowError(f"This proposal is not awaiting a review decision (status: {status}).")


def authorize_cancel(cur, request: dict, principal: Principal) -> None:
    if request["status"] in (CANCELLED, COMPLETED_REJECTED, COMPLETED_APPROVED):
        raise WorkflowError("This proposal can no longer be cancelled.")
    assert_proposal_owner(cur, request["request_id"], principal.user_id)


def can_view_department_task(cur, task: dict, user_id: int) -> bool:
    """Non-raising sibling of authorize_department_task, for read-side
    filtering where a 403 would be wrong (the caller may legitimately see the
    proposal, just not this one department's task/conversation)."""
    if task["assigned_unit_code"]:
        return heads_unit(cur, user_id, task["assigned_unit_code"])
    if task["assigned_role"] == "fmb":
        return heads_unit(cur, user_id, FMB_UNIT_CODE)
    if task["assigned_role"] == "cfo":
        return has_role(cur, user_id, "cfo")
    return False


def authorize_department_task(cur, task: dict, user_id: int) -> None:
    """Only the head of the unit a task routed to may act on it.

    Reads the routing off the task row rather than trusting any department key
    the client sent, so a manager cannot act on another department's task by
    naming it in the request body.
    """
    if not task["assigned_unit_code"] and task["assigned_role"] not in ("fmb", "cfo"):
        raise WorkflowError("This task has no recognised routing.")
    if not can_view_department_task(cur, task, user_id):
        if task["assigned_unit_code"]:
            raise Forbidden("You do not head the department this request is routed to.")
        if task["assigned_role"] == "fmb":
            raise Forbidden("Only F&B can act on this request.")
        raise Forbidden("Only the CFO can act on this request.")


def is_cafeteria_staff_of(cur, user_id: int, unit_code: str) -> bool:
    return has_role(cur, user_id, "cafeteria-staff", unit_code)


def is_cafeteria_manager_of(cur, user_id: int, unit_code: str) -> bool:
    return has_role(cur, user_id, "cafeteria-manager", unit_code)
