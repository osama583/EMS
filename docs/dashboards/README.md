# `/app/dashboard` — Role-Based Analytics Design

Planning documents for the dashboard page. Ten roles, ten dashboards, no shared
generic layout.

Status: **design — not implemented.** `/app/dashboard` currently resolves to
`InternalPlaceholderComponent` (`fyp-ui/src/app/app.routes.ts`), and no analytics
endpoint exists on the API.

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
