# Head of Department — Photography Services

`head-of-department` @ `photography_services` · profile key `hod_photography` ·
requirement `photoVideo`

> **What makes this dashboard different.** Photography shares A/V's shape on paper —
> no catalogue capacity, personnel decided at review time, `media_options.max_personnel`
> deliberately dropped — but the work has a completely different timeline. **A/V's job
> ends when the event ends.** The rig comes down and the task closes. **Photography's
> job starts at the event and finishes days later**, because the deliverable is the
> edit, not the attendance.
>
> That single fact reorganises the whole dashboard. A/V measures whether it can cover
> the hour; Photography measures that *and* whether the work already shot is getting
> out the door. A shoot that happened three weeks ago with nothing delivered is
> invisible on an A/V-style dashboard and is the largest thing on this one. The
> department also runs on **two photographers** — the thinnest lane in the system, where
> a single absence is a 50% capacity cut rather than an inconvenience.

---

## 1. Dashboard objective

**Responsible for:** every `request_task` routed to `photography_services` — approving
or sending back photo/video requests, assigning photographers to individual
`request_photography_videography` rows, and owning the Photography Services catalogue.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve or send back a shoot request | Daily | Whether a photographer is free in that window |
| Who shoots what | Daily | Forward assignment gaps and each photographer's live load |
| Which post-event edits to chase | Daily | The delivery backlog, aged |
| Whether to decline or reschedule an overcommitted day | Weekly | Coverage against a two-person roster |
| Whether turnaround is drifting | Weekly | Event-date-to-delivery distribution |
| Whether the department needs a third photographer | Termly | Sustained coverage ratio **and** turnaround together — either alone is misleading |

**Cannot:** reject a proposal. Send-back-with-comment only.

**Daily** — undelivered shoots by age, today's coverage, the inbox.
**Weekly** — turnaround distribution, double-booking, photographer balance.
**Monthly** — service mix, catalogue health, demand seasonality.
**Strategic** — coverage and turnaround fail for opposite reasons. Poor coverage with
good turnaround means too few shoot slots; good coverage with poor turnaround means
editing capacity, not shooting capacity, is the constraint. Only both figures side by
side distinguish them, and they lead to different hires.

---

## 2. Data access scope

**Visible:** proposals with a `photoVideo` task (clause 6, permanent); every
`request_photography_videography` row on them; `media_options` in full; own task and
row assignments; the `photography_services` roster by name.

**Restricted:** other departments' detail rows; all financial columns (`○` — R9;
`media_options` carries no price at all); attendee identity — a photography department
sees the *shoot*, not the guest list; other units' staff.

**Cross-department:** none.

**Note on delivery.** The schema has no "asset delivered" field. Completion is
`request_row_assignment.status = 'completed'` (migration 012) or the task reaching
`completed`. This dashboard treats that as the delivery signal and **says so on the
panel** — if photographers mark completion when they finish shooting rather than when
they hand over the edit, the turnaround figure measures nothing. That is a process
question the department must settle before the metric is trusted, and the caption
raises it rather than assuming an answer.

---

## 3. KPIs

### Hero · Post-event delivery backlog

| | |
|---|---|
| **Definition** | Shoots whose event date has passed and whose work is not yet marked complete, with the median age of that backlog |
| **Formula** | `count(request_row_assignment WHERE requirement_name='photoVideo' AND status <> 'completed' AND row date < CURRENT_DATE)`, plus `median(CURRENT_DATE − row date)` |
| **Source** | `request_row_assignment`, `request_photography_videography."date"` |
| **Why it matters** | The department's only invisible backlog. Forward-looking panels show it as done — the event happened, the calendar is clear — while the actual deliverable has not shipped. No other department accumulates work *after* the event |
| **Target** | ≤ 3 shoots, median age ≤ 7 days |
| **Drill** | `/app/ongoing/requests?requestKind=photoVideo&phase=post-event` |

### KPI 1 · Coverage gap, next 14 days
Forward shoots with zero assignees whose date falls inside `AT_RISK_WINDOW_DAYS`,
against a two-person roster. **Why:** with two photographers, the third simultaneous
shoot on any day is simply not happening, and the gap is knowable now.
**Target:** 0. **Drill:** Panel B, anchored to the first gap.

### KPI 2 · Turnaround (median · p90)
Event date → completion. Distinct from M11, which starts at task creation and so
mixes the wait *before* the event into the delivery figure. **Why:** the number the
requester experiences. **Target:** ≤ 7 days median. **Drill:** Panel C.

### KPI 3 · Double-booked photographer
Count of cases where one photographer holds two `request_photography_videography` rows
with overlapping windows. **Why:** unlimited assignees per row
(`MAX_ASSIGNEES_PER_ROW['photoVideo'] = None`) means nothing stops an over-assignment,
and with two staff it is easy to do by accident. **Target:** 0.
**Drill:** Panel D.

### KPI 4 · Decision latency (median · p90)
M10. **Target:** `SLA_DECISION_HOURS__photography_services`, default 48h.
**Drill:** `/app/inbox/requests?bucket=inbox&requestKind=photoVideo`.

### KPI 5 · Roster resilience
Active `staff` in the unit, with an explicit *"one absence removes N% of capacity"*
subtitle (M73). **Why:** on the seeded roster that reads 50%. A structural fact worth
a permanent tile rather than an occasional alert — it changes how every other number
on the page should be read. **Target:** ≥ 3 staff. **Drill:** none; informational.

---

## 4. Analytics & visualisation

### Panel A — Assignment-to-Delivery Pipeline · *signature*

| | |
|---|---|
| **Type** | `funnel`, five stages, each with a count and a median age badge |
| **Stages** | Requested → Approved → Assigned → Shot *(event date passed)* → Delivered *(completed)* |
| **Source** | `request_task`, `request_row_assignment`, `request_photography_videography."date"` |
| **Encoding** | Ordinal blue ramp, starting no lighter than step 250 so the first stage still clears 2:1. Stages whose median age exceeds target take a `warning` icon **and** label |
| **Filters** | Period, service type, photographer |
| **Purpose** | The department's whole state on one line, including the stage no other department has. "Shot but not delivered" is where the real backlog lives |
| **Actions** | Click a stage → those shoots, sorted oldest first. Hover → count, median age, oldest item |
| **Drill** | Stage → `/app/ongoing/requests?requestKind=photoVideo&phase=<stage>` |

A funnel and not a timeline: A/V's question is *when within the day*, so it gets a
timeline. Photography's question is *how far along*, and progression through stages
is what a funnel is for. The two departments look alike in the schema and need
different instruments.

### Panel B — Shoot coverage calendar
`timeline-chart`, 14 days forward, each shoot a bar from `start_time` to `end_time`,
with a ceiling rule at active photographer headcount. Bars with no assignee take the
`serious` status ring plus an icon. Days exceeding the ceiling take a critical band.
Bar → `/app/proposals/review/:id`.

### Panel C — Turnaround distribution
`dot-plot`, one dot per delivered shoot, x = days from event to completion, with
median and p90 reference lines. A distribution and not a mean: one shoot sitting at
40 days is the story, and a mean of 9 hides it. Dots beyond p90 are labelled with the
event title.
Dot → `/app/history/requests?requestKind=photoVideo` at that proposal.

### Panel D — Photographer load & conflicts
`dot-plot` of assignments per photographer (M60) with the median as a reference line,
and an inline conflict list beneath naming each overlapping pair with its window.
Names shown — own unit, R10. With two staff, M61's Gini is not meaningful and is
suppressed; the raw counts and the conflict list carry it.
Dot → `/app/inbox/requests?requestKind=photoVideo&assignee=<user_id>`.

### Panel E — Service mix
Horizontal `bar-chart` of `media_options` by selections in period (M37), with
off-catalogue `service` values (M27, `option_id IS NULL`) as a separate labelled bar
at the bottom. A large off-catalogue bar means people are asking for something the
catalogue does not name.
Bar → `/app/dropdown-options/photoVideo`.

### Panel F — Where the lane time goes
Horizontal `stacked-bar` per week: decision (M10) · assignment lag (M12) · pre-event
wait · post-event turnaround. **Four segments, not three** — the extra segment is the
whole point of this department and makes the bar non-comparable with the other five
departments, which the caption states.
Segment → the matching bucket for that week.

### Panel G — Forward demand
`area-chart`, shoots per day (M40) with the M41 projection dashed and banded. Single
series, no legend box.
Point → that day's shoots.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-16** `DELIVERY_BACKLOG` | Any shoot undelivered > 14 days after its event | serious | Names the oldest three and their photographers |
| **AI-18** `COVERAGE_GAP` | Forward shoot unassigned inside `AT_RISK_WINDOW_DAYS` | critical | Names the date, window, and who is free |
| **AI-21** `DOUBLE_BOOKED` | One photographer, two overlapping rows | critical | Both rows, with the overlap in minutes |
| **AI-19** `SPOF_LANE` | Active photographers ≤ 2 (M73) | serious | Standing card while the roster is thin; states the capacity loss per absence |
| **AI-05** `SLA_DRIFT` | M10 median rises 3 weeks running | warning | Names the weekday |
| **AI-24** `TURNAROUND_DRIFT` | Turnaround p90 rises while shoot count is flat | serious | Editing capacity is the constraint, not shooting capacity — and the card says which |
| **AI-14** `FORM_MISMATCH` | M20 and M27 both rising | warning | Catalogue no longer covers demand |
| **AI-22** `DEAD_CATALOGUE` | Active service, 0 selections in 90 days | info | Deactivate |
| **AI-11** `RUNWAY_COLLAPSE` | M16 median below target | serious | Applicants are submitting too late |
| **AI-31** `STRANDED_AT_GATE` | M78 matches a Photography applicant | critical | See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

---

## 6. Layout

```
┌ PHOTOGRAPHY SERVICES · Coverage + Delivery ─ [profile ▾]  ⟳ 09:14 ┐
├ [7d][30d][90d][Term]   [ service ▾ ] [ photographer ▾ ]           │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Coverage ┐┌Turnaround┐┌ Double  ┐┌ Roster   │
│ │ Undelivered    │ │   gap    ││  6d/14d  ││ booked  ││    2     │
│ │      7         │ │    2     ││ ✓ ≤7d    ││    1    ││ 1 absence│
│ │ median 11d ⚠   │ │ ⚠ Sep 4  ││          ││ ⚠       ││ = -50% ⚠ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── ASSIGNMENT → DELIVERY PIPELINE ─────────────────────────────┐ │
│ │  Requested ██████████████████████  14   2d                    │ │
│ │  Approved  ████████████████        11   3d                    │ │
│ │  Assigned  ██████████████           9   4d                    │ │
│ │  Shot      ████████████             8  11d ⚠                  │ │
│ │  Delivered ████                     1   —                     │ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Shoot coverage calendar (6) ┐ ┌── Turnaround spread (6) ────┐ │
│ ┌── Photographer load (4) ─┐ ┌ Service mix (4) ┐ ┌ Lane time(4)┐ │
│ ┌── Forward demand (12) ───────────────────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── At risk this week (4) ─┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Review inbox · 3] [Chase delivery · 7] [Photography options]     │
└───────────────────────────────────────────────────────────────────┘
```

The "Chase delivery" quick action is unique to this role and is the most-used button
on the page — no other department has work that needs chasing after the event.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | `/app/ongoing/requests` | `requestKind=photoVideo`, `phase=post-event`, `sort=schedule&order=asc` | Oldest undelivered first |
| Coverage KPI | Panel B, anchored to the first gap | — | In-page |
| Turnaround KPI | Panel C | — | In-page |
| Double-booked KPI | Panel D conflict list | — | In-page |
| Roster KPI | — | — | Informational; no drill |
| Decision latency | `/app/inbox/requests` | `bucket=inbox`, `requestKind=photoVideo` | Clear the queue |
| Panel A stage | `/app/ongoing/requests` | `requestKind=photoVideo`, `phase=<stage>` | That stage's shoots |
| Panel B bar | `/app/proposals/review/:id` | — | The proposal |
| Panel C dot | `/app/history/requests` | `requestKind=photoVideo`, at that proposal | The outlier |
| Panel D dot | `/app/inbox/requests` | `assignee` | One photographer's queue |
| Panel E bar | `/app/dropdown-options/photoVideo` | — | Edit the catalogue |
| Panel F segment | matching bucket | `requestKind`, `week` | — |
| Panel G point | `/app/inbox/requests` | `requestKind=photoVideo`, `date` | — |

New parameters: `phase` (this role only), `assignee`, `date`, `week`. `phase` maps to
a server-side predicate over event date and assignment status, not a client filter —
see [60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
