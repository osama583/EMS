"""Reference data: config, event categories/formats/requirements, units, cafeterias.

Read-mostly vocabulary the proposal form needs. Reads require authentication but
no particular role - this is the shared language of the system, not anyone's
private data. Writes are admin-only.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..db import query, transaction
from ..errors import NotFound
from ..security import require_admin, require_auth
from ._helpers import body, flag, required

bp = Blueprint("catalog", __name__, url_prefix="/catalog")


@bp.get("/config")
@require_auth
def get_config():
    """Workflow tunables as {code: number}. The client reads these rather than
    duplicating thresholds it would then get wrong when an admin changes one."""
    rows = query("SELECT code, number FROM config ORDER BY code")
    return jsonify({r["code"]: float(r["number"]) for r in rows})


@bp.put("/config/<code>")
@require_admin
def set_config(code: str):
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


@bp.get("/event-categories")
@require_auth
def event_categories():
    sql = (
        "SELECT event_category_id AS id, name, code, active "
        "FROM event_category WHERE archived_at IS NULL"
    )
    if flag("activeOnly"):
        sql += " AND active"
    return jsonify(query(sql + " ORDER BY name"))


@bp.get("/event-formats")
@require_auth
def event_formats():
    sql = (
        "SELECT event_format_id AS id, name, code, active "
        "FROM event_format WHERE archived_at IS NULL"
    )
    if flag("activeOnly"):
        sql += " AND active"
    return jsonify(query(sql + " ORDER BY event_format_id"))


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


@bp.get("/cafeterias")
@require_auth
def cafeterias():
    """A cafeteria is a unit with a reserved code prefix - there is no separate
    table, so "which cafeterias exist" is a prefix query. The underscores are
    escaped because _ is a LIKE wildcard."""
    return jsonify(
        query(
            "SELECT code, description, is_active FROM unit "
            "WHERE code LIKE 'cafeteria!_!_%%' ESCAPE '!' "
            "AND archived_at IS NULL AND is_active ORDER BY description"
        )
    )
