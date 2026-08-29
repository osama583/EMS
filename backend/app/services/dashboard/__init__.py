"""Assemble one dashboard document.

The whole page is one request. Widgets run **sequentially on one cursor**: the
pool is 1-10 connections and ten parallel widget queries would exhaust it for a
single page load. `read_cursor()` rolls back on exit, which matters here - a
dashboard opens a transaction in Postgres like any other read, and skipping the
rollback leaves pooled connections idle-in-transaction, the exact failure
`app/db.py` documents.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading
import time
from typing import Any

from ...db import fetch_all, read_cursor
from ...security.principal import Principal
from . import widgets as widget_package
from .profiles import (
    GENERIC_DEPARTMENT_PROFILE,
    NoDashboardProfile,
    PROFILES,
    ResolvedProfile,
    layout_for,
    resolve_dashboard_profiles,
)
from .scope import DashboardConfig, Scope, resolve_period
from .widgets.base import build as build_widget

log = logging.getLogger(__name__)

__all__ = ["build_document", "list_profiles", "NoDashboardProfile", "invalidate_cache"]


# --- Quick actions --------------------------------------------------------
# Band 5. Each carries a live count so the button says how much work is behind
# it - a quick action with no number is a link, and the sidebar already has one.

QUICK_ACTIONS: dict[str, dict[str, Any]] = {
    "review_inbox": {
        "label": "Review inbox",
        "icon": "inbox",
        "route": "/app/inbox/requests",
        "count": "inbox",
    },
    "assign_work": {
        "label": "Assign pending work",
        "icon": "assignment_ind",
        "route": "/app/ongoing/requests",
        "params": {"assigned": "none"},
        "count": "unassigned",
    },
    "catalogue": {"label": "Manage catalogue", "icon": "list_alt", "route": None, "count": None},
    "review_gate": {
        "label": "Review at your gate",
        "icon": "gavel",
        "route": "/app/inbox/proposals",
        "count": "gate",
    },
    "menu_oversight": {
        "label": "Menu oversight",
        "icon": "restaurant_menu",
        "route": "/app/cafeterias/menu-oversight",
        "count": None,
    },
    "funding_catalogue": {
        "label": "Funding catalogue",
        "icon": "account_balance",
        "route": "/app/dropdown-options/fundingMain",
        "count": None,
    },
    "cafeteria_orders": {
        "label": "Order queue",
        "icon": "receipt_long",
        "route": "/app/inbox/requests",
        "params": {"requestKind": "fmb"},
        "count": "orders",
    },
    "my_staff": {"label": "My staff", "icon": "groups", "route": "/app/cafeterias/my-staff", "count": None},
    "menu": {"label": "My menu", "icon": "menu_book", "route": "/app/menu", "count": None},
}

_GATE_FOR_PROFILE = {"hod_fmb": "fmb_review", "cfo": "cfo_review"}


def _quick_action_counts(cur, scope: Scope, keys: list[str], widgets: dict[str, Any]) -> dict[str, int]:
    """Badge numbers, taken from widgets already computed where possible.

    Only the two that are not already on the page cost a query, and both are a
    single count.
    """
    from ...db import fetch_one

    counts: dict[str, int] = {}
    if "review_inbox" in keys or "cafeteria_orders" in keys:
        if scope.unit_code and scope.profile_key.startswith("hod_"):
            row = fetch_one(
                cur,
                """
                SELECT count(*) AS n FROM request_task
                 WHERE assigned_unit_code = %(unit)s AND status = 'pending'
                """,
                scope.base_params,
            )
            counts["inbox"] = int(row["n"]) if row else 0
        if scope.outlets:
            row = fetch_one(
                cur,
                """
                SELECT count(*) AS n FROM request_fmb_selection
                 WHERE unit_code = ANY(%(outlets)s) AND status = 'pending'
                """,
                scope.base_params,
            )
            counts["orders"] = int(row["n"]) if row else 0
    if "review_gate" in keys:
        stage = _GATE_FOR_PROFILE.get(scope.profile_key)
        if stage:
            row = fetch_one(cur, "SELECT count(*) AS n FROM request WHERE status = %s", (stage,))
            counts["gate"] = int(row["n"]) if row else 0
    unassigned = widgets.get("dept_unassigned_work")
    if unassigned and unassigned.get("value") is not None:
        counts["unassigned"] = int(unassigned["value"])
    return counts


def _quick_actions(cur, scope: Scope, keys: list[str], widgets: dict[str, Any]) -> list[dict[str, Any]]:
    from .metrics.common import spec_for

    counts = _quick_action_counts(cur, scope, keys, widgets)
    spec = spec_for(scope.unit_code)
    out = []
    for key in keys:
        template = QUICK_ACTIONS.get(key)
        if template is None:
            continue
        route = template["route"]
        params = dict(template.get("params") or {})
        if key == "catalogue":
            if spec is None or not spec.catalogue_route:
                continue
            route = spec.catalogue_route
        if key in ("review_inbox", "assign_work") and spec is not None:
            params.setdefault("requestKind", spec.requirement)
        if key == "review_gate":
            stage = _GATE_FOR_PROFILE.get(scope.profile_key)
            if stage:
                params.setdefault("stage", stage.replace("_", "-"))
        badge = counts.get(template.get("count") or "")
        out.append(
            {
                "key": key,
                "label": template["label"],
                "icon": template["icon"],
                "route": route,
                "params": params,
                "badge": badge,
            }
        )
    return out


# --- Cache ----------------------------------------------------------------
# 60 seconds per (user, profile, unit, outlets, period). Dashboard numbers do not need to be sub-
# minute fresh, and the header shows the generation time so nobody mistakes cached for live.

_CACHE_TTL_SECONDS = 60
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _cache_key(principal: Principal, profile: ResolvedProfile, period_key: str, outlet: str | None) -> str:
    return f"{principal.user_id}|{profile.id}|{period_key}|{outlet or 'all'}"


def invalidate_cache(user_id: int | None = None) -> None:
    with _cache_lock:
        if user_id is None:
            _cache.clear()
            return
        prefix = f"{user_id}|"
        for key in [k for k in _cache if k.startswith(prefix)]:
            _cache.pop(key, None)


# --- Scope construction ---------------------------------------------------


def _outlet_labels(cur, codes: list[str]) -> dict[str, str]:
    if not codes:
        return {}
    rows = fetch_all(cur, "SELECT code, description FROM unit WHERE code = ANY(%s)", (codes,))
    return {row["code"]: row["description"] for row in rows}


def _build_scope(
    cur,
    principal: Principal,
    profile: ResolvedProfile,
    period_key: str | None,
    outlet: str | None,
    today: dt.date | None = None,
) -> Scope:
    config = DashboardConfig.load(cur)
    # R5: the outlet switcher's value is validated against the caller's own manager assignments before
    # it reaches any query.
    owned = sorted(principal.units_for_role("cafeteria-manager"))
    outlets = tuple(owned)
    if outlet and outlet != "all" and outlet in owned:
        outlets = (outlet,)
    return Scope(
        principal=principal,
        profile_key=profile.key,
        role_code=profile.role_code,
        unit_code=profile.unit_code,
        unit_label=profile.unit_label,
        outlets=outlets,
        outlet_labels=_outlet_labels(cur, list(outlets)),
        period=resolve_period(period_key, today=today),
        config=config,
        today=today or dt.date.today(),
    )


# --- Document -------------------------------------------------------------


def list_profiles(principal: Principal) -> list[dict[str, Any]]:
    with read_cursor() as cur:
        profiles = resolve_dashboard_profiles(cur, principal)
    return [
        {
            "id": p.id,
            "key": p.key,
            "roleCode": p.role_code,
            "unitCode": p.unit_code,
            "unitLabel": p.unit_label,
            "title": p.title,
            "eyebrow": p.eyebrow,
        }
        for p in profiles
    ]


def build_document(
    principal: Principal,
    *,
    period: str | None = None,
    requested_profile: str | None = None,
    outlet: str | None = None,
    refresh: bool = False,
    today: dt.date | None = None,
) -> dict[str, Any]:
    """The whole page as one JSON document.

    Raises `NoDashboardProfile` when the caller holds none of the four dashboard
    roles - the blueprint turns that into the existing no-access payload rather
    than a blank dashboard (rule R1, fail closed).
    """
    started = time.perf_counter()

    with read_cursor() as cur:
        profiles = resolve_dashboard_profiles(cur, principal, requested_profile)
        active = profiles[0]

        cache_key = _cache_key(principal, active, period or "30d", outlet)
        if not refresh:
            with _cache_lock:
                cached = _cache.get(cache_key)
            if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
                document = dict(cached[1])
                document["meta"] = {**document["meta"], "cached": True}
                return document

        scope = _build_scope(cur, principal, active, period, outlet, today=today)

        layout = layout_for(active.key)

        results: dict[str, Any] = {}
        ordered_ids = (
            # "hero" is optional in the same way "signature" and "alerts" are.
            ([layout["hero"]] if layout.get("hero") else [])
            + list(layout["kpis"])
            + ([layout["signature"]] if layout.get("signature") else [])
            + list(layout["panels"])
            # "alerts" is optional in the same way "counts" is: a profile whose
            # alerts would only restate a band it already carries sets it None
            # rather than shipping a rail that says nothing new.
            + ([layout["alerts"]] if layout.get("alerts") else [])
        )
        # "counts" is optional - only the profiles carrying the Inbox/Ongoing/
        # Completed/Late strip (widgets/department.py's dept_request_counts)
        # set it; every other profile is unaffected.
        if layout.get("counts"):
            ordered_ids = [layout["counts"]] + ordered_ids
        # Sequential, one cursor. See the module docstring.
        for widget_id in ordered_ids:
            results[widget_id] = build_widget(widget_id, cur, scope)

        # Mobile KPI ordering may name a tile the desktop layout does not carry
        # (Photography's backlog tile is the hero on desktop and a tile on a
        # phone). Build those too so the client never has to fetch mid-scroll.
        for widget_id in layout.get("mobileKpis", []):
            if widget_id not in results:
                results[widget_id] = build_widget(widget_id, cur, scope)

        actions = _quick_actions(cur, scope, list(layout["quickActions"]), results)

        document = {
            "profile": {
                "id": active.id,
                "key": active.key,
                "roleCode": active.role_code,
                "unitCode": active.unit_code,
                "unitLabel": active.unit_label,
                "title": active.title,
                "eyebrow": active.eyebrow,
                "switchable": [
                    {
                        "id": p.id,
                        "key": p.key,
                        "title": p.title,
                        "unitCode": p.unit_code,
                        "unitLabel": p.unit_label,
                    }
                    for p in profiles
                ],
                "outlets": [
                    {"code": code, "label": scope.outlet_labels.get(code, code)}
                    for code in sorted(principal.units_for_role("cafeteria-manager"))
                ],
                "activeOutlet": outlet if outlet in scope.outlets and len(scope.outlets) == 1 else "all",
            },
            "period": scope.period.as_json(),
            "requestCounts": results.get(layout["counts"]) if layout.get("counts") else None,
            "hero": results[layout["hero"]] if layout.get("hero") else None,
            "kpis": [results[widget_id] for widget_id in layout["kpis"]],
            "signature": results[layout["signature"]] if layout.get("signature") else None,
            "panels": [results[widget_id] for widget_id in layout["panels"]],
            "alerts": results[layout["alerts"]] if layout.get("alerts") else None,
            "quickActions": actions,
            "mobile": {"kpiOrder": list(layout.get("mobileKpis", []))},
            "extras": {
                widget_id: results[widget_id]
                for widget_id in layout.get("mobileKpis", [])
                if widget_id not in layout["kpis"]
            },
            "meta": {
                "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
                "queryMs": round((time.perf_counter() - started) * 1000, 1),
                "suppressedBuckets": scope.suppressed_buckets,
                "foldedSeries": scope.folded_series,
                "cached": False,
                "widgetCount": len(results),
            },
        }

    with _cache_lock:
        _cache[cache_key] = (time.time(), document)
        # Cheap bound: the cache is per-worker and keyed per user, so it cannot
        # grow without limit in normal use, but a long-lived worker serving many
        # users should not accumulate stale entries forever.
        if len(_cache) > 512:
            cutoff = time.time() - _CACHE_TTL_SECONDS
            for key in [k for k, (stamp, _) in _cache.items() if stamp < cutoff]:
                _cache.pop(key, None)

    log.info(
        "dashboard.built",
        extra={
            "profile": active.key,
            "unit": active.unit_code,
            "widgets": len(results),
            "duration_ms": document["meta"]["queryMs"],
        },
    )
    return document


def build_widget_only(
    principal: Principal,
    widget_id: str,
    *,
    period: str | None = None,
    requested_profile: str | None = None,
    outlet: str | None = None,
    today: dt.date | None = None,
) -> dict[str, Any]:
    """One widget, re-fetched on a filter change without re-running the page.

    The widget must belong to the caller's own resolved profile - asking for
    another profile's widget by id gets a 404-shaped error state, not that
    profile's data, because the scope is still built from this principal.
    """
    with read_cursor() as cur:
        profiles = resolve_dashboard_profiles(cur, principal, requested_profile)
        active = profiles[0]
        scope = _build_scope(cur, principal, active, period, outlet, today=today)
        layout = layout_for(active.key)
        allowed = {
            *([layout["hero"]] if layout.get("hero") else []),
            *([layout["signature"]] if layout.get("signature") else []),
            *([layout["alerts"]] if layout.get("alerts") else []),
            *layout["kpis"],
            *layout["panels"],
            *layout.get("mobileKpis", []),
            *([layout["counts"]] if layout.get("counts") else []),
        }
        if widget_id not in allowed:
            return {"id": widget_id, "kind": "panel", "state": "error", "message": "Unknown widget."}
        return build_widget(widget_id, cur, scope)
