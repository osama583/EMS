"""Reference data: config, event categories/formats/requirements, units, cafeterias.

Read-mostly vocabulary the proposal form needs. Reads require authentication but
no particular role - this is the shared language of the system, not anyone's
private data. Writes are admin-only.

Event categories and formats are the two admin-managed catalogues, and they are
structurally identical: same columns, same soft-delete semantics, different
table and referencing foreign key. One parameterised resource serves both under
/catalog/categories and /catalog/formats rather than duplicating nine endpoints.
"""
from __future__ import annotations

from dataclasses import dataclass

from flask import Blueprint, jsonify

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, NotFound
from ..logging_setup import audit
from ..security import authenticate_optional, require_admin, require_auth
from ..security.principal import current_principal
from ._helpers import body, flag, required

bp = Blueprint("catalog", __name__, url_prefix="/catalog")

# Soft-deleted rows stay restorable for a week, matching admin.py and options.py.
RETENTION_DAYS = 7


# The config table is keyed by SCREAMING_SNAKE code; the client speaks its own
# camelCase field names. Mapping here keeps database naming out of the API
# contract, and means the client cannot silently read a key that does not exist.
CONFIG_FIELDS: dict[str, str] = {
    "paxReviewerThreshold": "HIGH_PAX_THRESHOLD",
    "cancellationDaysLimit": "CANCELLATION_DEADLINE_DAYS",
    "maxEventCategories": "MAX_EVENT_CATEGORIES",
    # --- Dashboard thresholds (migration 018) -----------------------------
    # Every SLA target, capacity assumption, risk window and forecast horizon
    # the dashboards read. They are here rather than in code so an
    # administrator retunes a department's SLA without a deploy - the same rule
    # HIGH_PAX_THRESHOLD has always followed. Per-unit overrides use a
    # `__<unit_code>` suffix on the same code and are not editable from this
    # form; the resolver falls back to these defaults.
    "slaDecisionHours": "SLA_DECISION_HOURS",
    "slaAssignmentHours": "SLA_ASSIGNMENT_HOURS",
    "slaFulfilmentLeadDays": "SLA_FULFILMENT_LEAD_DAYS",
    "slaOrderAcceptHours": "SLA_ORDER_ACCEPT_HOURS",
    "slaOrderClaimHours": "SLA_ORDER_CLAIM_HOURS",
    "staffShiftHours": "STAFF_SHIFT_HOURS",
    "capacityWarnRatio": "CAPACITY_WARN_RATIO",
    "atRiskWindowDays": "AT_RISK_WINDOW_DAYS",
    "stallMultiplier": "STALL_MULTIPLIER",
    "forecastHorizonDays": "FORECAST_HORIZON_DAYS",
    "dashboardTrendWeeks": "DASHBOARD_TREND_WEEKS",
    "anomalySigma": "ANOMALY_SIGMA",
    "minBucketSize": "MIN_BUCKET_SIZE",
    "sendBackWarnRate": "SEND_BACK_WARN_RATE",
    "venueTeardownMinutes": "VENUE_TEARDOWN_MINUTES",
    "startPointMaxTours": "START_POINT_MAX_TOURS",
}

# CAPACITY_WARN_RATIO is 0.85, not 85. Rounding every value to an integer the
# way the original three could be would silently turn it into 0 or 1 and move
# every amber threshold in the system.
_FRACTIONAL_FIELDS = frozenset({"capacityWarnRatio"})


def _config_payload(rows) -> dict[str, float]:
    by_code = {r["code"]: r["number"] for r in rows}
    return {
        field: (float(by_code[code]) if field in _FRACTIONAL_FIELDS else int(by_code[code]))
        for field, code in CONFIG_FIELDS.items()
        if code in by_code
    }


@bp.get("/config")
@require_auth
def get_config():
    """Workflow tunables. The client reads these rather than duplicating
    thresholds it would then get wrong when an admin changes one."""
    return jsonify(_config_payload(query("SELECT code, number FROM config")))


@bp.put("/config")
@require_admin
def replace_config():
    """Save the whole settings form in one go.

    PUT of the entire object rather than a call per value: the form is saved as
    a unit, and applying it field by field would leave a half-applied policy
    visible to anyone reading config in between.
    """
    payload = body()
    updates = {
        CONFIG_FIELDS[field]: payload[field] for field in CONFIG_FIELDS if field in payload
    }
    if not updates:
        raise BadRequest(
            "Provide at least one of: " + ", ".join(sorted(CONFIG_FIELDS)) + "."
        )

    for field, value in ((f, payload[f]) for f in CONFIG_FIELDS if f in payload):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            raise BadRequest(f"{field} must be a non-negative number.")

    with transaction() as cur:
        for code, value in updates.items():
            cur.execute(
                "UPDATE config SET number = %s WHERE code = %s RETURNING code", (value, code)
            )
            if cur.fetchone() is None:
                raise NotFound("No configuration value named " + code + ".")
        rows = fetch_all(cur, "SELECT code, number FROM config")
        audit(
            "catalog.config.updated",
            codes=sorted(updates),
            actor_user_id=current_principal().user_id,
        )
    return jsonify(_config_payload(rows))


@bp.put("/config/<code>")
@require_admin
def set_config(code: str):
    """Single-value update, by raw config code. Kept for callers that predate
    the whole-object PUT above."""
    payload = body()
    (number,) = required(payload, "number")
    with transaction() as cur:
        cur.execute(
            "UPDATE config SET number = %s WHERE code = %s RETURNING code, number", (number, code)
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("No configuration value named " + code + ".")
    return jsonify({"code": row["code"], "number": float(row["number"])})


# --- Event categories and formats ----------------------------------------
@dataclass(frozen=True)
class _Catalogue:
    table: str
    pk: str
    order_by: str
    label: str
    # Where a live proposal points at this row, and under what column. A row
    # still referenced here cannot be deleted - the reference would dangle.
    ref_table: str
    ref_column: str


CATALOGUES: dict[str, _Catalogue] = {
    "categories": _Catalogue(
        table="event_category",
        pk="event_category_id",
        order_by="name",
        label="Event category",
        ref_table="request_categories",
        ref_column="category_id",
    ),
    "formats": _Catalogue(
        table="event_format",
        pk="event_format_id",
        order_by="event_format_id",
        label="Event format",
        ref_table="request",
        ref_column="event_format_id",
    ),
}


def _catalogue(resource: str) -> _Catalogue:
    catalogue = CATALOGUES.get(resource)
    if catalogue is None:
        raise NotFound("No such catalogue: " + resource + ".")
    return catalogue


def _slug(value: str) -> str:
    """lowercase_with_underscores - the same convention unit.code and role_code use."""
    out: list[str] = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "_":
            out.append("_")
    return "".join(out).strip("_")


def _projection(catalogue: _Catalogue) -> str:
    return f"SELECT {catalogue.pk} AS id, name, code, active FROM {catalogue.table}"


def _entry(cur, catalogue: _Catalogue, entry_id: int, *, live_only: bool = True) -> dict:
    sql = _projection(catalogue) + f" WHERE {catalogue.pk} = %s"
    if live_only:
        sql += " AND archived_at IS NULL"
    row = fetch_one(cur, sql, (entry_id,))
    if row is None:
        raise NotFound(catalogue.label + " not found.")
    return row


def _blockers(cur, catalogue: _Catalogue, entry_id: int) -> list[str]:
    """Proposals still pointing at this row. Counted before any delete."""
    used = fetch_one(
        cur,
        f"SELECT count(*) AS c FROM {catalogue.ref_table} WHERE {catalogue.ref_column} = %s",
        (entry_id,),
    )["c"]
    return [f"{used} proposal(s) still reference this entry"] if used else []


@bp.get("/<resource>")
def list_catalogue(resource: str):
    """Public: the Explore Events filters (category/format) need this list
    before a guest has signed in, same tier as the published events they
    filter - see authenticate_optional() on GET /events for the same reasoning."""
    authenticate_optional()
    catalogue = _catalogue(resource)
    sql = _projection(catalogue) + " WHERE archived_at IS NULL"
    # The client sends ?active=true; activeOnly is accepted as well so the
    # older callers of /event-categories keep working unchanged.
    if flag("active") or flag("activeOnly"):
        sql += " AND active"
    return jsonify(query(sql + f" ORDER BY {catalogue.order_by}"))


@bp.get("/<resource>/deleted")
@require_admin
def list_deleted_catalogue(resource: str):
    """The soft-delete bin, with how long each row has left before purge."""
    catalogue = _catalogue(resource)
    return jsonify(
        query(
            f"SELECT {catalogue.pk} AS id, name, code, active,"
            '       archived_at AS "deletedAt",'
            "       (archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
            "       GREATEST(0, %s - EXTRACT(DAY FROM now() - archived_at)::int)"
            '           AS "daysRemaining" '
            f"FROM {catalogue.table} WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
            (RETENTION_DAYS, RETENTION_DAYS),
        )
    )


@bp.post("/<resource>")
@require_admin
def create_catalogue_entry(resource: str):
    """`code` is derived from the name server-side and immutable thereafter, so
    it stays a stable key even when the display name is edited."""
    catalogue = _catalogue(resource)
    payload = body()
    (name,) = required(payload, "name")
    code = _slug(str(name))
    if not code:
        raise BadRequest("Name must contain at least one letter or digit.")

    with transaction() as cur:
        clash = fetch_one(
            cur,
            f"SELECT 1 FROM {catalogue.table} WHERE code = %s OR lower(name) = lower(%s)",
            (code, name),
        )
        if clash:
            raise Conflict("An entry with that name already exists.")
        cur.execute(
            f"INSERT INTO {catalogue.table} (name, code, active) VALUES (%s, %s, %s) "
            f"RETURNING {catalogue.pk} AS id, name, code, active",
            (name, code, bool(payload.get("active", True))),
        )
        row = dict(cur.fetchone())
        audit(
            "catalog.entry.created",
            resource=resource,
            entry_id=row["id"],
            actor_user_id=current_principal().user_id,
        )
    return jsonify(row), 201


@bp.put("/<resource>/<int:entry_id>")
@require_admin
def update_catalogue_entry(resource: str, entry_id: int):
    catalogue = _catalogue(resource)
    payload = body()
    (name,) = required(payload, "name")

    with transaction() as cur:
        _entry(cur, catalogue, entry_id)
        clash = fetch_one(
            cur,
            f"SELECT 1 FROM {catalogue.table} "
            f"WHERE lower(name) = lower(%s) AND {catalogue.pk} <> %s",
            (name, entry_id),
        )
        if clash:
            raise Conflict("An entry with that name already exists.")
        # `code` is deliberately not recomputed: it is referenced as a stable
        # key, so a rename must not silently repoint it.
        cur.execute(
            f"UPDATE {catalogue.table} SET name = %s, active = %s WHERE {catalogue.pk} = %s "
            f"RETURNING {catalogue.pk} AS id, name, code, active",
            (name, bool(payload.get("active", True)), entry_id),
        )
        row = dict(cur.fetchone())
    return jsonify(row)


@bp.patch("/<resource>/<int:entry_id>/status")
@require_admin
def set_catalogue_entry_status(resource: str, entry_id: int):
    catalogue = _catalogue(resource)
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")

    with transaction() as cur:
        _entry(cur, catalogue, entry_id)
        cur.execute(
            f"UPDATE {catalogue.table} SET active = %s WHERE {catalogue.pk} = %s "
            f"RETURNING {catalogue.pk} AS id, name, code, active",
            (bool(payload["active"]), entry_id),
        )
        row = dict(cur.fetchone())
    return jsonify(row)


@bp.get("/<resource>/<int:entry_id>/deletion-check")
@require_admin
def catalogue_deletion_check(resource: str, entry_id: int):
    """What still depends on this entry. Shown before a destructive click."""
    catalogue = _catalogue(resource)
    with transaction() as cur:
        row = _entry(cur, catalogue, entry_id)
        blockers = _blockers(cur, catalogue, entry_id)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["name"]}
    )


@bp.delete("/<resource>/<int:entry_id>")
@require_admin
def delete_catalogue_entry(resource: str, entry_id: int):
    """Soft delete. Refused while a proposal still references the entry."""
    catalogue = _catalogue(resource)
    with transaction() as cur:
        _entry(cur, catalogue, entry_id)
        blockers = _blockers(cur, catalogue, entry_id)
        if blockers:
            raise Conflict(blockers[0] + ". Reassign those proposals first.")
        cur.execute(
            f"UPDATE {catalogue.table} SET archived_at = now(), active = FALSE "
            f"WHERE {catalogue.pk} = %s RETURNING {catalogue.pk} AS id, name, code, active",
            (entry_id,),
        )
        row = dict(cur.fetchone())
        audit(
            "catalog.entry.deleted",
            resource=resource,
            entry_id=entry_id,
            actor_user_id=current_principal().user_id,
        )
    return jsonify(row)


@bp.post("/<resource>/<int:entry_id>/restore")
@require_admin
def restore_catalogue_entry(resource: str, entry_id: int):
    catalogue = _catalogue(resource)
    with transaction() as cur:
        _entry(cur, catalogue, entry_id, live_only=False)
        cur.execute(
            f"UPDATE {catalogue.table} SET archived_at = NULL WHERE {catalogue.pk} = %s "
            f"RETURNING {catalogue.pk} AS id, name, code, active",
            (entry_id,),
        )
        row = dict(cur.fetchone())
    return jsonify(row)


@bp.delete("/<resource>/<int:entry_id>/purge")
@require_admin
def purge_catalogue_entry(resource: str, entry_id: int):
    """Permanent. Only reachable for a row already in the soft-delete bin."""
    catalogue = _catalogue(resource)
    with transaction() as cur:
        row = fetch_one(
            cur,
            f"SELECT {catalogue.pk} FROM {catalogue.table} "
            f"WHERE {catalogue.pk} = %s AND archived_at IS NOT NULL",
            (entry_id,),
        )
        if row is None:
            raise NotFound("No deleted " + catalogue.label.lower() + " with that id.")
        blockers = _blockers(cur, catalogue, entry_id)
        if blockers:
            raise Conflict(blockers[0] + ". It cannot be purged.")
        cur.execute(f"DELETE FROM {catalogue.table} WHERE {catalogue.pk} = %s", (entry_id,))
        audit(
            "catalog.entry.purged",
            resource=resource,
            entry_id=entry_id,
            actor_user_id=current_principal().user_id,
        )
    return "", 204


# The pre-migration paths. Kept so anything still calling them keeps working;
# both delegate to the parameterised list above rather than repeating its SQL.
@bp.get("/event-categories")
def event_categories():
    return list_catalogue("categories")


@bp.get("/event-formats")
def event_formats():
    return list_catalogue("formats")


@bp.get("/requirements")
@require_auth
def requirements():
    """The requirement keys a proposal can select. These double as the department
    routing keys, so the list is fixed by the workflow rather than editable."""
    return jsonify(
        query(
            "SELECT requirement_id AS id, requirement_name AS name "
            "FROM event_requirements ORDER BY requirement_id"
        )
    )


@bp.get("/units")
@require_auth
def units():
    sql = "SELECT code, description, is_active FROM unit WHERE archived_at IS NULL"
    if flag("activeOnly"):
        sql += " AND is_active"
    return jsonify(query(sql + " ORDER BY description"))


# Cafeterias used to be a read-only listing here. They are a resource of their
# own now - outlets, staffing, and the requests to change it - and live in
# api/cafeterias.py under the same /catalog/cafeterias path.
