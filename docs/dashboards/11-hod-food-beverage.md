# Head of Department — Food & Beverage Services

`head-of-department` @ `food_beverage_services` · profile key `hod_fmb` ·
requirements `fmb` + `waterNormal`

> **What makes this dashboard different.** F&B is the only role in the system wearing
> three hats at once. It is a **gate** that can end a proposal outright at
> `fmb_review` — a power only the CFO and Heads of School otherwise hold. It is a
> **department lane** with a `request_task`, into which mineral water is folded
> because F&B reviews food and water as one unit of work. And it is a **supply
> orchestrator**: approving the food request fans out one `request_fmb_selection` per
> cafeteria, each with its own independent lifecycle, its own manager, and its own
> shared-pool claim. No other department has anything downstream of it.
>
> Its dashboard therefore has to answer three different questions on one page, and
> its signature panel is the one nothing else in the application shows: which outlet
> is actually delivering.

---

## 1. Dashboard objective

**Responsible for:** the `fmb_review` gate; the `fmb` department task (food + water);
choosing which cafeteria fulfils each food order; editing and re-sending orders a
manager pushes back; and the `dietaryInformation`, `servingUnit` and `waterNormal`
catalogues. Also holds Menu Oversight across every outlet
(`cafeteria-admin-folder` grant in `seed/nav.py`).

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve / reject / send back at `fmb_review` | Daily | Feasibility across outlets on that date, and cost |
| Which outlet fulfils which order | Daily | Live per-outlet load, acceptance latency, push-back history |
| Whether to re-send a pushed-back order or move it | Daily | The manager's comment and the alternative outlet's capacity |
| Whether water stock covers committed demand | Weekly | Committed bottles against `available_stock` |
| Whether the menus collectively cover dietary need | Monthly | Dietary coverage per outlet |
| Whether an outlet is structurally unreliable | Termly | On-time rate and push-back rate, per outlet, over a term |

**Uniquely can:** reject. `fmb_review` is a `REVIEWER_STAGE`, so this head can end a
proposal. That is why M22 (rejection rate) appears here and on no other department
dashboard.

**Daily** — the gate queue, orders at risk of missing serve time, pushed-back orders
waiting on an F&B edit.
**Weekly** — outlet allocation balance, water runway, order-lifecycle latency.
**Monthly** — committed food cost and its price coverage, dietary coverage, catalogue health.
**Strategic** — is an outlet's poor on-time rate a capacity problem or a staffing
problem? Its claim latency (M18) against its acceptance latency (M17) tells them
apart, and only F&B sees both across every outlet.

---

## 2. Data access scope

**Visible**

- Every proposal at `fmb_review` (clause 4), plus every proposal carrying an `fmb`
  task (clause 6), permanently.
- All `request_fmb`, `request_mineral_water`, and **every `request_fmb_selection`
  across every outlet** — F&B places the orders, so it sees all of them, not just one
  outlet's. This is the one department with legitimate cross-unit operational sight,
  and it exists because the fan-out is its own action.
- `fmb_options` for every cafeteria, including `unit_price_rm` — Menu Oversight
  already grants this.
- `water_normal_options`, `dietary_information_options`, `serving_unit_options`.
- The `food_beverage_services` roster by name.

**Restricted**

- Other departments' detail rows and staff.
- `request_funding_purchase`, `request.cost_amount`, `bank_account_*` — `○`. F&B sees
  the cost of **food it ordered** (`quantity × unit_price_rm`), never the proposal's
  budget or the event's ticket revenue. The distinction is deliberate: one is their
  own commitment, the other is the CFO's business.
- Cafeteria staff **names**. F&B sees outlet-level aggregates and claim latency; the
  individual who claimed an order is the Cafeteria Manager's business (R10). Panels
  here identify outlets, never people.
- Attendee identity.

**Cross-department:** outlet-scoped only, and only through orders F&B itself placed.
Nothing here reveals a cafeteria's staffing, its internal audit log, or its staffing
requests.

---

## 3. KPIs

### Hero · On-time delivery rate

| | |
|---|---|
| **Definition** | Share of delivered orders that reached the venue on or before the requested serve time |
| **Formula** | M19 — `count(delivered_at ≤ request_fmb."date" + serve_time) ÷ count(delivered_at IS NOT NULL)` |
| **Source** | `request_fmb_selection.delivered_at` (migration 013), `request_fmb."date"`, `.serve_time` |
| **Why it matters** | Every other number on this page is a means to this end. Food that arrives after the session it was ordered for did not happen, whatever the order status says |
| **Target** | ≥ 95% |
| **Drill** | `/app/history/requests?requestKind=fmb&delivery=late` |

### KPI 1 · Orders at risk
Live orders (`pending`/`approved`/`preparing`) whose serve time falls inside
`AT_RISK_WINDOW_DAYS`, split by which state they are stuck in. **Why:** an order
still `pending` two days out is a different emergency from one `preparing` two hours
out, and the split names the person to call. **Target:** 0 in `pending`.
**Drill:** `/app/inbox/requests?requestKind=fmb&risk=true`.

### KPI 2 · Gate queue & latency
Proposals waiting at `fmb_review`, with M14 dwell time for that status as the
subtitle. **Why:** F&B sits between HOS/HOD and the CFO; dwell here delays the CFO
gate and every department behind it. **Target:** ≤ 48h.
**Drill:** `/app/inbox/proposals?stage=fmb-review`.

### KPI 3 · Outlet push-back rate
M25 — orders reaching `resubmitted` ÷ orders placed, with the worst outlet named.
**Why:** a manager's send-back comes back to F&B, not to the applicant. Every
push-back is F&B rework, and it is usually caused by F&B sending an order to an outlet
that could not take it. **Target:** ≤ 10%.
**Drill:** `/app/inbox/requests?requestKind=fmb&orderStatus=resubmitted`.

### KPI 4 · Committed food cost
M50, with M58 price coverage rendered directly beneath as *"based on 84% of items
priced"*. **Why:** the total is the number people quote and the coverage is what makes
it honest. Showing one without the other is how a spend figure quietly understates.
**Target:** informational; alerts on week-on-week change > 40% (AI-04).
**Drill:** Panel D.

### KPI 5 · Water stock runway
M30, water variant — committed `request_mineral_water.quantity` against
`water_normal_options.available_stock`, expressed as days until the first breach.
**Why:** the one genuine inventory constraint F&B owns; every other F&B resource is a
cafeteria's kitchen. **Target:** ≥ 14 days.
**Drill:** `/app/dropdown-options/waterNormal`.

---

## 4. Analytics & visualisation

### Panel A — Order Fan-Out Board · *signature*

| | |
|---|---|
| **Type** | Matrix: one row per cafeteria outlet, one horizontal `stacked-bar` per row across the order lifecycle, with three numeric columns beside it |
| **Source** | `request_fmb_selection` grouped by `unit_code` and `status`; `unit.description` for labels |
| **Columns** | `pending → approved → preparing → ready → fulfilled`, plus **accept p50** (M17), **claim p50** (M18), **push-back %** (M25) |
| **Encoding** | Ordinal blue ramp across lifecycle states, starting at step 250 so the lightest still clears 2:1. 2px surface gap between segments. `cancelled` excluded from the bar and footnoted |
| **Filters** | Period, outlet, `with_logo` (water), menu item |
| **Purpose** | The routing decision. When the next order needs an outlet, this is the page that answers which one — not by capacity on paper but by measured behaviour |
| **Actions** | Click a segment → those orders. Click an outlet → that outlet's history. Hover → counts and medians |
| **Drill** | Segment → `/app/inbox/requests?requestKind=fmb&outlet=<code>&orderStatus=<s>` |

Why this and not a Sankey: a Sankey shows where orders *went*, which F&B already
knows — it sent them. What F&B does not know is which outlet is *slow*, and slowness
is a per-outlet distribution, not a flow volume.

### Panel B — Gate outcomes
`stacked-bar` by week: approved · sent back · rejected at `fmb_review` (M07, M22).
Three slots, legend present, direct-labelled. The only department dashboard carrying
a rejection series, because it is the only department that can reject.
Segment → `/app/history/proposals?stage=fmb-review&outcome=<o>`.

### Panel C — Outlet allocation balance
`line-chart`, one series per outlet, share of orders per week (M39). Capped at three
series by the all-pairs rule; a fourth outlet folds into "Other" and `meta` says so.
F&B chooses the split, so a drift is a decision worth seeing.
Point → that week's orders for that outlet.

### Panel D — Committed food cost by outlet
Horizontal `bar-chart`, outlets ranked by M50, each bar annotated with its M58 price
coverage. Bars whose coverage is under 80% carry a `warning` icon **and** label.
Bar → `/app/cafeterias/menu-oversight?outlet=<code>`.

### Panel E — Water stock runway
`meter` per active water option: committed against `available_stock`. Fill carries
severity; the track is a lighter step of the same blue. A meter, not a pie — it is one
ratio against one limit.
Meter → `/app/dropdown-options/waterNormal`.

### Panel F — Dietary coverage across outlets
`heatmap`, outlets × dietary options, cell = count of active menu items carrying that
tag (M38, via `fmb_option_dietary_information`). Empty cells get a status ring and an
icon. An outlet with no halal or no vegetarian item cannot serve a large share of
campus events, and nothing else in the application surfaces that.
Cell → `/app/cafeterias/menu-oversight?outlet=<code>&dietary=<id>`.

### Panel G — Order lifecycle latency
Horizontal `stacked-bar` per week: accept (M17) · claim (M18) · prepare · deliver.
Names which segment is degrading. Approximate until gap **G1** is closed — labelled
inline, not silently.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-04** `COST_SPIKE` | M50 week-on-week change > 40% | warning | Name the outlet and menu item driving it |
| **AI-06** `OUTLET_DEGRADING` | One outlet's M17 or M18 worsens 3 weeks running | serious | Recommend rebalancing new orders to the alternative outlet |
| **AI-09** `PUSHBACK_CONCENTRATION` | > 60% of push-backs come from one outlet | serious | Read that outlet's `manager_comment` values together; the reason is usually one thing |
| **AI-12** `WATER_STOCKOUT` | M30 water > 1.0 inside the horizon | critical | Name the date and the pack |
| **AI-15** `DIETARY_GAP` | A dietary option has zero coverage at an outlet receiving orders | warning | Propose menu additions to that manager |
| **AI-17** `SERVE_TIME_RISK` | Live order still `pending` inside `AT_RISK_WINDOW_DAYS` | critical | One-click into the order |
| **AI-20** `GATE_BOTTLENECK` | `fmb_review` is the slowest stage by M14 for 2 weeks | serious | The gate, not the departments, is the delay |
| **AI-23** `UNPRICED_EXPOSURE` | M58 coverage < 80% on an outlet with live orders (M75) | warning | Prices missing; M50 understates. Link to Menu Oversight |
| **AI-26** `REJECTION_DRIFT` | M22 rises while intake is flat | warning | Either quality fell or the bar moved — the trend cannot say which, and the card says so |
| **AI-31** `STRANDED_AT_GATE` | M78 matches an F&B applicant | critical | See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

---

## 6. Layout

```
┌ FOOD & BEVERAGE · Gate + Supply ─────────── [profile ▾]  ⟳ 09:14 ─┐
├ [7d][30d][90d][Term]   [ outlet ▾ ] [ menu item ▾ ] [ water ▾ ]   │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ At risk ─┐┌ Gate queue ┐┌Push-back┐┌ Food    │
│ │ On-time        │ │  2 pend  ││   5 · 39h  ││   14%   ││ cost    │
│ │   96.2%        │ │  1 prep  ││ ✓ ≤48h     ││ ⚠ ≤10%  ││RM 41.2k │
│ │ ▁▃▅▆▇█ ✓ ≥95%  │ │ ⚠ <7d    ││            ││ Level 3 ││ 84% prcd│
├───────────────────────────────────────────────────────────────────┤
│ ┌── ORDER FAN-OUT BOARD ────────────────────────────────────────┐ │
│ │ Outlet          pend appr prep ready fulf   accept claim  push│ │
│ │ Atrium      ▐██▌▐███▌▐██▌▐█▌▐█████▌      6h   2h    4%│ │
│ │ Level 3     ▐████▌▐██▌▐█▌▐▌▐███▌         19h ⚠ 11h ⚠ 22%⚠│ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Gate outcomes (6) ─────────┐ ┌── Allocation balance (6) ────┐ │
│ ┌── Food cost by outlet (4) ┐ ┌ Water runway (4) ┐ ┌ Dietary(4)┐ │
│ ┌── Order lifecycle latency (12) ──────────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── At risk this week (4) ─┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Gate queue · 5] [Pushed back · 3] [Menu oversight] [Water opts]  │
└───────────────────────────────────────────────────────────────────┘
```

Note the hero is a *rate*, not a count — a hero figure is one number, and "how well
is the supply chain working" is the number this role leads with.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | `/app/history/requests` | `requestKind=fmb`, `delivery=late` | Which deliveries were late and where |
| At-risk KPI | `/app/inbox/requests` | `requestKind=fmb`, `risk=true` | Act now |
| Gate queue KPI | `/app/inbox/proposals` | `stage=fmb-review` | The gate queue itself |
| Push-back KPI | `/app/inbox/requests` | `requestKind=fmb`, `orderStatus=resubmitted` | Edit and re-send |
| Food cost KPI | Panel D | — | In-page |
| Water KPI | `/app/dropdown-options/waterNormal` | — | Adjust stock |
| Panel A segment | `/app/inbox/requests` | `requestKind=fmb`, `outlet`, `orderStatus` | One outlet, one state |
| Panel A outlet | `/app/history/requests` | `requestKind=fmb`, `outlet` | That outlet's record |
| Panel B segment | `/app/history/proposals` | `stage=fmb-review`, `outcome`, `week` | The decisions behind the bar |
| Panel C point | `/app/history/requests` | `outlet`, `week` | — |
| Panel D bar | `/app/cafeterias/menu-oversight` | `outlet` | Fix prices |
| Panel F cell | `/app/cafeterias/menu-oversight` | `outlet`, `dietary` | Fix coverage |
| Panel G segment | matching bucket | `requestKind=fmb`, `week` | — |

New query parameters needed: `outlet`, `orderStatus`, `risk`, `delivery`, `stage`,
`outcome`, `dietary`, `week`. `/app/inbox/proposals` currently reads only `bucket`.
Itemised in [60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
