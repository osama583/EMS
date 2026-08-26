# Metric catalog — the semantic layer

Every number any dashboard can show, defined once. Role documents cite metric IDs;
they do not restate formulas. One definition means two dashboards showing "decision
latency" cannot disagree about what it means.

**Conventions used throughout**

- `:unit` — the caller's unit code, from `principal.headed_units` (rule R4).
- `:from` / `:to` — the period from the global filter row.
- `:outlets` — the caller's cafeteria codes (rule R5).
- Reserved-word columns (`date`, `time`) are double-quoted, per `backend/docs/database.md`.
- "Open" task means `status NOT IN ('completed','cancelled')` — matching `TASK_TERMINAL`.
- "Terminal proposal" means `status IN ('completed_approved','completed_rejected','cancelled')`
  — matching `TERMINAL_STATUSES`.
- Every metric is computed server-side (rule R2).

---

## Family A — Flow & throughput (M01–M08)

### M01 · Intake volume
Tasks entering the lane in the period. The denominator for most of Family C.
```sql
SELECT count(*) FROM request_task
 WHERE assigned_unit_code = :unit AND created_at >= :from AND created_at < :to
```
*Source:* `request_task`. *Target:* n/a — context, not a goal.

### M02 · Clearance rate
Resolved ÷ created in the same period. **> 1.0 means the backlog is shrinking.**
This is the single most honest one-number answer to "are we keeping up", and it is
the metric a raw "total approvals" card fails to give.
```sql
SELECT count(*) FILTER (WHERE resolved_at >= :from AND resolved_at < :to)::numeric
     / NULLIF(count(*) FILTER (WHERE created_at >= :from AND created_at < :to), 0)
  FROM request_task WHERE assigned_unit_code = :unit
```
*Target:* ≥ 1.0 sustained over 4 weeks.

### M03 · Open backlog
```sql
SELECT count(*) FROM request_task
 WHERE assigned_unit_code = :unit AND status NOT IN ('completed','cancelled')
```

### M04 · Backlog age profile
Open tasks bucketed by `now() - created_at`: `0–1d`, `1–3d`, `3–7d`, `7–14d`, `>14d`.
An age *distribution*, not a mean — a mean of 4 days hides one task sitting at 30.

### M05 · Throughput
Tasks reaching `completed` per ISO week. Plotted as a 12-week line (M-series default
window `DASHBOARD_TREND_WEEKS`).

### M06 · Work-in-progress
Open tasks with `status IN ('approved','preparing')` — accepted and being worked,
distinct from M03 which includes untouched `pending`.

### M07 · Stage transit volume
Proposals entering each workflow status in the period, from `workflow_history`.
Feeds the funnel on the HOS and CFO dashboards.
```sql
SELECT new_status, count(DISTINCT request_id) FROM workflow_history
 WHERE created_at >= :from AND created_at < :to AND new_status IS NOT NULL
 GROUP BY new_status
```

### M08 · Order volume (cafeteria)
`request_fmb_selection` rows created for `:outlets`. See gap **G1** — creation time
is derived from the F&B approval history row until a `created_at` column exists.

---

## Family B — SLA & latency (M10–M19)

All latencies are reported as **median and p90**, never a bare mean. A mean latency
is dominated by the one task nobody picked up, which is the task you already know about.

### M10 · Decision latency
Task created → its first approve/send-back. The department head's own responsiveness.
```sql
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM d.first_at - t.created_at)/3600)
  FROM request_task t
  JOIN LATERAL (
        SELECT min(created_at) AS first_at FROM workflow_history h
         WHERE h.request_task_id = t.request_task_id
           AND h.action IN ('approve','resubmit','send_back')
       ) d ON TRUE
 WHERE t.assigned_unit_code = :unit AND t.created_at >= :from
```
*Target:* `SLA_DECISION_HOURS__:unit`, falling back to `SLA_DECISION_HOURS` (48).

### M11 · Fulfilment cycle time
`created_at → resolved_at` on completed tasks, in hours. End-to-end lane time.

### M12 · Assignment lag
Task approved → first `task_assignment.assigned_at` (or `request_row_assignment.assigned_at`
for the five row-assignable requirements). Isolates "the head approved but nobody was
put on it" from "the staff member was slow", which M11 conflates.
*Target:* `SLA_ASSIGNMENT_HOURS` (24).

### M13 · Execution time
First assignment → `completed`. M11 minus M10 minus M12. The staff-side segment.

### M14 · Stage dwell time (proposal level)
Hours between consecutive `workflow_history` rows for a request, attributed to the
status being *left*. The input to bottleneck detection.
```sql
SELECT previous_status,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM gap)/3600) AS p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM gap)/3600) AS p90
  FROM (SELECT previous_status,
               created_at - lag(created_at) OVER (PARTITION BY request_id ORDER BY created_at) AS gap
          FROM workflow_history WHERE created_at >= :from) s
 WHERE gap IS NOT NULL GROUP BY previous_status
```

### M15 · SLA compliance
Share of tasks whose M10 fell within the unit's target. Reported as a percentage
with the breach count beside it — the count is the actionable half.
*Target:* ≥ 90%.

### M16 · Preparation runway
Task `created_at` → the earliest `"date"` in the requirement's own detail table.
How much notice the department actually got. A department can be fast and still fail
if it is handed three days' notice; this separates the two.
*Target:* ≥ `SLA_FULFILMENT_LEAD_DAYS` (3).

### M17 · Order acceptance latency (cafeteria)
Order created → `approved` by the manager. Blocked by gap **G1**.
*Target:* ≤ 12h.

### M18 · Claim latency (cafeteria)
`approved` → `preparing`. How long an approved order sat unclaimed in the shared
pool. This is the metric that exposes an understaffed outlet, and it exists nowhere
else in the application.
*Target:* ≤ 4h.

### M19 · Delivery punctuality (cafeteria)
`delivered_at` against `request_fmb.serve_time` on `request_fmb."date"`. Reported as
on-time share plus median minutes early/late.
```sql
SELECT count(*) FILTER (WHERE s.delivered_at <= (f."date" + f.serve_time))::numeric
     / NULLIF(count(*) FILTER (WHERE s.delivered_at IS NOT NULL), 0)
  FROM request_fmb_selection s JOIN request_fmb f USING (request_fmb_id)
 WHERE s.unit_code = ANY(:outlets)
```
*Target:* ≥ 95%.

---

## Family C — Quality & rework (M20–M27)

### M20 · Send-back rate
Tasks that ever reached `resubmitted` ÷ tasks created. High means the intake form is
not asking for what the department needs — a form problem wearing an approval costume.
```sql
SELECT count(DISTINCT h.request_task_id)::numeric / NULLIF(count(DISTINCT t.request_task_id), 0)
  FROM request_task t
  LEFT JOIN workflow_history h
         ON h.request_task_id = t.request_task_id AND h.new_status = 'resubmitted'
 WHERE t.assigned_unit_code = :unit AND t.created_at >= :from
```
*Target:* ≤ 15%.

### M21 · Rework loops per proposal
Mean count of `resubmitted` transitions per proposal that had at least one. Two lanes
can share a 20% send-back rate while one resolves in a single loop and the other takes
four.

### M22 · Rejection rate
Reviewer stages only — `hos_hod_review`, `fmb_review`, `cfo_review`. Departments have
no `rejected` status, so this metric is undefined for the four non-F&B service HODs
and must not appear on their dashboards.

### M23 · Cancellation rate
`cancelled` ÷ submitted, with a split on whether cancellation landed before or after
department tasks were created — cancelling after fan-out wastes committed department work.

### M24 · Send-back comment depth
Share of send-backs whose `comment` is under 40 characters. The comment is the entire
message to the applicant; a one-word comment guarantees another loop. Quality proxy,
labelled as such on the widget.

### M25 · Order push-back rate (F&B ↔ cafeteria)
`request_fmb_selection` rows reaching `resubmitted` ÷ orders placed. Read from both
sides: for F&B it means "my orders get bounced"; for a Cafeteria Manager it means
"I bounce orders" — same number, opposite action, and the two dashboards label it
accordingly.

### M26 · First-pass yield
Tasks completed with zero `resubmitted` transitions ÷ tasks completed.
*Target:* ≥ 80%.

### M27 · Catalogue mismatch rate
Detail rows whose `option_id` is NULL (typed in rather than picked from the
catalogue), ÷ all detail rows for the unit. A rising rate means the option catalogue
has stopped covering what people actually ask for.

---

## Family D — Capacity & utilisation (M30–M39)

### M30 · Stock commitment ratio
Σ committed quantity on a date ÷ available quantity. Above 1.0 is an oversubscription
that will surface as a conflict later. Only defined where the catalogue carries a
capacity column.

```sql
-- logistics variant
SELECT l."date", o.label, sum(l.quantity) AS committed, o.available_quantity,
       sum(l.quantity)::numeric / NULLIF(o.available_quantity, 0) AS ratio
  FROM request_logistics l
  JOIN logistics_options o ON o.logistics_option_id = l.option_id
  JOIN request r ON r.request_id = l.request_id
 WHERE r.status NOT IN ('cancelled','completed_rejected','draft')
   AND l."date" BETWEEN CURRENT_DATE AND CURRENT_DATE + :horizon
 GROUP BY l."date", o.label, o.available_quantity
```

| Unit | Committed | Available |
|---|---|---|
| Logistics | `sum(request_logistics.quantity)` | `logistics_options.available_quantity` |
| Transport | `count(request_transportation)` rows | `transportation_options.available_vehicle_count` |
| F&B (water) | `sum(request_mineral_water.quantity)` | `water_normal_options.available_stock` |
| Student Services | `sum(request_campus_tour.pax)` | `campus_tour_start_options.max_group_size` |

*Target:* ≤ 0.85 (headroom for late requests).

### M31 · Concurrency load
Count of overlapping detail rows per unit per day, and the maximum simultaneous
overlap within the day. For A/V and Photography this **is** the capacity metric —
they have no stock, so two rigs at the same hour is the constraint.
```sql
SELECT s."date", count(*) AS rows_that_day,
       max(overlap) AS peak_simultaneous
  FROM (SELECT x."date", x.start_time,
               count(*) OVER (PARTITION BY x."date"
                              ORDER BY x.start_time
                              RANGE BETWEEN CURRENT ROW AND CURRENT ROW) AS overlap
          FROM request_sound_light x) s
 GROUP BY s."date"
```
*(The production query uses a proper interval-overlap self-join; the sketch above
shows the shape.)*

### M32 · Seat-fill efficiency — **Transport only**
`requested_pax ÷ passenger_capacity` of the chosen vehicle. Under ~50% means a
40-seater is moving twelve people, which is a cost and an availability problem at once.
*Target:* 0.6–0.95.

### M33 · Group-split requirement — **Student Services only**
`ceil(request_campus_tour.pax / campus_tour_start_options.max_group_size)` = guides
needed for that tour. Summed by date it gives guide demand, which is the actual
staffing question.

### M34 · Service-hour demand
`Σ (end_time − start_time)` over the unit's detail rows per day. Defined for A/V
(`request_sound_light`), Photography (`request_photography_videography`), and
Logistics (`request_logistics`). Undefined for Transport (a single `moving_time`,
no end), Student Services (times were dropped from the tour form), and F&B
(`serve_time` only) — those units use M31/M33 instead.

### M35 · Staff coverage ratio
M34 ÷ (active staff in unit × `STAFF_SHIFT_HOURS`). Above 1.0 on any day means the
day cannot be delivered by the current roster regardless of scheduling skill.
```sql
-- denominator
SELECT count(*) * (SELECT number FROM config WHERE code = 'STAFF_SHIFT_HOURS')
  FROM user_unit_roles
 WHERE unit_code = :unit AND role_code = 'staff' AND is_active
```
*Target:* ≤ 0.8.

### M36 · Peak-day concentration
Share of the period's demand falling on its three busiest days. High concentration
means the problem is scheduling, not headcount, and the recommended action differs.

### M37 · Catalogue utilisation
Active options selected at least once in the period ÷ active options. Low means the
catalogue carries dead weight that lengthens the applicant's form for nothing.

### M38 · Menu coverage — **F&B / cafeteria**
Distinct `dietary_information_options` represented among an outlet's active menu items,
against the full active list. A cafeteria with no vegetarian item cannot serve half of
the events routed to it, and nothing else in the app surfaces that.
Uses `fmb_option_dietary_information` (migration 006 — many-to-many).

### M39 · Outlet load balance — **F&B**
Distribution of orders across cafeterias, as a share plus a max/min spread. F&B
chooses which outlet fulfils each order, so a lopsided split is a decision, not weather.

---

## Family E — Demand & forecast (M40–M47)

### M40 · Forward demand curve
Committed demand per day for the next `FORECAST_HORIZON_DAYS`, from the unit's detail
table `"date"` column, filtered to non-terminal proposals. Not a forecast — this is
already-committed work, and it is the more useful of the two.

### M41 · Demand forecast (naive seasonal)
Trailing 8-week same-weekday mean × trend factor, plotted as a dashed continuation of
M40 with a shaded p10–p90 band.
```
forecast(d) = mean(demand on same weekday, last 8 weeks) × (1 + trend)
trend       = (mean of last 4 weeks − mean of prior 4 weeks) / mean of prior 4 weeks
```
Deliberately simple. It is explainable to a department head in one sentence, its error
is measurable against M40 as reality arrives, and it needs no library the project does
not already have. **It must be labelled "projected" and rendered dashed** — never
merged into the committed series.

**Honesty note.** The seed carries no proposals, so on day one M41 has no history and
must render an explicit "insufficient history — needs 8 weeks" empty state rather than
a flat line at zero. Every target in this catalog is an initial default to be
recalibrated after one full term of real data.

### M42 · Requirement mix
Share of proposals selecting each of the eight requirements, from
`application_requirements`. On a school dashboard this is the school's demand
fingerprint; on the CFO's it is the institutional one.

### M43 · Pipeline conversion
Proposals entering a stage ÷ proposals leaving it approved, per stage. The funnel.

### M44 · Approval throughput by school
Proposals decided per school per week (HOS scope, plus institutional aggregate under R7/R8).

### M45 · Event calendar density
Events per day from `event_schedule."date"` for approved proposals — the institutional
load curve every department's demand ultimately derives from.

### M46 · Registration conversion
`event_registration` rows ÷ `request.max_pax`, and `registered` ÷ all non-cancelled.
Demand signal for the school that ran the event.

### M47 · Lead-time distribution
`submitted_at` → earliest `event_schedule."date"`. How far ahead people plan. Falling
lead time is the leading indicator of every downstream SLA breach in Family B.

---

## Family F — Cost & finance (M50–M58)

### M50 · Committed food cost
```sql
SELECT sum(s.quantity * o.unit_price_rm)
  FROM request_fmb_selection s
  JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
  JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
  JOIN request r ON r.request_id = f.request_id
 WHERE s.status NOT IN ('cancelled') AND r.status NOT IN ('cancelled','completed_rejected')
```
Pair with **M58** — `unit_price_rm` is nullable, so a total without a coverage
percentage beside it is a total that quietly understates.

### M51 · Funding & purchase commitment
```sql
SELECT sum(quantity * unit_price_rm) FROM request_funding_purchase p
  JOIN request r USING (request_id)
 WHERE r.status NOT IN ('cancelled','completed_rejected','draft')
```
Recorded on every proposal, routed on none. The CFO's largest blind spot today and
the reason rule R7 exists.

### M52 · Budget category concentration
M51 grouped by `funding_main_options.budget_category_finance_code`, then by
`funding_sub_options.finance_procurement_code`. Two-level treemap on the CFO dashboard.

### M53 · Event revenue exposure
`Σ request.cost_amount × count(active registrations)` for paid events. Exposure, not
revenue — collection is M54.

### M54 · Collection rate
`payment_status = 'approved'` ÷ registrations where `payment_status <> 'not_required'`.
The gap between M53 and M54 × M53 is uncollected.

### M55 · Cost per pax
`(M50 + M51) ÷ Σ request.total_pax`, sliced by school and by event format. The single
most comparable efficiency figure the schema can produce, and the one a CFO can put in
front of a school head.

### M56 · Gate coverage
Share of proposals crossing `HIGH_PAX_THRESHOLD` and therefore reaching `fmb_review`
and `cfo_review`. If this is 4%, the CFO gate is reviewing 4% of events and R7's
aggregate scope is carrying the other 96% — which is precisely the argument for
retuning the threshold, and the CFO is the person who can request it.

### M57 · Forward commitment runway
M50 + M51 for approved proposals whose earliest `event_schedule."date"` is still in
the future, bucketed into the next four months. Money committed but not yet spent.

### M58 · Price coverage
Active `fmb_options` with a non-null `unit_price_rm` ÷ active options, per outlet.
Displayed beside every currency figure that depends on it.

---

## Family G — People & productivity (M60–M67)

Rule R10 governs this whole family: names inside the unit, shapes across units.

### M60 · Assignments per staff
`task_assignment` rows plus `request_row_assignment` rows per staff member in the
period. Row assignments are the real unit of work for the five row-assignable
requirements; counting only `task_assignment` undercounts them badly.

### M61 · Workload balance
Max/min spread and Gini coefficient of M60 across the unit's active staff. A head with
three staff at 12/11/1 has a management problem that an average of 8 conceals.

### M62 · Completion rate per staff
`request_row_assignment.status = 'completed'` ÷ assigned.

### M63 · Mean handling time per staff
`assigned_at → resolved_at` on that person's row assignments. Compared *within* the
unit only — cross-unit comparison is meaningless when one unit moves furniture and
another shoots photographs.

### M64 · Unassigned approved work
Tasks at `approved` with zero assignment rows, weighted by days until the event date.
The most actionable single number on any service HOD's dashboard.

### M65 · Claim share — **cafeteria**
Per-staff share of claimed orders. First-come-first-served claiming means an outlet can
have one person taking 80% of the pool while others idle; nothing else surfaces this.

### M66 · Staff churn — **cafeteria**
`cafeteria_staff_audit_log` actions per outlet per period, split by
`create / edit / suspend / restore / remove`.

### M67 · Staffing request cycle time — **cafeteria**
`cafeteria_staff_requests.created_at → resolved_at`. A manager cannot write
`user_unit_roles` directly, so this is how long they wait on Cafeteria Admin before
they can staff their outlet — a real operational constraint on M18 and M35.

---

## Family H — Risk & anomaly (M70–M78)

Every metric here is a **count of things to act on**, each drilling to a filtered list.

### M70 · At-risk tasks
Open tasks whose requirement date falls within `AT_RISK_WINDOW_DAYS` (7).

### M71 · Capacity breach forecast
Forward dates where M30 > 1.0, or M35 > 1.0. Names the date and the item, not the proposal.

### M72 · Stalled items
Open tasks older than 2 × the unit's median M10.

### M73 · Single-point-of-failure lanes
Requirement lanes with exactly one active `staff` assignment in the unit. On seeded
data, Photography has two staff and Transport has two — a single absence halves either.

### M74 · Cancellation-window exposure
Approved proposals now inside the `CANCELLATION_DEADLINE_DAYS` lock that still carry
open tasks. They can no longer be cancelled, so the work must be delivered.

### M75 · Unpriced ordered items
Orders whose `fmb_options.unit_price_rm IS NULL`. Each one silently understates M50.

### M76 · Stale catalogue entries
Active options with zero selections in 90 days, and inactive options with open
selections against them.

### M77 · Anomalous spike
Any daily series exceeding `mean + 2σ` of its trailing 8 weeks. Feeds AI-01.

### M78 · Stranded at gate
Proposals at `hos_hod_review` where no user satisfies `is_hos_hod_for_applicant()` —
the defect recorded in [01](01-role-hierarchy-and-access.md) § 2.3(b).
```sql
SELECT r.request_id FROM request r
 WHERE r.status = 'hos_hod_review'
   AND NOT EXISTS (
        SELECT 1 FROM user_unit_roles applicant_role
          JOIN user_unit_roles head ON head.unit_code = applicant_role.unit_code
         WHERE applicant_role.user_id = r.applicant_user_id
           AND head.role_code = 'head-of-school' AND head.is_active)
```

---

## Schema gaps

Six metrics need a column the schema does not have. Each is listed with the migration
that would close it. **None is faked in the meantime** — the widget renders a
documented partial state instead.

| # | Gap | Blocks | Proposed fix |
|---|---|---|---|
| **G1** | `request_fmb_selection` has no `created_at` / `approved_at` / `ready_at`. Only `delivered_at` exists (migration 013). | M08, M17, M18 exactly | Migration 018: add the three timestamps, backfill `created_at` from the F&B approval `workflow_history` row. Until then M17/M18 derive from history and are labelled "approximate". |
| **G2** | No staff availability or shift model. | M35, M73 precision | M35 uses headcount × `STAFF_SHIFT_HOURS` from config and states the assumption on the widget. A real roster table is out of scope. |
| **G3** | `sound_light_options` and `media_options` carry no capacity column (both dropped deliberately). | M30 for A/V and Photography | Not a defect — those departments allocate at review time. They use M31/M34/M35 instead, which is why their dashboards differ. |
| **G4** | `fmb_options.unit_price_rm` is nullable (migration 010). | M50, M55, M57 completeness | M58 reports coverage beside every dependent figure. Making it `NOT NULL` needs a data pass first. |
| **G5** | No `request.completed_at`. | M11 at proposal level | Derived from the last `workflow_history` row. Correct, just costlier; the index in § 8 of [03](03-dashboard-architecture.md) covers it. |
| **G6** | `request_row_assignment` has no `started_at` between `assigned` and `preparing`. | Splitting M63 into wait vs work | Deferred. M63 is reported as total handling time and labelled as such. |
