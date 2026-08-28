"""Serve a dashboard document without a database.

Every widget runs its **real** code path; only the cursor is synthetic. A fake
cursor parses each statement's SELECT aliases and answers with rows shaped like
the columns the query asked for, so the widget bodies — the layout, the
folding, the status derivation, the table views — execute against populated
data rather than the empty result set `tests/test_dashboard.py` covers.

That matters because the two failure modes are different. Empty data catches a
missing NULLIF; populated data catches a panel that divides by a count it
assumed was non-zero, a fold that drops the wrong series, or a chart that only
renders when it has three points. Neither test finds the other's bugs.

    python -m scripts.dashboard_preview --serve 5000     # mock API for `ng serve`
    python -m scripts.dashboard_preview --check          # every profile, non-zero exit on failure

Not part of the app. The real endpoint is `app/api/dashboard.py`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import pathlib
import random
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.security.principal import Principal  # noqa: E402
from app.services.dashboard import QUICK_ACTIONS, _quick_actions  # noqa: E402
from app.services.dashboard.profiles import PROFILES, layout_for  # noqa: E402
from app.services.dashboard.scope import DashboardConfig, Scope, resolve_period  # noqa: E402
from app.services.dashboard.widgets.base import build as build_widget  # noqa: E402

TODAY = dt.date.today()

# --- The synthetic cursor -------------------------------------------------

_ALIAS = re.compile(r"\bAS\s+(\w+)", re.IGNORECASE)
_PLACEHOLDER = re.compile(r"%\((\w+)\)s")


def _output_columns(sql: str) -> list[str]:
    """The names a statement actually returns, aliased or not.

    Parsed rather than pattern-matched: `SELECT action, count(*) AS n` returns
    two columns and a regex over `AS` finds one, which makes a working widget
    look broken. Falls back to the regex where sqlglot is unavailable.
    """
    try:
        import sqlglot

        normalised = _PLACEHOLDER.sub(r":p_\1", sql).replace("%%", "%")
        names = [name for name in sqlglot.parse_one(normalised, dialect="postgres").named_selects if name != "*"]
        if names:
            return names
    except Exception:  # noqa: BLE001 - the fallback keeps the preview usable
        pass
    return _ALIAS.findall(sql)


_LABELS = [
    "Line array PA", "Wireless mic set", "LED wash bar", "Stage monitor", "Follow spot",
    "Atrium Cafeteria", "Level 3 Food Court", "Nasi lemak set", "Vegetarian bento",
    "40-seat coach", "16-seat van", "Main Lobby", "Library Steps", "Heritage walk",
]
_NAMES = ["Marcus Vance", "Ethan Wong", "Nurul Huda", "Alex Rivera", "Samantha Ong"]
_STATUSES = ["pending", "approved", "preparing", "completed"]


class SyntheticCursor:
    """Answers any statement with rows carrying the aliases it selected.

    Value shape is inferred from the alias name, which is enough to exercise a
    widget honestly: a column called `ratio` gets a ratio, one called `day` gets
    a date in the right window, one called `label` gets a catalogue-shaped
    string. Deterministic per statement, so two runs produce the same page and a
    difference between them is a real change.
    """

    def __init__(self, rows: int = 8, seed: int = 7):
        self.rows = rows
        self.seed = seed
        self._result: list[dict] = []

    def execute(self, sql, params=None):
        aliases = _output_columns(sql)
        if not aliases:
            self._result = []
            return
        rng = random.Random(hash(sql) % 10_000 + self.seed)
        count = 1 if " count(*) AS n\n" in sql and "GROUP BY" not in sql else self.rows
        if "config" in sql and "code" in aliases:
            self._result = []  # DashboardConfig is supplied directly below.
            return
        self._result = [self._row(aliases, rng, index) for index in range(count)]

    def _row(self, aliases: list[str], rng: random.Random, index: int) -> dict:
        row: dict = {}
        for alias in aliases:
            row[alias] = self._value(alias, rng, index)
        return row

    def _value(self, alias: str, rng: random.Random, index: int):
        lowered = alias.lower()
        if lowered in ("day", "date", "week", "bucket", "first_date", "soonest", "oldest_date"):
            base = TODAY + dt.timedelta(days=index * (7 if lowered in ("week", "bucket") else 1))
            return base
        if lowered.endswith("_at") or lowered in ("at", "oldest", "approved_at"):
            return dt.datetime.now() - dt.timedelta(hours=index * 6 + 3)
        if lowered == "deadline":
            # risk.risk_list()'s `min(date + start_column)` (or `date::timestamp`
            # for a department with no time-of-day column) - always a real
            # timestamp, never a date alone, so the naive tzinfo check in
            # risk_list() has something to call .tzinfo on.
            return dt.datetime.now() + dt.timedelta(hours=index * 3 - 6)
        if lowered in ("start_time", "end_time", "serve_time", "moving_time", "a_start", "a_end", "b_start", "b_end"):
            hour = 8 + (index * 2) % 10
            extra = 2 if lowered.startswith(("end", "a_end", "b_end")) else 0
            return dt.time(min(21, hour + extra), 30 * (index % 2))
        if lowered in ("label", "item", "start_point", "vehicle", "school", "unit_label", "tour_type", "event_title", "location", "route", "a_label", "b_label"):
            return _LABELS[(index + hash(alias)) % len(_LABELS)]
        if lowered in ("name", "actor", "claimed_by", "target_display_name", "actor_display_name"):
            return _NAMES[index % len(_NAMES)]
        if lowered in ("code", "outlet", "unit_code", "requirement", "format", "category", "subcategory", "action", "status", "guest_type", "type", "stage"):
            return {"status": _STATUSES[index % 4], "action": ("create", "edit", "suspend")[index % 3]}.get(
                lowered, ("atrium", "level3", "hos_hod_review", "Workshop", "OPEX-1200")[index % 5]
            )
        if lowered in ("ratio", "fill", "share", "rate", "coverage", "median_qty"):
            return round(rng.uniform(0.25, 1.25), 3)
        if lowered in ("p50", "p90", "p10", "median_hours", "hours", "decision_h", "assign_h", "execute_h", "accept_h", "prepare_h", "deliver_h", "median_days", "p90_days", "days", "median_age", "oldest_age", "median_minutes", "gap_minutes", "hours_since", "mean_loops", "mean_count"):
            return round(rng.uniform(2, 60), 1)
        if lowered in ("total", "cost", "spend", "spend_above", "revenue", "amount", "value", "food", "funding", "exposure", "collected", "price", "unit_price_rm", "mean_cost"):
            return round(rng.uniform(180, 9800), 2)
        if lowered in ("option_id", "row_id", "request_id", "task_id", "user_id", "id", "tag_id", "start_point_id", "a_id", "b_id", "a_request", "b_request", "selection_id"):
            return 100 + index
        if lowered in ("request_code",):
            return f"REQ-2026-{200 + index}"
        if lowered in ("cap", "max_group_size", "seats", "available", "available_stock", "passenger_capacity", "capacity"):
            return rng.choice([12, 20, 40, 60])
        if lowered in ("instructions", "comments", "notes"):
            return "Meet at the main entrance."
        if lowered in ("suppressed", "unpriced"):
            return False
        return rng.randint(0, 14)

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None


SEEDED_CONFIG = DashboardConfig(
    [
        {"code": "SLA_DECISION_HOURS", "number": 48},
        {"code": "SLA_ASSIGNMENT_HOURS", "number": 24},
        {"code": "SLA_FULFILMENT_LEAD_DAYS", "number": 3},
        {"code": "SLA_ORDER_ACCEPT_HOURS", "number": 12},
        {"code": "SLA_ORDER_CLAIM_HOURS", "number": 4},
        {"code": "STAFF_SHIFT_HOURS", "number": 8},
        {"code": "CAPACITY_WARN_RATIO", "number": 0.85},
        {"code": "AT_RISK_WINDOW_DAYS", "number": 7},
        {"code": "STALL_MULTIPLIER", "number": 2},
        {"code": "FORECAST_HORIZON_DAYS", "number": 60},
        {"code": "DASHBOARD_TREND_WEEKS", "number": 12},
        {"code": "ANOMALY_SIGMA", "number": 2},
        {"code": "MIN_BUCKET_SIZE", "number": 5},
        {"code": "SEND_BACK_WARN_RATE", "number": 15},
        {"code": "VENUE_TEARDOWN_MINUTES", "number": 60},
        {"code": "START_POINT_MAX_TOURS", "number": 2},
        {"code": "HIGH_PAX_THRESHOLD", "number": 50},
        {"code": "CANCELLATION_DEADLINE_DAYS", "number": 3},
    ]
)

PROFILE_SETUP = {
    "hod_av": ("head-of-department", "a_v_services", "A/V Services", ()),
    "hod_logistics": ("head-of-department", "logistics_and_facilities", "Logistics and Facilities", ()),
    "hod_transport": ("head-of-department", "transport_services", "Transport Services", ()),
    "hod_student_services": ("head-of-department", "student_services", "Student Services", ()),
    "hod_photography": ("head-of-department", "photography_services", "Photography Services", ()),
    "hod_fmb": ("head-of-department", "food_beverage_services", "Food & Beverage Services", ()),
    "hod_generic": ("head-of-department", "greenhouse_services", "Greenhouse Services", ()),
    "hos_school": ("head-of-school", "school_of_computing", "School of Computing", ()),
    "cfo": ("cfo", None, None, ()),
    "cafeteria_manager": ("cafeteria-manager", None, None, ("cafeteria__atrium_cafeteria", "cafeteria__level_3_food_court")),
}


def build_preview(profile_key: str, period: str = "30d", variant: str | None = None) -> dict:
    role_code, unit_code, unit_label, outlets = PROFILE_SETUP[profile_key]
    cur = SyntheticCursor()
    scope = Scope(
        principal=Principal(
            user_id=1,
            full_name="Preview User",
            email="preview@demo.apu.edu.my",
            is_active=True,
            assignments=tuple((role_code, unit_code) for _ in (0,)),
        ),
        profile_key=profile_key,
        role_code=role_code,
        unit_code=unit_code,
        unit_label=unit_label,
        outlets=outlets,
        outlet_labels={"cafeteria__atrium_cafeteria": "Atrium Cafeteria", "cafeteria__level_3_food_court": "Level 3 Food Court"},
        period=resolve_period(period, today=TODAY),
        config=SEEDED_CONFIG,
        today=TODAY,
    )
    layout = layout_for(profile_key, variant)
    ids = [layout["hero"], *layout["kpis"], layout["signature"], *layout["panels"], layout["alerts"], *layout.get("mobileKpis", [])]
    results = {widget_id: build_widget(widget_id, cur, scope) for widget_id in dict.fromkeys(ids)}
    actions = _quick_actions(cur, scope, list(layout["quickActions"]), results)
    title = unit_label or ("Institutional finance" if profile_key == "cfo" else "Cafeteria operations")

    return {
        "profile": {
            "id": f"{profile_key}:{unit_code}" if unit_code else profile_key,
            "key": profile_key,
            "variant": variant,
            "roleCode": role_code,
            "unitCode": unit_code,
            "unitLabel": unit_label,
            "title": title,
            "eyebrow": PROFILES.get(profile_key, {}) and _eyebrow(profile_key),
            "switchable": [
                {"id": key, "key": key, "title": _eyebrow(key), "unitCode": None, "unitLabel": None}
                for key in PROFILE_SETUP
            ],
            "outlets": [{"code": code, "label": scope.outlet_labels[code]} for code in outlets],
            "activeOutlet": "all",
        },
        "period": scope.period.as_json(),
        "hero": results[layout["hero"]],
        "kpis": [results[widget_id] for widget_id in layout["kpis"]],
        "signature": results[layout["signature"]],
        "panels": [results[widget_id] for widget_id in layout["panels"]],
        "alerts": results[layout["alerts"]],
        "quickActions": actions,
        "mobile": {"kpiOrder": list(layout.get("mobileKpis", []))},
        "extras": {wid: results[wid] for wid in layout.get("mobileKpis", []) if wid not in layout["kpis"]},
        "meta": {
            "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "queryMs": 214.0,
            "suppressedBuckets": scope.suppressed_buckets,
            "foldedSeries": scope.folded_series,
            "cached": False,
            "widgetCount": len(results),
        },
    }


from app.services.dashboard.profiles import PROFILE_TITLES  # noqa: E402


def _eyebrow(key: str) -> str:
    title, eyebrow = PROFILE_TITLES.get(key, ("Department", "Service lane operations"))
    return eyebrow


def _json_default(value):
    if isinstance(value, (dt.date, dt.time, dt.datetime)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return str(value)


# --- Checks ---------------------------------------------------------------


def check() -> int:
    """Build every profile with populated data and report anything that broke."""
    failures: list[str] = []
    for profile_key in PROFILE_SETUP:
        variants = ("service", "commercial") if profile_key == "hos_school" else (None,)
        for variant in variants:
            name = f"{profile_key}{'/' + variant if variant else ''}"
            try:
                document = build_preview(profile_key, variant=variant)
            except Exception as error:  # noqa: BLE001 - the point is to report, not raise
                failures.append(f"{name}: build failed — {error!r}")
                continue

            widgets = [document["hero"], *document["kpis"], document["signature"], *document["panels"], document["alerts"]]
            for widget in widgets:
                if widget.get("state") == "error":
                    failures.append(f"{name}: widget {widget['id']} returned state=error")
            try:
                json.dumps(document, default=_json_default)
            except (TypeError, ValueError) as error:
                failures.append(f"{name}: document is not JSON-serialisable — {error}")

            panels = [w for w in widgets if w.get("kind") == "panel"]
            for panel in panels:
                if panel.get("tableView") is None:
                    failures.append(f"{name}: panel {panel['id']} ships no table view")
            populated = [p for p in panels if p.get("series") or (p.get("data") or {})]
            print(
                f"  {name:28s} {len(widgets):2d} widgets · {len(populated):2d}/{len(panels)} panels populated "
                f"· {document['meta']['suppressedBuckets']} suppressed"
            )

    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print("  -", failure)
        return 1
    print("\nEvery profile built with populated data.")
    return 0


# --- Mock server ----------------------------------------------------------

_NAV = [
    {"pageCode": "dashboard", "label": "Dashboard", "entryType": "page", "icon": None, "routePath": "/app/dashboard", "children": []},
    {"pageCode": "inbox", "label": "Inbox", "entryType": "page", "icon": None, "routePath": "/app/inbox", "children": []},
]


def _user(profile_key: str) -> dict:
    role_code, unit_code, unit_label, _ = PROFILE_SETUP[profile_key]
    return {
        "id": "1",
        "email": "preview@demo.apu.edu.my",
        "displayName": "Preview User",
        "accountType": "internal",
        "roles": [{"roleCode": role_code, "roleName": role_code.replace("-", " ").title(), "unitCode": unit_code, "unitDescription": unit_label}],
        "roleLabel": f"{role_code.replace('-', ' ').title()}" + (f" — {unit_label}" if unit_label else ""),
        "department": unit_label or "Institution",
        "nav": _NAV,
    }


class PreviewHandler(BaseHTTPRequestHandler):
    profile_key = "hod_av"

    def _send(self, payload, status=200):
        body = json.dumps(payload, default=_json_default).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802 - BaseHTTPRequestHandler naming
        self._send({})

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.endswith("/auth/login"):
            length = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(length)
            self._send({"user": _user(self.profile_key), "accessToken": "preview", "refreshToken": "preview", "expiresIn": 3600})
            return
        self._send({}, 404)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        path = parsed.path

        if path.endswith("/dashboard"):
            key = (query.get("profile") or [self._cookie_profile()])[0].split(":")[0]
            if key not in PROFILE_SETUP:
                key = self.profile_key
            variant = "commercial" if query.get("variant") == ["commercial"] else None
            period = (query.get("period") or ["30d"])[0]
            self._send(build_preview(key, period=period, variant=variant))
            return
        if path.endswith("/dashboard/profiles"):
            self._send({"profiles": [{"id": k, "key": k, "title": _eyebrow(k), "unitCode": None, "unitLabel": None} for k in PROFILE_SETUP]})
            return
        if path.endswith("/auth/session") or path.endswith("/auth/me"):
            self._send({"user": _user(self._cookie_profile())})
            return
        if path.endswith("/auth/dev-users"):
            self._send([{"email": "preview@demo.apu.edu.my", "displayName": "Preview User", "roleLabel": "Preview"}])
            return
        if path.endswith("/catalog/config"):
            self._send({"paxReviewerThreshold": 50, "cancellationDaysLimit": 3, "maxEventCategories": 2})
            return
        self._send([])

    def _cookie_profile(self) -> str:
        """The profile preview-login.html seeded, so a preview session shows the
        dashboard for the role it signed in as rather than the server default."""
        cookies = self.headers.get("Cookie") or ""
        for part in cookies.split(";"):
            name, _, value = part.strip().partition("=")
            if name == "previewProfile" and value in PROFILE_SETUP:
                return value
        return self.profile_key

    def log_message(self, fmt, *args):
        sys.stderr.write("  preview " + (fmt % args) + "\n")


def serve(port: int, profile_key: str) -> None:
    PreviewHandler.profile_key = profile_key
    server = HTTPServer(("127.0.0.1", port), PreviewHandler)
    print(f"Dashboard preview on http://127.0.0.1:{port} — default profile {profile_key}")
    print("Switch profiles with ?profile=<key>; every widget runs its real code against synthetic rows.")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", type=int, metavar="PORT", help="run the mock API on this port")
    parser.add_argument("--profile", default="hod_av", choices=sorted(PROFILE_SETUP))
    parser.add_argument("--check", action="store_true", help="build every profile and report failures")
    parser.add_argument("--dump", metavar="PATH", help="write one profile's document to a file")
    args = parser.parse_args()

    if args.check:
        raise SystemExit(check())
    if args.dump:
        pathlib.Path(args.dump).write_text(
            json.dumps(build_preview(args.profile), default=_json_default, indent=2), encoding="utf-8"
        )
        print("wrote", args.dump)
        return
    if args.serve:
        serve(args.serve, args.profile)
        return
    parser.print_help()


if __name__ == "__main__":
    main()
