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


# The whole-proposal reviewer chain has exactly these three stages (see constants.REVIEWER_STAGES) -
# unlike actor_role (which is ambiguous: a Service department's head-of-department and F&B's head-of-
# department share the same role_code), the STAGE a resubmit row was sent back FROM (its
# previous_status) unambiguously identifies which of the three it was.
_REVIEWER_STAGE_LABELS: dict[str, str] = {
    "hos_hod_review": "HOS/HOD",
    "fmb_review": "F&B",
    "cfo_review": "CFO",
}


def conversations_for(cur, request: dict, caller_user_id: int) -> list[dict[str, Any]]:
    """Group workflow_history's resubmit/applicant-resubmit rows into
    per-partner conversations, scoped to what caller_user_id may see.

    The applicant and co-owners see every thread on the proposal - they are a
    party to all of them. Anyone else sees only the thread where THEY are the
    identified authority partner: their own user_id for a reviewer-stage
    thread (the specific person who sent it back, not "whoever currently
    holds that role"), or a department task they currently head for a
    department thread - never another authority's thread.

    Conversation rows are exactly action IN ('resubmit', 'applicant-resubmit')
    - reject also writes a comment but is a terminal decision with no reply
      expected, not a back-and-forth, and is deliberately excluded.
    """
    # Local imports to avoid a circular import at module load time (authorization
    # imports nothing from history, but this keeps the dependency one-directional
    # and easy to reason about).
    from .authorization import can_view_department_task, is_proposal_owner

    request_id = request["request_id"]
    rows = [r for r in history_for(cur, request_id) if r["action"] in ("resubmit", "applicant-resubmit")]

    # partner_key -> {"messages": [...], "_partner_name": ..., "_partner_role_label": ...}
    threads: dict[tuple[str, Any], dict[str, Any]] = {}
    current_reviewer_partner: int | None = None

    for row in rows:
        if row["request_task_id"] is not None:
            key = ("task", row["request_task_id"])
            authority_role_label = row["requirement_name"] or "Department"
        else:
            if row["action"] == "resubmit":
                current_reviewer_partner = row["actor_user_id"]
            if current_reviewer_partner is None:
                # An applicant-resubmit with no preceding resubmit row for this
                # request_id - cannot happen given how send_back/applicant_resubmit
                # are called, but skip defensively rather than mis-attribute it.
                continue
            key = ("user", current_reviewer_partner)
            authority_role_label = _REVIEWER_STAGE_LABELS.get(row["previous_status"], row["actor_role"])

        thread = threads.setdefault(key, {"messages": []})
        if row["action"] == "resubmit":
            # Department threads are named after the requirement ("Logistics"), not the
            # individual head, since headship can change hands while the thread persists.
            # Reviewer-stage threads are named after the specific person (see module docstring).
            thread["_partner_name"] = authority_role_label if key[0] == "task" else row["actor_name"]
            thread["_partner_role_label"] = "Department" if key[0] == "task" else authority_role_label

        sender_side = "applicant" if row["action"] == "applicant-resubmit" else "authority"
        thread["messages"].append(
            {
                "senderSide": sender_side,
                "senderName": row["actor_name"] or request["applicant_name"],
                "senderRoleLabel": "Applicant" if sender_side == "applicant" else authority_role_label,
                "text": row["comment"] or "",
                "createdAt": row["created_at"].isoformat(),
            }
        )

    can_see_all = is_proposal_owner(cur, request_id, caller_user_id)

    result: list[dict[str, Any]] = []
    for key, thread in threads.items():
        if not thread["messages"]:
            continue
        if key[0] == "task":
            task_id = key[1]
            if not can_see_all:
                task_row = fetch_one(
                    cur,
                    "SELECT assigned_unit_code, assigned_role FROM request_task WHERE request_task_id = %s",
                    (task_id,),
                )
                if task_row is None or not can_view_department_task(cur, task_row, caller_user_id):
                    continue
            conversation_id = f"task:{task_id}"
        else:
            owner_user_id = key[1]
            if not can_see_all and caller_user_id != owner_user_id:
                continue
            conversation_id = f"user:{owner_user_id}"
        partner_name = thread.get("_partner_name") or "Reviewer"
        partner_role_label = thread.get("_partner_role_label") or "Reviewer"

        result.append(
            {
                "conversationId": conversation_id,
                "partnerName": partner_name,
                "partnerRoleLabel": partner_role_label,
                "messages": thread["messages"],
            }
        )

    return result
