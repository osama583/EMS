# Head of Department — Student Services

`head-of-department` @ `student_services` · profile key `hod_student_services` ·
requirement `campusTour`

> **What makes this dashboard different.** Student Services is the only department
> whose request form carries **no times at all**. `request_campus_tour` has a `"date"`,
> a `pax`, a start point and a tour type — `start_time`, `end_time` and `location` were
> deliberately dropped because Student Services scopes the actual timing when it
> reviews. So there is no hour-level collision to detect, no service-hour demand to
> sum, and none of the temporal machinery that drives the A/V, Photography or Logistics
> dashboards applies.
>
> What it has instead is the only **per-unit group cap** in the schema:
> `campus_tour_start_options.max_group_size`. Capacity here is measured in *people per
> guide*, and the operative question is arithmetic rather than scheduling — a 90-person
> tour from a start point capped at 25 is four guides, not one, and nothing in the
> application currently says so. That calculation is the dashboard.

---

## 1. Dashboard objective

**Responsible for:** every `request_task` routed to `student_services` — approving or
sending back campus tour requests, assigning guides to individual
`request_campus_tour` rows, and owning **two** catalogues (Campus Tour Starting Points
and Campus Tour Types), more than any other department.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve or send back a tour request | Daily | Guides available that day, once the group is split |
| How many guides a tour needs, and who | Daily | `pax` against the start point's cap |
| Whether a start point is over-subscribed on a date | Weekly | Tours per start point per day |
| Whether group caps are set correctly | Monthly | How often groups split, and by how much |
| Which tour types are actually asked for | Monthly | Type mix and off-catalogue rate |
| Whether the guide roster is the right size | Termly | Sustained guide demand against headcount |

**Cannot:** reject a proposal. Send-back-with-comment only.

**Daily** — tomorrow's guide requirement, unassigned approved tours, the inbox.
**Weekly** — start-point congestion, group-size outliers, guide balance.
**Monthly** — cap calibration, catalogue health, seasonality.
**Strategic** — whether demand growth is in *tours* or in *tour size*. Twenty tours of
20 and ten tours of 40 carry identical pax and completely different guide costs, and
only the split calculation distinguishes them.

---

## 2. Data access scope

**Visible:** proposals with a `campusTour` task (clause 6, permanent); every
`request_campus_tour` row on them; `campus_tour_start_options` (including
`max_group_size` and `meeting_instructions`) and `campus_tour_type_options` in full;
own task and row assignments; the `student_services` roster by name.

**Restricted:** other departments' detail rows; all financial columns (`○` — R9;
neither tour catalogue carries a price); attendee identity — a tour has a `pax` count
and no guest list, so the question does not arise; other units' staff.

**Cross-department:** none.

**Note on nullable caps.** `campus_tour_start_options.max_group_size` is nullable. A
start point with no cap yields a group split of 1 regardless of `pax`, which is
correct behaviour and a silent under-estimate of guide demand. Panel A renders those
tours in a distinct hatched band labelled *"no cap set"* rather than folding them into
the total, and KPI 5 counts them, so the gap is visible rather than absorbed.

---

## 3. KPIs

### Hero · Guide demand vs roster — peak forward day

| | |
|---|---|
| **Definition** | The busiest forthcoming day's required guide count as a fraction of the active roster |
| **Formula** | `max over forward days of ( Σ ceil(request_campus_tour.pax ÷ NULLIF(max_group_size,0)) ÷ active student_services staff )` — M33 over M35 |
| **Source** | `request_campus_tour.pax/"date"/start_point_option_id`, `campus_tour_start_options.max_group_size`, `user_unit_roles` |
| **Why it matters** | The only department whose capacity requirement is a computed number rather than an observed one. A day that looks like three tours can be eleven guides, and the head has no other way to find out before the morning |
| **Target** | ≤ 0.80 (`CAPACITY_WARN_RATIO`). Critical above 1.00 |
| **Drill** | Panel A, anchored to the peak day |

### KPI 1 · Tours needing a split
Forward tours where `pax > max_group_size`, with the largest split factor named.
**Why:** each is a staffing decision that must be made before the day, and the
applicant does not know it is coming. **Target:** informational; the count drives
Panel A. **Drill:** `/app/inbox/requests?requestKind=campusTour&split=true`.

### KPI 2 · Start-point congestion
Forward dates where one start point hosts more tours than a configurable comfortable
maximum. **Why:** `meeting_instructions` assume one group at the meeting point.
Three groups converging on the same spot at the same hour is a real failure the
schema makes visible and nothing currently checks. **Target:** 0.
**Drill:** Panel B.

### KPI 3 · Decision latency (median · p90)
M10. **Target:** `SLA_DECISION_HOURS__student_services`, default 48h.
**Drill:** `/app/inbox/requests?bucket=inbox&requestKind=campusTour`.

### KPI 4 · Unassigned approved tours
M64, weighted by days to the tour date. **Target:** 0 within `SLA_ASSIGNMENT_HOURS`.
**Drill:** `/app/ongoing/requests?requestKind=campusTour&assigned=none`.

### KPI 5 · Uncapped start points
Active start points with `max_group_size IS NULL` that received a tour in the period.
**Why:** each one silently under-states the hero. This is a data-quality tile that
directly governs whether the headline number can be trusted. **Target:** 0.
**Drill:** `/app/dropdown-options/campusTourStart`.

---

## 4. Analytics & visualisation

### Panel A — Guide Demand & Group-Split Planner · *signature*

| | |
|---|---|
| **Type** | `column-chart`, one column per forward day, stacked by start point |
| **Value** | Guides required, not tours — `Σ ceil(pax ÷ max_group_size)` per tour |
| **Source** | `request_campus_tour` × `campus_tour_start_options`, non-terminal proposals, next `FORECAST_HORIZON_DAYS` |
| **Encoding** | Categorical slots by start point, capped at three plus "Other" (all-pairs rule). Solid hairline ceiling at active guide headcount. Uncapped tours in a hatched band labelled *"no cap set"*, excluded from the stack total |
| **Filters** | Horizon, start point, tour type, "splits only" |
| **Purpose** | Convert a tour schedule into a staffing requirement — the arithmetic that separates a manageable day from an impossible one |
| **Actions** | Hover → tours, pax, split factor, guides. Click a segment → those tours |
| **Drill** | Segment → `/app/inbox/requests?requestKind=campusTour&startPoint=<id>&date=<d>` |

A stacked column and not a heatmap: the reader's question is "how many people do I
need that day", which is a magnitude with a ceiling — a bar against a rule answers it
directly. Logistics gets the heatmap because its question is per-item, and this
department has one resource, not many.

### Panel B — Start-point congestion
`heatmap`, start points × days, cell = tour count. Sequential blue. Cells above the
comfortable maximum take a `warning` ring **and** glyph. `meeting_instructions` shown
in the hover, because the instruction text is usually what makes two groups at one
point unworkable.
Cell → `/app/inbox/requests?requestKind=campusTour&startPoint=<id>&date=<d>`.

### Panel C — Group size against cap
`dot-plot`, one dot per tour, x = `pax`, with each start point's `max_group_size` drawn
as a reference band. Dots beyond their band are the splits. Shows cap calibration at a
glance: a cap every tour exceeds is set too low; a cap no tour approaches is not doing
anything.
Dot → `/app/proposals/review/:id`.

### Panel D — Tour type mix
`line-chart`, share per tour type per week (M42-shaped, scoped to this catalogue),
capped at three series plus "Other". Student Services is the only department owning
two catalogues, and type mix is the one it can influence by what it offers.
Point → `/app/history/requests?requestKind=campusTour&tourType=<id>&week=<w>`.

### Panel E — Guide workload balance
`dot-plot`, one dot per staff member, x = row assignments in period (M60), median
reference line, M61 spread in the subtitle. Names shown — own unit, R10.
Dot → `/app/inbox/requests?requestKind=campusTour&assignee=<user_id>`.

### Panel F — Where the lane time goes
Horizontal `stacked-bar` per week: decision (M10) · assignment lag (M12) · execution
(M13). Comparable across the six departments by design.
Segment → the matching bucket.

### Panel G — Forward demand, two series
`line-chart` with **tours** and **guides required** as two series on **one axis** —
both are counts of the same kind, so this is legitimate where a pax-versus-tours plot
would be a dual-axis violation. Their divergence is the story: guides rising faster
than tours means group sizes are growing.
Point → that day's tours.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-02** `CAPACITY_BREACH` | Guide demand > roster on a forward date | critical | Names the date, the tours, and the guide shortfall |
| **AI-25** `GROUP_SPLIT_SURGE` | Mean split factor rises 3 weeks running | warning | Group sizes growing — a cap or a roster decision, and the card presents both |
| **AI-28** `START_POINT_CROWDING` | One start point over the comfortable maximum on a date | serious | Names the point, date, and the tours to redirect |
| **AI-29** `UNCAPPED_START_POINT` | An uncapped start point receives a tour | warning | The hero is under-stating; link to set the cap |
| **AI-05** `SLA_DRIFT` | M10 median rises 3 weeks running | warning | Names the weekday |
| **AI-08** `WORKLOAD_IMBALANCE` | M61 spread > 3× | warning | Names both ends |
| **AI-27** `STALE_UNASSIGNED` | Approved tour unassigned past target | serious | Link to assignment |
| **AI-22** `DEAD_CATALOGUE` | Start point or tour type with 0 selections in 90 days | info | Deactivate to shorten the form |
| **AI-11** `RUNWAY_COLLAPSE` | M16 median below `SLA_FULFILMENT_LEAD_DAYS` | serious | Applicants submitting too late |
| **AI-31** `STRANDED_AT_GATE` | M78 matches a Student Services applicant | critical | See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

---

## 6. Layout

```
┌ STUDENT SERVICES · Tours + Guides ───────── [profile ▾]  ⟳ 09:14 ─┐
├ [7d][30d][90d][Term]  [ start point ▾ ] [ type ▾ ] [ splits ☐ ]   │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Splits  ┐┌ Start-pt ┐┌ Decision ┐┌ Uncapped │
│ │ Guide demand   │ │    4    ││ crowding ││ 22h/48h  ││    1     │
│ │    1.33        │ │ max ×4  ││    1     ││ ✓ ≤48h   ││ point ⚠  │
│ │ ⚠ Sep 18 · ≤.8 │ │         ││ ⚠ Atrium ││          ││          │
├───────────────────────────────────────────────────────────────────┤
│ ┌── GUIDE DEMAND & GROUP-SPLIT PLANNER ────────── 30 days ──────┐ │
│ │ guides                                                        │ │
│ │   6 │                        ▄▄                               │ │
│ │   4 │──────────▄▄────────────██──── roster ceiling (3) ───────│ │
│ │   2 │    ▄▄    ██     ▄▄     ██    ▄▄        ▨▨ no cap set    │ │
│ │   0 └─ 01 02 03 04 05 06 07 08 09 10 11 12 13 14 …            │ │
│ │      ■ Main Gate  ■ Atrium  ■ Library  □ Other                │ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Start-point congestion (6) ┐ ┌── Group size vs cap (6) ─────┐ │
│ ┌── Tour type mix (4) ┐ ┌ Guide balance (4) ┐ ┌ Lane time (4) ─┐ │
│ ┌── Forward demand · tours vs guides (12) ─────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── At risk this week (4) ─┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Review inbox · 5] [Assign guides · 4] [Start points] [Types]     │
└───────────────────────────────────────────────────────────────────┘
```

Two catalogue quick actions, because this is the only department owning two.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | Panel A, anchored to the peak day | — | In-page |
| Splits KPI | `/app/inbox/requests` | `requestKind=campusTour`, `split=true` | Plan the guides |
| Congestion KPI | Panel B | — | In-page |
| Decision latency | `/app/inbox/requests` | `bucket=inbox`, `requestKind=campusTour` | Clear the queue |
| Unassigned KPI | `/app/ongoing/requests` | `requestKind=campusTour`, `assigned=none` | Assign |
| Uncapped KPI | `/app/dropdown-options/campusTourStart` | — | Set the cap |
| Panel A segment | `/app/inbox/requests` | `requestKind=campusTour`, `startPoint`, `date` | That day, that point |
| Panel B cell | `/app/inbox/requests` | `requestKind=campusTour`, `startPoint`, `date` | — |
| Panel C dot | `/app/proposals/review/:id` | — | The tour |
| Panel D point | `/app/history/requests` | `tourType`, `week` | — |
| Panel E dot | `/app/inbox/requests` | `assignee` | One guide's queue |
| Panel F segment | matching bucket | `requestKind`, `week` | — |
| Panel G point | `/app/inbox/requests` | `requestKind=campusTour`, `date` | — |

New parameters: `split`, `startPoint`, `tourType`, `date`, `assigned`, `assignee`,
`week`. See [60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
