"""Proposals: the applicant's own submissions and every review action on them.

Resource design
---------------
    GET    /proposals                      scoped to the caller (see below)
    POST   /proposals                      create and submit
    POST   /proposals/drafts               create or update a draft
    GET    /proposals/{id}                 one proposal, if the caller may see it
    PATCH  /proposals/{id}                 save content without changing stage
    DELETE /proposals/{id}                 delete a draft
    GET    /proposals/{id}/history         audit trail
    GET    /proposals/{id}/tasks           department tasks
    POST   /proposals/{id}/decision        approve | reject | send-back  (reviewer)
    POST   /proposals/{id}/resubmission    applicant returns sent-back work
    POST   /proposals/{id}/cancellation    applicant cancels

The three reviewer verbs collapse into ONE endpoint taking {"decision": ...}
rather than three sibling routes. The authorisation, the stage lookup and the
audit write are identical for all three; only the resulting status differs. The
mock had /approve, /reject and /resubmit as separate routes, which is where its
"which actor field does this one take?" inconsistency came from.

SCOPING. GET /proposals returns only what the caller may see, computed
server-side: their own proposals, ones they co-own, and ones currently awaiting
their decision. The mock returned every proposal in the database to every
caller and let the browser filter - which meant every applicant's bank account
details were in the response of any list page.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, transaction
from ..errors import Forbidden, NotFound, WorkflowError
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from ..services import proposals as svc
from ..services import workflow as wf
from ._helpers import body, pagination, required

bp = Blueprint("proposals", __name__, url_prefix="/proposals")


# --- Visibility -----------------------------------------------------------
# One predicate, used by both the list and the single-item read, so a proposal
# can never be listable but unreadable (or worse, the reverse).
_VISIBLE_SQL = """
      r.applicant_user_id = %(user_id)s
   OR EXISTS (
        SELECT 1 FROM co_owners c
   LEFT JOIN staff s ON s.staff_id = c.staff_id
       WHERE c.request_id = r.request_id
         AND (s.user_id = %(user_id)s OR lower(trim(c.staff_email)) = lower(%(email)s))
      )
   OR (r.status = 'hos_hod_review' AND EXISTS (
        SELECT 1 FROM user_unit_roles applicant_role
          JOIN user_unit_roles my_role ON my_role.unit_code = applicant_role.unit_code
         WHERE applicant_role.user_id = r.applicant_user_id
           AND my_role.user_id = %(user_id)s
           AND my_role.role_code IN ('head-of-school', 'head-of-department')
      ))
   OR (r.status = 'fmb_review' AND %(is_fmb_head)s)
   OR (r.status = 'cfo_review' AND %(is_cfo)s)
   OR EXISTS (
        SELECT 1 FROM request_task t
         WHERE t.request_id = r.request_id
           AND (t.assigned_unit_code = ANY(%(headed_units)s)
                OR (t.assigned_role = 'fmb' AND %(is_fmb_head)s)
                OR (t.assigned_role = 'cfo' AND %(is_cfo)s))
      )
   OR EXISTS (
        SELECT 1 FROM task_assignment a
          JOIN request_task t ON t.request_task_id = a.request_task_id
         WHERE t.request_id = r.request_id AND a.staff_user_id = %(user_id)s
      )
   OR EXISTS (
        SELECT 1 FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE f.request_id = r.request_id
           AND sel.unit_code = ANY(%(cafeteria_units)s)
      )
"""


def _scope_params() -> dict:
    principal = current_principal()
    cafeteria_units = sorted(
        principal.units_for_role("cafeteria-manager") | principal.units_for_role("cafeteria-staff")
    )
    return {
        "user_id": principal.user_id,
        "email": principal.email,
        "headed_units": sorted(principal.headed_units) or [""],
        "cafeteria_units": cafeteria_units or [""],
        "is_cfo": principal.has_role("cfo"),
        "is_fmb_head": "food_beverage_services" in principal.headed_units,
    }


def _load_visible(cur, request_id: int) -> dict:
    params = {**_scope_params(), "request_id": request_id}
    row = fetch_one(
        cur,
        f"SELECT r.* FROM request r WHERE r.request_id = %(request_id)s AND ({_VISIBLE_SQL})",
        params,
    )
    if row is None:
        # Deliberately 404, not 403: telling an unauthorised caller that a
        # proposal exists is itself a disclosure.
        raise NotFound("Proposal not found.")
    return row


# --- Reads ----------------------------------------------------------------
@bp.get("")
@require_auth
def list_proposals():
    """Proposals the caller may see. Optional ?status= and ?mine=true filters."""
    limit, offset = pagination()
    params = _scope_params()
    clauses = [f"({_VISIBLE_SQL})"]

    status = request.args.get("status")
    if status:
        params["status"] = status.split(",")
        clauses.append("r.status = ANY(%(status)s)")
    if str(request.args.get("mine", "")).lower() in ("1", "true", "yes"):
        clauses.append("r.applicant_user_id = %(user_id)s")

    where = " AND ".join(clauses)
    with transaction() as cur:
        total = fetch_one(cur, f"SELECT count(*) AS c FROM request r WHERE {where}", params)["c"]
        rows = fetch_all(
            cur,
            f"SELECT r.* FROM request r WHERE {where} ORDER BY r.updated_at DESC "
            f"LIMIT {limit} OFFSET {offset}",
            params,
        )
        items = [svc.project(cur, row, include_children=False) for row in rows]

    return jsonify(
        {
            "items": items,
            "page": offset // limit + 1,
            "pageSize": limit,
            "total": total,
            "totalPages": max(1, -(-total // limit)),
        }
    )


@bp.get("/<int:request_id>")
@require_auth
def get_proposal(request_id: int):
    with transaction() as cur:
        row = _load_visible(cur, request_id)
        projected = svc.project(cur, row)
        projected["tasks"] = wf.tasks_for_request(cur, request_id)
        projected["fmbSelections"] = wf.selections_for_request(cur, request_id)
    return jsonify(projected)


@bp.get("/<int:request_id>/history")
@require_auth
def get_history(request_id: int):
    with transaction() as cur:
        _load_visible(cur, request_id)
        return jsonify(wf.history_for(cur, request_id))


@bp.get("/<int:request_id>/tasks")
@require_auth
def get_tasks(request_id: int):
    with transaction() as cur:
        _load_visible(cur, request_id)
        return jsonify(wf.tasks_for_request(cur, request_id))


# --- Create and edit ------------------------------------------------------
@bp.post("")
@require_internal
def create_proposal():
    """Create and submit in one step - the applicant never sees a bare draft."""
    principal = current_principal()
    payload = body()
    draft_id = payload.pop("draftRequestId", None)

    with transaction() as cur:
        applicant = svc.load_applicant(cur, principal.user_id)
        if draft_id:
            # Submitting an existing draft converts it in place rather than
            # leaving a duplicate behind.
            existing = wf.load_request(cur, int(draft_id))
            if existing["status"] != "draft":
                raise WorkflowError("This proposal is no longer a draft.")
            wf.assert_proposal_owner(cur, existing["request_id"], principal.user_id)
            svc.save_content(cur, existing["request_id"], applicant, payload, draft=False)
            request_id = existing["request_id"]
        else:
            request_id = svc.create(cur, applicant, payload, draft=False)

        wf.submit(cur, request_id)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result), 201


@bp.post("/drafts")
@require_internal
def save_draft():
    """Create or update a draft. Never enters the workflow."""
    principal = current_principal()
    payload = body()
    draft_id = payload.pop("draftRequestId", None)

    with transaction() as cur:
        applicant = svc.load_applicant(cur, principal.user_id)
        if draft_id:
            existing = wf.load_request(cur, int(draft_id))
            if existing["status"] != "draft":
                raise WorkflowError("This proposal is no longer a draft.")
            wf.assert_proposal_owner(cur, existing["request_id"], principal.user_id)
            svc.save_content(cur, existing["request_id"], applicant, payload, draft=True)
            request_id = existing["request_id"]
        else:
            request_id = svc.create(cur, applicant, payload, draft=True)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result), 200 if draft_id else 201


@bp.patch("/<int:request_id>")
@require_internal
def save_edits(request_id: int):
    """Persist edits without advancing the workflow.

    Allowed while a reviewer has sent the proposal back, while a department has
    sent its own task back (the proposal itself stays in department_review), and
    on a draft.
    """
    principal = current_principal()
    payload = body()

    with transaction() as cur:
        proposal = wf.load_request(cur, request_id)
        wf.assert_proposal_owner(cur, request_id, principal.user_id)

        department_sent_back = proposal["status"] == "department_review" and fetch_one(
            cur,
            "SELECT 1 FROM request_task WHERE request_id = %s AND status = 'resubmitted'",
            (request_id,),
        )
        if proposal["status"] not in ("draft", "resubmission_required") and not department_sent_back:
            raise WorkflowError("Cannot save edits from status " + proposal["status"] + ".")

        applicant = svc.load_applicant(cur, proposal["applicant_user_id"])
        svc.save_content(
            cur, request_id, applicant, payload, draft=proposal["status"] == "draft"
        )
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.delete("/<int:request_id>")
@require_internal
def delete_draft(request_id: int):
    """Drafts only. A submitted proposal must be cancelled so its history survives."""
    principal = current_principal()
    with transaction() as cur:
        proposal = wf.load_request(cur, request_id)
        if proposal["status"] != "draft":
            raise WorkflowError("Only drafts can be deleted. Cancel a submitted proposal instead.")
        wf.assert_proposal_owner(cur, request_id, principal.user_id)
        svc.delete_draft(cur, request_id)
    return "", 204


# --- Workflow actions -----------------------------------------------------
DECISIONS = ("approve", "reject", "send-back")


@bp.post("/<int:request_id>/decision")
@require_internal
def record_decision(request_id: int):
    """The reviewer's decision at the current single-actor stage.

    One endpoint for all three verbs: they share the same authorisation, the
    same stage lookup and the same audit write, and differ only in outcome.
    """
    principal = current_principal()
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in DECISIONS:
        raise WorkflowError("Decision must be one of: " + ", ".join(DECISIONS) + ".")

    comment = str(payload.get("comment") or payload.get("reason") or "")
    with transaction() as cur:
        if decision == "approve":
            wf.approve(cur, request_id, principal)
        elif decision == "reject":
            wf.reject(cur, request_id, principal, comment)
        else:
            wf.send_back(cur, request_id, principal, comment)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.post("/<int:request_id>/resubmission")
@require_internal
def resubmit(request_id: int):
    """Applicant returns work that a reviewer or a department sent back.

    An optional body updates the content in the same transaction, so a
    resubmission can never persist edits and then fail to advance the stage.
    """
    principal = current_principal()
    payload = request.get_json(silent=True) or {}

    with transaction() as cur:
        proposal = wf.load_request(cur, request_id)
        wf.assert_proposal_owner(cur, request_id, principal.user_id)
        if payload:
            applicant = svc.load_applicant(cur, proposal["applicant_user_id"])
            svc.save_content(cur, request_id, applicant, payload, draft=False)
        wf.applicant_resubmit(cur, request_id, principal)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.post("/<int:request_id>/cancellation")
@require_internal
def cancel(request_id: int):
    principal = current_principal()
    with transaction() as cur:
        wf.cancel(cur, request_id, principal)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.get("/<int:request_id>/cancellation")
@require_auth
def cancellation_window(request_id: int):
    """Whether cancellation is still open, computed by the same authority that
    enforces it - so the button's state and the rule can never disagree."""
    with transaction() as cur:
        _load_visible(cur, request_id)
        principal = current_principal()
        return jsonify(
            {
                "open": wf.is_within_cancellation_window(cur, request_id),
                "isOwner": wf.is_proposal_owner(cur, request_id, principal.user_id),
            }
        )
