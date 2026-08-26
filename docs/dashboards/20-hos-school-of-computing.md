# Head of School — School of Computing

`head-of-school` @ `school_of_computing` · profile key `hos_school` ·
signature `technical_dependency`

> **What makes this dashboard different.** A Head of School owns no service lane and
> no inventory. They own a **gate** and a **portfolio**: they can end any proposal from
> their own people at `hos_hod_review`, and after they act, clause 9 of `_VISIBLE_SQL`
> keeps that proposal visible for its whole life. So a Head of School is the only role
> that watches a proposal travel the entire machine — through F&B, the CFO, and every
> department — while being able to change nothing downstream.
>
> That makes their dashboard a **latency and dependency** instrument, not an operations
> board. The question is not "what is in my queue" — it is "why do my school's events
> take eleven days, and which of the six departments is that eleven days actually in".
>
> Computing receives the **Technical Service Dependency** signature panel by the
> profile-score rule in [01](01-role-hierarchy-and-access.md) § 1: its proposals select
> more requirements per proposal, weighted toward `soundLight`, `photoVideo` and
> `logistics`, than they carry commercial markers. If that balance shifts, the panel
> shifts with it — the rule is evaluated at request time, not hardcoded.

---

## 1. Dashboard objective

**Responsible for:** the `hos_hod_review` gate for every applicant belonging to
`school_of_computing` — students, lecturers and staff of the school — plus the school's
overall event portfolio and its standing against the institution.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve, reject, or send back a proposal from their school | Daily | The proposal, its service footprint, and its runway |
| Whether to intervene on a stalled proposal | Weekly | Where in the machine it is stuck, and for how long |
| Which department is costing the school the most time | Monthly | Cycle-time attribution by department |
| Whether the school is over-committing to service-heavy events | Monthly | Requirements per proposal, and the trend |
| Where the school stands against the other school | Termly | Peer comparison under R7/R8 |
| Whether to coach specific applicants | Termly | Send-back rate by applicant, own school only |

**Uniquely can:** reject. `hos_hod_review` is a `REVIEWER_STAGE`.

**Daily** — the gate queue and its age; anything from the school now stalled downstream.
**Weekly** — end-to-end time and where it is spent; send-backs their people received.
**Monthly** — service dependency, requirement mix, applicant distribution.
**Strategic** — is the school's slow cycle caused by *what it asks for* or by *who it
waits on*? Requirements-per-proposal against per-department dwell separates them, and
they lead to opposite conversations — one with the school's own organisers, one with
another department head.

---

## 2. Data access scope

**Visible**

- Proposals at `hos_hod_review` from applicants in `school_of_computing` — clause 3.
- Every proposal they have decided, for its full remaining life — clause 9. In
  practice this is the school's whole portfolio, because a unit has at most one head
  and every non-skipped proposal from the school passes through them.
- Their own proposals as applicant or co-owner — clauses 1 and 2.
- Stage timings, department task states and outcomes on those proposals.
- Registration **counts** and status distributions on their school's events.
- The `school_of_computing` roster.

**Restricted**

- Other schools' proposals at row level. `◐` aggregate only, under R7 and the k ≥ 5
  floor of R8.
- Department **internals**. A Head of School sees that the A/V task took five days;
  they do not see A/V's roster, its assignments, or its catalogue. Dwell time is an
  outcome the school experiences; how A/V produced it is A/V's business.
- Financial detail. `cost_amount` and funding totals reach this role only as
  school-level sums and per-pax ratios (R9). `bank_account_*` never.
- Attendee identity — counts and payment-status distributions only.
- Cafeteria operations entirely.

**Cross-department:** read-only, aggregate, and only as *time attributed to the
school's own proposals*. There is no panel here showing a department's absolute
workload.

**Cross-school:** exactly two comparators — the institutional mean, and the one named
peer school. Both aggregate, both k ≥ 5 suppressed. Naming the peer is deliberate:
with two schools an "other schools" label is a fig leaf, and a comparison that
pretends to anonymity while identifying one institution is worse than an honest one.

---

## 3. KPIs

### Hero · End-to-end approval time

| | |
|---|---|
| **Definition** | Median days from a school proposal being submitted to reaching `completed_approved` |
| **Formula** | `median(last workflow_history.created_at where new_status='completed_approved' − request.submitted_at)`, scoped to applicants in the school |
| **Source** | `request.submitted_at`, `workflow_history` (gap **G5** — no `request.completed_at`) |
| **Why it matters** | The number the school's organisers actually experience and the one they complain about. Every other figure on the page exists to explain it |
| **Target** | ≤ 10 days, with the institutional median shown beside it as context, not as a target |
| **Drill** | Panel A |

### KPI 1 · Gate latency (median · p90)
M14 for `hos_hod_review`, this school only. **Why:** the one segment of the hero this
head personally owns. Displayed as a share of the hero, so a 1.2-day gate inside an
11-day total reads honestly rather than looking like the problem.
**Target:** ≤ 48h. **Drill:** `/app/inbox/proposals?stage=hos-hod-review`.

### KPI 2 · Approval outcome mix
Approved / rejected / sent back at this gate, as shares (M22, M20). **Why:** a gate
that approves everything is not a gate; a gate that sends back half is a form problem
upstream. **Target:** send-back ≤ 20%. **Drill:** `/app/history/proposals?stage=hos-hod-review`.

### KPI 3 · Service footprint
Mean requirements per proposal (M42), with the peer school's figure beside it under
R7/R8. **Why:** the school's own driver of downstream latency, and the only one it
controls directly. Computing's signature metric. **Target:** informational — a
trend, not a limit. **Drill:** Panel B.

### KPI 4 · Downstream stall rate
Share of the school's live proposals sitting in one status beyond 2× the institutional
median for that status (M72 applied at proposal level). **Why:** the head cannot act
on another department's queue, but they can escalate — and they need to know which
proposals warrant it. **Target:** ≤ 5%. **Drill:** `/app/ongoing/proposals?stalled=true`.

### KPI 5 · Forward pipeline
Approved proposals with a future `event_schedule."date"`, and the pax they carry.
**Why:** what the school has committed to deliver, distinct from what it has submitted.
**Target:** informational. **Drill:** `/app/ongoing/proposals?horizon=60`.

---

## 4. Analytics & visualisation

### Panel A — Service Dependency Map · *signature*

| | |
|---|---|
| **Type** | Horizontal `stacked-bar`, one bar per requirement, segment = median dwell contributed to the school's proposals; plus a **share** column showing how often the school selects it |
| **Source** | `application_requirements`, `request_task.created_at/resolved_at`, `workflow_history`, scoped to the school's proposals |
| **Encoding** | Ordinal blue ramp by dwell. Departments exceeding the institutional median for that requirement take a `warning` icon **and** label. Requirements the school never selects are listed greyed beneath, not hidden |
| **Filters** | Period, requirement, approved-only |
| **Purpose** | Turn "our events are slow" into "we select A/V on 62% of proposals and A/V contributes 4.1 of our 11 days". That sentence is the whole point of this dashboard |
| **Actions** | Hover → selection share, median dwell, p90, sample size. Click → the school's proposals carrying that requirement |
| **Drill** | Bar → `/app/history/proposals?requirement=<name>&school=mine` |

Under R7 this panel crosses a boundary: it reports on department task timings for
proposals the school owns. That is legitimate — the rows are the school's own
proposals, and the aggregate carries no department-internal identifier. The k ≥ 5
floor still applies per requirement, and suppressed requirements render `—`.

### Panel B — Requirement mix against the peer school
Grouped `bar-chart`, eight requirements, two series: this school and the peer. Two
slots, legend present, direct-labelled. Buckets under k = 5 suppressed with the
footnote count in `meta.suppressedBuckets`.
Bar → `/app/history/proposals?requirement=<name>&school=mine`.

### Panel C — Stage waterfall
Horizontal `stacked-bar`, one bar per month: gate · F&B · CFO · department review ·
resubmission wait, summing to the hero. Shows the hero decomposing over time, so a
worsening total can be attributed to a stage rather than argued about.
Segment → `/app/history/proposals?stage=<s>&month=<m>`.

### Panel D — Applicant activity
`dot-plot`, one dot per applicant in the school with at least one proposal, x =
proposals submitted, colour-free, with send-back rate as the hover. Names shown — own
school, R10. Identifies both the organisers carrying the school and the ones who need
help with the form.
Dot → `/app/history/proposals?applicant=<user_id>`.

### Panel E — Event outcome
`line-chart`, two series on one axis: registrations and `max_pax` capacity across the
school's approved events over time (M46). Divergence is the school's real demand
signal — events filling to capacity argue for more or larger events; events at 20% fill
argue for fewer.
Point → `/app/history/proposals` at that event.

### Panel F — Rework profile
`column-chart` of send-backs received per month, with the mean loop count (M21) as a
separate small tile. Send-back **comments** are shown in the hover, truncated — they
are the actual coaching material and the only place the school learns what it keeps
getting wrong.
Column → `/app/history/proposals?outcome=resubmitted&month=<m>`.

### Panel G — Forward commitment
`area-chart` of the school's approved events per week over the forward horizon, with
pax as the hover. What the school has promised to run.
Point → `/app/ongoing/proposals?week=<w>`.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-32** `DEPENDENCY_DRAG` | One requirement contributes > 40% of the school's median cycle time | serious | Names it, its dwell, and the institutional comparison — the escalation case, pre-written |
| **AI-33** `PEER_DIVERGENCE` | This school's hero exceeds the peer's by > 50% for 2 months | warning | Names the stage carrying the difference; suppressed if either side is under k = 5 |
| **AI-20** `GATE_BOTTLENECK` | This school's own gate is the slowest stage | serious | The delay is here, not downstream — stated plainly |
| **AI-34** `SCOPE_INFLATION` | Requirements per proposal rises 3 months running | warning | The school is choosing its own latency; shows which requirement is being added |
| **AI-26** `REJECTION_DRIFT` | M22 rises while intake is flat | warning | Quality fell or the bar moved; the data cannot say which and the card says so |
| **AI-16** `DELIVERY_BACKLOG` | A school event has passed with open department tasks | serious | Names the proposal and the open lanes |
| **AI-11** `RUNWAY_COLLAPSE` | M47 lead time falls below the institutional median | serious | The school submits late; this is the school's own fix |
| **AI-05** `SLA_DRIFT` | Gate latency rises 3 weeks running | warning | Names the weekday it concentrates on |
| **AI-31** `STRANDED_AT_GATE` | M78 matches an applicant in this school | critical | Should be impossible for a school (a school has a head) — if it fires, the head role is unassigned or suspended |

---

## 6. Layout

```
┌ SCHOOL OF COMPUTING · Portfolio ─────────── [profile ▾]  ⟳ 09:14 ─┐
├ [30d][90d][Term][YTD]   [ requirement ▾ ] [ approved only ☐ ]     │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Gate     ┐┌ Outcomes ┐┌ Service  ┐┌ Stalled  │
│ │ End-to-end     │ │ 1.2d/3d  ││ 71/12/17 ││ footprint││   2      │
│ │   11.4 days    │ │ = 11% of ││ appr/rej ││   3.1    ││ proposals│
│ │ inst. 8.6 ⚠    │ │  total   ││ /back  % ││ peer 1.8 ││ ⚠        │
├───────────────────────────────────────────────────────────────────┤
│ ┌── SERVICE DEPENDENCY MAP ─────────────────────────────────────┐ │
│ │ requirement     selected   median dwell contributed            │ │
│ │ Sound & Light      62%     ████████████ 4.1d ⚠ inst 2.4d      │ │
│ │ Logistics          58%     ███████ 2.6d                        │ │
│ │ Photo / Video      44%     █████ 1.9d                          │ │
│ │ F&B                31%     ████ 1.5d                           │ │
│ │ Transport          12%     ██ 0.6d                             │ │
│ │ Campus Tour         —      (never selected)                    │ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Mix vs peer school (6) ────┐ ┌── Stage waterfall (6) ───────┐ │
│ ┌── Applicant activity (4) ┐ ┌ Event outcome (4) ┐ ┌ Rework (4)┐ │
│ ┌── Forward commitment (12) ───────────────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── Needs escalation (4) ──┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Gate queue · 3] [Stalled · 2] [School events] [New proposal]     │
└───────────────────────────────────────────────────────────────────┘
```

The alerts rail here is titled **Needs escalation**, not "At risk" — a Head of School
cannot fix a department queue, and the action available to them is a conversation.
The rail's contents and its verbs reflect that.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | Panel A | — | In-page: where the days are |
| Gate KPI | `/app/inbox/proposals` | `stage=hos-hod-review` | Decide what is waiting |
| Outcomes KPI | `/app/history/proposals` | `stage=hos-hod-review` | Review past decisions |
| Service footprint | Panel B | — | In-page |
| Stalled KPI | `/app/ongoing/proposals` | `stalled=true`, `sort=schedule` | Escalation list |
| Pipeline KPI | `/app/ongoing/proposals` | `horizon=60` | What is committed |
| Panel A bar | `/app/history/proposals` | `requirement`, `school=mine` | Proposals carrying it |
| Panel B bar | `/app/history/proposals` | `requirement`, `school=mine` | Peer side is aggregate-only — no drill (R7) |
| Panel C segment | `/app/history/proposals` | `stage`, `month` | — |
| Panel D dot | `/app/history/proposals` | `applicant` | One organiser's record |
| Panel E point | `/app/history/proposals` | at that event | — |
| Panel F column | `/app/history/proposals` | `outcome=resubmitted`, `month` | Read the comments |
| Panel G point | `/app/ongoing/proposals` | `week` | — |

**The peer series has no drill-down.** Clicking it does nothing and the cursor does not
change — R7 permits the aggregate and R3 forbids the rows, so offering a link that
lands on an empty list would be worse than offering none.

New parameters: `stage`, `requirement`, `school`, `stalled`, `horizon`, `applicant`,
`outcome`, `month`, `week`. `/app/inbox/proposals` and `/app/history/proposals`
currently read only `bucket`. See
[60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
