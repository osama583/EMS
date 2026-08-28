# A/V Services HOD Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first of the ten `/app/dashboard` role dashboards — Head of Department, A/V Services — fully end-to-end: a real Flask endpoint computing metrics from Postgres, a real Angular page rendering it with hand-rolled SVG charts, styled like the reference admin-dashboard screenshots (stat tiles, donut/bar/line charts, clean cards on a light grey plane), and responsive down to mobile. This becomes the template the other nine dashboards reuse.

**Architecture:** One new Flask blueprint (`app/api/dashboard.py`) resolves the caller's role/unit to a profile and returns one JSON document (hero + KPIs + chart panels) computed with scoped raw SQL, matching the project's existing `query()`/`transaction()` conventions. One new Angular route (`/app/dashboard`, replacing the placeholder) renders that document with a small set of new standalone chart components (`stat-tile`, `donut-chart`, `column-chart`, `timeline-chart`) built with inline SVG, no new npm dependency, following the existing `_design-system.scss` tokens.

**Tech Stack:** Flask + psycopg2 raw SQL (existing `db.py` helpers), pytest; Angular 21 standalone components + signals, inline SVG for charts, SCSS using existing `--apu-*`/`--internal-*` custom properties.

## Global Constraints

- Every SQL query scopes by the caller's headed unit in its `WHERE` clause — never fetch broadly and filter in Python (mirrors `backend/docs/security.md`'s rule, cited as R2 in `docs/dashboards/01-role-hierarchy-and-access.md`).
- Unit scope comes from `principal.headed_units` (`backend/app/security/principal.py`), never a client-supplied parameter.
- No new runtime frontend dependency — charts are hand-built inline SVG, matching `docs/dashboards/03-dashboard-architecture.md` § 5's decision.
- The dashboard route already has a nav grant (`grants_for(HEAD_ROLES)` in `backend/seed/nav.py:88-89`) — no nav/seed change needed for this task.
- Every page in this app is responsive; this one must work down to a 360px-wide mobile viewport (stat tiles stack to 1 column, charts scroll horizontally inside `overflow-x: auto` containers rather than overflowing the page).
- Follow existing conventions: `query()`/`query_one()` from `app/db.py`, `RealDictCursor` rows, Flask blueprints registered in `app/api/__init__.py`, Angular standalone components with `ChangeDetectionStrategy.OnPush` and signals (see `cafeteria-my-staff.ts` as the reference pattern), `environment.apiBaseUrl` for HTTP calls.
- Scope for this task is the single `hod_av` profile only — not all ten roles. The response contract and component design should be generic enough that a second profile is a new backend query module + a new frontend config object, not a new component, but implementing that generality for all ten is explicitly out of scope here.

---

### Task 1: Backend — dashboard blueprint skeleton with role resolution

**Files:**
- Create: `backend/app/api/dashboard.py`
- Modify: `backend/app/api/__init__.py`
- Test: `backend/tests/test_dashboard_routes.py`

**Interfaces:**
- Consumes: `current_principal()` from `backend/app/security/principal.py` (has `.headed_units: frozenset[str]`, `.has_role(*codes)`); `require_auth`, `require_internal` from `backend/app/security/__init__.py`; `query`, `query_one` from `backend/app/db.py`; `Forbidden` from `backend/app/errors.py`.
- Produces: `GET /api/v1/dashboard` route returning `404` (via a `NoDashboardProfile`-style 403) for a caller with no matching profile, and a stub `{"profile": {...}}` body for an A/V HOD. Later tasks extend this same handler's response body — they do not add new routes.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dashboard_routes.py
"""Tests for GET /dashboard against the live database, matching the
project's existing pytest-against-real-db style (see test_catalog_routes.py)."""
from __future__ import annotations

import pytest


def test_dashboard_requires_auth(client):
    resp = client.get("/api/v1/dashboard")
    assert resp.status_code == 401


def test_dashboard_forbidden_for_role_with_no_profile(client, login_as):
    # A plain student/lecturer holds no head-of-department/head-of-school/cfo/
    # cafeteria-manager role, so no dashboard profile can resolve for them.
    token = login_as("farah.izzati@staff.apu.edu.my")
    resp = client.get("/api/v1/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_dashboard_resolves_av_hod_profile(client, login_as):
    token = login_as("av.manager@demo.apu.edu.my")
    resp = client.get("/api/v1/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["profile"]["key"] == "hod_av"
    assert body["profile"]["unitCode"] == "a_v_services"
```

Check `backend/tests/test_catalog_routes.py` first for the exact `client`/`login_as` fixture names already in `conftest.py` — reuse them verbatim rather than inventing new fixture names.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_dashboard_routes.py -v`
Expected: FAIL — `404 Not Found` on all three, because no `/dashboard` route exists yet.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/api/dashboard.py
"""Role-based analytics for /app/dashboard.

    GET /dashboard   the resolved profile plus hero/KPIs/panels for that caller

Only one profile is implemented so far: `hod_av` (Head of Department @
a_v_services), per docs/dashboards/10-hod-av-services.md. Resolution follows
docs/dashboards/03-dashboard-architecture.md's tier order (cfo > head-of-school >
head-of-department > cafeteria-manager); a caller matching a tier this module
does not yet implement gets 403, same as one matching no tier at all — both are
"no dashboard for you today", not a bug to distinguish client-side.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..errors import Forbidden
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from . import av_dashboard

bp = Blueprint("dashboard", __name__, url_prefix="/dashboard")

AV_UNIT_CODE = "a_v_services"


@bp.get("")
@require_auth
@require_internal
def get_dashboard():
    principal = current_principal()
    if AV_UNIT_CODE in principal.headed_units:
        return jsonify(av_dashboard.build(principal))
    raise Forbidden("No dashboard is available for your role yet.")
```

```python
# backend/app/api/av_dashboard.py (new file, used by dashboard.py above)
"""Query module for the hod_av dashboard profile.

Every query is scoped to a_v_services in SQL (never filtered in Python
afterwards), per docs/dashboards/01-role-hierarchy-and-access.md rule R2.
"""
from __future__ import annotations

from ..security.principal import Principal

UNIT_CODE = "a_v_services"
UNIT_LABEL = "A/V Services"


def build(principal: Principal) -> dict:
    return {
        "profile": {
            "key": "hod_av",
            "roleCode": "head-of-department",
            "unitCode": UNIT_CODE,
            "unitLabel": UNIT_LABEL,
            "title": "A/V Services · Operations",
        },
    }
```

Register the blueprint:

```python
# backend/app/api/__init__.py — add import and BLUEPRINTS entry
from .dashboard import bp as dashboard_bp
...
BLUEPRINTS = (
    auth_bp,
    dashboard_bp,
    proposals_bp,
    ...
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_dashboard_routes.py -v`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/dashboard.py backend/app/api/av_dashboard.py backend/app/api/__init__.py backend/tests/test_dashboard_routes.py
git commit -m "feat(dashboard): add /dashboard endpoint with hod_av profile resolution"
```

---

### Task 2: Backend — hero + KPI metrics for hod_av

**Files:**
- Modify: `backend/app/api/av_dashboard.py`
- Modify: `backend/tests/test_dashboard_routes.py`

**Interfaces:**
- Consumes: `query`, `query_one` from `backend/app/db.py`.
- Produces: `build(principal)` now also returns `"hero"` (crew coverage ratio) and `"kpis"` (list of 4 KPI dicts: decision latency, unassigned approved rigs, send-back rate, open backlog). Each KPI dict shape: `{"id": str, "label": str, "value": float, "format": "percent"|"hours"|"count", "target": float|None, "status": "good"|"warning"|"critical"}`. This shape is what Task 4's frontend `stat-tile` component consumes — do not rename these keys later without updating that component.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dashboard_routes.py — add to the existing file
def test_dashboard_av_hero_and_kpis_shape(client, login_as):
    token = login_as("av.manager@demo.apu.edu.my")
    resp = client.get("/api/v1/dashboard", headers={"Authorization": f"Bearer {token}"})
    body = resp.get_json()

    hero = body["hero"]
    assert hero["id"] == "crew_coverage_ratio"
    assert hero["format"] == "percent"
    assert isinstance(hero["value"], (int, float))

    kpi_ids = {k["id"] for k in body["kpis"]}
    assert kpi_ids == {"decision_latency", "unassigned_rigs", "send_back_rate", "open_backlog"}
    for kpi in body["kpis"]:
        assert kpi["status"] in ("good", "warning", "critical")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_dashboard_routes.py::test_dashboard_av_hero_and_kpis_shape -v`
Expected: FAIL — `KeyError: 'hero'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/api/av_dashboard.py — replace the body of build() and add helpers below it
from ..db import query, query_one

def build(principal: Principal) -> dict:
    return {
        "profile": {
            "key": "hod_av",
            "roleCode": "head-of-department",
            "unitCode": UNIT_CODE,
            "unitLabel": UNIT_LABEL,
            "title": "A/V Services · Operations",
        },
        "hero": _hero(),
        "kpis": _kpis(),
    }


def _hero() -> dict:
    # Peak simultaneous technician-hour demand over the next 14 days, as a
    # fraction of active-staff capacity. STAFF_SHIFT_HOURS is not yet a config
    # row (gap G2 in docs/dashboards/02-metric-catalog.md); 8h is used as the
    # stated, visible default rather than a silently-assumed one.
    staff_count = query_one(
        """
        SELECT count(*) AS n
          FROM user_unit_roles uur
          JOIN role r ON r.role_code = uur.role_code
         WHERE uur.unit_code = %s AND uur.role_code = 'staff' AND uur.is_active
        """,
        (UNIT_CODE,),
    )["n"] or 1

    daily_hours = query(
        """
        SELECT date,
               sum(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0) AS hours
          FROM request_sound_light rsl
          JOIN request r ON r.request_id = rsl.request_id
         WHERE rsl.date >= CURRENT_DATE AND rsl.date < CURRENT_DATE + INTERVAL '14 days'
           AND r.status NOT IN ('completed_approved','completed_rejected','cancelled')
      GROUP BY date
        """
    )
    shift_hours = 8
    capacity = staff_count * shift_hours
    peak_ratio = max((row["hours"] / capacity for row in daily_hours), default=0.0)

    return {
        "id": "crew_coverage_ratio",
        "label": "Crew coverage ratio — next 14 days, peak day",
        "value": round(float(peak_ratio), 2),
        "format": "percent",
        "target": 0.80,
        "status": _status(peak_ratio, warn=0.80, critical=1.00),
    }


def _kpis() -> list[dict]:
    return [_decision_latency(), _unassigned_rigs(), _send_back_rate(), _open_backlog()]


def _decision_latency() -> dict:
    row = query_one(
        """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50
          FROM (
              SELECT EXTRACT(EPOCH FROM (wh.created_at - t.created_at)) / 3600.0 AS hours
                FROM request_task t
                JOIN workflow_history wh ON wh.request_task_id = t.request_task_id
               WHERE t.assigned_unit_code = %s
                 AND wh.action IN ('approve', 'send_back')
          ) latencies
        """,
        (UNIT_CODE,),
    )
    p50 = float(row["p50"]) if row and row["p50"] is not None else 0.0
    return {
        "id": "decision_latency", "label": "Decision latency (median)",
        "value": round(p50, 1), "format": "hours", "target": 48.0,
        "status": _status(p50, warn=48.0, critical=72.0),
    }


def _unassigned_rigs() -> dict:
    row = query_one(
        """
        SELECT count(*) AS n
          FROM request_task t
         WHERE t.assigned_unit_code = %s
           AND t.status = 'approved'
           AND NOT EXISTS (
               SELECT 1 FROM task_assignment a WHERE a.request_task_id = t.request_task_id
           )
        """,
        (UNIT_CODE,),
    )
    n = row["n"]
    return {
        "id": "unassigned_rigs", "label": "Unassigned approved rigs",
        "value": n, "format": "count", "target": 0,
        "status": "good" if n == 0 else ("warning" if n <= 2 else "critical"),
    }


def _send_back_rate() -> dict:
    row = query_one(
        """
        SELECT
            count(*) FILTER (WHERE status = 'resubmitted')::numeric
              / NULLIF(count(*), 0) AS rate
          FROM request_task
         WHERE assigned_unit_code = %s
        """,
        (UNIT_CODE,),
    )
    rate = float(row["rate"]) if row and row["rate"] is not None else 0.0
    return {
        "id": "send_back_rate", "label": "Send-back rate",
        "value": round(rate, 3), "format": "percent", "target": 0.15,
        "status": _status(rate, warn=0.15, critical=0.30),
    }


def _open_backlog() -> dict:
    row = query_one(
        "SELECT count(*) AS n FROM request_task WHERE assigned_unit_code = %s AND status NOT IN ('completed','cancelled')",
        (UNIT_CODE,),
    )
    n = row["n"]
    return {
        "id": "open_backlog", "label": "Open backlog",
        "value": n, "format": "count", "target": None, "status": "good",
    }


def _status(value: float, *, warn: float, critical: float) -> str:
    if value >= critical:
        return "critical"
    if value >= warn:
        return "warning"
    return "good"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_dashboard_routes.py -v`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/av_dashboard.py backend/tests/test_dashboard_routes.py
git commit -m "feat(dashboard): compute hero and KPI metrics for hod_av"
```

---

### Task 3: Backend — chart panels (collision timeline, decision-latency trend, catalogue health)

**Files:**
- Modify: `backend/app/api/av_dashboard.py`
- Modify: `backend/tests/test_dashboard_routes.py`

**Interfaces:**
- Consumes: same `query`/`query_one` helpers.
- Produces: `build(principal)` now also returns `"panels"`, a list of 3 dicts. Each has `{"id": str, "title": str, "chart": "timeline"|"column"|"donut", "series": [...], "tableView": {"columns": [...], "rows": [...]}}`. This is the exact shape Task 5's frontend chart components read — `chart` is the discriminator the Angular template switches on.

  - Panel 1 `id: "rig_collisions"`, `chart: "timeline"`: `series` is a list of `{"date": "YYYY-MM-DD", "bars": [{"label": str, "startHour": float, "endHour": float}]}` for the next 14 days.
  - Panel 2 `id: "decision_latency_trend"`, `chart: "column"`: `series` is a list of `{"x": "YYYY-Www", "y": float}` — median decision latency in hours per ISO week, last 8 weeks.
  - Panel 3 `id: "catalogue_health"`, `chart: "donut"`: `series` is a list of `{"label": str, "value": int}` — count of `request_sound_light` selections per `sound_light_options.label` in the last 90 days (top 5, rest folded into "Other").

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_dashboard_routes.py — add to the existing file
def test_dashboard_av_panels_shape(client, login_as):
    token = login_as("av.manager@demo.apu.edu.my")
    resp = client.get("/api/v1/dashboard", headers={"Authorization": f"Bearer {token}"})
    body = resp.get_json()

    panels = {p["id"]: p for p in body["panels"]}
    assert set(panels) == {"rig_collisions", "decision_latency_trend", "catalogue_health"}

    assert panels["rig_collisions"]["chart"] == "timeline"
    assert panels["decision_latency_trend"]["chart"] == "column"
    assert panels["catalogue_health"]["chart"] == "donut"

    for panel in panels.values():
        assert "series" in panel
        assert "tableView" in panel
        assert "columns" in panel["tableView"]
        assert "rows" in panel["tableView"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_dashboard_routes.py::test_dashboard_av_panels_shape -v`
Expected: FAIL — `KeyError: 'panels'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/api/av_dashboard.py — add "panels": _panels() to build()'s return dict,
# and add these functions

def _panels() -> list[dict]:
    return [_rig_collisions_panel(), _decision_latency_trend_panel(), _catalogue_health_panel()]


def _rig_collisions_panel() -> dict:
    rows = query(
        """
        SELECT rsl.date, rsl.item,
               EXTRACT(EPOCH FROM rsl.start_time) / 3600.0 AS start_hour,
               EXTRACT(EPOCH FROM rsl.end_time) / 3600.0 AS end_hour
          FROM request_sound_light rsl
          JOIN request r ON r.request_id = rsl.request_id
         WHERE rsl.date >= CURRENT_DATE AND rsl.date < CURRENT_DATE + INTERVAL '14 days'
           AND r.status NOT IN ('completed_approved','completed_rejected','cancelled')
      ORDER BY rsl.date, rsl.start_time
        """
    )
    by_date: dict[str, list[dict]] = {}
    for row in rows:
        key = row["date"].isoformat()
        by_date.setdefault(key, []).append({
            "label": row["item"],
            "startHour": float(row["start_hour"]),
            "endHour": float(row["end_hour"]),
        })
    series = [{"date": date, "bars": bars} for date, bars in sorted(by_date.items())]
    table_rows = [
        {"date": s["date"], "item": bar["label"], "window": f"{bar['startHour']:.0f}:00–{bar['endHour']:.0f}:00"}
        for s in series for bar in s["bars"]
    ]
    return {
        "id": "rig_collisions", "title": "Rig Collision Timeline", "chart": "timeline",
        "series": series,
        "tableView": {"columns": ["date", "item", "window"], "rows": table_rows},
    }


def _decision_latency_trend_panel() -> dict:
    rows = query(
        """
        SELECT to_char(date_trunc('week', wh.created_at), 'IYYY-"W"IW') AS iso_week,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (wh.created_at - t.created_at)) / 3600.0
               ) AS p50
          FROM request_task t
          JOIN workflow_history wh ON wh.request_task_id = t.request_task_id
         WHERE t.assigned_unit_code = %s
           AND wh.action IN ('approve', 'send_back')
           AND wh.created_at >= now() - INTERVAL '8 weeks'
      GROUP BY 1
      ORDER BY 1
        """,
        (UNIT_CODE,),
    )
    series = [{"x": row["iso_week"], "y": round(float(row["p50"]), 1)} for row in rows]
    return {
        "id": "decision_latency_trend", "title": "Decision latency — 8-week trend", "chart": "column",
        "series": series,
        "tableView": {"columns": ["week", "median_hours"], "rows": [{"week": p["x"], "median_hours": p["y"]} for p in series]},
    }


def _catalogue_health_panel() -> dict:
    rows = query(
        """
        SELECT slo.label, count(*) AS n
          FROM request_sound_light rsl
          JOIN sound_light_options slo ON slo.sound_light_option_id = rsl.option_id
         WHERE rsl.date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY slo.label
      ORDER BY n DESC
        """
    )
    top = rows[:5]
    other_count = sum(r["n"] for r in rows[5:])
    series = [{"label": r["label"], "value": r["n"]} for r in top]
    if other_count:
        series.append({"label": "Other", "value": other_count})
    return {
        "id": "catalogue_health", "title": "Catalogue health — selections, last 90 days", "chart": "donut",
        "series": series,
        "tableView": {"columns": ["label", "selections"], "rows": [{"label": s["label"], "selections": s["value"]} for s in series]},
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_dashboard_routes.py -v`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/av_dashboard.py backend/tests/test_dashboard_routes.py
git commit -m "feat(dashboard): add rig-collision, latency-trend and catalogue-health panels"
```

---

### Task 4: Frontend — dashboard service, models, and route wiring

**Files:**
- Create: `fyp-ui/src/app/core/dashboard/dashboard.models.ts`
- Create: `fyp-ui/src/app/core/dashboard/dashboard.service.ts`
- Create: `fyp-ui/src/app/core/dashboard/dashboard.service.spec.ts`
- Modify: `fyp-ui/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `HttpClient` (Angular), `environment.apiBaseUrl` from `fyp-ui/src/environments/environment.ts`.
- Produces: `DashboardDocument` interface and `DashboardService.getDashboard(): Observable<DashboardDocument>`. Task 6's `DashboardComponent` consumes exactly this type and method — do not rename `hero`/`kpis`/`panels` fields, they must match the backend's JSON keys verbatim (camelCase already matches since the backend emits `unitCode`, `roleCode` etc. — but plain fields like `hero`, `kpis`, `panels`, `profile` pass straight through).

- [ ] **Step 1: Write the failing test**

```typescript
// fyp-ui/src/app/core/dashboard/dashboard.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DashboardService } from './dashboard.service';
import { environment } from '../../../environments/environment';
import { DashboardDocument } from './dashboard.models';

describe('DashboardService', () => {
  let service: DashboardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fetches the dashboard document', () => {
    const mockDoc: DashboardDocument = {
      profile: { key: 'hod_av', roleCode: 'head-of-department', unitCode: 'a_v_services', unitLabel: 'A/V Services', title: 'A/V Services · Operations' },
      hero: { id: 'crew_coverage_ratio', label: 'Crew coverage', value: 0.72, format: 'percent', target: 0.8, status: 'good' },
      kpis: [],
      panels: [],
    };

    let result: DashboardDocument | undefined;
    service.getDashboard().subscribe((doc) => (result = doc));

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/dashboard`);
    expect(req.request.method).toBe('GET');
    req.flush(mockDoc);

    expect(result).toEqual(mockDoc);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fyp-ui && npx vitest run src/app/core/dashboard/dashboard.service.spec.ts`
Expected: FAIL — cannot find module `./dashboard.service`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// fyp-ui/src/app/core/dashboard/dashboard.models.ts
export type MetricFormat = 'percent' | 'hours' | 'count';
export type MetricStatus = 'good' | 'warning' | 'critical';
export type ChartKind = 'timeline' | 'column' | 'donut';

export interface DashboardProfile {
  readonly key: string;
  readonly roleCode: string;
  readonly unitCode: string;
  readonly unitLabel: string;
  readonly title: string;
}

export interface DashboardMetric {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly format: MetricFormat;
  readonly target: number | null;
  readonly status: MetricStatus;
}

export interface TimelineBar {
  readonly label: string;
  readonly startHour: number;
  readonly endHour: number;
}
export interface TimelineSeriesPoint {
  readonly date: string;
  readonly bars: readonly TimelineBar[];
}
export interface ColumnSeriesPoint {
  readonly x: string;
  readonly y: number;
}
export interface DonutSeriesPoint {
  readonly label: string;
  readonly value: number;
}

export interface DashboardPanel {
  readonly id: string;
  readonly title: string;
  readonly chart: ChartKind;
  readonly series: readonly (TimelineSeriesPoint | ColumnSeriesPoint | DonutSeriesPoint)[];
  readonly tableView: { readonly columns: readonly string[]; readonly rows: readonly Record<string, string | number>[] };
}

export interface DashboardDocument {
  readonly profile: DashboardProfile;
  readonly hero: DashboardMetric;
  readonly kpis: readonly DashboardMetric[];
  readonly panels: readonly DashboardPanel[];
}
```

```typescript
// fyp-ui/src/app/core/dashboard/dashboard.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardDocument } from './dashboard.models';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/dashboard`;

  getDashboard(): Observable<DashboardDocument> {
    return this.http.get<DashboardDocument>(this.baseUrl);
  }
}
```

Wire the route (`fyp-ui/src/app/app.routes.ts`), replacing the placeholder dashboard route:

```typescript
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/internal/pages/dashboard/dashboard').then(
            (module) => module.DashboardComponent,
          ),
        title: 'Dashboard | APU Events',
      },
```

(This import target doesn't exist yet — it's created in Task 6. Leave this edit for the start of Task 6 if you prefer strict TDD ordering; either order is fine since this file compiles independently.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fyp-ui && npx vitest run src/app/core/dashboard/dashboard.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fyp-ui/src/app/core/dashboard/dashboard.models.ts fyp-ui/src/app/core/dashboard/dashboard.service.ts fyp-ui/src/app/core/dashboard/dashboard.service.spec.ts
git commit -m "feat(dashboard): add DashboardService and response models"
```

---

### Task 5: Frontend — chart primitives (stat-tile, donut-chart, column-chart, timeline-chart)

**Files:**
- Create: `fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.ts`
- Create: `fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.html`
- Create: `fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.scss`
- Create: `fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.spec.ts`
- Create: `fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.ts`
- Create: `fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.html`
- Create: `fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.scss`
- Create: `fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.spec.ts`
- Create: `fyp-ui/src/app/shared/components/charts/column-chart/column-chart.ts`
- Create: `fyp-ui/src/app/shared/components/charts/column-chart/column-chart.html`
- Create: `fyp-ui/src/app/shared/components/charts/column-chart/column-chart.scss`
- Create: `fyp-ui/src/app/shared/components/charts/timeline-chart/timeline-chart.ts`
- Create: `fyp-ui/src/app/shared/components/charts/timeline-chart/timeline-chart.html`
- Create: `fyp-ui/src/app/shared/components/charts/timeline-chart/timeline-chart.scss`

**Interfaces:**
- Consumes: `DashboardMetric`, `ColumnSeriesPoint`, `DonutSeriesPoint`, `TimelineSeriesPoint` from `fyp-ui/src/app/core/dashboard/dashboard.models.ts` (Task 4).
- Produces: 4 standalone Angular components with these exact selectors/inputs, consumed by Task 6's `DashboardComponent`:
  - `<app-stat-tile [metric]="metric" [sparkline]="sparklineValues" />` — `metric: DashboardMetric`, `sparkline?: readonly number[]` (optional, may be omitted).
  - `<app-donut-chart [series]="series" [title]="title" />` — `series: readonly DonutSeriesPoint[]`, `title: string`.
  - `<app-column-chart [series]="series" [title]="title" [yUnit]="'h'" />` — `series: readonly ColumnSeriesPoint[]`, `title: string`, `yUnit?: string`.
  - `<app-timeline-chart [series]="series" [title]="title" [capacityHour]="24" />` — `series: readonly TimelineSeriesPoint[]`, `title: string`.

- [ ] **Step 1: Write the failing test**

```typescript
// fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatTileComponent } from './stat-tile';
import { DashboardMetric } from '../../../../core/dashboard/dashboard.models';

describe('StatTileComponent', () => {
  let fixture: ComponentFixture<StatTileComponent>;

  const metric: DashboardMetric = {
    id: 'decision_latency', label: 'Decision latency (median)',
    value: 31, format: 'hours', target: 48, status: 'good',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatTileComponent] });
    fixture = TestBed.createComponent(StatTileComponent);
    fixture.componentRef.setInput('metric', metric);
    fixture.detectChanges();
  });

  it('renders the label and formatted value', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Decision latency (median)');
    expect(text).toContain('31');
  });

  it('applies a status-good class', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.stat-tile--good')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fyp-ui && npx vitest run src/app/shared/components/charts/stat-tile/stat-tile.spec.ts`
Expected: FAIL — cannot find module `./stat-tile`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DashboardMetric } from '../../../../core/dashboard/dashboard.models';

@Component({
  selector: 'app-stat-tile',
  templateUrl: './stat-tile.html',
  styleUrl: './stat-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTileComponent {
  readonly metric = input.required<DashboardMetric>();
  readonly sparkline = input<readonly number[]>();

  readonly formattedValue = computed(() => {
    const m = this.metric();
    if (m.format === 'percent') return `${Math.round(m.value * 100)}%`;
    if (m.format === 'hours') return `${m.value}h`;
    return `${m.value}`;
  });

  readonly formattedTarget = computed(() => {
    const m = this.metric();
    if (m.target === null) return '';
    if (m.format === 'percent') return `Target ≤ ${Math.round(m.target * 100)}%`;
    if (m.format === 'hours') return `Target ≤ ${m.target}h`;
    return `Target ${m.target}`;
  });

  readonly sparklinePoints = computed(() => {
    const values = this.sparkline();
    if (!values || values.length < 2) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = 100 / (values.length - 1);
    return values.map((v, i) => `${i * stepX},${28 - ((v - min) / range) * 28}`).join(' ');
  });
}
```

```html
<!-- fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.html -->
<div class="stat-tile" [class]="'stat-tile--' + metric().status">
  <span class="stat-tile__label">{{ metric().label }}</span>
  <span class="stat-tile__value">{{ formattedValue() }}</span>
  @if (formattedTarget()) {
    <span class="stat-tile__target">{{ formattedTarget() }}</span>
  }
  @if (sparklinePoints()) {
    <svg class="stat-tile__spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline [attr.points]="sparklinePoints()" fill="none" stroke-width="2" />
    </svg>
  }
</div>
```

```scss
// fyp-ui/src/app/shared/components/charts/stat-tile/stat-tile.scss
.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: var(--space-3);
  background: var(--apu-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--internal-card-shadow);
  min-width: 0;

  &__label {
    font-size: var(--type-label);
    color: var(--apu-text-muted);
    font-weight: var(--weight-label);
  }
  &__value {
    font-size: var(--type-card);
    font-weight: var(--weight-card);
    color: var(--apu-navy-900);
  }
  &__target {
    font-size: 0.75rem;
    color: var(--apu-text-soft);
  }
  &__spark {
    width: 100%;
    height: 28px;
    margin-top: 0.25rem;
  }
  &__spark polyline { stroke: var(--apu-blue-700); }

  &--good .stat-tile__value { color: #0ca30c; }
  &--warning .stat-tile__value { color: #fab219; }
  &--critical .stat-tile__value { color: #d03b3b; }
}
```

```typescript
// fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DonutSeriesPoint } from '../../../../core/dashboard/dashboard.models';

const SLOT_COLORS = ['#1769d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#e34948', '#7a8796'];

interface DonutSlice extends DonutSeriesPoint {
  readonly pathD: string;
  readonly color: string;
  readonly percent: number;
}

@Component({
  selector: 'app-donut-chart',
  templateUrl: './donut-chart.html',
  styleUrl: './donut-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DonutChartComponent {
  readonly series = input.required<readonly DonutSeriesPoint[]>();
  readonly title = input.required<string>();

  readonly total = computed(() => this.series().reduce((sum, s) => sum + s.value, 0) || 1);

  readonly slices = computed<readonly DonutSlice[]>(() => {
    const total = this.total();
    let angle = -90;
    const radius = 40;
    const cx = 50;
    const cy = 50;
    return this.series().map((point, i) => {
      const fraction = point.value / total;
      const sweep = fraction * 360;
      const startRad = (angle * Math.PI) / 180;
      const endRad = ((angle + sweep) * Math.PI) / 180;
      const x1 = cx + radius * Math.cos(startRad);
      const y1 = cy + radius * Math.sin(startRad);
      const x2 = cx + radius * Math.cos(endRad);
      const y2 = cy + radius * Math.sin(endRad);
      const largeArc = sweep > 180 ? 1 : 0;
      const pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      angle += sweep;
      return { ...point, pathD, color: SLOT_COLORS[i % SLOT_COLORS.length], percent: Math.round(fraction * 100) };
    });
  });
}
```

```html
<!-- fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.html -->
<div class="donut-chart">
  <h3 class="donut-chart__title">{{ title() }}</h3>
  <div class="donut-chart__body">
    <svg viewBox="0 0 100 100" class="donut-chart__svg" role="img" [attr.aria-label]="title()">
      @for (slice of slices(); track slice.label) {
        <path [attr.d]="slice.pathD" [attr.fill]="slice.color" />
      }
      <circle cx="50" cy="50" r="24" fill="var(--apu-surface)" />
    </svg>
    <ul class="donut-chart__legend">
      @for (slice of slices(); track slice.label) {
        <li>
          <span class="donut-chart__swatch" [style.background]="slice.color"></span>
          {{ slice.label }} — {{ slice.percent }}%
        </li>
      }
    </ul>
  </div>
</div>
```

```scss
// fyp-ui/src/app/shared/components/charts/donut-chart/donut-chart.scss
.donut-chart {
  background: var(--apu-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--internal-card-shadow);
  padding: var(--space-3);

  &__title { font-size: var(--type-label); font-weight: var(--weight-label); color: var(--apu-navy-900); margin: 0 0 var(--space-2); }
  &__body { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  &__svg { width: 120px; height: 120px; flex: 0 0 auto; }
  &__legend { list-style: none; margin: 0; padding: 0; font-size: 0.85rem; color: var(--apu-text-muted); display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
  &__swatch { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%; margin-right: 0.4rem; }
}
```

```typescript
// fyp-ui/src/app/shared/components/charts/column-chart/column-chart.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ColumnSeriesPoint } from '../../../../core/dashboard/dashboard.models';

@Component({
  selector: 'app-column-chart',
  templateUrl: './column-chart.html',
  styleUrl: './column-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnChartComponent {
  readonly series = input.required<readonly ColumnSeriesPoint[]>();
  readonly title = input.required<string>();
  readonly yUnit = input<string>('');

  readonly maxY = computed(() => Math.max(...this.series().map((p) => p.y), 1));

  readonly bars = computed(() => {
    const max = this.maxY();
    const count = this.series().length || 1;
    const width = 100 / count;
    return this.series().map((point, i) => ({
      x: i * width + width * 0.15,
      width: width * 0.7,
      height: (point.y / max) * 80,
      y: 90 - (point.y / max) * 80,
      label: point.x,
      value: point.y,
    }));
  });
}
```

```html
<!-- fyp-ui/src/app/shared/components/charts/column-chart/column-chart.html -->
<div class="column-chart">
  <h3 class="column-chart__title">{{ title() }}</h3>
  <div class="column-chart__scroll">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="column-chart__svg" role="img" [attr.aria-label]="title()">
      <line x1="0" y1="90" x2="100" y2="90" class="column-chart__axis" />
      @for (bar of bars(); track bar.label) {
        <rect [attr.x]="bar.x" [attr.y]="bar.y" [attr.width]="bar.width" [attr.height]="bar.height" rx="1" class="column-chart__bar" />
      }
    </svg>
    <div class="column-chart__labels">
      @for (bar of bars(); track bar.label) {
        <span>{{ bar.label }}<b>{{ bar.value }}{{ yUnit() }}</b></span>
      }
    </div>
  </div>
</div>
```

```scss
// fyp-ui/src/app/shared/components/charts/column-chart/column-chart.scss
.column-chart {
  background: var(--apu-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--internal-card-shadow);
  padding: var(--space-3);

  &__title { font-size: var(--type-label); font-weight: var(--weight-label); color: var(--apu-navy-900); margin: 0 0 var(--space-2); }
  &__scroll { overflow-x: auto; }
  &__svg { width: 100%; height: 160px; min-width: 320px; }
  &__axis { stroke: var(--apu-border); stroke-width: 0.5; }
  &__bar { fill: var(--apu-blue-700); }
  &__labels { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--apu-text-soft); min-width: 320px; gap: 0.25rem; }
  &__labels span { display: flex; flex-direction: column; align-items: center; }
  &__labels b { color: var(--apu-navy-900); font-weight: var(--weight-label); }
}
```

```typescript
// fyp-ui/src/app/shared/components/charts/timeline-chart/timeline-chart.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TimelineSeriesPoint } from '../../../../core/dashboard/dashboard.models';

@Component({
  selector: 'app-timeline-chart',
  templateUrl: './timeline-chart.html',
  styleUrl: './timeline-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineChartComponent {
  readonly series = input.required<readonly TimelineSeriesPoint[]>();
  readonly title = input.required<string>();
  readonly capacityHour = input<number>(24);

  readonly rows = computed(() =>
    this.series().map((day) => ({
      date: day.date,
      bars: day.bars.map((bar) => ({
        ...bar,
        leftPct: (bar.startHour / 24) * 100,
        widthPct: ((bar.endHour - bar.startHour) / 24) * 100,
      })),
    })),
  );
}
```

```html
<!-- fyp-ui/src/app/shared/components/charts/timeline-chart/timeline-chart.html -->
<div class="timeline-chart">
  <h3 class="timeline-chart__title">{{ title() }}</h3>
  @if (rows().length === 0) {
    <p class="timeline-chart__empty">No sound & light bookings in the next 14 days.</p>
  } @else {
    <div class="timeline-chart__scroll">
      @for (row of rows(); track row.date) {
        <div class="timeline-chart__row">
          <span class="timeline-chart__date">{{ row.date }}</span>
          <div class="timeline-chart__track">
            @for (bar of row.bars; track bar.label + bar.startHour) {
              <div class="timeline-chart__bar" [style.left.%]="bar.leftPct" [style.width.%]="bar.widthPct" [title]="bar.label">
                {{ bar.label }}
              </div>
            }
          </div>
        </div>
      }
    </div>
  }
</div>
```

```scss
// fyp-ui/src/app/shared/components/charts/timeline-chart/timeline-chart.scss
.timeline-chart {
  background: var(--apu-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--internal-card-shadow);
  padding: var(--space-3);

  &__title { font-size: var(--type-label); font-weight: var(--weight-label); color: var(--apu-navy-900); margin: 0 0 var(--space-2); }
  &__empty { color: var(--apu-text-muted); font-size: 0.9rem; }
  &__scroll { overflow-x: auto; }
  &__row { display: flex; align-items: center; gap: var(--space-2); min-width: 480px; padding: 0.35rem 0; border-bottom: 1px solid var(--apu-border); }
  &__row:last-child { border-bottom: none; }
  &__date { width: 5rem; flex: 0 0 auto; font-size: 0.75rem; color: var(--apu-text-muted); }
  &__track { position: relative; flex: 1; height: 1.6rem; background: var(--apu-surface-muted); border-radius: 0.3rem; }
  &__bar {
    position: absolute;
    top: 0.15rem;
    height: 1.3rem;
    background: var(--apu-blue-700);
    color: #fff;
    font-size: 0.65rem;
    border-radius: 0.25rem;
    padding: 0 0.3rem;
    overflow: hidden;
    white-space: nowrap;
    display: flex;
    align-items: center;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fyp-ui && npx vitest run src/app/shared/components/charts/stat-tile/stat-tile.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fyp-ui/src/app/shared/components/charts/
git commit -m "feat(dashboard): add stat-tile, donut, column and timeline chart primitives"
```

---

### Task 6: Frontend — DashboardComponent page, responsive layout, and route swap

**Files:**
- Create: `fyp-ui/src/app/features/internal/pages/dashboard/dashboard.ts`
- Create: `fyp-ui/src/app/features/internal/pages/dashboard/dashboard.html`
- Create: `fyp-ui/src/app/features/internal/pages/dashboard/dashboard.scss`
- Create: `fyp-ui/src/app/features/internal/pages/dashboard/dashboard.spec.ts`
- Modify: `fyp-ui/src/app/app.routes.ts` (finish the swap started in Task 4)

**Interfaces:**
- Consumes: `DashboardService.getDashboard()` (Task 4), `StatTileComponent`, `DonutChartComponent`, `ColumnChartComponent`, `TimelineChartComponent` (Task 5), `DashboardDocument`/`DashboardPanel`/`ColumnSeriesPoint`/`DonutSeriesPoint`/`TimelineSeriesPoint` (Task 4).
- Produces: `DashboardComponent`, the route target already referenced by `app.routes.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// fyp-ui/src/app/features/internal/pages/dashboard/dashboard.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DashboardComponent } from './dashboard';
import { DashboardService } from '../../../../core/dashboard/dashboard.service';
import { DashboardDocument } from '../../../../core/dashboard/dashboard.models';

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;

  const doc: DashboardDocument = {
    profile: { key: 'hod_av', roleCode: 'head-of-department', unitCode: 'a_v_services', unitLabel: 'A/V Services', title: 'A/V Services · Operations' },
    hero: { id: 'crew_coverage_ratio', label: 'Crew coverage ratio', value: 0.72, format: 'percent', target: 0.8, status: 'good' },
    kpis: [
      { id: 'decision_latency', label: 'Decision latency', value: 31, format: 'hours', target: 48, status: 'good' },
    ],
    panels: [
      { id: 'rig_collisions', title: 'Rig Collision Timeline', chart: 'timeline', series: [], tableView: { columns: [], rows: [] } },
      { id: 'decision_latency_trend', title: 'Decision latency trend', chart: 'column', series: [], tableView: { columns: [], rows: [] } },
      { id: 'catalogue_health', title: 'Catalogue health', chart: 'donut', series: [], tableView: { columns: [], rows: [] } },
    ],
  };

  beforeEach(() => {
    const serviceStub = { getDashboard: () => of(doc) };
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [{ provide: DashboardService, useValue: serviceStub }],
    });
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
  });

  it('renders the profile title and hero', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('A/V Services · Operations');
    expect(text).toContain('Crew coverage ratio');
  });

  it('renders one panel component per chart kind', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-timeline-chart')).toBeTruthy();
    expect(host.querySelector('app-column-chart')).toBeTruthy();
    expect(host.querySelector('app-donut-chart')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fyp-ui && npx vitest run src/app/features/internal/pages/dashboard/dashboard.spec.ts`
Expected: FAIL — cannot find module `./dashboard`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// fyp-ui/src/app/features/internal/pages/dashboard/dashboard.ts
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DashboardService } from '../../../../core/dashboard/dashboard.service';
import {
  ColumnSeriesPoint,
  DashboardDocument,
  DashboardPanel,
  DonutSeriesPoint,
  TimelineSeriesPoint,
} from '../../../../core/dashboard/dashboard.models';
import { StatTileComponent } from '../../../../shared/components/charts/stat-tile/stat-tile';
import { DonutChartComponent } from '../../../../shared/components/charts/donut-chart/donut-chart';
import { ColumnChartComponent } from '../../../../shared/components/charts/column-chart/column-chart';
import { TimelineChartComponent } from '../../../../shared/components/charts/timeline-chart/timeline-chart';

@Component({
  selector: 'app-dashboard',
  imports: [StatTileComponent, DonutChartComponent, ColumnChartComponent, TimelineChartComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly dashboardService = inject(DashboardService);
  private readonly destroyRef = inject(DestroyRef);

  readonly document = signal<DashboardDocument | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  constructor() {
    this.dashboardService.getDashboard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (doc) => { this.document.set(doc); this.loading.set(false); },
      error: () => { this.errorMessage.set('The dashboard could not be loaded.'); this.loading.set(false); },
    });
  }

  isTimeline(panel: DashboardPanel): boolean { return panel.chart === 'timeline'; }
  isColumn(panel: DashboardPanel): boolean { return panel.chart === 'column'; }
  isDonut(panel: DashboardPanel): boolean { return panel.chart === 'donut'; }

  asTimelineSeries(panel: DashboardPanel): readonly TimelineSeriesPoint[] {
    return panel.series as readonly TimelineSeriesPoint[];
  }
  asColumnSeries(panel: DashboardPanel): readonly ColumnSeriesPoint[] {
    return panel.series as readonly ColumnSeriesPoint[];
  }
  asDonutSeries(panel: DashboardPanel): readonly DonutSeriesPoint[] {
    return panel.series as readonly DonutSeriesPoint[];
  }
}
```

```html
<!-- fyp-ui/src/app/features/internal/pages/dashboard/dashboard.html -->
@if (loading()) {
  <div class="dashboard dashboard--loading">Loading dashboard…</div>
} @else if (errorMessage()) {
  <div class="dashboard dashboard--error">{{ errorMessage() }}</div>
} @else if (document(); as doc) {
  <div class="dashboard">
    <header class="dashboard__header">
      <p class="dashboard__eyebrow">{{ doc.profile.unitLabel }}</p>
      <h1 class="dashboard__title">{{ doc.profile.title }}</h1>
    </header>

    <section class="dashboard__signal">
      <div class="dashboard__hero">
        <app-stat-tile [metric]="doc.hero" />
      </div>
      <div class="dashboard__kpis">
        @for (kpi of doc.kpis; track kpi.id) {
          <app-stat-tile [metric]="kpi" />
        }
      </div>
    </section>

    <section class="dashboard__panels">
      @for (panel of doc.panels; track panel.id) {
        <div class="dashboard__panel" [class.dashboard__panel--wide]="isTimeline(panel)">
          @if (isTimeline(panel)) {
            <app-timeline-chart [series]="asTimelineSeries(panel)" [title]="panel.title" />
          } @else if (isColumn(panel)) {
            <app-column-chart [series]="asColumnSeries(panel)" [title]="panel.title" yUnit="h" />
          } @else if (isDonut(panel)) {
            <app-donut-chart [series]="asDonutSeries(panel)" [title]="panel.title" />
          }
        </div>
      }
    </section>
  </div>
}
```

```scss
// fyp-ui/src/app/features/internal/pages/dashboard/dashboard.scss
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--internal-container-padding);

  &--loading, &--error {
    padding: var(--space-5);
    color: var(--apu-text-muted);
    text-align: center;
  }

  &__eyebrow {
    font-size: var(--type-label);
    color: var(--apu-text-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 0.25rem;
  }
  &__title {
    font-size: var(--type-card);
    font-weight: var(--weight-heading);
    color: var(--apu-navy-900);
    margin: 0;
  }

  &__signal {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 2fr;
    gap: var(--space-3);
  }
  &__hero { display: flex; }
  &__hero app-stat-tile { flex: 1; }
  &__kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-3);
  }

  &__panels {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
  }
  &__panel--wide { grid-column: 1 / -1; }
}

// Mobile: everything stacks to a single column, no fixed widths that could
// force the page itself to scroll horizontally — only chart-internal
// `overflow-x: auto` containers (see column-chart/timeline-chart) may scroll.
@media (max-width: 720px) {
  .dashboard__signal {
    grid-template-columns: 1fr;
  }
  .dashboard__kpis {
    grid-template-columns: repeat(2, 1fr);
  }
  .dashboard__panels {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 420px) {
  .dashboard__kpis {
    grid-template-columns: 1fr;
  }
}
```

Finish the route swap in `fyp-ui/src/app/app.routes.ts` (if not already done in Task 4):

```typescript
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/internal/pages/dashboard/dashboard').then(
            (module) => module.DashboardComponent,
          ),
        title: 'Dashboard | APU Events',
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fyp-ui && npx vitest run src/app/features/internal/pages/dashboard/dashboard.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fyp-ui/src/app/features/internal/pages/dashboard/ fyp-ui/src/app/app.routes.ts
git commit -m "feat(dashboard): render hod_av dashboard page and wire the route"
```

---

### Task 7: Manual verification — run the app, log in as the A/V HOD, confirm responsiveness

**Files:** none (verification only).

**Interfaces:** N/A — this task exercises Tasks 1–6 together against the real dev stack.

- [ ] **Step 1: Start the backend**

Run: `cd backend && flask run` (or the project's existing documented dev-server command — check `backend/README.md` if `flask run` needs an app factory flag).
Expected: server listening, `/health` returns `{"status": "ok", ...}`.

- [ ] **Step 2: Start the frontend**

Run: `cd fyp-ui && npm start` (or `ng serve`, matching `package.json`'s existing script name).
Expected: dev server compiles with no errors, proxying `/api` to the Flask backend per `proxy.conf.json`.

- [ ] **Step 3: Log in as the seeded A/V HOD and open the dashboard**

Log in as `av.manager@demo.apu.edu.my` (seeded in `backend/seed/data.py`) with its seeded password, navigate to `/app/dashboard`.
Expected: page shows the hero tile ("Crew coverage ratio"), 4 KPI tiles, and 3 chart panels (timeline, column, donut) with real numbers — not zeros/empty unless the seed data genuinely has none in the relevant windows.

- [ ] **Step 4: Resize to mobile width and re-check**

Using the browser devtools responsive mode, set viewport to 360×740 (a small phone).
Expected: KPI tiles stack to 1 column, hero/KPI grid stacks to 1 column, chart panels stack to 1 column full-width, no horizontal scrollbar on the page body itself (only inside the column-chart/timeline-chart's own scroll containers if their content is wider than the viewport).

- [ ] **Step 5: Run the full test suites**

Run: `cd backend && pytest tests/test_dashboard_routes.py -v` and `cd fyp-ui && npx vitest run`
Expected: all backend dashboard tests pass; no regressions in the existing frontend suite (baseline test count from `docs/dashboards/03-dashboard-architecture.md` § 11 references "the existing 99-test suite" — confirm the new dashboard specs added to that count, and nothing pre-existing broke).

- [ ] **Step 6: Commit any fixups found during manual verification**

If Step 3 or 4 surfaces a real bug (wrong query, layout break at a specific width), fix it, re-run the relevant test from Tasks 1–6, and commit as its own small fix commit — do not fold silent fixes into this task's non-existent diff.

```bash
git add -A
git commit -m "fix(dashboard): <describe the specific issue found during manual verification>"
```

(Skip this step entirely if nothing needed fixing.)
