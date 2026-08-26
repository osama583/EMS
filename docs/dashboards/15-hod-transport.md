# Head of Department — Transport Services

`head-of-department` @ `transport_services` · profile key `hod_transport` ·
requirement `transportation`

> **What makes this dashboard different.** Transport is the only department the
> workflow constrains to **one assignee per row** —
> `MAX_ASSIGNEES_PER_ROW['transportation'] = 1`, because one row is one vehicle and one
> vehicle needs exactly one driver. Every other row-assignable requirement is
> unlimited. That turns the row count into a driver count directly, and it means
> Transport runs against **two independent hard ceilings at once**: vehicles
> (`available_vehicle_count`) and drivers (active staff). Either can bind, they bind on
> different days, and the remedy differs completely — hiring a driver does not conjure
> a bus.
>
> It is also the only department that can measure **waste**. `passenger_capacity`
> against `requested_pax` says whether a 40-seater is carrying twelve people, and
> `pickup`/`dropoff` say whether two half-empty trips are running the same route on the
> same day. No other department has a comparable efficiency signal in its schema.

---

## 1. Dashboard objective

**Responsible for:** every `request_task` routed to `transport_services` — approving or
sending back transport requests, assigning a driver to each `request_transportation`
row, and owning the Transportation Types catalogue with its fleet counts and seat
capacities.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve or send back a transport request | Daily | Whether a vehicle **and** a driver are free that day |
| Which driver takes which trip | Daily | Driver load and the day's trip count |
| Whether two trips can be merged | Daily | Same-day, same-route, low-seat-fill pairs |
| Which ceiling is binding this month | Weekly | Vehicle commitment against driver commitment |
| Whether the right vehicles are in the fleet | Monthly | Seat-fill by vehicle type |
| Whether to buy a vehicle or hire a driver | Termly | Which ceiling binds more often, and by how much |

**Cannot:** reject a proposal. Send-back-with-comment only.

**Daily** — tomorrow's trips against both ceilings, unassigned approved trips,
consolidation candidates, the inbox.
**Weekly** — seat-fill trend, route concentration, driver balance.
**Monthly** — fleet composition against demand, catalogue health.
**Strategic** — the buy-a-bus versus hire-a-driver question, which the binding-constraint
history answers directly and nothing else in the application can.

---

## 2. Data access scope

**Visible:** proposals with a `transportation` task (clause 6, permanent); every
`request_transportation` row including `pickup`, `dropoff` and `requested_pax`;
`transportation_options` in full including `available_vehicle_count`,
`passenger_capacity` and `instructions`; own task and row assignments; the
`transport_services` roster by name.

**Restricted:** other departments' detail rows; all financial columns (`○` — R9;
`transportation_options` carries no cost per trip, so fuel and mileage costing is
outside what this schema can support and no panel implies otherwise); attendee
identity — Transport sees a passenger *count*, never a manifest; other units' staff.

**Cross-department:** none.

**Note on route text.** `pickup` and `dropoff` are free text, not a controlled place
list. Panel C normalises case and whitespace before pairing and says so — otherwise
"APU Main" and "apu main " are two routes and the consolidation check misses its own
best cases. A controlled place catalogue would be a better fix; it is listed as
optional in the roadmap.

---

## 3. KPIs

### Hero · Binding constraint — peak forward day

| | |
|---|---|
| **Definition** | The higher of the two ceiling ratios on the busiest forthcoming day, labelled with **which** ceiling binds |
| **Formula** | `max( vehicles_required ÷ available_vehicle_count , trips ÷ active drivers )` per day, over the horizon; the label names the argmax |
| **Source** | `request_transportation."date"/option_id`, `transportation_options.available_vehicle_count`, `user_unit_roles` (role `staff`, `is_active`) |
| **Why it matters** | A single ratio is a lie in a two-ceiling department. Reading "1.5" without knowing whether it means *no bus* or *no driver* sends the head to the wrong meeting. The label is half the metric |
| **Target** | ≤ 0.85 (`CAPACITY_WARN_RATIO`). Critical above 1.00 |
| **Drill** | Panel A, anchored to the peak day |

### KPI 1 · Seat-fill efficiency (median)
M32 — `requested_pax ÷ passenger_capacity` of the selected vehicle. **Why:** a fleet
running at 40% fill is short of vehicles it does not actually need. This is the only
department that can see its own waste, and the figure is the argument against the next
purchase request. **Target:** 0.60–0.95 — a *band*, because above 0.95 there is no
margin for a late addition. **Drill:** Panel B.

### KPI 2 · Driver-bound days
Forward days where trip count exceeds active drivers. Shown beside vehicle-bound days
as a small pair. **Why:** with two drivers on the seeded roster, a third simultaneous
trip is not happening regardless of fleet size. **Target:** 0.
**Drill:** Panel A, filtered to driver-bound days.

### KPI 3 · Consolidation opportunities
Same-date, same-normalised-route trip pairs where both are under 50% seat fill and
their combined pax fits one vehicle. **Why:** a saving that is arithmetic, not
judgement, and invisible on every existing screen. **Target:** informational — the
count is a work list. **Drill:** Panel C's opportunity list.

### KPI 4 · Decision latency (median · p90)
M10. **Target:** `SLA_DECISION_HOURS__transport_services`, default 48h.
**Drill:** `/app/inbox/requests?bucket=inbox&requestKind=transportation`.

### KPI 5 · Unassigned approved trips
M64, weighted by days to the trip. Under the one-driver cap, an unassigned trip has
nobody at all — there is no partial staffing. **Target:** 0 within
`SLA_ASSIGNMENT_HOURS`.
**Drill:** `/app/ongoing/requests?requestKind=transportation&assigned=none`.

---

## 4. Analytics & visualisation

### Panel A — Fleet & Driver Roster Board · *signature*

| | |
|---|---|
| **Type** | `column-chart`, one column per forward day, stacked by vehicle type, with **two** ceiling rules |
| **Ceilings** | Solid hairline at total `available_vehicle_count`; a second, distinctly labelled rule at active driver headcount. Whichever a column crosses first is annotated on the column |
| **Source** | `request_transportation` × `transportation_options`, non-terminal proposals, next `FORECAST_HORIZON_DAYS` |
| **Encoding** | Categorical slots by vehicle type, capped at three plus "Other". Breaching columns take a `critical` cap **and** a glyph naming which ceiling |
| **Filters** | Horizon, vehicle type, "breaches only", "driver-bound only" |
| **Purpose** | The only view in the system showing both constraints on one time axis, so the head can see that September binds on drivers and October binds on vehicles |
| **Actions** | Hover → trips, vehicles required, drivers required, seat fill. Click a segment → those trips |
| **Drill** | Segment → `/app/inbox/requests?requestKind=transportation&vehicleType=<id>&date=<d>` |

Two rules on one plot, not two y-axes. Both ceilings are counts of the same kind
(units of the thing plotted), so a single axis is correct — this is not the dual-axis
anti-pattern, and the distinction is worth stating because it looks superficially
similar.

### Panel B — Seat-fill efficiency
`dot-plot`, one dot per trip, x = seat fill, with the 0.60–0.95 target band shaded and
median plus p10 reference lines. Dots below 0.35 are direct-labelled with the route —
those are the consolidation candidates and the ones worth naming.
Dot → `/app/proposals/review/:id`.

### Panel C — Route concentration & consolidation
Horizontal `bar-chart` of normalised `pickup → dropoff` pairs by trip count, with a
list beneath naming each consolidation opportunity: two trips, one date, one route,
combined pax, and the vehicle that would take both.
Bar → `/app/history/requests?requestKind=transportation&route=<hash>`.
Opportunity row → both proposals side by side.

### Panel D — Fleet utilisation by type
`bar-chart`, vehicle types ranked by committed vehicle-days ÷ available vehicle-days
over the horizon, each annotated with its median seat fill. A type at 95% utilisation
and 40% fill is the wrong vehicle bought in the right quantity, and that reading is
only available with both figures together.
Bar → `/app/dropdown-options/transportation?type=<id>`.

### Panel E — Driver load balance
`dot-plot`, one dot per driver, x = trips assigned in period (M60), median reference
line. With two drivers M61's Gini is not meaningful and is suppressed; raw counts
carry it. Names shown — own unit, R10.
Dot → `/app/inbox/requests?requestKind=transportation&assignee=<user_id>`.

### Panel F — Where the lane time goes
Horizontal `stacked-bar` per week: decision (M10) · assignment lag (M12) · execution
(M13). Comparable across the six departments by design.
Segment → the matching bucket.

### Panel G — Forward demand, two series
`line-chart` with **trips** and **vehicles required** on **one axis** — both counts of
the same kind. Divergence means trips are increasingly needing more than one vehicle.
Point → that day's trips.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-02** `CAPACITY_BREACH` | Either ceiling exceeded on a forward date | critical | Names the date **and** which ceiling — the two have different fixes |
| **AI-07** `LOW_SEAT_FILL` | M32 median below 0.55 for 3 weeks | serious | Names the worst vehicle-type/route combination |
| **AI-30** `CONSOLIDATION_CANDIDATE` | Same date, same route, both under 50% fill, combined pax fits one vehicle | info | Both trips, combined pax, the vehicle that takes them |
| **AI-19** `SPOF_LANE` | Active drivers ≤ 2 (M73) | serious | Standing card while the roster is thin; states the capacity loss per absence |
| **AI-05** `SLA_DRIFT` | M10 median rises 3 weeks running | warning | Names the weekday |
| **AI-27** `STALE_UNASSIGNED` | Approved trip unassigned past target | serious | Under the one-driver cap this is a trip with nobody on it |
| **AI-13** `CHRONIC_SHORTAGE` | One vehicle type breaches on > 20% of horizon days | serious | A fleet case, not a scheduling one |
| **AI-22** `DEAD_CATALOGUE` | Vehicle type with 0 selections in 90 days | info | Retire or redeploy |
| **AI-11** `RUNWAY_COLLAPSE` | M16 median below `SLA_FULFILMENT_LEAD_DAYS` | serious | Applicants submitting too late |
| **AI-31** `STRANDED_AT_GATE` | M78 matches a Transport applicant | critical | See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

---

## 6. Layout

```
┌ TRANSPORT SERVICES · Fleet + Drivers ────── [profile ▾]  ⟳ 09:14 ─┐
├ [7d][30d][90d][Term]  [ vehicle type ▾ ] [ breaches only ☐ ]      │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Seat fill┐┌ Bound    ┐┌ Consolid ┐┌Unassigned│
│ │ Binding: DRIVER│ │   0.54   ││ drv 3    ││    2     ││    4     │
│ │     1.50       │ │ ⚠ 0.6-.95││ veh 0    ││ pairs    ││ trips ⚠  │
│ │ ⚠ Sep 12 · ≤.85│ │          ││ next Sep9││          ││          │
├───────────────────────────────────────────────────────────────────┤
│ ┌── FLEET & DRIVER ROSTER BOARD ───────────────── 30 days ──────┐ │
│ │ units                                                         │ │
│ │   4 │              ▄▄  ⚠driver                                │ │
│ │   3 │─────────────▐██▌──────── vehicles available (4) ────────│ │
│ │   2 │═════▄▄══════▐██▌══▄▄═══ drivers available (2) ══════════│ │
│ │   1 │ ▄▄ ▐██▌ ▄▄  ▐██▌  ██  ▄▄                                │ │
│ │   0 └─ 01 02 03 04 05 06 07 08 09 10 11 12 13 14 …            │ │
│ │      ■ 40-seat coach  ■ 15-seat van  ■ MPV  □ Other           │ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Seat-fill spread (6) ──────┐ ┌── Route & consolidation (6) ─┐ │
│ ┌── Fleet by type (4) ─┐ ┌ Driver balance (4) ┐ ┌ Lane time(4)─┐ │
│ ┌── Forward demand · trips vs vehicles (12) ───────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── At risk this week (4) ─┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Review inbox · 6] [Assign drivers · 4] [Transportation types]    │
└───────────────────────────────────────────────────────────────────┘
```

The hero card names the binding ceiling in words. A department with two constraints
whose dashboard shows one number is a department that will buy the wrong thing.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | Panel A, anchored to the peak day | — | In-page |
| Seat-fill KPI | Panel B | — | In-page |
| Bound-days KPI | Panel A, `driver-bound only` | — | In-page |
| Consolidation KPI | Panel C opportunity list | — | In-page |
| Decision latency | `/app/inbox/requests` | `bucket=inbox`, `requestKind=transportation` | Clear the queue |
| Unassigned KPI | `/app/ongoing/requests` | `requestKind=transportation`, `assigned=none` | Assign a driver |
| Panel A segment | `/app/inbox/requests` | `requestKind=transportation`, `vehicleType`, `date` | That day, that type |
| Panel B dot | `/app/proposals/review/:id` | — | The trip |
| Panel C bar | `/app/history/requests` | `route` | That route's history |
| Panel C opportunity | `/app/proposals/review/:id` ×2 | — | Both trips, to merge or reschedule |
| Panel D bar | `/app/dropdown-options/transportation` | `type` | Adjust the fleet count |
| Panel E dot | `/app/inbox/requests` | `assignee` | One driver's schedule |
| Panel F segment | matching bucket | `requestKind`, `week` | — |
| Panel G point | `/app/inbox/requests` | `requestKind=transportation`, `date` | — |

New parameters: `vehicleType`, `route`, `date`, `assigned`, `assignee`, `week`.
`route` is a stable hash of the normalised pickup/dropoff pair, computed server-side
so the client never has to reproduce the normalisation. See
[60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
