"""Query scope, the period filter, live config lookup, and the R7/R8 helpers.

Everything in this module exists to keep one promise: a dashboard query is
scoped in SQL, from the principal, never from a client parameter (rules R2 and
R4 in docs/dashboards/01-role-hierarchy-and-access.md). A `Scope` is built once
per request from the resolved profile and threaded through every widget, so a
widget author cannot accidentally widen it - there is no other object to reach
for.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable, Sequence

from ...db import fetch_all
from ...security.principal import Principal

# --- Period ---------------------------------------------------------------

PERIOD_KEYS = ("7d", "30d", "90d", "term", "ytd")
DEFAULT_PERIOD = "30d"

_PERIOD_LABEL = {
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    "90d": "Last 90 days",
    "term": "This term",
    "ytd": "Year to date",
}

# APU runs three intakes a year. A "term" filter that meant "the last 120 days"
# would silently straddle two of them, so the boundaries are the intake months
# rather than a rolling window: Jan-Apr, May-Aug, Sep-Dec.
_TERM_STARTS = (1, 5, 9)


@dataclass(frozen=True)
class Period:
    """A half-open [start, end) window, plus the equal-length window before it.

    Half-open deliberately: `created_at >= start AND created_at < end` counts a
    row created at midnight on the boundary exactly once, where BETWEEN on
    timestamps counts it in both windows.
    """

    key: str
    label: str
    start: dt.date
    end: dt.date
    previous_start: dt.date
    previous_end: dt.date

    @property
    def days(self) -> int:
        return max(1, (self.end - self.start).days)

    def as_json(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "from": self.start.isoformat(),
            "to": self.end.isoformat(),
            "comparedTo": {
                "from": self.previous_start.isoformat(),
                "to": self.previous_end.isoformat(),
                "label": f"previous {self.days} days",
            },
        }


def resolve_period(key: str | None, *, today: dt.date | None = None) -> Period:
    """Map a period key to its window. An unrecognised key falls back to the
    default rather than erroring - a stale bookmark should not 400."""
    today = today or dt.date.today()
    end = today + dt.timedelta(days=1)  # include everything that happened today
    key = (key or "").strip().lower()
    if key not in PERIOD_KEYS:
        key = DEFAULT_PERIOD

    if key == "term":
        month = max(m for m in _TERM_STARTS if m <= today.month)
        start = dt.date(today.year, month, 1)
    elif key == "ytd":
        start = dt.date(today.year, 1, 1)
    else:
        start = today - dt.timedelta(days=int(key.rstrip("d")) - 1)

    span = max(1, (end - start).days)
    return Period(
        key=key,
        label=_PERIOD_LABEL[key],
        start=start,
        end=end,
        previous_start=start - dt.timedelta(days=span),
        previous_end=start,
    )


# --- Config ---------------------------------------------------------------


class DashboardConfig:
    """Every `config` row, read once per request, with per-unit override support.

    `FORECAST_HORIZON_DAYS__a_v_services` beats `FORECAST_HORIZON_DAYS` for the
    A/V head and nobody else. A missing code returns the caller's default
    instead of raising: the dashboard degrades to a documented assumption
    rather than 500ing because migration 018 has not been applied yet.
    """

    def __init__(self, rows: Iterable[dict[str, Any]]):
        self._values: dict[str, Decimal] = {row["code"]: row["number"] for row in rows}

    @classmethod
    def load(cls, cur) -> "DashboardConfig":
        return cls(fetch_all(cur, "SELECT code, number FROM config"))

    def number(self, code: str, default: float, *, unit: str | None = None) -> float:
        if unit:
            scoped = self._values.get(f"{code}__{unit}")
            if scoped is not None:
                return float(scoped)
        value = self._values.get(code)
        return float(value) if value is not None else float(default)

    def integer(self, code: str, default: int, *, unit: str | None = None) -> int:
        return int(self.number(code, default, unit=unit))

    # Named accessors for the codes read from more than one widget, so a typo
    # in a code string is a one-place fix rather than a silent default.
    def horizon_days(self, unit: str | None = None) -> int:
        return self.integer("FORECAST_HORIZON_DAYS", 60, unit=unit)

    def trend_weeks(self) -> int:
        return self.integer("DASHBOARD_TREND_WEEKS", 12)

    def bucket_floor(self) -> int:
        return self.integer("MIN_BUCKET_SIZE", 5)


# --- Scope ----------------------------------------------------------------


@dataclass
class Scope:
    """Everything a widget query is allowed to know about who is asking.

    `unit_code` and `outlets` come from the principal's own assignments, never
    from the request. `notes` is the widget-visible side channel for caveats the
    document has to carry (an assumption, an approximation, a fold-to-Other),
    collected here so the response can surface them next to the number rather
    than in a footnote nobody reads.
    """

    principal: Principal
    profile_key: str
    role_code: str
    unit_code: str | None
    unit_label: str | None
    outlets: tuple[str, ...]
    outlet_labels: dict[str, str]
    period: Period
    config: DashboardConfig
    today: dt.date = field(default_factory=dt.date.today)
    suppressed_buckets: int = 0
    folded_series: int = 0

    # --- SQL parameter bundles -------------------------------------------
    @property
    def base_params(self) -> dict[str, Any]:
        return {
            "unit": self.unit_code,
            "outlets": list(self.outlets) or [""],
            "user_id": self.principal.user_id,
            "email": self.principal.email,
            "from": self.period.start,
            "to": self.period.end,
            "prev_from": self.period.previous_start,
            "prev_to": self.period.previous_end,
            "today": self.today,
            "horizon": self.config.horizon_days(self.unit_code),
        }

    def params(self, **extra: Any) -> dict[str, Any]:
        return {**self.base_params, **extra}

    # --- R8 ---------------------------------------------------------------
    def note_suppressed(self, count: int = 1) -> None:
        self.suppressed_buckets += count

    def note_folded(self, count: int = 1) -> None:
        self.folded_series += count


# --- R7 / R8 helpers ------------------------------------------------------

# Column names that would carry a row identity out of an aggregate. R7 forbids
# them in any widget crossing a scope boundary; enforced by strip_identity()
# rather than left to review, because a leak added one widget at a time is
# exactly the failure mode the rule exists to prevent.
_IDENTIFYING_KEYS = frozenset(
    {
        "request_id",
        "request_code",
        "applicant_user_id",
        "applicant_name",
        "applicant_email",
        "event_title",
        "user_id",
        "staff_user_id",
        "email",
        "full_name",
        "bank_account_name",
        "bank_account_number",
        "comment",
        "notes",
        "reviewer_comment",
        "manager_comment",
        "registrant_name",
        "registrant_email",
    }
)


def strip_identity(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop every per-row identifier from an R7 aggregate result set.

    Used by widgets that compute over rows the caller cannot open. It is cheaper
    to strip unconditionally than to audit each SELECT list, and it means adding
    a column to a shared SQL fragment cannot quietly widen an existing widget.
    """
    return [{k: v for k, v in row.items() if k not in _IDENTIFYING_KEYS} for row in rows]


def apply_bucket_floor(
    scope: Scope,
    rows: Sequence[dict[str, Any]],
    *,
    count_key: str = "n",
    value_keys: Sequence[str] = (),
) -> list[dict[str, Any]]:
    """Blank out buckets holding fewer than k rows and count them on the scope.

    Renders as an em dash with a "below reporting threshold" tooltip rather than
    disappearing: a bucket that vanishes misstates the chart, and a reader
    cannot tell "none" from "too few to report".
    """
    floor = scope.config.bucket_floor()
    out: list[dict[str, Any]] = []
    for row in rows:
        count = row.get(count_key) or 0
        if count and count < floor:
            scope.note_suppressed()
            suppressed = dict(row)
            for key in value_keys or [k for k in row if k != count_key]:
                if key in suppressed and isinstance(suppressed[key], (int, float, Decimal)):
                    suppressed[key] = None
            suppressed[count_key] = None
            suppressed["suppressed"] = True
            out.append(suppressed)
        else:
            out.append({**row, "suppressed": False})
    return out


def fold_tail(
    scope: Scope,
    rows: Sequence[dict[str, Any]],
    *,
    limit: int = 3,
    label_key: str = "label",
    value_keys: Sequence[str] = ("value",),
    other_label: str = "Other",
) -> list[dict[str, Any]]:
    """Keep the top `limit` series and sum the rest into one "Other" row.

    The all-pairs colour ceiling is three (docs/dashboards/03 § 6): past that,
    yellow sits beside orange and the pair fails the CVD floor. Folding on the
    server rather than the client is what makes the ceiling enforceable - the
    client never receives a fourth slot to render.
    """
    if len(rows) <= limit:
        return list(rows)
    head = list(rows[:limit])
    tail = rows[limit:]
    scope.note_folded(len(tail))
    other: dict[str, Any] = {label_key: other_label, "isOther": True}
    for key in value_keys:
        total = sum(float(row.get(key) or 0) for row in tail)
        other[key] = round(total, 4)
    return head + [other]


# --- Numeric helpers ------------------------------------------------------


def num(value: Any, default: float | None = None) -> float | None:
    """Decimal/None-safe float coercion. psycopg2 hands NUMERIC back as Decimal,
    which json.dumps refuses; every metric result passes through here."""
    if value is None:
        return default
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and math.isnan(value) else float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def ratio(numerator: Any, denominator: Any) -> float | None:
    """Guarded division. Returns None, never zero, when the denominator is
    empty - a rate over no observations is undefined, and rendering it as 0%
    reads as failure when it means absence."""
    top = num(numerator)
    bottom = num(denominator)
    if top is None or not bottom:
        return None
    return top / bottom


def delta(current: float | None, previous: float | None, *, higher_is_better: bool) -> dict[str, Any] | None:
    """Period-on-period movement, with whether the movement is good.

    Direction and goodness are separate: latency falling is 'down' and good,
    coverage falling is 'down' and bad, and a client that infers one from the
    other gets half of them wrong.
    """
    if current is None or previous is None:
        return None
    change = current - previous
    if abs(change) < 1e-9:
        return {"value": 0.0, "percent": 0.0, "direction": "flat", "isGood": True}
    return {
        "value": round(change, 4),
        "percent": round(change / abs(previous), 4) if previous else None,
        "direction": "up" if change > 0 else "down",
        "isGood": (change > 0) == higher_is_better,
    }


def status_for(
    value: float | None,
    *,
    warn: float | None = None,
    critical: float | None = None,
    minimum: float | None = None,
    higher_is_better: bool = False,
) -> str:
    """Derive a KPI's status server-side so two clients cannot disagree about
    whether 0.54 is a warning (docs/dashboards/03 § 4)."""
    if value is None:
        return "unknown"
    if higher_is_better:
        if critical is not None and value < critical:
            return "critical"
        if minimum is not None and value < minimum:
            return "warning"
        return "good"
    if critical is not None and value > critical:
        return "critical"
    if warn is not None and value > warn:
        return "warning"
    return "good"
