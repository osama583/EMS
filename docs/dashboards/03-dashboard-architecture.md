# Dashboard architecture

How the ten dashboards are built, served, and rendered. One mechanism, ten
configurations.

---

## 1. Shape of the thing

```
  GET /dashboard?period=90d[&unit=…][&outlet=…][&profile=…]
        │
        │  app/api/dashboard.py          ← new blueprint
        ▼
  resolve_dashboard_profile(principal)   ← § 3, deterministic
        │
        ▼
  PROFILES[profile_key]                  ← declarative layout, one entry per role
        │  { hero, kpis[], panels[], insights[], quickActions[] }
        ▼
  for each widget: WIDGET_REGISTRY[id].query(cur, scope, period)
        │  every query scoped in SQL (R2), unit from principal (R4)
        ▼
  one JSON document  →  Angular DashboardComponent
                        renders declaratively; computes nothing
```

The layout is **data, not code**. A profile is a Python dict naming widget ids; the
Angular component walks it. Adding a Cafeteria Admin dashboard later is a new
`PROFILES` entry plus any new widgets, with no change to the component, the route,
or the response contract.

---

## 2. API surface

| Endpoint | Purpose |
|---|---|
| `GET /dashboard` | The whole document: resolved profile, KPIs, panels, insights, quick actions |
| `GET /dashboard/widgets/<widget_id>` | One widget, re-fetched on filter change without re-running the page |
| `GET /dashboard/profiles` | The profiles this caller may switch between (§ 3) |
| `GET /dashboard/export?widget=<id>&format=csv` | The table-view twin of any chart, as a download |

**Query parameters**

| Param | Values | Default | Notes |
|---|---|---|---|
| `period` | `7d` `30d` `90d` `term` `ytd` | `30d` | One filter row scopes every widget on the page |
| `unit` | a unit code | first of `headed_units` | **Validated against `principal.headed_units`; an unrecognised value is ignored, not rejected** (R4) |
| `outlet` | a cafeteria code or `all` | `all` | Validated against `units_for_role('cafeteria-manager')` (R5) |
| `profile` | a profile key | tier order | Validated against `GET /dashboard/profiles` |

**Decorators.** `@require_auth` and `@require_internal`. No `@require_roles` — the
profile resolver is the gate, and it fails closed to `no-access` (R1). Rate limit
inherits the global 300/min; the dashboard is one request per page load.

**Errors.** Standard `app/errors.py` envelope. A widget whose query fails does not
fail the page: it returns `{"id": …, "state": "error"}` and renders an inline retry.
One bad aggregate must not blank a department head's morning.

---

## 3. Role resolution

```python
DASHBOARD_TIERS = (
    ("cfo",                 lambda p: p.has_role("cfo")),
    ("head-of-school",      lambda p: p.units_for_role("head-of-school")),
    ("head-of-department",  lambda p: p.units_for_role("head-of-department")),
    ("cafeteria-manager",   lambda p: p.units_for_role("cafeteria-manager")),
)

def resolve_dashboard_profile(principal, requested=None):
    """Ordered list of profiles this actor may see. First is the default."""
    available = []
    for role_code, matcher in DASHBOARD_TIERS:
        units = matcher(principal)
        if not units:
            continue
        if units is True:                       # flat role
            available.append(Profile(role_code, unit=None))
            continue
        for unit in sorted(units):              # stable across sessions
            available.append(Profile(role_code, unit=unit))
    if not available:
        raise NoDashboardProfile              # → /app/no-access
    if requested:
        available = [p for p in available if p.key == requested] + \
                    [p for p in available if p.key != requested]
    return available
```

A service HOD's profile key resolves further, by unit, to one of six department
profiles. That is where the six HOD dashboards diverge:

```python
DEPARTMENT_PROFILE = {
    "a_v_services":             "hod_av",
    "food_beverage_services":   "hod_fmb",
    "logistics_and_facilities": "hod_logistics",
    "photography_services":     "hod_photography",
    "student_services":         "hod_student_services",
    "transport_services":       "hod_transport",
}
```

**A unit not in that map** (a service department a System Admin creates later) falls
back to `hod_generic` — the flow/SLA/quality/people families only, since it has no
known detail table or capacity column. Documented so a new unit degrades gracefully
instead of erroring.

**The two schools** resolve through the profile-score rule in
[01](01-role-hierarchy-and-access.md) § 1, evaluated at request time so it tracks the
data rather than a hardcoded pairing.

---

## 4. Response contract

```jsonc
{
  "profile":  { "key": "hod_transport", "roleCode": "head-of-department",
                "unitCode": "transport_services", "unitLabel": "Transport Services",
                "title": "Transport Operations", "switchable": [ /* other profiles */ ] },
  "period":   { "key": "30d", "from": "2026-07-28", "to": "2026-08-27",
                "comparedTo": { "from": "2026-06-28", "to": "2026-07-28" } },

  "hero":     { "id": "fleet_utilisation", "label": "Fleet day utilisation",
                "value": 0.72, "format": "percent",
                "delta": { "value": 0.08, "direction": "up", "isGood": false,
                           "vs": "previous 30 days" },
                "sparkline": [ /* 12 points */ ],
                "drill": { "route": "/app/inbox/requests", "params": {…} } },

  "kpis":     [ { "id": "seat_fill", "label": "Seat-fill efficiency",
                  "value": 0.54, "format": "percent",
                  "target": { "min": 0.6, "max": 0.95 }, "status": "warning",
                  "delta": {…}, "sparkline": […], "drill": {…},
                  "definition": "M32 — requested pax ÷ vehicle capacity" } ],

  "panels":   [ { "id": "vehicle_day_commitment", "title": "Vehicle-day commitment",
                  "chart": "heatmap",
                  "series": [ { "key": "…", "label": "…", "colorSlot": 1,
                                "points": [ { "x": "2026-09-02", "y": 0.94 } ] } ],
                  "axes": { "x": { "type": "date" }, "y": { "type": "category" } },
                  "annotations": [ { "type": "threshold", "value": 1.0,
                                     "label": "capacity" } ],
                  "filters": [ "vehicleType" ],
                  "tableView": { "columns": [...], "rows": [...] },
                  "drill": {…}, "state": "ok" } ],

  "insights": [ { "id": "AI-07", "severity": "serious",
                  "title": "Seat-fill fell below 55% for the third week",
                  "body": "…", "evidence": { "metric": "M32", "value": 0.54,
                                             "window": "3 weeks" },
                  "action": { "label": "Review vehicle assignments",
                              "route": "/app/inbox/requests",
                              "params": { "requestKind": "transportation" } } } ],

  "quickActions": [ { "label": "Assign pending work", "icon": "assignment_ind",
                      "route": "/app/inbox/requests", "badge": 6 } ],

  "meta": { "generatedAt": "…", "cacheKey": "…", "queryMs": 214,
            "suppressedBuckets": 2 }
}
```

Notes that matter:

- **`tableView` ships with every panel.** Not lazily fetched. It is the WCAG-clean
  twin, the CSV export source, and the fallback when a chart cannot render.
- **`colorSlot` is an integer, not a hex.** The server assigns identity; the client
  maps slot → hex. This is what makes "colour follows the entity, never its rank"
  enforceable: filtering out a series cannot repaint the survivors, because slots are
  assigned from the entity key, not the row index.
- **`status` on a KPI is derived server-side** from the target and the config
  thresholds, so two clients cannot disagree about whether 0.54 is a warning.
- **`suppressedBuckets`** tells the UI to render the R8 footnote. Silently dropping
  buckets would misstate a chart.

---

## 5. Chart runtime

**Decision: hand-rolled inline-SVG primitives, no charting dependency.**

`fyp-ui/package.json` carries exactly `@angular/*`, `rxjs` and `tslib`. Every complex
UI piece in the app — `data-table`, `step-indicator`, `task-calendar`,
`option-picker-grid`, `nav-icon` — is hand-built. Adding Chart.js or ECharts here
would be the first runtime UI dependency in the project and would bring a canvas
renderer that cannot inherit the SCSS custom properties the rest of the app is themed
with.

The charts this design needs are geometrically simple: line, area, column, stacked
bar, horizontal bar, heatmap, dot/lollipop, and a gantt-style timeline. Each is
under 200 lines of Angular + SVG with the mark specs in § 7 applied, and they are
seek-safe for screenshotting and printing in a way canvas is not.

*Trade-off, stated plainly:* a library would give zoom, brush-select, and animated
transitions for free. This design does not use those. If a later requirement needs
them, the panel contract in § 4 is renderer-agnostic — swapping in a library is a
component change, not an API change.

### Component inventory — `fyp-ui/src/app/shared/components/charts/`

| Component | Used for | Notes |
|---|---|---|
| `chart-frame` | Every chart | Title, subtitle, legend, filter slot, table-view toggle, empty/loading/error states, export |
| `line-chart` | Trends, forecasts | 2px stroke, ≥8px end markers with 2px surface ring, dashed for projections, crosshair + tooltip |
| `area-chart` | Single-series volume | Series hue at 10% opacity, 2px stroke on top |
| `column-chart` | Weekly counts | ≤24px thick, 4px rounded cap, square at baseline, 2px surface gap |
| `stacked-bar` | Status mix, part-to-whole | Horizontal when category names are long; 2px surface gap between segments |
| `bar-chart` | Ranked comparison | Horizontal; value at the tip; ordered descending |
| `heatmap` | Date × item commitment | Sequential blue ramp; threshold cells get a status ring **and an icon**, never colour alone |
| `timeline-chart` | Concurrency / gantt | Overlap depth by row; the A/V and Photography signature |
| `dot-plot` | Distributions, per-staff spread | ≥8px markers, 2px surface ring |
| `funnel` | Stage conversion | Ordinal blue ramp starting no lighter than step 250 |
| `meter` | Single ratio vs a limit | Fill carries severity; track is a lighter step of the same ramp |
| `stat-tile` | KPI cards | label · value · delta · 12-point sparkline |
| `hero-figure` | The one lead number | ≥48px, same sans, proportional figures, **exactly one per view** |
| `insight-card` | AI insights | Severity icon + label + evidence + action button |

### Rules these components enforce, not just document

Encoded as component contracts so a future panel cannot violate them:

1. **No dual-axis.** `line-chart` accepts one `yAxis`. Two measures of different
   scale are two panels or one indexed series. This is the single most common
   dashboard mistake and the contract makes it unrepresentable.
2. **Legend for ≥ 2 series, none for 1.** `chart-frame` derives this from
   `series.length`; it is not a prop.
3. **Selective direct labels only.** `labelStrategy: 'endpoint' | 'extreme' | 'none'`.
   There is no `'all'`.
4. **Slot ceiling of 8, all-pairs ceiling of 3.** `heatmap`, `dot-plot` and any
   small-multiple layout reject a 4th categorical series — the server folds the tail
   into "Other" and says so in `meta`.
5. **Solid hairline grid.** No dashed gridlines; dashing is reserved for the
   projected segment of a forecast and means only that.
6. **Container includes the axis band.** Height is `plot + axis`, never a fixed
   height that nests a scrollbar.
7. **Text never wears the series colour.** Values, labels and legend text use the
   ink tokens; identity comes from the swatch beside them.

---

## 6. Palette

Anchored to the APU tokens already in `_design-system.scss`, then **validated** —
not eyeballed. The app renders on `--apu-surface: #fff` and has no dark mode
(no `prefers-color-scheme` or `data-theme` anywhere in `fyp-ui/src`), so light mode
is the only mode to validate.

### Categorical — fixed slot order, never cycled

| Slot | Hue | Hex | Origin |
|---|---|---|---|
| 1 | blue | `#1769d6` | `--apu-blue-700`, the app's own primary |
| 2 | orange | `#eb6834` | |
| 3 | aqua | `#1baf7a` | |
| 4 | yellow | `#eda100` | |
| 5 | magenta | `#e87ba4` | |
| 6 | green | `#008300` | |
| 7 | violet | `#4a3aa7` | |
| 8 | red | `#e34948` | |

Validator output, `--mode light --surface #ffffff`:

```
[PASS] Lightness band       all 8 inside L 0.43–0.77
[PASS] Chroma floor         all 8 >= 0.1
[PASS] CVD separation       worst adjacent #eda100↔#1baf7a ΔE 9.1 (protan)
[PASS] Normal-vision floor  worst adjacent #e87ba4↔#eda100 ΔE 19.6
[WARN] Contrast vs surface  below 3:1: #1baf7a (2.82), #eda100 (2.17), #e87ba4 (2.69)
→ ALL CHECKS PASS
```

Slot 1 is the APU blue rather than the reference `#2a78d6`, so the charts read as
part of this application rather than beside it. The substitution was re-validated,
not assumed: it changes no worst-pair result.

**The WARN is an obligation, not a dismissal.** Slots 3, 4 and 5 sit under 3:1 on
white, so any panel that seats them ships visible direct labels or its table view.
`chart-frame` always ships the table view, which discharges it — but a panel using
those slots for its *only* encoding must also direct-label.

**All-pairs forms cap at three series.** `heatmap`, `dot-plot` and small multiples
use slots 1–3 only (worst all-pairs CVD ΔE 9.2, normal-vision 27.6 — both clear).
Slot 4 puts yellow beside orange, which fails the all-pairs floor. Past three, the
server folds to "Other".

### Sequential — one hue, light → dark

Blue, for every magnitude encoding (heatmaps, commitment ratios, density).

| step | hex | step | hex | step | hex | step | hex |
|---|---|---|---|---|---|---|---|
| 100 | `#cde2fb` | 250 | `#86b6ef` | 400 | `#3987e5` | 550 | `#1c5cab` |
| 150 | `#b7d3f6` | 300 | `#6da7ec` | 450 | `#2a78d6` | 600 | `#184f95` |
| 200 | `#9ec5f4` | 350 | `#5598e7` | 500 | `#256abf` | 650 | `#104281` |

Ordinal ramps (funnel stages, age buckets) start no lighter than **step 250** so the
lightest mark still clears 2:1 against white. A second simultaneous sequential
context takes orange as its own one-hue ramp.

### Diverging — blue ↔ red, neutral grey midpoint

For anything with a sign: variance to target, over/under capacity, week-on-week
delta. Midpoint `#f0efec`. Equal steps per arm. Never a hue at the midpoint — the
middle must read as "nothing".

### Status — fixed, never themed, never a series colour

| Role | Hex | Used for |
|---|---|---|
| good | `#0ca30c` | within target |
| warning | `#fab219` | approaching a threshold |
| serious | `#ec835a` | breached, recoverable |
| critical | `#d03b3b` | breached, event-date-bound |

`warning` and `serious` are sub-3:1 on white **by design** — every status is rendered
as icon + label + colour, so hue never carries the meaning alone. This also keeps
status distinguishable from slot 2 (orange) and slot 8 (red), which sit close in hue.

### Chrome

| Role | Hex | Existing token |
|---|---|---|
| Chart surface | `#ffffff` | `--apu-surface` |
| Page plane | `#f4f7fa` | `--apu-surface-muted` |
| Primary ink | `#07182c` | `--apu-navy-900` |
| Secondary ink | `#5f6d7f` | `--apu-text-muted` |
| Muted / axis | `#7a8796` | `--apu-text-soft` |
| Gridline | `rgb(15 35 60 / 12%)` | `--apu-border` |
| De-emphasis | `#acd3ff` | `--apu-blue-200`, for the grey-the-rest series in emphasis charts |

Declared once as `--viz-*` custom properties in `_dashboard.scss`, referenced by role
throughout. No component holds a raw hex.

---

## 7. Layout grid

12 columns, `--space-4` gutter, `--layout-max` container — the tokens already in
`_design-system.scss`. Cards use `--radius-card`, `--internal-card-shadow`,
`--apu-surface`.

```
┌─ Page header ─────────────────────────────────────────────────────────┐
│ Eyebrow · Title · profile switcher · unit/outlet switcher             │
├─ Filter row (sticky) ─────────────────────────────────────────────────┤
│ [ 7d | 30d | 90d | Term | YTD ]        [ dimension filters ]  ⟳ 09:14 │
├─ Band 1 · Signal ─────────────────────────────────────────────────────┤
│ ┌── hero (4 cols) ──┐ ┌─ kpi ─┐ ┌─ kpi ─┐ ┌─ kpi ─┐ ┌─ kpi ─┐        │
│ │  one big number   │ │ 2 col │ │ 2 col │ │ 2 col │ │ 2 col │        │
├─ Band 2 · Signature panel ────────────────────────────────────────────┤
│ ┌──────────────── the panel unique to this role (12 cols) ──────────┐ │
├─ Band 3 · Analysis ───────────────────────────────────────────────────┤
│ ┌────── 6 cols ──────┐ ┌────── 6 cols ──────┐                        │
│ ┌────── 8 cols ──────┐ ┌── 4 cols ──┐                                │
├─ Band 4 · Decision support ───────────────────────────────────────────┤
│ ┌── AI insights (8 cols) ──┐ ┌── Alerts / at-risk (4 cols) ──┐       │
├─ Band 5 · Quick actions ──────────────────────────────────────────────┤
│ [ action ] [ action ] [ action ]                                      │
└───────────────────────────────────────────────────────────────────────┘
```

**One filter row, above everything it scopes.** Never a filter inside a chart card;
every panel re-renders against the same slice. A panel-local dimension filter (e.g.
"vehicle type") sits in the panel header and is declared in `panel.filters` — it
narrows within the page slice, it does not replace it.

**Band 2 is why the dashboards look different.** Bands 1, 3, 4 and 5 share a skeleton
across all ten roles; band 2 is the role's own instrument and is the widest, tallest
element on the page. A Logistics head sees an inventory heatmap there; an A/V head
sees a collision timeline; the CFO sees a commitment waterfall.

---

## 8. New `config` codes

`config` is `(code VARCHAR(50) PK, number NUMERIC NOT NULL)` — numeric only, read
live. Per-unit overrides use a `__<unit_code>` suffix; the resolver tries the
suffixed code first and falls back to the bare one. Longest key,
`SLA_DECISION_HOURS__logistics_and_facilities`, is 44 characters.

| Code | Default | Effect |
|---|---|---|
| `SLA_DECISION_HOURS` | 48 | M10 target; per-unit override supported |
| `SLA_ASSIGNMENT_HOURS` | 24 | M12 target |
| `SLA_FULFILMENT_LEAD_DAYS` | 3 | M16 minimum runway |
| `SLA_ORDER_ACCEPT_HOURS` | 12 | M17 target |
| `SLA_ORDER_CLAIM_HOURS` | 4 | M18 target |
| `STAFF_SHIFT_HOURS` | 8 | M35 denominator — gap **G2**, stated on the widget |
| `CAPACITY_WARN_RATIO` | 0.85 | M30/M35 amber threshold |
| `AT_RISK_WINDOW_DAYS` | 7 | M70 window |
| `STALL_MULTIPLIER` | 2 | M72 — × the unit's median M10 |
| `FORECAST_HORIZON_DAYS` | 60 | M40/M41 horizon |
| `DASHBOARD_TREND_WEEKS` | 12 | Default trend window |
| `ANOMALY_SIGMA` | 2 | M77 sensitivity |
| `MIN_BUCKET_SIZE` | 5 | R8 bucket floor |
| `SEND_BACK_WARN_RATE` | 15 | M20 amber, whole percent |

Added by migration 018 alongside the G1 columns, and surfaced on
`/app/admin/settings/policies` — which already exists as the System Admin's home for
exactly this kind of value.

---

## 9. Performance

**Budget:** p95 under 800 ms for the full document on a term-sized period; no single
widget over 150 ms.

**Concurrency.** `ThreadedConnectionPool` is 1–10 connections. Ten widgets fired in
parallel would exhaust it for one page load, so widgets run **sequentially on one
`read_cursor()`**. Reads roll back on exit, which matters here: a dashboard opens a
transaction in Postgres like any other read, and skipping the rollback leaves pooled
connections idle-in-transaction — the exact failure `app/db.py` already documents.

**Caching.** 60-second per-(user, profile, unit, period) in-process cache. Dashboard
numbers do not need to be sub-minute fresh, and the header shows the generation time
so nobody mistakes cached for live. `⟳` forces a bypass. Same caveat as rate
limiting: in-process means per-worker; move to Redis with `RATELIMIT_STORAGE_URI` if
workers multiply.

**Indexes** — migration 018. The existing 26 cover point lookups, not the time-series
scans a dashboard does.

```sql
CREATE INDEX ix_request_task_unit_created   ON request_task (assigned_unit_code, created_at DESC)
                                            WHERE assigned_unit_code IS NOT NULL;
CREATE INDEX ix_request_task_unit_resolved  ON request_task (assigned_unit_code, resolved_at DESC)
                                            WHERE resolved_at IS NOT NULL;
CREATE INDEX ix_request_task_open           ON request_task (assigned_unit_code, status)
                                            WHERE status NOT IN ('completed','cancelled');
CREATE INDEX ix_workflow_history_task       ON workflow_history (request_task_id, created_at)
                                            WHERE request_task_id IS NOT NULL;
CREATE INDEX ix_workflow_history_actor_time ON workflow_history (actor_user_id, created_at DESC);
CREATE INDEX ix_request_submitted           ON request (submitted_at DESC) WHERE submitted_at IS NOT NULL;
CREATE INDEX ix_event_schedule_date         ON event_schedule ("date");
CREATE INDEX ix_row_assignment_assigned     ON request_row_assignment (staff_user_id, assigned_at DESC);
CREATE INDEX ix_request_logistics_date      ON request_logistics ("date");
CREATE INDEX ix_request_transportation_date ON request_transportation ("date");
CREATE INDEX ix_request_sound_light_date    ON request_sound_light ("date");
CREATE INDEX ix_request_photo_date          ON request_photography_videography ("date");
CREATE INDEX ix_request_campus_tour_date    ON request_campus_tour ("date");
CREATE INDEX ix_request_fmb_date            ON request_fmb ("date");
CREATE INDEX ix_request_mineral_water_date  ON request_mineral_water ("date");
```

**Escalation path if the budget is missed:** a nightly rollup table
(`dashboard_daily_fact`, one row per unit per day per metric), refreshed by a cron
job, with live queries only for the current day. Not built up front — with the data
volumes this system will realistically carry, the indexes above are expected to be
enough, and a rollup adds a staleness class of bug for no measured benefit.

---

## 10. States

| State | Rendering |
|---|---|
| Loading, first paint | Skeleton from `shared/components/loading-state`, using the existing `--shimmer-*` tokens |
| Loading, refetch | **Previous render held at reduced opacity.** Never a skeleton flash — it causes a layout jump on a page the user is reading |
| Empty (no data in period) | Panel-specific sentence naming what would populate it, plus the widened-period action. Never "No data" alone |
| Insufficient history | M41 only: "Needs 8 weeks of history — 3 available" |
| Suppressed (R8) | `—` with a "below reporting threshold" tooltip; count in the page footnote |
| Error | Inline retry inside the panel. The rest of the page renders |

---

## 11. Testing

**Backend** (`backend/tests/test_dashboard.py`, matching the existing pytest style
that runs against the live database):

- Profile resolution for every seeded account, including the deliberately role-less
  `farah.izzati@staff.apu.edu.my` → `NoDashboardProfile`.
- Scope leakage: for each seeded head, assert every widget's SQL result set is a
  subset of what `_VISIBLE_SQL` returns for that principal, **or** is an R7 aggregate
  carrying no row identifier. This is the test that keeps the aggregate/detail split
  honest as widgets are added.
- Bucket floor: synthesise a 3-row bucket, assert it renders suppressed.
- Ignored `unit` parameter: a HOD passing another unit's code gets their own data.
- Suspended assignment (`is_active = false`) yields `NoDashboardProfile`.
- Every metric's SQL runs against an empty database without erroring — division by
  zero is guarded by `NULLIF` throughout, and the empty case is the day-one case.

**Frontend** (vitest, matching the existing 99-test suite):

- The component renders a profile document it has never seen, driven only by widget
  ids — the declarative-layout guarantee.
- Palette slots map to the documented hexes.
- `line-chart` rejects a second y-axis.
- `chart-frame` shows a legend at 2 series and hides it at 1.
- Table view carries every value present in the chart.
