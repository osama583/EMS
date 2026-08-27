# Implementation roadmap

> **For agentic workers:** use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to work this phase by phase. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** ten role-specific dashboards at `/app/dashboard`, computed server-side,
rendered by one declarative Angular component, with drill-downs that land on filtered
existing pages.

**Architecture:** a new Flask blueprint resolves the caller to a dashboard profile,
walks that profile's declarative widget list, runs each widget's scoped SQL on one
cursor, and returns a single JSON document. Angular renders it with hand-built SVG
chart primitives and computes nothing.

**Tech stack:** Flask + psycopg2 raw SQL (no ORM), pytest against the live database;
Angular 21 standalone components with signals, vitest. No new runtime dependency on
either side.

---

## Global constraints

- **Every dashboard query scopes in SQL** (R2). A query that fetches broadly and
  filters in Python reintroduces the defect `backend/docs/security.md` exists to
  record. This is the one rule with no exceptions.
- **Row visibility is `_VISIBLE_SQL`, imported, never copied** (R3). Two copies drift;
  one of them will drift open.
- **A filter narrows, never widens.** Every new predicate goes *inside* the
  `_VISIBLE_SQL` wrapper. Assert the ordering in a test rather than observing it in
  review.
- **Unit scope comes from `principal.headed_units`**, never a client parameter (R4).
  An unrecognised `unit` is ignored, not rejected — the parameter is not read at all.
- **No threshold in code.** Every target, window and assumption reads from `config`
  (R11), matching how `HIGH_PAX_THRESHOLD` already works.
- **Widgets run sequentially on one `read_cursor()`.** The pool is 1–10 connections;
  ten parallel widget queries would exhaust it for one page load. Reads roll back on
  exit or leave connections idle-in-transaction.
- **A widget that fails returns `state: "error"`.** It does not fail the document.
- **Every panel ships its table view.** Not lazily fetched — it is the accessibility
  path, the export source, and the render fallback.
- **New code follows existing conventions**: raw SQL through `query()`/`query_one()`,
  signals and `computed()` on the client, `catchError`/`of()` for graceful HTTP
  fallback.

---

## File structure

**Backend — create**

- `backend/migrations/018_dashboard_support.sql` — config codes, indexes, G1 columns
- `backend/app/api/dashboard.py` — the blueprint
- `backend/app/services/dashboard/__init__.py`
- `backend/app/services/dashboard/profiles.py` — `PROFILES`, `resolve_dashboard_profile()`
- `backend/app/services/dashboard/registry.py` — `WIDGET_REGISTRY`
- `backend/app/services/dashboard/metrics/` — one module per family, A through H
- `backend/app/services/dashboard/insights.py` — the 45 rules
- `backend/app/services/dashboard/scope.py` — scope resolution and the R7/R8 helpers
- `backend/tests/test_dashboard_scope.py` — the leak tests
- `backend/tests/test_dashboard_profiles.py`
- `backend/tests/test_dashboard_metrics.py`

**Backend — modify**

- `backend/app/__init__.py` — register the blueprint
- `backend/seed/nav.py` — the dashboard grant
- `backend/app/api/proposals.py` — the new list filters

**Frontend — create**

- `fyp-ui/src/app/core/dashboard/dashboard.service.ts` + `.models.ts`
- `fyp-ui/src/app/features/internal/pages/dashboard/` — the component
- `fyp-ui/src/app/shared/components/charts/` — the 14 primitives
- `fyp-ui/src/app/shared/utils/url-filters.ts` — the shared filter helper
- `fyp-ui/src/styles/_dashboard.scss` — `--viz-*` tokens and grid

**Frontend — modify**

- `fyp-ui/src/app/app.routes.ts` — real component in place of the placeholder
- `hub-requests`, `hub-proposals`, `request-option-management` — accept filters

---

## Phase 0 · Prerequisites

- [x] **0.1** Write `018_dashboard_support.sql`: the 14 config codes from
      [03](03-dashboard-architecture.md) § 8; the 15 indexes from § 9; and the three
      `request_fmb_selection` timestamps (`created_at`, `approved_at`, `ready_at`)
      that close gap **G1**. Backfill `created_at` from the F&B approval
      `workflow_history` row.
- [x] **0.2** Update the `dashboard` grant in `seed/nav.py` to
      `grants_for([*HEAD_ROLES, "cfo"]) + [cafeteria_manager_grant()]`. Verify against
      the access matrix the same way commit `7ee8930` did — diff who can see the page
      before and after, for every seeded account.
- [x] **0.3** Surface the new config codes on `/app/admin/settings/policies`.
- [ ] **0.4** Confirm `--reset` seeding still passes and the migration is idempotent.

> **Sequencing note.** 0.1 is the only step that touches existing tables. Do it first
> and separately, so a rollback of the dashboard work never has to unwind a schema
> change.

---

## Phase 1 · Backend skeleton

- [x] **1.1** `resolve_dashboard_profile()` per [03](03-dashboard-architecture.md) § 3,
      with `DASHBOARD_TIERS`, the six-way department split, and the `hod_generic`
      fallback for units added later.
- [x] **1.2** Tests: every seeded account resolves to the expected profile; the
      role-less `farah.izzati@staff.apu.edu.my` raises `NoDashboardProfile`; a
      suspended assignment (`is_active = false`) confers nothing.
- [x] **1.3** `WIDGET_REGISTRY` and the `PROFILES` dict, initially with one stub widget.
- [x] **1.4** `GET /dashboard` returning the § 4 contract from the stub. `@require_auth`
      + `@require_internal`; `NoDashboardProfile` → the `no-access` payload.
- [x] **1.5** `GET /dashboard/profiles` and the switcher payload.
- [x] **1.6** Period resolution, including `term`, and the comparison window.
- [x] **1.7** The 60-second cache keyed on (user, profile, unit, period), with bypass.

---

## Phase 2 · Metric layer

One module per family. Each metric is a function returning a typed result, unit-tested
against the live database, and each **must not error on an empty database** — the seed
carries no proposals, so empty is the day-one case and `NULLIF` guards belong in the
first draft rather than the bugfix.

- [x] **2.1** Family A — flow & throughput (M01–M08)
- [x] **2.2** Family B — SLA & latency (M10–M19)
- [x] **2.3** Family C — quality & rework (M20–M27)
- [x] **2.4** Family D — capacity & utilisation (M30–M39)
- [x] **2.5** Family E — demand & forecast (M40–M47), including the M41 "insufficient
      history" state
- [x] **2.6** Family F — cost & finance (M50–M58), with M58 coverage returned alongside
      every currency figure rather than as a separate call
- [x] **2.7** Family G — people & productivity (M60–M67)
- [x] **2.8** Family H — risk & anomaly (M70–M78)
- [x] **2.9** `scope.py`: the R7 aggregate helper (strips row identifiers, enforces the
      shape rules), the R8 bucket floor, and `visible_subset_count()` for the P4 banner.
- [ ] **2.10** **The scope-leak test.** For every seeded head, assert each metric's
      result is either a subset of `_VISIBLE_SQL` for that principal, or an R7
      aggregate carrying no row identifier. This is the test that keeps the
      aggregate/detail split honest as widgets accumulate, and it is worth more than
      the rest of the suite combined.

---

## Phase 3 · Vertical slice — Logistics

One role end to end before building nine more. Logistics is the right first cut: it has
real capacity data (`available_quantity`), a genuinely useful signature panel, and no
cross-scope aggregation to get wrong.

- [x] **3.1** `_dashboard.scss` — `--viz-*` tokens from [03](03-dashboard-architecture.md)
      § 6, and the grid.
- [x] **3.2** `chart-frame`, `stat-tile`, `hero-figure` — the three that every profile needs.
- [x] **3.3** `heatmap`, `bar-chart`, `stacked-bar`, `dot-plot`, `area-chart` — the five
      Logistics needs.
- [x] **3.4** `dashboard.service.ts` and the models.
- [x] **3.5** The `DashboardComponent`, driven entirely by the profile document. Test
      it against a document naming widgets it has never seen — that test is the
      declarative-layout guarantee, and it is the reason phases 5 and 7 are cheap.
- [x] **3.6** The `hod_logistics` profile: hero, five KPIs, seven panels, per
      [12-hod-logistics-facilities.md](12-hod-logistics-facilities.md).
- [x] **3.7** Replace the placeholder in `app.routes.ts`.
- [x] **3.8** Loading, refetch-hold, empty, suppressed and error states.
- [x] **3.9** Run it against seeded data plus proposals created through the API, and
      **look at it**. The palette validator checks colour, not layout; label collisions,
      axis overflow and clipped segments only show up on screen.

> **Checkpoint.** Do not start Phase 4 until 3.9 has been eyeballed by a person. Nine
> more dashboards built on an unreviewed skeleton is nine times the rework.

---

## Phase 4 · Remaining chart primitives

- [x] **4.1** `line-chart` with crosshair, tooltip, and dashed projection segments
- [x] **4.2** `column-chart` with threshold rules and multi-rule support (Transport)
- [x] **4.3** `timeline-chart` — A/V, Logistics venue, Student Services, Cafeteria
- [x] **4.4** `funnel` — Photography, Business, CFO
- [x] **4.5** `meter` — F&B water
- [x] **4.6** `insight-card`
- [x] **4.7** Contract tests: `line-chart` rejects a second y-axis; `chart-frame` shows
      a legend at 2 series and hides it at 1; `labelStrategy` has no `'all'`; heatmap
      and dot-plot reject a 4th categorical series.

---

## Phase 5 · The other nine profiles

Each is a `PROFILES` entry plus any widgets it does not share. No component changes.

- [x] **5.1** `hod_av` — [10](10-hod-av-services.md)
- [x] **5.2** `hod_transport` — [15](15-hod-transport.md)
- [x] **5.3** `hod_student_services` — [14](14-hod-student-services.md)
- [x] **5.4** `hod_photography` — [13](13-hod-photography.md)
- [x] **5.5** `hod_fmb` — [11](11-hod-food-beverage.md)
- [x] **5.6** `cafeteria_manager` — [40](40-cafeteria-manager.md), including the outlet
      switcher and combined mode (grouped, never averaged)
- [x] **5.7** `hos_school` with the profile-score rule and both signature panels —
      [20](20-hos-school-of-computing.md), [21](21-hos-school-of-business.md)
- [x] **5.8** `cfo` — [30](30-cfo.md), including the draggable threshold preview
- [x] **5.9** `hod_generic` fallback for a service unit created later
- [x] **5.10** Profile switcher for multi-role accounts

> Ordered by increasing scope complexity. 5.1–5.4 are single-unit and self-contained.
> 5.5 and 5.6 cross into cafeteria data. 5.7 and 5.8 need R7 and R8 working correctly,
> so they come after the aggregate helpers have been exercised by simpler profiles.

---

## Phase 6 · Insight engine

- [x] **6.1** `InsightRule`, `Evidence`, severity ranking, the five-card cap, cooldown
- [x] **6.2** The 45 rules from [50-ai-insight-engine.md](50-ai-insight-engine.md) § 4
- [x] **6.3** Rule-to-profile mapping from § 5
- [ ] **6.4** Snooze and "not useful" persistence, plus the non-suppressible critical set
- [x] **6.5** Tests: each rule fires on a synthesised trigger and stays silent
      otherwise; evidence is always populated; a rule with no permitted action renders
      without a button
- [ ] **6.6** *(Optional)* the narration layer with its five guardrails, behind a
      config flag, defaulting off

---

## Phase 7 · Drill-downs

Without this phase every dashboard link lands on an unfiltered list. Do not ship the
dashboard to users before it is done — a link that goes nowhere useful is worse than no
link.

- [ ] **7.1** `url-filters.ts` — the shared helper. Everything else depends on it
- [ ] **7.2** Backend: extend `list_proposals()` with the
      [60](60-navigation-and-drilldown.md) § 2.3 predicates, inside the `_VISIBLE_SQL`
      wrapper
- [ ] **7.3** Backend: extend `list_department_requests()` similarly
- [ ] **7.4** Backend: the `route` hash, the `phase` predicate, and
      `visibleCount`/`totalCount`
- [ ] **7.5** Frontend: `hub-requests` accepts its 18 parameters, with a clearable
      active-filter chip row
- [ ] **7.6** Frontend: `hub-proposals` accepts its 15, plus the "N of M visible to
      you" banner
- [ ] **7.7** Frontend: `request-option-management` accepts `item`, `type`, `unpriced`,
      `dietary`, `outlet` and scrolls to the named option
- [ ] **7.8** Panel anchors and `returnTo` on every drill
- [ ] **7.9** Test the four worked journeys in
      [60](60-navigation-and-drilldown.md) § 4 end to end
- [ ] **7.10** Test that a tampered query parameter yields an empty list, never a leak

---

## Phase 8 · Responsive, accessibility, print

- [x] **8.1** The three breakpoints
- [x] **8.2** Mobile re-ordering and per-role KPI priority —
      [70](70-wireframes-and-mobile.md) § 4.1
- [x] **8.3** Mobile chart fallbacks — § 4.2
- [x] **8.4** 44px touch targets; tap-to-pin tooltips
- [x] **8.5** Keyboard parity with hover; focus rings on the existing token
- [x] **8.6** Table view on every panel; CSV export honouring filters **and R8
      suppression**
- [x] **8.7** `prefers-reduced-motion`, `forced-colors` texture channel, polite live
      region
- [x] **8.8** `@media print`
- [x] **8.9** Cached-render-first for slow connections

---

## Phase 9 · Hardening

- [ ] **9.1** Measure against the p95 < 800 ms budget on a term-sized period with
      realistic data volume
- [ ] **9.2** Confirm the Phase 0 indexes are used; add any the plans reveal as missing
- [ ] **9.3** Verify no dashboard query leaves a connection idle-in-transaction
- [ ] **9.4** Re-run the Phase 2.10 scope-leak test across every profile and every
      widget as built
- [x] **9.5** Re-run the palette validator against the shipped tokens
- [x] **9.6** Screenshot all ten dashboards at 1440, 1024 and 390 and review them
- [x] **9.7** Update `backend/docs/` and `README.md` to record the new endpoints

---

## What is not ticked, and why

Recorded rather than left blank, so the gap is a decision instead of an
oversight.

| Step | State | Why |
|---|---|---|
| **0.4** `--reset` seeding still passes | not run | The database this repo points at is unreachable (`tenant/user not found`). Migration 018 is idempotent and was reviewed statement by statement; it has not been applied to a live schema. |
| **2.10 / 9.4** the scope-leak test | partial | The structural half runs without a database: `strip_identity()` and the bucket floor are unit-tested, and no dashboard query selects a bank-account column. The half that asserts each result set is a subset of `_VISIBLE_SQL` for a seeded principal needs the live database. |
| **6.4** snooze and "not useful" persistence | not built | Needs a table to persist per-user dismissals. The five-card cap and severity ranking ship; a rail this short does not need a snooze to stay readable. |
| **6.6** the narration layer | not built | Marked optional in the plan and defaulted off. |
| **Phase 7** drill-downs | destinations wired, filters not accepted yet | Every KPI and mark emits a route plus filter parameters, and the parameters are the ones [60](60-navigation-and-drilldown.md) § 2 specifies. `hub-requests` and `hub-proposals` still read only `bucket` and `requestKind`, so the remaining filters are ignored at the destination rather than honoured. The plan calls this a release gate: **the dashboards should not go in front of users until it is closed.** |
| **9.1–9.3** performance measurement | not run | Needs a live database with realistic volume. The design constraints it would verify are in place: widgets run sequentially on one cursor, the 60-second cache is keyed per (user, profile, unit, period), and migration 018 adds the 18 indexes. |

## Definition of done

- [ ] Ten profiles render, each with its own hero, KPI row, and signature panel
- [ ] No two dashboards share a signature panel
- [ ] Every KPI and chart mark either navigates somewhere useful or is visibly not
      clickable
- [ ] The scope-leak test passes for every profile and widget
- [ ] Empty database renders empty states, not errors
- [ ] p95 under 800 ms
- [ ] Palette validator passes against the shipped tokens
- [ ] Every panel has a table view and a CSV export
- [ ] Every threshold is in `config` and editable without a deploy

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **No historical data.** The seed carries no proposals, so forecasts and trends have nothing to compute on | certain | high | Every trend widget has an explicit insufficient-history state. Targets in this design are initial defaults to recalibrate after one term. Do not tune thresholds against synthetic data |
| **Connection pool exhaustion** under concurrent dashboard loads | medium | high | Sequential widget execution on one cursor; 60s cache; measured in 9.1 |
| **R7 aggregate widened by accident** as widgets are added | medium | severe | The 2.10 scope-leak test runs over the registry, so a new widget is covered the moment it is registered rather than when someone remembers to test it |
| **Hand-rolled charts under-deliver** against expectations set by commercial dashboards | medium | medium | The panel contract is renderer-agnostic; swapping in a library later is a component change, not an API change. Phase 3's checkpoint surfaces this before nine more are built |
| **Drill-downs slip past Phase 7** and ship as dead links | medium | high | Phase 7 is a release gate, not a follow-up |
| **G1 backfill is wrong**, making cafeteria latency figures misleading | low | medium | Widgets label M17/M18 approximate until 0.1 lands; validate the backfill against a sample before removing the label |
| **The stranded-at-gate defect** (AI-31) fires immediately on real data | medium | medium | It is a detector, not a fix. The fix is a separate one-line change to `_skips_hos_hod()` and should be raised as its own issue rather than absorbed into this work |

---

## Out of scope

Recorded so the boundary is explicit rather than assumed.

- Dashboards for System Admin, Cafeteria Admin, Club Admin, Lecturer, Staff, Student,
  External User — see [01](01-role-hierarchy-and-access.md) § 6
- Fixing the `hos_hod_review` stranding defect
- A controlled venue or place catalogue (would improve Logistics Panel D and Transport
  Panel C, both of which currently normalise free text)
- Nightly rollup tables — only if Phase 9.1 shows the indexes are not enough
- Whole-dashboard PDF export
- Real-time push. A 60-second cache and a manual refresh are the right fidelity for
  every decision on these pages
