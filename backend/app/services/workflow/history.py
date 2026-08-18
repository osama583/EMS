"""workflow_history writes - the audit trail for every state transition.

Called inside the same transaction as the change it records, so a transition
can never be applied without its history row (or vice versa).
"""
from __future__ import annotations

from typing import Any

from ...db import fetch_one
from ...logging_setup import audit

# Synthetic actors that have no users row. 'system' covers auto-completion when
# the last department task resolves and nobody clicked anything.
SYSTEM_ACTOR = "system"


def primary_role_code(cur, user_id: int | None) -> str:
    """Display-only role label for the history row. Never used for authorisation."""
    if user_id is None:
        return SYSTEM_ACTOR
    row = fetch_one(
        cur,
        "SELECT role_code FROM user_unit_roles WHERE user_id = %s ORDER BY user_unit_role_id LIMIT 1",
        (user_id,),
    )
    return row["role_code"] if row else "unknown"


def record(
    cur,
    request_id: int,
    *,
    action: str,
    actor_user_id: int | None,
    actor_role: str,
    previous_status: str | None = None,
    new_status: str | None = None,
    request_task_id: int | None = None,
    requirement_id: int | None = None,
    comment: str | None = None,
) -> None:
    # actor_user_id is NOT NULL in the schema, but auto-completion has no human
    # actor. The applicant carries the row in that case, with actor_role='system'
    # marking it as machine-driven.
    if actor_user_id is None:
        owner = fetch_one(cur, "SELECT applicant_user_id FROM request WHERE request_id = %s", (request_id,))
        actor_user_id = owner["applicant_user_id"] if owner else None
        actor_role = SYSTEM_ACTOR

    cur.execute(
        """
        INSERT INTO workflow_history
            (request_id, request_task_id, requirement_id, action, actor_user_id,
             actor_role, comment, previous_status, new_status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            request_id,
            request_task_id,
            requirement_id,
            action,
            actor_user_id,
            actor_role,
            comment or None,
            previous_status,
            new_status,
        ),
    )
    audit(
        f"workflow.{action}",
        request_id=request_id,
        actor_user_id=actor_user_id,
        previous_status=previous_status,
        new_status=new_status,
        request_task_id=request_task_id,
    )


def history_for(cur, request_id: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT h.workflow_history_id, h.action, h.actor_user_id, u.full_name AS actor_name,
               h.actor_role, h.comment, h.previous_status, h.new_status, h.created_at,
               h.request_task_id, er.requirement_name
          FROM workflow_history h
     LEFT JOIN users u ON u.user_id = h.actor_user_id
     LEFT JOIN event_requirements er ON er.requirement_id = h.requirement_id
         WHERE h.request_id = %s
      ORDER BY h.created_at, h.workflow_history_id
        """,
        (request_id,),
    )
    return [dict(row) for row in cur.fetchall()]
