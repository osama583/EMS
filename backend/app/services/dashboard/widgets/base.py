"""Widget construction: the registry, and the three shapes a widget can take.

A widget is a function `(cur, scope) -> dict`. It is registered by id, and a
profile names ids. Nothing about the layout is compiled in - the Angular
component walks the ids it is given, which is what makes a new profile a data
change rather than a component change.

`colorSlot` is an integer, never a hex. The server assigns identity from the
entity key; the client maps slot to colour. That is what makes "colour follows
the entity, never its rank" enforceable: filtering a series out cannot repaint
the survivors, because the slot was never derived from a row index.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Iterable

from ..scope import Scope

log = logging.getLogger(__name__)

WidgetFn = Callable[..., dict[str, Any]]
WIDGET_REGISTRY: dict[str, WidgetFn] = {}


def widget(widget_id: str) -> Callable[[WidgetFn], WidgetFn]:
    def register(fn: WidgetFn) -> WidgetFn:
        if widget_id in WIDGET_REGISTRY:
            raise RuntimeError(f"Duplicate dashboard widget id: {widget_id}")
        WIDGET_REGISTRY[widget_id] = fn
        fn.__widget_id__ = widget_id  # type: ignore[attr-defined]
        return fn

    return register


def build(widget_id: str, cur, scope: Scope) -> dict[str, Any]:
    """Run one widget, converting a failure into an inline error state.

    A widget whose query fails must not blank the page. One bad aggregate should
    cost a department head one panel, not their morning.
    """
    fn = WIDGET_REGISTRY.get(widget_id)
    if fn is None:
        return {"id": widget_id, "kind": "panel", "state": "error", "message": "Unknown widget."}
    try:
        result = fn(cur, scope)
        result.setdefault("id", widget_id)
        result.setdefault("state", "ok")
        return result
    except Exception:
        log.exception("dashboard.widget.failed", extra={"widget": widget_id, "profile": scope.profile_key})
        return {
            "id": widget_id,
            "kind": "panel",
            "state": "error",
            "message": "This panel could not be loaded.",
        }


# --- Shapes ---------------------------------------------------------------


def drill(route: str, **params: Any) -> dict[str, Any]:
    """A destination plus the filters to apply there.

    Filters only, never rows or ids the destination would not have granted on
    its own (R12) - a tampered query string yields an empty filtered page, not
    a leak.
    """
    return {"route": route, "params": {k: v for k, v in params.items() if v is not None}}


def hero(
    *,
    label: str,
    value: float | int | None,
    fmt: str,
    caption: str | None = None,
    target: dict[str, Any] | None = None,
    status: str = "unknown",
    delta: dict[str, Any] | None = None,
    sparkline: Iterable[dict[str, Any]] | None = None,
    caveat: str | None = None,
    definition: str | None = None,
    drill_to: dict[str, Any] | None = None,
    empty: str | None = None,
) -> dict[str, Any]:
    """The one lead number. Exactly one per view.

    `caveat` renders **inside** the card, not in a page footnote: a cost figure
    that is 84% priced and one that is 100% priced are different claims, and the
    difference belongs where the number is read.
    """
    return {
        "kind": "hero",
        "label": label,
        "value": value,
        "format": fmt,
        "caption": caption,
        "target": target,
        "status": status,
        "delta": delta,
        "sparkline": list(sparkline or []),
        "caveat": caveat,
        "definition": definition,
        "drill": drill_to,
        "empty": empty,
    }


def kpi(
    *,
    label: str,
    value: float | int | None,
    fmt: str,
    secondary: str | None = None,
    caption: str | None = None,
    target: dict[str, Any] | None = None,
    status: str = "unknown",
    delta: dict[str, Any] | None = None,
    sparkline: Iterable[dict[str, Any]] | None = None,
    definition: str | None = None,
    caveat: str | None = None,
    drill_to: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A stat tile. `secondary` carries the p90 beside a median, or the second
    half of a two-number tile - "4% of proposals, 31% of spend" is one fact and
    splitting it across two tiles would lose the comparison that makes it one."""
    return {
        "kind": "kpi",
        "label": label,
        "value": value,
        "format": fmt,
        "secondary": secondary,
        "caption": caption,
        "target": target,
        "status": status,
        "delta": delta,
        "sparkline": list(sparkline or []),
        "definition": definition,
        "caveat": caveat,
        "drill": drill_to,
    }


def series(key: str, label: str, slot: int, points: Iterable[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"key": key, "label": label, "colorSlot": slot, "points": list(points), **extra}


def table(columns: Iterable[dict[str, str]], rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """The WCAG-clean twin of a chart, the CSV export source, and the fallback
    when a chart cannot render. Ships with every panel, never lazily fetched -
    a value gated behind a hover is a value some readers never get."""
    return {"columns": list(columns), "rows": list(rows)}


def panel(
    *,
    title: str,
    chart: str,
    data: dict[str, Any] | list[Any] | None = None,
    subtitle: str | None = None,
    series_list: Iterable[dict[str, Any]] | None = None,
    axes: dict[str, Any] | None = None,
    annotations: Iterable[dict[str, Any]] | None = None,
    table_view: dict[str, Any] | None = None,
    caption: str | None = None,
    caveat: str | None = None,
    empty: str | None = None,
    filters: Iterable[str] | None = None,
    drill_to: dict[str, Any] | None = None,
    signature: bool = False,
    mobile: str | None = None,
    suppressed: int = 0,
) -> dict[str, Any]:
    """A chart card.

    `empty` is a panel-specific sentence naming what would populate it, never
    the words "No data" alone - a reader who cannot tell an empty period from a
    broken query will assume the second.

    `mobile` names the phone fallback form (see docs/dashboards/70 § 4.2). A
    thirty-column heatmap is unreadable at any cell size on a 390px screen, so
    it becomes a ranked list of breaches rather than a squeezed heatmap.
    """
    return {
        "kind": "panel",
        "title": title,
        "subtitle": subtitle,
        "chart": chart,
        "data": data,
        "series": list(series_list or []),
        "axes": axes or {},
        "annotations": list(annotations or []),
        "tableView": table_view,
        "caption": caption,
        "caveat": caveat,
        "empty": empty,
        "filters": list(filters or []),
        "drill": drill_to,
        "signature": signature,
        "mobile": mobile,
        # Buckets *this* panel withheld under the k>=5 floor. Per panel, not the
        # page total: a footnote that repeats the same number under five charts
        # tells a reader nothing about which chart is incomplete.
        "suppressed": suppressed,
    }


def insight_action(label: str, route: str, **params: Any) -> dict[str, Any]:
    return {"label": label, **drill(route, **params)}


# --- Formatting vocabulary ------------------------------------------------
# The client formats; the server names the format. Keeping the vocabulary here
# rather than in each widget means a new format is added in one place and every
# widget that wants it spells it the same way.

FMT_NUMBER = "number"
FMT_PERCENT = "percent"
FMT_RATIO = "ratio"
FMT_HOURS = "hours"
FMT_DAYS = "days"
FMT_CURRENCY = "currency"
FMT_COUNT = "count"
FMT_MINUTES = "minutes"
