# `/app/dashboard` — Role-Based Analytics Design

Planning documents for the dashboard page. Ten roles, ten dashboards, no shared
generic layout.

Status: **built.** `/app/dashboard` resolves to `DashboardComponent`, served by
`GET /api/v1/dashboard`. Where the implementation departs from what is written
below, the reason is recorded here:

| Design says | Built as | Why |
|---|---|---|
| `hero-figure` and `stat-tile` as separate components | one `stat-tile` with a `kind` of `hero` or `kpi` | Same object at two weights. Two components would mean two places to keep the caveat rendering, the delta logic and the drill target in step, and they would drift. |
| A drawn `funnel` | full-width bars scaled by length, with the conversion printed per step | A tapering polygon encodes each stage as an *area*, which readers compare badly and which exaggerates every drop. |
| M67 staffing-request cycle time | active headcount plus audit-log churn | Migration 015 removed the staffing-request tables; a manager now creates staff directly, so the pending queue no longer has a source. The tile says so. |
| `line-chart` "rejects a second y-axis" | has no second-axis input at all | Rejecting at runtime still admits the shape into the contract. Leaving it out makes the mistake unrepresentable. |
| Cafeteria "who's carrying how much work" as a horizontal `bar-chart` | vertical `column-chart` | A cafeteria roster is a handful of people with short names, so nothing has to be rotated or truncated under a column. The horizontal form earns its keep where the categories are long service names ("Photography / Videography"), which this panel's are not. |
| An alerts rail on every profile | every profile except Cafeteria Manager | Everything `caf_at_risk` raised was already on that page a band higher — the hero *is* the live at-risk count and the Late tile *is* the same queue — so the rail only restated it further down. `alerts` is now optional in a profile, the way `counts` already was. |
| Cafeteria "Late" tile green at zero | always `critical` | A green zero trains the eye to skim past the one tile on the strip worth stopping for. The number already says "none"; the colour's job is to say "this is the count that matters". Applied to `dept_request_counts` too, so the strip means the same thing on every dashboard that carries it. |
| The five department profiles carry no KPI tiles | an **On-time completion** and a **Push-back rate** tile each | Every department promises someone a time and none of them had a number saying whether it was kept. What "the time" is differs by lane, so `sla.task_deadline_sql` resolves it per department and the tile prints the basis it used — see the table below. |
| A Risk List panel and an "At risk this week" rail on each department | neither | Both restated the `dept_jobs_at_risk` hero: the same rows, counted on the tile and then listed twice below it. `signature` and `alerts` are now optional in a profile, the way `counts` already was. |
| Department "Who's carrying how much work" / "Most used" as two horizontal bar charts | a vertical column chart and a ring | They answer the same two questions the Cafeteria Manager's panels answer and had drifted into different shapes. Two panels with the same title across two dashboards now have the same form. |
| The alerts rail's empty state as a green "all clear" card | the neutral `viz-empty` container every other panel uses | A green block on a page whose colours otherwise all mean "act on me" reads as a result, and it drew the eye hardest when it had the least to say. |

### What "on time" means per department

The schema records time three different ways, so one deadline column would be
wrong for four of the six. `sla.task_deadline_sql` resolves it, and the tile
names the basis so two heads never assume their numbers are comparable when
they are not.

| Department | Detail columns | Deadline used |
|---|---|---|
| A/V, Logistics, Photography | `start_time` + `end_time` | the end of each booked window |
| Transport | `moving_time` only | that instant plus a 5-minute grace |
| Food & Beverage | `serve_time` only | that instant plus a 5-minute grace |
| Student Services | neither — campus tours dropped their time columns | the end of the event day |

A task counts once, against the **earliest** commitment among its own detail
rows: a job holding a 9am room and a 2pm room is late the moment the 9am one is
missed. That is the same `min(deadline)` rule the risk metric ranks by, so the
tile and the hero cannot disagree about which job was late. The denominator is
tasks *completed* in the period, never tasks created — an open job has not
failed yet, and counting it as a miss would make the rate fall every time a
department accepted work.

Two thresholds the role documents call "configurable" without naming a code are
`VENUE_TEARDOWN_MINUTES` and `START_POINT_MAX_TOURS`; both are seeded by
migration 018 alongside the fourteen in
[03-dashboard-architecture.md](03-dashboard-architecture.md) § 8.

## Why ten dashboards and not one

The system already distinguishes these roles everywhere else — routing
(`UNIT_CODE_FOR_REQUIREMENT`), authorisation (`services/workflow/authorization.py`),
and sidebar visibility (`nav_page_grants`) all treat them as different actors with
different data. A single dashboard would be the only place in the application that
pretends they are the same.

They are also not the same *kind* of manager. A Logistics head runs an inventory
pool. A Transport head runs a fleet with a hard one-driver-per-vehicle constraint.
An A/V head runs no stock at all — their only scarce resource is technician-hours
against overlapping event windows. Those are three different jobs, and a shared
"Total Requests / Total Approvals" card set tells none of them anything they can act on.

## The ten

| # | Role | Unit | Doc |
|---|---|---|---|
| 1 | Head of Department | A/V Services | [10-hod-av-services.md](10-hod-av-services.md) |
| 2 | Head of Department | Food & Beverage Services | [11-hod-food-beverage.md](11-hod-food-beverage.md) |
| 3 | Head of Department | Logistics and Facilities | [12-hod-logistics-facilities.md](12-hod-logistics-facilities.md) |
| 4 | Head of Department | Photography Services | [13-hod-photography.md](13-hod-photography.md) |
| 5 | Head of Department | Student Services | [14-hod-student-services.md](14-hod-student-services.md) |
| 6 | Head of Department | Transport Services | [15-hod-transport.md](15-hod-transport.md) |
| 7 | Head of School | School of Computing | [20-hos-school-of-computing.md](20-hos-school-of-computing.md) |
| 8 | Head of School | School of Business | [21-hos-school-of-business.md](21-hos-school-of-business.md) |
| 9 | CFO | *(flat role)* | [30-cfo.md](30-cfo.md) |
| 10 | Cafeteria Manager | all cafeterias | [40-cafeteria-manager.md](40-cafeteria-manager.md) |

## Reading order

Cross-cutting first, then the role you care about.

| Doc | What it settles |
|---|---|
| [01-role-hierarchy-and-access.md](01-role-hierarchy-and-access.md) | Authority tiers, the role-to-data access matrix, and the twelve access-control rules every widget obeys |
| [02-metric-catalog.md](02-metric-catalog.md) | The semantic layer — 70 metric primitives with formulas and source tables. Role docs cite metric IDs instead of restating SQL |
| [03-dashboard-architecture.md](03-dashboard-architecture.md) | API contract, role resolution, chart runtime, validated palette, caching, performance budget |
| **10–40** | One document per role: objective, scope, KPIs, charts, AI insights, layout, drill-downs |
| [50-ai-insight-engine.md](50-ai-insight-engine.md) | The 45 insight rules, their triggers, severities, and which roles see which |
| [60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) | Every widget's click destination, filters applied, and the frontend work each one needs |
| [70-wireframes-and-mobile.md](70-wireframes-and-mobile.md) | Wireframes per role, the responsive grid, and the mobile priority ordering |
| [90-implementation-roadmap.md](90-implementation-roadmap.md) | Phased build order with task checkboxes |

## Four principles the whole design obeys

**1. The API decides, the client renders.** Every number is computed in SQL and
arrives pre-aggregated. No dashboard widget fetches a list and reduces it in the
browser. This is the same rule the proposal list already follows after the
server-side bucketing pass, and for the same reason: client-side aggregation means
shipping rows the caller is not allowed to see.

**2. Aggregates and rows have different scopes.** A widget may show a *count* over
data whose *rows* the viewer cannot open. The CFO can see that RM 41,200 of food
cost is committed across the institution without being able to read the bank
account details on each proposal behind it. Rule **R7** in
[01-role-hierarchy-and-access.md](01-role-hierarchy-and-access.md) makes this precise;
without it the CFO dashboard is blind to roughly every proposal under the
high-pax threshold, and the school dashboards cannot benchmark against each other.

**3. Nothing on a dashboard is a dead end.** Every KPI and every chart mark has a
drill-down destination that lands on an existing page with filters pre-applied.
A number you cannot act on is a number that should not be on the screen.

**4. Thresholds live in `config`, never in code.** SLA targets, capacity
assumptions, forecast horizons and risk windows all read live from the `config`
table, the same way `HIGH_PAX_THRESHOLD` and `CANCELLATION_DEADLINE_DAYS` already do.
An administrator retunes a department's SLA without a deploy.

## What this design deliberately excludes

- **Total record counts as headline figures.** They appear only as denominators.
- **Roles without a dashboard in this phase.** System Admin, Cafeteria Admin, Club
  Admin, Lecturer, Staff, Student and External User are out of scope per the brief.
  [01-role-hierarchy-and-access.md](01-role-hierarchy-and-access.md) records what each
  would need if added later, so the architecture does not have to change to admit them.
- **Charts of data the schema cannot produce.** Where a metric needs a column that
  does not exist, it is listed as a gap with the migration that would close it,
  not quietly faked. There are six such gaps; see
  [02-metric-catalog.md](02-metric-catalog.md) § Schema gaps.

## Source of truth

Everything here was derived from the code, not from assumption:

| Subject | Source |
|---|---|
| Schema | `backend/migrations/001_initial_schema.sql` + migrations 002–017 |
| Workflow states and routing | `backend/app/services/workflow/constants.py`, `backend/docs/workflow.md` |
| Row-level authorisation | `backend/app/services/workflow/authorization.py`, `backend/docs/security.md` |
| Proposal visibility predicate | `_VISIBLE_SQL` in `backend/app/api/proposals.py` |
| Page visibility | `backend/seed/nav.py`, `_satisfies_grant()` in `backend/app/services/identity.py` |
| Units, roles, seeded staffing | `backend/seed/data.py` |
| Design tokens | `fyp-ui/src/styles/_design-system.scss` |
