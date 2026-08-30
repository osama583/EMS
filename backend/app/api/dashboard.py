"""Role-based analytics at /dashboard.

    GET /dashboard                       the whole document for the caller
    GET /dashboard/profiles              the profiles this caller may switch between
    GET /dashboard/widgets/<widget_id>   one widget, re-fetched on a filter change
    GET /dashboard/export                any panel's table view, as CSV

No `@require_roles`. The profile resolver is the gate, and it fails closed to a
no-access payload (rule R1): a caller holding none of the four dashboard roles
gets a 200 with `{"profile": null}` rather than a 403, because the client's job
in that case is to render the existing `/app/no-access` placeholder, not an
error page.

Query parameters narrow; they never widen. `unit` is not read at all - unit
scope comes from `principal.headed_units` (R4), so a department head passing
another unit's code gets their own data rather than a rejection. `outlet` is
validated against the caller's own manager assignments (R5) before it reaches
SQL.
"""
from __future__ import annotations

import csv
import io

from flask import Blueprint, Response, jsonify, request

from ..errors import NotFound
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from ..services import dashboard as svc
from ..services.dashboard.profiles import NoDashboardProfile
from ..services.dashboard.scope import CUSTOM_PERIOD, PERIOD_KEYS

bp = Blueprint("dashboard", __name__, url_prefix="/dashboard")


def _period() -> str | None:
    """The period key, or None to let the service pick its default.

    A custom range arrives as `custom:<from>:<to>`, so the check is on the
    prefix rather than exact membership. The dates themselves are not validated
    here - resolve_period() parses them and falls back to the default window on
    anything malformed, which is the one place that decision belongs.
    """
    value = (request.args.get("period") or "").strip().lower()
    if value.startswith(f"{CUSTOM_PERIOD}:"):
        return value
    return value if value in PERIOD_KEYS else None


def _no_access_payload() -> dict:
    return {
        "profile": None,
        "reason": "no_dashboard_profile",
        "message": "You do not hold a role with a dashboard.",
    }


@bp.get("")
@require_auth
@require_internal
def get_dashboard():
    try:
        document = svc.build_document(
            current_principal(),
            period=_period(),
            requested_profile=(request.args.get("profile") or "").strip() or None,
            outlet=(request.args.get("outlet") or "").strip() or None,
            refresh=request.args.get("refresh") == "1",
        )
    except NoDashboardProfile:
        return jsonify(_no_access_payload()), 200
    return jsonify(document)


@bp.get("/profiles")
@require_auth
@require_internal
def get_profiles():
    try:
        profiles = svc.list_profiles(current_principal())
    except NoDashboardProfile:
        return jsonify({"profiles": []}), 200
    return jsonify({"profiles": profiles})


@bp.get("/widgets/<widget_id>")
@require_auth
@require_internal
def get_widget(widget_id: str):
    try:
        widget = svc.build_widget_only(
            current_principal(),
            widget_id,
            period=_period(),
            requested_profile=(request.args.get("profile") or "").strip() or None,
            outlet=(request.args.get("outlet") or "").strip() or None,
        )
    except NoDashboardProfile:
        return jsonify(_no_access_payload()), 200
    return jsonify(widget)


@bp.get("/export")
@require_auth
@require_internal
def export_widget():
    """A panel's table view as CSV.

    Exports the same rows the table view renders, which means an R8-suppressed
    bucket exports as an em dash and never as its underlying count. Export must
    not be the hole through which the bucket floor leaks.
    """
    widget_id = (request.args.get("widget") or "").strip()
    if not widget_id:
        raise NotFound("Name a widget to export.")
    try:
        widget = svc.build_widget_only(
            current_principal(),
            widget_id,
            period=_period(),
            requested_profile=(request.args.get("profile") or "").strip() or None,
            outlet=(request.args.get("outlet") or "").strip() or None,
        )
    except NoDashboardProfile:
        raise NotFound("Widget not found.")

    view = widget.get("tableView")
    if widget.get("state") == "error" or not view:
        raise NotFound("Widget not found.")

    columns = view["columns"]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([column["label"] for column in columns])
    for row in view["rows"]:
        writer.writerow(
            [
                "—" if row.get("suppressed") and column["key"] not in ("label", "x", "date") else _cell(row.get(column["key"]))
                for column in columns
            ]
        )

    filename = f"{widget_id}.csv"
    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)
