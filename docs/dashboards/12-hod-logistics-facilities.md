# Head of Department — Logistics and Facilities

`head-of-department` @ `logistics_and_facilities` · profile key `hod_logistics` ·
requirement `logistics`

> **What makes this dashboard different.** Logistics is the only department whose
> catalogue carries a real consumable stock level — `logistics_options.available_quantity`
> with a `quantity_unit` — and whose request rows carry a `quantity` to draw against
> it. That makes it the one department that can genuinely forecast a stock-out: a
> specific item, on a specific date, short by a specific number of units. It is also
> the only department that owns **facilities**, so `request_logistics.location` gives
> it a second constraint nobody else has — the same hall cannot be struck and re-set
> between two events an hour apart.
>
> Two hard constraints, both forecastable. The signature panel is the inventory
> heatmap; the second-tier panel nobody else gets is venue turnaround.

---

## 1. Dashboard objective

**Responsible for:** every `request_task` routed to `logistics_and_facilities` —
approving or sending back equipment and facilities requests, assigning crew to
individual `request_logistics` rows, and owning the Logistics Items catalogue with
its stock levels.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve or send back an equipment request | Daily | Whether the item is free on that date at that quantity |
| Which crew take which rows | Daily | Per-person load and the day's row count |
| Whether to buy, hire in, or refuse | Weekly | Forward commitment against stock, and how often it breaches |
| Whether a venue's back-to-back schedule is physically possible | Weekly | Turnaround gaps at the same location |
| Whether stock levels in the catalogue are right | Monthly | Utilisation per item; items never breached and items always breached |
| Whether to expand the inventory | Termly | Sustained breach rate and its trend |

**Cannot:** reject a proposal. Send-back-with-comment only.

**Daily** — today's and tomorrow's breaches, unassigned approved rows, the inbox.
**Weekly** — stock runway per item, venue turnaround conflicts, crew balance.
**Monthly** — catalogue utilisation, off-catalogue rate, demand seasonality.
**Strategic** — which items are structurally undersized, and whether a breach is
demand growth or one recurring event that should have its own kit.

---

## 2. Data access scope

**Visible:** proposals with a `logistics` task (clause 6, permanent); every
`request_logistics` row on them; `logistics_options` in full including
`available_quantity`; own task assignments and row assignments; the
`logistics_and_facilities` roster by name.

**Restricted:** other departments' detail rows; all financial columns (`○` — R9;
`logistics_options` has no price column at all, so there is nothing to leak);
attendee identity; other units' staff.

**Cross-department:** none. Every panel is unit-scoped.

**Note on `location`.** `request_logistics.location` is free text typed by the
applicant, not a controlled venue list. Panel D normalises case and whitespace before
grouping and states that it does so — otherwise "Hall A" and "hall a " are two
venues and the turnaround check misses the conflict it exists to find. A controlled
venue catalogue would be a better fix and is noted in the roadmap as optional.

---

## 3. KPIs

### Hero · Peak stock commitment

| | |
|---|---|
| **Definition** | The highest ratio of committed to available quantity for any item on any date in the forward horizon |
| **Formula** | `max( Σ request_logistics.quantity ÷ logistics_options.available_quantity )` over item × date — M30, logistics variant |
| **Source** | `request_logistics.quantity/"date"/option_id`, `logistics_options.available_quantity`, filtered to non-terminal proposals |
| **Why it matters** | Above 1.0 is a promise that cannot be kept, and it is knowable weeks ahead. Every other logistics failure is downstream of this one |
| **Target** | ≤ 0.85 (`CAPACITY_WARN_RATIO`). Critical above 1.0 |
| **Drill** | Panel A, anchored to the breaching cell |

### KPI 1 · Items over capacity
Count of distinct item × date cells above 1.0 in the horizon, with the nearest breach
date. **Why:** the hero names the worst; this names the workload. One item breaching
for a week is one conversation; six items breaching once each is six.
**Target:** 0. **Drill:** Panel A, filtered to breaches.

### KPI 2 · Venue turnaround conflicts
Pairs of `request_logistics` rows at the same normalised location whose gap is under
the configured teardown window. **Why:** the only department that can detect this,
because it is the only one holding both the venue and the setup window.
**Target:** 0. **Drill:** Panel D.

### KPI 3 · Decision latency (median · p90)
M10. **Target:** `SLA_DECISION_HOURS__logistics_and_facilities`, default 48h.
**Drill:** `/app/inbox/requests?bucket=inbox&requestKind=logistics`.

### KPI 4 · Unassigned approved rows
M64, weighted by days to event. Logistics permits unlimited assignees per row
(`MAX_ASSIGNEES_PER_ROW['logistics'] = None`), so a heavy row can carry several people
— an unassigned one carries nobody. **Target:** 0 within `SLA_ASSIGNMENT_HOURS`.
**Drill:** `/app/ongoing/requests?requestKind=logistics&assigned=none`.

### KPI 5 · Off-catalogue rate
M27 — `request_logistics.option_id IS NULL`. **Why:** an off-catalogue item has no
stock level, so it is invisible to the hero and to Panel A. A rising rate means the
inventory forecast is quietly covering less of the real demand.
**Target:** ≤ 10%. **Drill:** `/app/dropdown-options/logistics`.

---

## 4. Analytics & visualisation

### Panel A — Inventory Commitment Heatmap · *signature*

| | |
|---|---|
| **Type** | `heatmap` — rows = catalogue items, columns = days, cell = M30 ratio |
| **Source** | `request_logistics` × `logistics_options`, non-terminal proposals, next `FORECAST_HORIZON_DAYS` |
| **Encoding** | Sequential blue, one hue, light → dark, mapped 0 → 1.0. Cells above 1.0 take the `critical` ring **plus a warning glyph**, so a breach is never colour-alone. Off-catalogue rows are excluded and counted in the caption |
| **Filters** | Horizon (14 / 30 / 60 d), item group, "breaches only" |
| **Purpose** | See the shortage before it is a phone call. Rows sort by peak ratio, so the worst item is the top row |
| **Actions** | Hover → committed / available / shortfall in the item's own `quantity_unit`. Click → the proposals drawing on that item that day |
| **Drill** | Cell → `/app/inbox/requests?requestKind=logistics&item=<option_id>&date=<d>` |

A heatmap here and a timeline for A/V, deliberately: for consumable stock the
constraint is the **day total**, because an item issued in the morning is not back by
the afternoon. For A/V the constraint is the hour, because a crew that finishes at
noon is free at one. The chart form follows the physics, not the department's rank.

### Panel B — Stock runway by item
Horizontal `bar-chart`, items ranked by days until first breach. Items with no breach
in the horizon render in the de-emphasis tint at full length with a "clear" label —
present so the head sees what is *fine*, which is how a heatmap alone misleads.
Bar → `/app/dropdown-options/logistics?item=<option_id>`.

### Panel C — Where the lane time goes
Horizontal `stacked-bar` per week: decision (M10) · assignment lag (M12) · execution
(M13). Same three-segment shape as every other department dashboard, deliberately —
this is the one panel that should be comparable across departments if a Head of
School or the CFO ever asks.
Segment → the matching bucket for that week.

### Panel D — Venue turnaround
`timeline-chart`, one lane per normalised location, bars from `start_time` to
`end_time`. Gaps under the teardown window are drawn as a `critical` connector with a
label giving the gap in minutes. Locations with a single booking are hidden.
Connector → both proposals side by side.

### Panel E — Crew workload balance
`dot-plot`, one dot per staff member, x = row assignments in period (M60), unit median
as a reference line, M61 spread in the subtitle. Names shown — own unit, R10.
Dot → `/app/inbox/requests?requestKind=logistics&assignee=<user_id>`.

### Panel F — Catalogue utilisation
`bar-chart`, items ranked by selections in period (M37), with zero-selection active
items tinted de-emphasis and the off-catalogue rate (M27) as a caption. Two opposite
problems on one chart: dead options lengthening the form, and demand escaping the
catalogue entirely.
Bar → `/app/dropdown-options/logistics`.

### Panel G — Forward demand
`area-chart`, committed rows per day (M40) with the M41 projection as a **dashed**
continuation and a shaded p10–p90 band. Single series, no legend box.
Point → that day's requests.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-01** `STOCKOUT_FORECAST` | M30 > 1.0 for an item on a forward date | critical | Name item, date, shortfall in its own unit; offer send-back on the latest-submitted claimant |
| **AI-02** `CAPACITY_BREACH` | M35 > 1.0 (crew, not stock) | critical | Distinguishes "no kit" from "no people" — they have different fixes |
| **AI-10** `VENUE_CONFLICT` | Turnaround gap below the window at one location | serious | Both proposals, with the gap in minutes |
| **AI-05** `SLA_DRIFT` | M10 median rises 3 weeks running | warning | Names the weekday it concentrates on |
| **AI-08** `WORKLOAD_IMBALANCE` | M61 spread > 3× | warning | Names both ends |
| **AI-13** `CHRONIC_SHORTAGE` | The same item breaches on > 20% of horizon days | serious | This is a purchasing case, not a scheduling one, and the card says so |
| **AI-14** `FORM_MISMATCH` | M20 and M27 both rising | warning | The catalogue has stopped covering demand |
| **AI-22** `DEAD_CATALOGUE` | Active item, 0 selections in 90 days | info | Deactivate to shorten the form |
| **AI-27** `STALE_UNASSIGNED` | Approved row unassigned past target | serious | Link to assignment |
| **AI-31** `STRANDED_AT_GATE` | M78 matches a Logistics applicant | critical | See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

---

## 6. Layout

```
┌ LOGISTICS & FACILITIES · Operations ─────── [profile ▾]  ⟳ 09:14 ─┐
├ [7d][30d][90d][Term]   [ item group ▾ ] [ breaches only ☐ ]       │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Over cap ┐┌ Venue    ┐┌ Decision ┐┌ Unassg  │
│ │ Peak stock     │ │    3     ││ conflicts││ 26h / 61h││    5    │
│ │    1.24        │ │ items    ││    1     ││ ✓ ≤48h   ││ rows ⚠  │
│ │ ⚠ Sep 12 · ≤.85│ │ next Sep9││ ⚠ Hall A ││          ││         │
├───────────────────────────────────────────────────────────────────┤
│ ┌── INVENTORY COMMITMENT ──────────────────────── 30 days ──────┐ │
│ │                Sep 01 02 03 04 05 06 07 08 09 10 11 12 13 14  │ │
│ │ Round table     ░░ ▒▒ ▓▓ ██ ▓▓ ░░ ░░ ▒▒ ▓▓ ██ ▓▓ ⚠1.24 ▓▓ ▒▒ │ │
│ │ Stage riser     ░░ ░░ ▒▒ ▒▒ ░░ ░░ ░░ ▒▒ ⚠1.10 ▓▓ ▒▒ ░░ ░░ ░░ │ │
│ │ Barricade       ░░ ░░ ░░ ▒▒ ░░ ░░ ░░ ░░ ░░ ▒▒ ░░ ░░ ░░ ░░    │ │
│ │                 0 ░░░▒▒▒▓▓▓███ 1.0+  ⚠ = over capacity        │ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Stock runway (6) ──────────┐ ┌── Venue turnaround (6) ──────┐ │
│ ┌── Lane time (4) ──┐ ┌ Crew balance (4) ┐ ┌ Catalogue (4) ───┐  │
│ ┌── Forward demand (12) ───────────────────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── At risk this week (4) ─┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Review inbox · 7] [Assign work · 5] [Logistics items]            │
└───────────────────────────────────────────────────────────────────┘
```

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | Panel A, anchored to the breaching cell | — | In-page |
| Over-capacity KPI | Panel A, `breaches only` | — | In-page |
| Venue KPI | Panel D | — | In-page |
| Decision latency | `/app/inbox/requests` | `bucket=inbox`, `requestKind=logistics` | Clear the queue |
| Unassigned KPI | `/app/ongoing/requests` | `requestKind=logistics`, `assigned=none` | Assign |
| Off-catalogue KPI | `/app/dropdown-options/logistics` | — | Add the missing item |
| Panel A cell | `/app/inbox/requests` | `requestKind=logistics`, `item`, `date` | Who is drawing on it |
| Panel B bar | `/app/dropdown-options/logistics` | `item` | Adjust the stock level |
| Panel C segment | matching bucket | `requestKind`, `week` | — |
| Panel D connector | `/app/proposals/review/:id` ×2 | — | Both sides of the conflict |
| Panel E dot | `/app/inbox/requests` | `assignee` | One person's queue |
| Panel F bar | `/app/dropdown-options/logistics` | — | Prune or extend |
| Panel G point | `/app/inbox/requests` | `requestKind=logistics`, `date` | — |

New parameters: `item`, `date`, `assigned`, `assignee`, `week`. See
[60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
