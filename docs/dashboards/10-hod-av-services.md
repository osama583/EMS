# Head of Department — A/V Services

`head-of-department` @ `a_v_services` · profile key `hod_av` · requirement `soundLight`

> **What makes this dashboard different.** A/V has no stock. `sound_light_options`
> carries a `technical_description` and nothing else — `available_quantity` was
> deliberately dropped because the Sound & Light manager decides allocation at review
> time. So there is no inventory to forecast and no stock-out to warn about. The only
> scarce resource is **technician-hours against overlapping event windows**, and the
> only failure mode that matters is two rigs needing the same crew at the same hour.
> The signature panel is therefore a collision timeline, not a heatmap and not an
> inventory chart.

---

## 1. Dashboard objective

**Responsible for:** every `request_task` routed to `a_v_services` — approving or
sending back the sound-and-light request on a proposal, assigning technicians to
individual `request_sound_light` rows, and owning the Sound & Light option catalogue.

**Decisions this role makes**

| Decision | Made how often | What it needs |
|---|---|---|
| Approve or send back a sound & light request | Daily | Whether the crew can cover that date and window |
| Which technician takes which rig | Daily | Current per-person load and the day's overlap depth |
| Whether to escalate a date that cannot be covered | Weekly | Forward collision forecast against headcount |
| Whether the catalogue still matches what is asked for | Monthly | Off-catalogue rate, dead options |
| Whether the department needs more technicians | Termly | Sustained coverage ratio and its trend |

**Cannot do:** reject a proposal. `chk_task_status` has no `rejected` value for
departments. Send-back-with-comment is the only pushback, and the comment is the
entire message to the applicant — which is why M24 (comment depth) is on this
dashboard and not merely in the catalog.

**Daily** — what arrived overnight, what is unassigned, what is at risk this week,
today's collisions.
**Weekly** — coverage ratio trend, where lane time is going, per-technician balance,
send-back rate.
**Monthly** — catalogue utilisation, demand seasonality, staffing case.
**Strategic** — is the department structurally under-resourced, or is it a scheduling
problem? M36 (peak-day concentration) against M35 (coverage ratio) separates them,
and they have opposite remedies.

---

## 2. Data access scope

**Visible**

- Proposals with a `request_task` routed to `a_v_services` — clause 6 of
  `_VISIBLE_SQL`, permanent because task rows persist.
- Every `request_sound_light` row on those proposals.
- Proposals they personally decided — clause 9.
- `sound_light_options` in full (they own it).
- `task_assignment` and `request_row_assignment` rows on their own tasks.
- The `a_v_services` staff roster and each member's load, by name (R10 — own unit).

**Restricted**

- Other departments' detail rows. A/V never sees `request_logistics` or
  `request_transportation`, even on a shared proposal.
- Every financial column. `cost_amount`, `unit_price_rm`, `bank_account_*`,
  `request_funding_purchase` — all `○` (R9). A/V allocates equipment; it does not
  hold budget.
- Attendee identity. `event_registration` is not on this dashboard at all.
- Cross-department staff names.

**Cross-department**: none. Every panel is `a_v_services`-scoped, no `◐` cells on
this role's row in the access matrix.

**Second hat, and its limit.** Clause 3 also shows this head any `hos_hod_review`
proposal from an applicant in `a_v_services`. They cannot act on it —
`is_hos_hod_for_applicant()` requires a School. Those proposals surface **only** in
the alerts rail as insight **AI-31**, never as reviewable work, so the dashboard does
not offer an action that the API would refuse.

---

## 3. KPIs

Hero plus five tiles. Each cites its metric definition from
[02-metric-catalog.md](02-metric-catalog.md).

### Hero · Crew coverage ratio — next 14 days, peak day

| | |
|---|---|
| **Definition** | The busiest forthcoming day's technician-hour demand as a fraction of what the roster can physically deliver |
| **Formula** | `max over next 14 days of ( M34 ÷ (active a_v_services staff × STAFF_SHIFT_HOURS) )` — M35 |
| **Source** | `request_sound_light.start_time/end_time/"date"`, `user_unit_roles` (role `staff`, `is_active`), `config.STAFF_SHIFT_HOURS` |
| **Why it matters** | Above 1.0 the day cannot be delivered by this roster no matter how well it is scheduled. It is the only number that distinguishes "busy" from "impossible", and it is the number that justifies a hire |
| **Target** | ≤ 0.80 (`CAPACITY_WARN_RATIO`). Amber 0.80–1.00, critical > 1.00 |
| **Caveat shown on the tile** | Assumes a uniform shift length — gap **G2**. Stated inline, not hidden |
| **Drill** | `/app/inbox/requests?requestKind=soundLight&sort=schedule&date=<peak>` |

### KPI 1 · Rig collisions, next 14 days
Count of forward dates whose peak simultaneous overlap (M31) exceeds active
technician headcount. **Why:** coverage ratio is a daily *total*; two four-hour rigs
at the same hour can breach while the day's total looks comfortable. This catches
what the hero misses. **Target:** 0. **Drill:** signature panel, scrolled to the
first breach date.

### KPI 2 · Decision latency (median · p90)
M10. Task created → first approve/send-back. **Why:** the one segment of the lane
this head personally controls. **Target:** `SLA_DECISION_HOURS__a_v_services`,
default 48h. **Drill:** `/app/inbox/requests?bucket=inbox&requestKind=soundLight`.

### KPI 3 · Unassigned approved rigs
M64, weighted by days to the event. **Why:** an approved rig with no technician is
work that has been promised and not staffed — the most actionable number on the page.
**Target:** 0 within `SLA_ASSIGNMENT_HOURS` of approval.
**Drill:** `/app/ongoing/requests?requestKind=soundLight&assigned=none`.

### KPI 4 · Send-back rate
M20, with M24 (share of send-backs under 40 characters) as its subtitle. **Why:** a
high send-back rate on a form the department does not control is a signal to change
the *form*, not to work harder. **Target:** ≤ 15% (`SEND_BACK_WARN_RATE`).
**Drill:** `/app/history/requests?requestKind=soundLight&outcome=resubmitted`.

### KPI 5 · Preparation runway (median)
M16. Notice between the task appearing and the event date. **Why:** separates "we are
slow" from "we were given three days". Falling runway predicts every other SLA breach
before it happens. **Target:** ≥ 3 days (`SLA_FULFILMENT_LEAD_DAYS`).
**Drill:** the lead-time distribution panel.

---

## 4. Analytics & visualisation

### Panel A — Rig Collision Timeline · *signature*

| | |
|---|---|
| **Type** | `timeline-chart` — one horizontal lane per day, each `request_sound_light` row a bar from `start_time` to `end_time` |
| **Source** | `request_sound_light` joined to `request`, non-terminal proposals, next `FORECAST_HORIZON_DAYS` |
| **Encoding** | Bar fill = sequential blue by overlap depth at that instant. A horizontal rule at active technician headcount. Segments above the rule take the `critical` status ring **and a warning icon** — never colour alone |
| **Filters** | Date window (14 / 30 / 60 d), option label, `assigned` / `unassigned` |
| **Purpose** | Answer "can we cover this?" at a glance, and show *why* not — which two rigs collide, at what hour, in which venue |
| **Actions** | Click a bar → that proposal's review page. Hover → item, venue, window, assignees. Select a day → the assignment panel filters to it |
| **Drill** | Bar → `/app/proposals/review/:id`. Day header → `/app/inbox/requests?requestKind=soundLight&date=<d>` |

Why a timeline and not a heatmap: a heatmap cell says "this day is busy". This
department's problem is *when within the day*, and only a timeline shows an hour-level
overlap. Logistics gets the heatmap, because for stock the day total is the constraint.

### Panel B — Where the lane time goes
Horizontal `stacked-bar`, one bar per week: decision latency (M10) · assignment lag
(M12) · execution (M13), summing to cycle time (M11). Three slots, direct-labelled.
Turns "we are slow" into "we are slow *here*", which has three different fixes.
Segment → the matching bucket, filtered to that week.

### Panel C — Technician-hour demand vs capacity
`column-chart`, daily, 30 days forward. Columns = M34. Solid hairline threshold at
roster capacity; the projected tail (M41) is **dashed** and labelled *projected*.
Single series → no legend box; the title names it.
Column → `/app/inbox/requests?requestKind=soundLight&date=<d>`.

### Panel D — Technician workload balance
`dot-plot`, one dot per technician, x = assignments in period (M60), with the unit
median as a reference line and the max/min spread (M61) as the subtitle. Three
technicians at 12 / 11 / 1 is invisible in an average of 8. Names shown — own unit,
R10. Dot → `/app/inbox/requests?requestKind=soundLight&assignee=<user_id>`.

### Panel E — Catalogue health
`bar-chart`, horizontal, options ranked by selections in period. Zero-selection
active options tinted de-emphasis; the off-catalogue rate (M27) sits as a caption.
Bar → `/app/dropdown-options/soundLight`.

### Panel F — Rework profile
`column-chart` of send-backs per week (M20) with mean loops per proposal (M21) as a
second small tile beside it — **two panels, not two axes.** Column →
`/app/history/requests?requestKind=soundLight&outcome=resubmitted&week=<w>`.

---

## 5. AI & decision-support insights

Full rule definitions in [50-ai-insight-engine.md](50-ai-insight-engine.md). Those
surfacing here:

| Rule | Fires when | Severity | Recommended action |
|---|---|---|---|
| **AI-02** `CAPACITY_BREACH` | M35 > 1.0 on any forward date | critical | Name the date and the colliding rigs; offer send-back-with-reschedule on the later one |
| **AI-03** `COLLISION_CLUSTER` | ≥ 3 collision dates within one week | serious | Flag the week for a temporary crew arrangement rather than per-rig triage |
| **AI-05** `SLA_DRIFT` | M10 median rises for 3 consecutive weeks | warning | Show which weekday the drift concentrates on |
| **AI-08** `WORKLOAD_IMBALANCE` | M61 spread > 3× across active staff | warning | Name the under- and over-loaded technician; link to reassignment |
| **AI-11** `RUNWAY_COLLAPSE` | M16 median falls below `SLA_FULFILMENT_LEAD_DAYS` | serious | Identify the applicant units submitting late; this is an upstream fix |
| **AI-14** `FORM_MISMATCH` | M20 > threshold **and** M27 rising together | warning | The catalogue no longer covers what is asked for — propose the missing options |
| **AI-19** `SPOF_LANE` | Active technicians ≤ 1 (M73) | serious | One absence stops the lane |
| **AI-22** `DEAD_CATALOGUE` | Active option with 0 selections in 90 days (M76) | info | Suggest deactivation to shorten the applicant's form |
| **AI-27** `STALE_UNASSIGNED` | Approved rig unassigned past `SLA_ASSIGNMENT_HOURS` | serious | Direct link to the assignment screen |
| **AI-31** `STRANDED_AT_GATE` | M78 matches an `a_v_services` applicant | critical | Cannot be resolved from this dashboard — routes to a System Admin note. See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

Cap: **five cards**, ranked by severity then recency. An insights rail that scrolls
is an insights rail nobody reads.

---

## 6. Layout

```
┌ A/V SERVICES · Operations ───────────────── [profile ▾]  ⟳ 09:14 ─┐
├ [7d][30d][90d][Term]     [ option ▾ ] [ assigned ▾ ]              │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Collisions ┐┌ Decision  ┐┌Unassigned┐┌Send-  │
│ │ Crew coverage  │ │     2      ││ 31h / 74h ││    3     ││back   │
│ │     0.94       │ │ next 14d   ││ p50 / p90 ││  rigs    ││ 11%   │
│ │ ▁▂▃▅▆█ peak Sep│ │ ⚠ target 0 ││ ✓ ≤48h    ││ ⚠        ││ ✓     │
├───────────────────────────────────────────────────────────────────┤
│ ┌── RIG COLLISION TIMELINE ───────────────────── 14 days ───────┐ │
│ │ Mon 01 ▐████ Hall A ▌   ▐██ Aud ▌                             │ │
│ │ Tue 02 ▐███████ Hall A ▌▐████ Aud ▌▐███ Lab ▌  ⚠ 3 > 3 crew   │ │
│ │ Wed 03 ▐██ Aud ▌                                              │ │
│ │        08  10  12  14  16  18  20 ── crew ceiling ────────────│ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Where lane time goes (6) ──┐ ┌── Demand vs capacity (6) ────┐ │
│ ┌── Technician balance (4) ─┐ ┌ Catalogue (4) ┐ ┌ Rework (4) ──┐ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── At risk this week (4) ─┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Review inbox · 4] [Assign work · 3] [Sound & Light options]      │
└───────────────────────────────────────────────────────────────────┘
```

---

## 7. Navigation & drill-down

| From | To | Filters carried | Journey |
|---|---|---|---|
| Hero | `/app/inbox/requests` | `requestKind=soundLight`, `sort=schedule`, `date=<peak>` | See the rigs making the peak day |
| Collisions KPI | Panel A anchored to the first breach | — | In-page |
| Decision latency | `/app/inbox/requests?bucket=inbox` | `requestKind=soundLight` | Act on what is waiting |
| Unassigned KPI | `/app/ongoing/requests` | `requestKind=soundLight`, `assigned=none` | Assign |
| Send-back KPI | `/app/history/requests` | `requestKind=soundLight`, `outcome=resubmitted` | Read the comments; judge whether the form is at fault |
| Panel A bar | `/app/proposals/review/:id` | — | Full proposal, A/V section |
| Panel A day | `/app/inbox/requests` | `requestKind=soundLight`, `date=<d>` | One day's rigs |
| Panel B segment | matching bucket | `requestKind`, `week` | Which items dominated that segment |
| Panel C column | `/app/inbox/requests` | `requestKind=soundLight`, `date=<d>` | — |
| Panel D dot | `/app/inbox/requests` | `assignee=<user_id>` | One technician's queue |
| Panel E bar | `/app/dropdown-options/soundLight` | — | Edit the catalogue |
| AI card action | per rule | rule-specific | — |

`date`, `assigned`, `assignee`, `outcome` and `week` are **new query parameters** on
`hub-requests`; today it reads only `bucket` and `requestKind`. The frontend work is
itemised in [60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2 —
without it every drill-down lands on an unfiltered list, which is a dead end wearing a
link.
