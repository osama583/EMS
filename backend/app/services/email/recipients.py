"""Resolves "who should be emailed" for a proposal stage or department task.

Kept separate from services/workflow — that package answers "who may act",
this one answers "who should be told", which is a superset (e.g. the
applicant is told about things they can't act on, like a final rejection).
"""
from __future__ import annotations

from ...db import fetch_all, fetch_one
from ..workflow.constants import CFO_REVIEW, FMB_REVIEW, FMB_UNIT_CODE, HOS_HOD_REVIEW

Recipient = dict  # {"user_id": int, "full_name": str, "email": str}


def _users_with_role(cur, role_code: str, unit_code: str | None = None) -> list[Recipient]:
    if unit_code is None:
        sql = (
            "SELECT DISTINCT u.user_id, u.full_name, u.email FROM users u "
            "JOIN user_unit_roles r ON r.user_id = u.user_id "
            "WHERE r.role_code = %s AND u.is_active"
        )
        params: tuple = (role_code,)
    else:
        sql = (
            "SELECT DISTINCT u.user_id, u.full_name, u.email FROM users u "
            "JOIN user_unit_roles r ON r.user_id = u.user_id "
            "WHERE r.role_code = %s AND r.unit_code = %s AND u.is_active"
        )
        params = (role_code, unit_code)
    return fetch_all(cur, sql, params)


def _heads_of_unit(cur, unit_code: str) -> list[Recipient]:
    rows = fetch_all(
        cur,
        "SELECT DISTINCT u.user_id, u.full_name, u.email, un.description AS unit_description FROM users u "
        "JOIN user_unit_roles r ON r.user_id = u.user_id "
        "JOIN unit un ON un.code = r.unit_code "
        "WHERE r.unit_code = %s AND r.role_code IN ('head-of-school', 'head-of-department') AND u.is_active",
        (unit_code,),
    )
    return rows


def _applicant_schools(cur, applicant_user_id: int) -> list[str]:
    return [
        row["unit_code"]
        for row in fetch_all(
            cur,
            "SELECT DISTINCT unit_code FROM user_unit_roles WHERE user_id = %s AND unit_code IS NOT NULL",
            (applicant_user_id,),
        )
    ]


def reviewers_for_stage(cur, status: str, applicant_user_id: int) -> list[Recipient]:
    """Everyone who should be emailed "this proposal now needs your review"
    for the given `request.status`. Empty list for a status this doesn't
    apply to (e.g. a terminal or department-review status)."""
    if status == HOS_HOD_REVIEW:
        recipients: list[Recipient] = []
        for unit_code in _applicant_schools(cur, applicant_user_id):
            recipients.extend(_heads_of_unit(cur, unit_code))
        return recipients
    if status == FMB_REVIEW:
        return _heads_of_unit(cur, FMB_UNIT_CODE)
    if status == CFO_REVIEW:
        return _users_with_role(cur, "cfo")
    return []


def department_head_for_task(cur, task: dict) -> Recipient | None:
    """The single head who owns a `request_task` row, matching the same
    routing authorize_department_task() checks against."""
    if task.get("assigned_unit_code"):
        heads = _heads_of_unit(cur, task["assigned_unit_code"])
        return heads[0] if heads else None
    if task.get("assigned_role") == "fmb":
        heads = _heads_of_unit(cur, FMB_UNIT_CODE)
        return heads[0] if heads else None
    if task.get("assigned_role") == "cfo":
        cfos = _users_with_role(cur, "cfo")
        if not cfos:
            return None
        cfo = dict(cfos[0])
        cfo["unit_description"] = "Finance Office"
        return cfo
    return None


def department_heads_for_request(cur, request_id: int) -> list[Recipient]:
    """One recipient per open department task on a request — used when
    every routed department needs the same email (e.g. proposal cancelled)."""
    tasks = fetch_all(
        cur,
        "SELECT DISTINCT assigned_unit_code, assigned_role FROM request_task WHERE request_id = %s",
        (request_id,),
    )
    seen: set[int] = set()
    recipients: list[Recipient] = []
    for task in tasks:
        head = department_head_for_task(cur, task)
        if head and head["user_id"] not in seen:
            seen.add(head["user_id"])
            recipients.append(head)
    return recipients


def cafeteria_managers_of(cur, unit_code: str) -> list[Recipient]:
    return _users_with_role(cur, "cafeteria-manager", unit_code)


def role_label(cur, user_id: int) -> str:
    """"head-of-department — Logistics & Facilities" style label for account
    emails, matching admin.py's _role_label() shape."""
    row = fetch_one(
        cur,
        "SELECT r.role_code, u.description AS unit_description FROM user_unit_roles r "
        "LEFT JOIN unit u ON u.code = r.unit_code WHERE r.user_id = %s LIMIT 1",
        (user_id,),
    )
    if row is None:
        return ""
    if row["unit_description"]:
        return f"{row['role_code']} — {row['unit_description']}"
    return row["role_code"]
