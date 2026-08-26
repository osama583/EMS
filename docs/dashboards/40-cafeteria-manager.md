# Cafeteria Manager — Operations Dashboard

`cafeteria-manager` @ one or more `cafeteria__*` units · profile key `cafeteria_manager`

> **What makes this dashboard different.** Every other dashboard here belongs to
> someone who *decides*. This one belongs to someone who *runs a shift*. The Cafeteria
> Manager accepts or pushes back the orders F&B sends, watches a **shared pool** they
> do not control — claiming is first-come-first-served among their staff, enforced by a
> status-guarded UPDATE — and gets food to a venue before a serve time that was fixed
> by someone else weeks ago.
>
> They also have a constraint no other role has: **they cannot staff their own outlet.**
> A manager cannot write `user_unit_roles` directly. Every add, edit and removal is a
> `cafeteria_staff_requests` row that a Cafeteria Admin must approve first. So when this
> dashboard says "you are short-staffed", the action is not "hire" — it is "raise a
> request and wait", and the wait itself is a measurable operational constraint.
>
> The page grant is **all-cafeterias** (`grant_type = 'cafeteria'`, so a newly created
> outlet works immediately — see commit `7ee8930`), but the data scope is only the
> outlets this manager actually holds a row for. A manager with two outlets gets one
> dashboard with a switcher, not two dashboards.

---

## 1. Dashboard objective

**Responsible for:** accepting or pushing back `request_fmb_selection` orders at their
outlets; the outlet menu (`fmb_options` — items, prices, dietary tags, serving units,
availability notes); their staff roster, mediated through Cafeteria Admin; and getting
each order delivered by its serve time.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Accept or push back an incoming order | Hourly | Kitchen load that day, staff on shift, whether the item is on the menu |
| Whether an unclaimed order needs a nudge | Hourly | Claim age against serve time |
| Whether to raise a staffing request | Weekly | Claim latency, per-person load, and how long the last request took |
| Which menu items to add, price, or retire | Weekly | Order volume and revenue per item; unpriced items |
| Whether the menu covers dietary requirements | Monthly | Coverage against the shared dietary catalogue |
| Whether an outlet is structurally under-resourced | Termly | Claim latency and on-time rate over a term |

**Cannot:** submit proposals (no Drafts, no Forms in their sidebar — they review
orders, they do not raise events); write `user_unit_roles`; see another outlet.

**Hourly** — orders due today, unclaimed orders, anything approaching a serve time.
**Daily** — yesterday's on-time record, today's staff load.
**Weekly** — claim distribution, menu performance, staffing request status.
**Monthly** — dietary coverage, churn, price coverage.
**Strategic** — is the outlet slow because of kitchen capacity or because orders sit
unclaimed? Acceptance latency (M17) against claim latency (M18) separates them: the
first is the manager's own responsiveness, the second is the roster's.

---

## 2. Data access scope

**Visible** — scoped to `units_for_role('cafeteria-manager')` (rule R5):

- Every `request_fmb_selection` at their outlets, with its parent `request_fmb`
  context: `food_type`, `pax`, `"date"`, `serve_time`, `location`.
- The proposals those orders belong to — clause 8 of `_VISIBLE_SQL`.
- `fmb_options` for their outlets, including `unit_price_rm` and dietary tags.
- Their staff by name — they manage them at `/app/cafeterias/my-staff`, so per-person
  claim and completion figures are in scope (R10, own unit).
- `cafeteria_staff_requests` they raised, with resolution times.
- `cafeteria_staff_audit_log` for their outlets — server-side scoped, per `seed/nav.py`.

**Restricted**

- **Another outlet, entirely.** Not aggregated, not benchmarked, not anonymised. The
  cross-outlet comparison in [11-hod-food-beverage.md](11-hod-food-beverage.md) belongs
  to F&B, who places the orders; a manager comparing themselves to a peer outlet has no
  action available and the data is not theirs.
- **The proposal's finances.** `cost_amount`, `bank_account_*`,
  `request_funding_purchase` — `○`. The manager sees the value of **their own menu
  items** (`quantity × unit_price_rm`), which is their revenue, not the event's budget.
- **Other departments' requirements.** An order's proposal may also need transport and
  A/V; none of that appears here.
- **Attendee identity.** `pax` is a headcount for portioning. There is no guest list.
- **Cafeteria Admin's view.** Cross-outlet staffing, outlet lifecycle and menu
  oversight belong to `/app/reports`, which is granted to `cafeteria-admin`.

**Multi-outlet handling.** The header carries an outlet switcher with an **All my
outlets** option. In combined mode every panel is grouped by outlet rather than summed
into an average — two outlets with 95% and 55% on-time rates average to a number that
describes neither. Values are validated against the manager's own set before reaching
SQL (R5).

---

## 3. KPIs

### Hero · Orders at risk right now

| | |
|---|---|
| **Definition** | Live orders whose serve time falls inside the risk window and which have not reached `ready`, with a countdown to the nearest |
| **Formula** | `count(request_fmb_selection WHERE unit_code = ANY(:outlets) AND status IN ('pending','approved','preparing') AND (request_fmb."date" + serve_time) < now() + AT_RISK_WINDOW)`, split by status |
| **Source** | `request_fmb_selection.status`, `request_fmb."date"/serve_time` |
| **Why it matters** | A shift manager's hero is not a rate, it is a count of things happening now. The status split names the action: `pending` needs the manager to accept, `approved` needs someone to claim, `preparing` needs a nudge |
| **Target** | 0 in `pending`, 0 in `approved` inside 4h of serve time |
| **Drill** | `/app/inbox/requests?requestKind=fmb&risk=true` |

### KPI 1 · Claim latency (median · p90)
M18 — approved → `preparing`. **Why:** the shared pool's health, and the only number
that distinguishes "my kitchen is slow" from "nobody picked it up". A manager cannot
assign an order; they can only staff the pool and nudge. **Target:** ≤ 4h
(`SLA_ORDER_CLAIM_HOURS`). Approximate until gap **G1** is closed — labelled on the tile.
**Drill:** Panel C.

### KPI 2 · On-time delivery
M19 for these outlets, with median minutes early or late. **Why:** the outcome. In
combined mode, one figure per outlet, never an average.
**Target:** ≥ 95%. **Drill:** `/app/history/requests?requestKind=fmb&delivery=late`.

### KPI 3 · Menu readiness
M58 price coverage for the outlet's active menu, with the count of unpriced items that
have live orders (M75). **Why:** an unpriced item is an order the manager cannot
value and F&B's cost figure cannot count. It is the manager's own data to fix, on a
page they already own. **Target:** 100%. **Drill:** `/app/menu?unpriced=true`.

### KPI 4 · Staff availability
Active `cafeteria-staff` at the outlet, with pending `cafeteria_staff_requests` and the
median resolution time of past ones (M67). **Why:** the manager's staffing lever runs
through Cafeteria Admin, and the wait is part of the plan. "2 active, 1 pending for 6
days" is a different situation from "2 active, 1 pending since this morning".
**Target:** 0 pending over 3 days.
**Drill:** `/app/cafeterias/my-staff`.

### KPI 5 · Push-back rate
M25 from the manager's side — orders they sent back to F&B ÷ orders received.
**Why:** the same number F&B reads as "this outlet bounces orders". Seeing their own
figure lets the manager know how they look upstream, and a high rate with a consistent
`manager_comment` reason is a case for changing what F&B sends rather than bouncing it.
**Target:** ≤ 10%. **Drill:** `/app/history/requests?requestKind=fmb&orderStatus=resubmitted`.

---

## 4. Analytics & visualisation

### Panel A — Outlet Service Board · *signature*

| | |
|---|---|
| **Type** | `timeline-chart` — one lane per day for the next 7 days, each order a block positioned at its `serve_time` |
| **Block content** | Menu item, quantity, venue, order state, and the claimer's name where claimed |
| **Source** | `request_fmb_selection` × `request_fmb` × `fmb_options`, scoped to `:outlets` |
| **Encoding** | Ordinal blue ramp by state (`pending` → `fulfilled`), starting no lighter than step 250. Blocks inside the risk window and not yet `ready` take a `critical` ring **and** a clock glyph. Unclaimed approved blocks carry a distinct hatched fill, so "nobody has this" is visible without reading the label |
| **Filters** | Outlet, menu item, state, "at risk only" |
| **Purpose** | The shift. Everything due, in serve-time order, with the two failure states — unaccepted and unclaimed — visible without clicking |
| **Actions** | Click a block → the order. Hover → full detail and claim age. Accept / push back inline where the state allows |
| **Drill** | Block → `/app/inbox/requests?requestKind=fmb&order=<selection_id>` |

Why serve time and not order date: the manager's day is organised by when food must
leave the kitchen. Ordering this board by anything else would be a chart of someone
else's schedule.

### Panel B — Claim distribution
`dot-plot`, one dot per staff member, x = orders claimed in period (M65), with the
outlet median as a reference line and mean handling time as the hover. First-come-
first-served means one person can take most of the pool while others idle; the
`claimed_by_user_id` column makes it visible and nothing else in the application does.
Names shown — own outlet, R10.
Dot → `/app/history/requests?requestKind=fmb&claimedBy=<user_id>`.

### Panel C — Order lifecycle latency
Horizontal `stacked-bar` per week: accept (M17) · claim (M18) · prepare · deliver.
Names the degrading segment. Accept is the manager's own; claim is the roster's;
prepare is the kitchen's. Three different remedies, and the bar says which is needed.
Approximate until gap **G1** — labelled inline.
Segment → the matching bucket for that week.

### Panel D — Menu performance
Horizontal `bar-chart`, menu items ranked by order volume, each annotated with revenue
(`Σ quantity × unit_price_rm`) and a price-missing glyph where `unit_price_rm IS NULL`.
Items with zero orders in the period tinted de-emphasis. Two decisions on one chart:
what to promote, and what to retire.
Bar → `/app/menu?item=<fmb_option_id>`.

### Panel E — Dietary coverage
`heatmap`, this outlet's active menu items × dietary options
(`fmb_option_dietary_information`, migration 006). Empty columns — a dietary
requirement with no item covering it — take a `warning` ring and glyph. In combined
mode, outlets are the rows.
Column → `/app/menu?dietary=<id>`.

### Panel F — Staffing timeline
`timeline-chart` from `cafeteria_staff_audit_log` (M66): create, edit, suspend,
restore, remove, one lane per staff member, plus pending `cafeteria_staff_requests`
shown as open-ended bars with their age. The gap between raising a request and it
resolving is drawn to scale, which is the point — a manager arguing for faster
turnaround has the evidence rather than an impression.
Bar → `/app/cafeterias/staff-requests-history`.

### Panel G — Forward order demand
`area-chart`, orders and total portions per day over the forward horizon (M40, scoped
to these outlets). Two series on one axis — both counts. Portions rising faster than
orders means larger orders, which is a kitchen-capacity signal rather than a
throughput one.
Point → `/app/inbox/requests?requestKind=fmb&date=<d>`.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-17** `SERVE_TIME_RISK` | Live order not `ready` inside the risk window | critical | One click to the order; names the claimer or the fact there is none |
| **AI-41** `POOL_STARVED` | Approved order unclaimed past `SLA_ORDER_CLAIM_HOURS` | serious | Names the order and who is on shift |
| **AI-42** `CLAIM_CONCENTRATION` | One staff member claims > 60% of the pool | warning | Names both ends. Not necessarily wrong — it may be one person's shift — and the card says so rather than asserting a problem |
| **AI-43** `STAFFING_REQUEST_STALLED` | A `cafeteria_staff_requests` row is pending beyond the median (M67) | warning | Names the request and its age; the action is a follow-up with Cafeteria Admin |
| **AI-23** `UNPRICED_EXPOSURE` | An unpriced menu item receives an order (M75) | warning | Direct link to that item on `/app/menu` |
| **AI-15** `DIETARY_GAP` | A dietary option has zero coverage while orders arrive | warning | Names the gap and suggests items |
| **AI-06** `OUTLET_DEGRADING` | This outlet's M17 or M18 worsens 3 weeks running | serious | Shows which segment; F&B sees the same signal and may reroute |
| **AI-45** `PORTION_SURGE` | Median order quantity rises 3 weeks running | warning | Kitchen capacity, not order count, is the growing constraint |
| **AI-22** `DEAD_CATALOGUE` | Active menu item, 0 orders in 90 days | info | Retire to shorten F&B's picker |
| **AI-44** `CHURN_SPIKE` | Suspend or remove actions exceed the trailing mean + 2σ (M66) | warning | Roster stability signal, from the outlet's own audit log |

---

## 6. Layout

```
┌ ATRIUM CAFETERIA · Operations ─── [outlet ▾ All] [profile ▾] ⟳ 09:14
├ [Today][7d][30d][Term]   [ item ▾ ] [ state ▾ ] [ at risk only ☐ ]│
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Claim    ┐┌ On-time  ┐┌ Menu     ┐┌ Staff    │
│ │ At risk now    │ │ 2.1h/6h  ││  96.2%   ││ 84%      ││ 3 active │
│ │      3         │ │ ✓ ≤4h    ││ ✓ ≥95%   ││ priced   ││ 1 pending│
│ │ 1 pend · 2 appr│ │ approx.  ││ +4m med  ││ 2 live ⚠ ││ 6 days ⚠ │
│ │ next in 02:14 ⚠│ │          ││          ││          ││          │
├───────────────────────────────────────────────────────────────────┤
│ ┌── OUTLET SERVICE BOARD ──────────────────────── next 7 days ──┐ │
│ │ Wed 03  ▐Nasi lemak ×80 · Hall A · READY · Faridah▌           │ │
│ │         ▐▨▨ Sandwich ×40 · Lab 2 · APPROVED · unclaimed ▨▨▌ ⚠ │ │
│ │ Thu 04  ▐Bee hoon ×120 · Aud · PREPARING · Ravi▌              │ │
│ │         ▐Fruit box ×30 · Hall B · PENDING — accept?▌ ⚠        │ │
│ │         08:00  10:00  12:00  14:00  16:00  18:00  ← serve time│ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Claim distribution (6) ────┐ ┌── Lifecycle latency (6) ─────┐ │
│ ┌── Menu performance (4) ┐ ┌ Dietary coverage (4) ┐ ┌Staffing(4)┐│
│ ┌── Forward order demand (12) ─────────────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── Due today (4) ─────────┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Accept orders · 1] [My Menu] [My Staff] [Staff history]          │
└───────────────────────────────────────────────────────────────────┘
```

The default period here is **Today**, not 30 days. Every other dashboard in this set
opens on a management horizon; this one opens on a shift. The alerts rail is titled
**Due today** for the same reason.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | `/app/inbox/requests` | `requestKind=fmb`, `risk=true`, `sort=schedule` | Act now, soonest first |
| Claim KPI | Panel C | — | In-page |
| On-time KPI | `/app/history/requests` | `requestKind=fmb`, `delivery=late` | What went late and why |
| Menu KPI | `/app/menu` | `unpriced=true` | Price the items |
| Staff KPI | `/app/cafeterias/my-staff` | — | Roster and requests |
| Push-back KPI | `/app/history/requests` | `requestKind=fmb`, `orderStatus=resubmitted` | What was sent back and the comments |
| Panel A block | `/app/inbox/requests` | `requestKind=fmb`, `order=<id>` | Accept, push back, or nudge |
| Panel B dot | `/app/history/requests` | `claimedBy` | One person's claimed orders |
| Panel C segment | matching bucket | `requestKind=fmb`, `week` | — |
| Panel D bar | `/app/menu` | `item` | Edit price, availability, tags |
| Panel E column | `/app/menu` | `dietary` | Add covering items |
| Panel F bar | `/app/cafeterias/staff-requests-history` | — | The audit trail |
| Panel G point | `/app/inbox/requests` | `requestKind=fmb`, `date` | That day's orders |

New parameters: `order`, `claimedBy`, `risk`, `delivery`, `orderStatus`, `unpriced`,
`item`, `dietary`, `date`, `week`. `/app/menu` currently reads no query parameters.
See [60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
