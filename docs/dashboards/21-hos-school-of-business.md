# Head of School — School of Business

`head-of-school` @ `school_of_business` · profile key `hos_school` ·
signature `cost_recovery`

> **What makes this dashboard different from the other school's.** Both Heads of School
> hold the same authority, the same gate, and the same clause-3-plus-clause-9
> visibility. The schema does not distinguish them — both are `unit` rows whose head
> holds `head-of-school`. So the difference is not invented, it is **computed**: the
> profile-score rule in [01](01-role-hierarchy-and-access.md) § 1 measures each school's
> service-intensity against its commercial-intensity and assigns the signature panel to
> whichever is higher.
>
> Business scores on **commercial intensity** — a higher share of proposals carrying
> `cost_amount > 0` or a `request_funding_purchase` row, and a higher external and
> industry-partner share in `general_guest`. So it receives the **Cost Recovery &
> Engagement** signature, a set of KPIs about money and audience, and a different
> benchmark peer. Computing's Service Dependency Map does not appear here at all.
>
> If Business's profile shifts, the panel shifts. The rule is evaluated per request, so
> the design does not have to be revisited when the data changes — and a third school
> added next year gets a signature panel without anyone writing one.

---

## 1. Dashboard objective

**Responsible for:** the `hos_hod_review` gate for every applicant belonging to
`school_of_business`, plus the school's event portfolio, its cost profile, and its
external engagement.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve, reject, or send back a proposal from their school | Daily | The proposal, its committed cost, and its runway |
| Whether an event's pricing covers its cost | Weekly | Cost recovery on that event, before it runs |
| Whether registration revenue is actually being collected | Weekly | Collection rate and the unpaid tail |
| Where the school's spend concentrates | Monthly | Committed cost by finance category |
| Whether external engagement is growing | Monthly | Guest mix and industry-partner counts |
| Whether the school's cost per head is defensible | Termly | Cost per pax against the institution |

**Uniquely can:** reject. `hos_hod_review` is a `REVIEWER_STAGE`.

**Daily** — the gate queue; any event about to run with an unresolved payment tail.
**Weekly** — cost recovery per upcoming event, collection rate.
**Monthly** — spend by category, guest mix, cost per pax trend.
**Strategic** — whether the school's events are self-funding or subsidised, and whether
external engagement is growing fast enough to justify the subsidy. Those are the two
questions a business school head is asked, and neither is answerable anywhere else in
this application.

---

## 2. Data access scope

Identical in *shape* to the other school, different in *emphasis*. Same clauses, same
rules; the financial `◐` cells carry more weight here because the signature panel uses
them.

**Visible**

- Proposals at `hos_hod_review` from `school_of_business` applicants — clause 3.
- Every proposal they decided, for its full life — clause 9.
- Own proposals — clauses 1 and 2.
- **School-level financial aggregates** under R7 and R9: `cost_amount` sums,
  `request_funding_purchase` totals by category, committed food cost, cost per pax.
- Registration counts and `payment_status` distributions on the school's events.
- `general_guest` counts by type and `important_people` counts by type.
- The `school_of_business` roster.

**Restricted**

- **`bank_account_name` and `bank_account_number` — never.** R9 is absolute. A cost
  recovery panel needs amounts, not payout destinations, and no widget here reads
  those columns.
- **Per-registrant payment detail — never.** Collection rate is a distribution over
  `payment_status`; `registrant_name`, `registrant_email` and `payment_proof_url` are
  organiser-only, per `backend/docs/security.md`. The school head sees "7 unpaid", not
  who.
- Other schools' proposals at row level — `◐` aggregate, k ≥ 5.
- Department internals — the same boundary as Computing: outcomes, not operations.
- Cafeteria operations entirely. The school sees the **cost** of food ordered for its
  events; which outlet cooked it and how fast is F&B's and the manager's business.

**Cross-school:** the institutional mean and the one named peer, aggregate and
suppressed under k ≥ 5.

---

## 3. KPIs

### Hero · Cost per pax

| | |
|---|---|
| **Definition** | Total committed cost across the school's non-terminal and approved proposals, divided by the total attendance those proposals carry |
| **Formula** | `(M50 + M51) ÷ Σ request.total_pax`, scoped to the school's applicants — M55 |
| **Source** | `request_fmb_selection × fmb_options.unit_price_rm`, `request_funding_purchase.quantity × unit_price_rm`, `request.total_pax` |
| **Why it matters** | The only comparable efficiency figure the schema can produce, and the one a CFO will quote back. Always defined, unlike a recovery ratio on a term with no paid events |
| **Target** | Institutional median, shown beside it. Amber above +25%, critical above +50% |
| **Caveat on the tile** | *"Food component based on N% of items priced"* — M58, gap **G4**. The caveat travels with the number, not in a footnote |
| **Drill** | Panel B |

### KPI 1 · Cost recovery
Registration revenue collected ÷ committed cost, **paid events only**
(`cost_amount > 0`). Renders "no paid events this period" rather than 0% when the
denominator is empty — a zero here would be read as failure when it means absence.
**Why:** the school's own commercial signature. **Target:** ≥ 60% on paid events.
**Drill:** Panel A.

### KPI 2 · Collection rate
M54 — `payment_status='approved'` ÷ registrations requiring payment, with the unpaid
count beside it. **Why:** the gap between an event that sold and an event that was
paid for. The count is the actionable half; the rate is the trend.
**Target:** ≥ 90%. **Drill:** `/app/history/proposals?payment=unpaid&school=mine`.

### KPI 3 · Gate latency (median · p90)
M14 for `hos_hod_review`, this school only, shown as a share of end-to-end time.
**Why:** the one segment this head owns. **Target:** ≤ 48h.
**Drill:** `/app/inbox/proposals?stage=hos-hod-review`.

### KPI 4 · Commercial intensity
Share of the school's proposals carrying `cost_amount > 0` **or** a
`request_funding_purchase` row, with the peer school's figure beside it.
**Why:** the input to the profile-score rule that selected this dashboard, shown
openly so the head can see why their dashboard looks as it does.
**Target:** informational — a trend. **Drill:** Panel D.

### KPI 5 · External engagement
Share of expected attendance from `External Guests`, `Industry Partners` and `Alumni`
in `general_guest`, with the count of `important_people` of type `Partner` and
`Speaker`. **Why:** the justification for a subsidised event. A school running
internal-only events at a high cost per pax has a different case to make than one
bringing two hundred industry guests onto campus. **Target:** informational.
**Drill:** Panel C.

---

## 4. Analytics & visualisation

### Panel A — Cost Recovery Funnel · *signature*

| | |
|---|---|
| **Type** | `funnel`, five stages, with an explicit net position beneath |
| **Stages** | Committed cost → Capacity (`max_pax`) → Registered → Payment required → Payment approved |
| **Value** | Ringgit at the ends, headcount in the middle, with the conversion percentage on each step |
| **Source** | `request.cost_amount/max_pax`, `event_registration.status/payment_status`, M50, M51 |
| **Encoding** | Ordinal blue ramp starting no lighter than step 250. Net position rendered with the **diverging** pair — blue for recovered above cost, red below, neutral grey at break-even — because it is the one figure on this dashboard with a sign |
| **Filters** | Period, paid-events-only, event category, format |
| **Purpose** | Show the whole commercial path in one object, and where it leaks. A school losing money at "payment approved" has a collections problem; one losing it at "registered" has a pricing or marketing problem. The stage names the fix |
| **Actions** | Hover → counts, ringgit, conversion. Click a stage → the school's events at that stage |
| **Drill** | Stage → `/app/history/proposals?school=mine&stage=<funnel-stage>` |

A funnel and not a waterfall: the reader's question is conversion between stages, not
additive contributions to a total.

### Panel B — Committed cost by finance category
Horizontal `stacked-bar`, one bar per month, segments = `funding_main_options.budget_category_finance_code`
(M52), with food cost as a distinct final segment. Categories beyond three fold to
"Other" per the all-pairs cap; `meta` records how many folded. Each bar annotated with
its M58 price coverage.
Segment → `/app/history/proposals?school=mine&fundingCategory=<code>&month=<m>`.

### Panel C — External engagement mix
`stacked-bar` by month over four collapsed guest bands, **not** the raw seven
`general_guest.guest_type` values — seven classes carrying meaning is past the point
where adjacent bands blur, so they collapse to:

| Band | `guest_type` values |
|---|---|
| Internal | Students, APU Staff |
| External | External Guests, Industry Partners, Alumni |
| Family | Parents-Guardians |
| Other | Others |

with the full seven-way split available in the table view, where a table does the job
colour cannot. A small `bar-chart` beside it counts `important_people` by its four
types.
Segment → `/app/history/proposals?school=mine&guestBand=<b>&month=<m>`.

### Panel D — Cost per pax against the peer school
`line-chart`, three series on one axis: this school, the peer school, institutional
mean. All three are ringgit per head, so one axis is correct. Buckets under k = 5
suppressed.
Point → this school's series only; the peer and institutional series are
aggregate-only and carry no drill (R7).

### Panel E — Stage waterfall
Horizontal `stacked-bar` per month: gate · F&B · CFO · department review ·
resubmission wait. Present on both school dashboards deliberately — it is the one
panel that should be identical, so two heads comparing notes are comparing the same
thing.
Segment → `/app/history/proposals?stage=<s>&month=<m>`.

### Panel F — Applicant activity
`dot-plot`, one dot per applicant in the school, x = proposals submitted, hover =
send-back rate and mean committed cost. Names shown — own school, R10. The cost hover
is the difference from Computing's version of this panel: here the interesting
organiser is the expensive one, not the frequent one.
Dot → `/app/history/proposals?applicant=<user_id>`.

### Panel G — Forward financial commitment
`area-chart`, M57 for the school — committed cost by month for approved events not yet
run. What the school has already spent on paper.
Point → `/app/ongoing/proposals?month=<m>`.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-35** `RECOVERY_SHORTFALL` | A future paid event's projected recovery is under 40% | serious | Names the event, its cost, its price, and the break-even registration count |
| **AI-36** `COLLECTION_TAIL` | Unpaid registrations remain within 7 days of an event | serious | Names the event and the count — never the registrants (R9) |
| **AI-04** `COST_SPIKE` | School committed cost rises > 40% month on month | warning | Names the category and the proposals driving it |
| **AI-33** `PEER_DIVERGENCE` | Cost per pax exceeds the peer's by > 50% for 2 months | warning | Names the category carrying the difference; suppressed under k = 5 |
| **AI-23** `UNPRICED_EXPOSURE` | M58 coverage < 80% on the school's food orders | warning | The hero is understating; the card says by roughly how much |
| **AI-37** `ENGAGEMENT_DECLINE` | External band share falls 3 months running | warning | Weakens the subsidy case; shows which band shrank |
| **AI-20** `GATE_BOTTLENECK` | This school's gate is the slowest stage | serious | The delay is here |
| **AI-26** `REJECTION_DRIFT` | M22 rises while intake is flat | warning | Quality or bar — the data cannot say which |
| **AI-16** `DELIVERY_BACKLOG` | A school event has passed with open department tasks | serious | Names the proposal and the open lanes |
| **AI-31** `STRANDED_AT_GATE` | M78 matches an applicant in this school | critical | Should be impossible for a school — if it fires, the head role is unassigned or suspended |

---

## 6. Layout

```
┌ SCHOOL OF BUSINESS · Portfolio + Commercial ─ [profile ▾] ⟳ 09:14 ┐
├ [30d][90d][Term][YTD]  [ category ▾ ] [ format ▾ ] [ paid only ☐ ]│
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Recovery ┐┌Collection┐┌ Gate     ┐┌ External │
│ │ Cost per pax   │ │   64%    ││   87%    ││ 0.9d/2d  ││   38%    │
│ │   RM 18.40     │ │ ✓ ≥60%   ││ 7 unpaid ││ = 9% of  ││ of pax   │
│ │ inst RM 14.10  │ │ paid evts││ ⚠ ≥90%   ││  total   ││ ▁▂▄▅▆    │
│ │ 84% priced     │ │          ││          ││          ││          │
├───────────────────────────────────────────────────────────────────┤
│ ┌── COST RECOVERY FUNNEL ───────────────────────────────────────┐ │
│ │  Committed cost   ██████████████████████  RM 12,400           │ │
│ │  Capacity         ████████████████████     640 seats          │ │
│ │  Registered       ██████████████           412   64%          │ │
│ │  Payment required ████████████             389   94%          │ │
│ │  Payment approved ██████████               338   87%          │ │
│ │  ── Net position ───────────────────────  −RM 4,460  ▮ under  │ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Cost by category (6) ──────┐ ┌── Engagement mix (6) ────────┐ │
│ ┌── Cost/pax vs peer (4) ┐ ┌ Stage waterfall (4) ┐ ┌Applicants(4)│
│ ┌── Forward financial commitment (12) ─────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── Needs attention (4) ───┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Gate queue · 2] [Unpaid · 7] [School events] [New proposal]      │
└───────────────────────────────────────────────────────────────────┘
```

Set this beside [20-hos-school-of-computing.md](20-hos-school-of-computing.md) § 6:
same skeleton, different hero, different KPI row, different signature panel, different
alerts, different quick actions. Two Heads of School, two dashboards.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | Panel B | — | In-page: where the cost is |
| Recovery KPI | Panel A | — | In-page |
| Collection KPI | `/app/history/proposals` | `payment=unpaid`, `school=mine` | Events with an unpaid tail — counts only |
| Gate KPI | `/app/inbox/proposals` | `stage=hos-hod-review` | Decide what is waiting |
| Commercial intensity | Panel D | — | In-page |
| External KPI | Panel C | — | In-page |
| Panel A stage | `/app/history/proposals` | `school=mine`, `stage=<funnel-stage>` | The events at that stage |
| Panel B segment | `/app/history/proposals` | `fundingCategory`, `month` | — |
| Panel C segment | `/app/history/proposals` | `guestBand`, `month` | — |
| Panel D point | this school's series only | `month` | Peer and institutional carry no drill (R7) |
| Panel E segment | `/app/history/proposals` | `stage`, `month` | — |
| Panel F dot | `/app/history/proposals` | `applicant` | One organiser's record |
| Panel G point | `/app/ongoing/proposals` | `month` | — |

New parameters beyond Computing's set: `payment`, `fundingCategory`, `guestBand`,
`category`, `format`. See
[60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
