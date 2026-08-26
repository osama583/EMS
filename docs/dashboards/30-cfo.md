# CFO — Executive Dashboard

`cfo` (flat role, `unit_code IS NULL`) · profile key `cfo`

> **What makes this dashboard different, and the problem it has to solve first.** The
> CFO is the only Tier 0 role with a business dashboard: no unit, no lane, no queue of
> their own beyond one gate. But that gate is narrow. `cfo_review` is reached only when
> `total_pax > HIGH_PAX_THRESHOLD` (default 50), and clause 5 of `_VISIBLE_SQL` matches
> only while a proposal sits there. Clause 6's `assigned_role = 'cfo'` branch is **dead
> code** — `fundingPurchase` is in `NON_WORKFLOW_REQUIREMENTS` and never routed, so no
> CFO task is ever created.
>
> Meanwhile `request_funding_purchase` rows are recorded on **every** proposal.
> Built strictly on row visibility, a CFO dashboard would report on the minority of
> events that cross the pax threshold and be silent about the rest — the person who
> owns the money, blind to most of it.
>
> Rule **R7** is the answer: institution-wide **aggregates**, row detail only where
> `_VISIBLE_SQL` already allows, bucket floor k ≥ 5, and every widget stating the size
> of the subset it can drill into. This dashboard is the reason that rule exists, and
> its signature panel exists to measure the gap itself.

---

## 1. Dashboard objective

**Responsible for:** the `cfo_review` gate; the Funding Main Items and Funding
Sub-items catalogues and their finance codes; and institutional oversight of committed
event spend.

**Decisions this role makes**

| Decision | Cadence | What it needs |
|---|---|---|
| Approve, reject, or send back at `cfo_review` | Daily | The proposal's cost, its category, and comparable events |
| Whether an event's spend is proportionate | Daily | Cost per pax against the institutional distribution |
| Whether registration revenue is being collected | Weekly | Collection rate and the uncollected amount |
| Where committed spend concentrates | Monthly | Finance-code breakdown and month-on-month movement |
| Whether forward commitment is affordable | Monthly | Approved-but-not-run runway by month |
| **Whether `HIGH_PAX_THRESHOLD` is set correctly** | Termly | How much spend passes below the gate |
| Whether the finance code catalogue is fit for purpose | Termly | Off-catalogue rate, dead codes |

The threshold question is the strategic decision only this role can raise. `config` is
admin-editable and read live, so a retune takes effect without a deploy — but nobody
can argue for one without knowing what the current setting misses. That is what Panel A
measures.

**Uniquely can:** reject at `cfo_review`. One of three roles that can end a proposal.

**Daily** — the gate queue; events about to run with an unpaid tail.
**Weekly** — collection, spend movement.
**Monthly** — category concentration, forward runway, cost per pax by school.
**Strategic** — gate coverage, threshold calibration, price-data quality.

---

## 2. Data access scope

**Visible at row level** — `_VISIBLE_SQL` only, unchanged:

- Proposals currently at `cfo_review` (clause 5).
- Every proposal the CFO has ever decided (clause 9) — durable, so the gate's history
  accumulates into a real portfolio over a term.
- Their own proposals as applicant or co-owner.
- `funding_main_options` and `funding_sub_options` in full, including
  `budget_category_finance_code` and `finance_procurement_code`.

**Visible as aggregate only** — R7, with k ≥ 5 (R8):

- Committed food cost (M50) and funding commitment (M51) across the institution.
- Cost per pax (M55) by school, by event format, by category.
- Revenue exposure (M53) and collection rate (M54).
- Spend by finance code (M52).
- Forward commitment runway (M57).
- Gate coverage (M56) and the pax × cost distribution.
- Price coverage (M58).

**Restricted, absolutely**

- **`bank_account_name` and `bank_account_number`.** R9. These are payout
  destinations. No widget on this dashboard reads either column, including on
  proposals the CFO *can* open at row level — the projection excludes them.
- **Registrant identity and payment proofs.** Collection is a distribution over
  `payment_status`. `registrant_name`, `registrant_email` and `payment_proof_url` are
  organiser-only.
- **Department internals.** No rosters, no assignments, no catalogues outside funding.
  The CFO sees what things cost, not who carried them.
- **Cafeteria operations.** Food *cost* is in scope; claim latency, staff and audit
  logs are not.
- **Any aggregate resolving to fewer than five rows** — rendered `—`.

**Every widget states its drillable subset.** A panel showing RM 128,400 of committed
spend across 212 proposals, of which the CFO can open 31, says so on its face. Hiding
that gap would make the aggregate feel like row access it is not.

---

## 3. KPIs

### Hero · Forward committed spend, next 90 days

| | |
|---|---|
| **Definition** | Money committed to approved events that have not yet happened |
| **Formula** | M57 — `(M50 + M51)` for proposals at `completed_approved` whose earliest `event_schedule."date"` is in the future, bucketed by month |
| **Source** | `request_funding_purchase`, `request_fmb_selection × fmb_options.unit_price_rm`, `event_schedule` |
| **Why it matters** | Approved spend is already a commitment; the proposal cannot be cancelled inside `CANCELLATION_DEADLINE_DAYS`. This is the number that has to be affordable, and it is knowable months ahead |
| **Target** | Informational. Alerts on month-on-month movement above 40% (AI-04) |
| **Caveat on the tile** | *"Food component based on N% of items priced"* — M58, gap **G4** |
| **Drill** | Panel C |

### KPI 1 · Gate coverage
M56 — share of proposals reaching `cfo_review`, **and** the share of committed spend
those proposals carry. Two numbers on one tile, deliberately: *"4% of proposals · 31%
of spend"*. **Why:** the single most decision-relevant figure on the page. If the gate
sees 4% of events and 31% of the money, the threshold is roughly doing its job; if it
sees 4% and 9%, it is not. **Target:** spend coverage ≥ 60%.
**Drill:** Panel A.

### KPI 2 · Cost per pax — institutional
M55, with the inter-school spread as its subtitle. **Why:** the comparable efficiency
figure, and the basis of every conversation with a Head of School. **Target:**
informational; alerts on a school exceeding the median by 50% (AI-33).
**Drill:** Panel D.

### KPI 3 · Collection
M54 with the uncollected amount in ringgit. **Why:** revenue that was earned and not
received. The amount is what makes it a finance issue rather than an administrative
one. **Target:** ≥ 90%. **Drill:** Panel E.

### KPI 4 · Gate queue & latency
Proposals waiting at `cfo_review`, with M14 dwell for that status. **Why:** the CFO is
the last gate before department fan-out; dwell here delays every department behind it.
**Target:** ≤ 48h. **Drill:** `/app/inbox/proposals?stage=cfo-review`.

### KPI 5 · Price coverage
M58 across all active menus, plus the count of unpriced items with live orders (M75).
**Why:** a data-quality tile promoted to KPI status because every currency figure on
this page depends on it. A CFO reading RM 128,400 needs to know whether that is 95% of
the truth or 60%. **Target:** ≥ 95%.
**Drill:** `/app/cafeterias/menu-oversight?unpriced=true`.

---

## 4. Analytics & visualisation

### Panel A — Gate Coverage Matrix · *signature*

| | |
|---|---|
| **Type** | `heatmap` — pax bands (x) × committed-cost bands (y), cell = proposal count |
| **Annotation** | A solid vertical rule at the live `HIGH_PAX_THRESHOLD` value, read from `config` at query time |
| **Source** | `request.total_pax`, M50 + M51 per proposal, all proposals in period — R7 aggregate |
| **Encoding** | Sequential blue by count. Cells **left of the rule and in the top two cost bands** — spend the gate never sees — carry a `serious` ring **and** a glyph. Cells under k = 5 render `—` |
| **Filters** | Period, school, event format, category |
| **Purpose** | Quantify what the current threshold misses, in the only terms that matter: how many proposals, carrying how much money, pass below the gate. This is the evidence for or against retuning `HIGH_PAX_THRESHOLD`, and it does not exist anywhere else |
| **Actions** | Hover → count, total committed cost, mean cost per pax, **and how many of those the CFO can open**. Drag the threshold rule → a live preview of coverage at a hypothetical value, computed server-side, changing nothing |
| **Drill** | Cell → `/app/history/proposals?paxBand=<b>&costBand=<c>` — re-filtered by `_VISIBLE_SQL` (R3), landing on the subset the CFO may read, with the count difference stated |

The draggable threshold preview is the panel's real value. A CFO can see that moving
the threshold from 50 to 35 would bring 41% of spend under the gate instead of 31%, and
add roughly six proposals a month to their queue — both sides of the trade, before
asking an administrator to change anything.

### Panel B — Committed spend by finance category
Horizontal `stacked-bar`, one bar per month, segments = `budget_category_finance_code`
(M52), with food cost as a distinct final segment. Beyond three categories the tail
folds to "Other" (all-pairs cap) and `meta` records the count. A second level by
`finance_procurement_code` is available in the table view, where a table carries what
colour cannot.
Segment → `/app/history/proposals?fundingCategory=<code>&month=<m>`.

### Panel C — Forward commitment runway
`column-chart`, committed spend by month for the next six months (M57). Months beyond
the CFO's practical horizon rendered in the de-emphasis tint. The projected component
— proposals not yet approved but likely to be, from M41 — is a **dashed** overlay
labelled *projected*, never merged into the committed columns.
Column → `/app/ongoing/proposals?month=<m>`.

### Panel D — Cost per pax by school and format
`bar-chart`, horizontal, grouped by school then by event format, with the institutional
median as a reference line. Every bar is an R7 aggregate; k ≥ 5 suppressed and counted.
The two schools are **named** — with two schools an anonymised label identifies them
anyway, and a comparison that pretends otherwise is worse than an honest one.
Bar → `/app/history/proposals?school=<code>&format=<f>` — CFO-visible subset only.

### Panel E — Revenue & collection funnel
`funnel`: revenue exposure (M53) → payment required → submitted → approved → collected.
Ordinal blue ramp from step 250. The drop between "submitted" and "approved" is
organisers not reviewing proofs; between "required" and "submitted" is attendees not
paying. Two different problems, two different people to talk to, and the funnel names
which.
Stage → `/app/history/proposals?payment=<stage>` — counts only, never registrants.

### Panel F — Gate decisions & dwell
`stacked-bar` by month: approved · rejected · sent back at `cfo_review` (M07, M22),
with M14 dwell as a line **in a separate stacked panel below**, not a second y-axis.
Segment → `/app/history/proposals?stage=cfo-review&outcome=<o>&month=<m>`.

### Panel G — Finance catalogue health
`bar-chart` of funding main options by selections in period (M37), with off-catalogue
rate (M27) as a caption and dead codes tinted de-emphasis. The CFO owns this catalogue;
a high off-catalogue rate means spend is being recorded outside the finance codes it is
meant to roll up to, which quietly breaks Panel B.
Bar → `/app/dropdown-options/fundingMain`.

---

## 5. AI & decision-support insights

| Rule | Fires when | Severity | Action |
|---|---|---|---|
| **AI-38** `THRESHOLD_MISCALIBRATED` | Spend coverage (M56) below 60% for a term | serious | Presents the coverage curve and the queue cost at three candidate thresholds. The recommendation names the trade, not just the number |
| **AI-04** `COST_SPIKE` | Institutional committed spend rises > 40% month on month | warning | Names the category, the school, and the three largest contributing proposals the CFO can open |
| **AI-39** `CATEGORY_CONCENTRATION` | One finance code exceeds 50% of committed spend | warning | Concentration risk; shows the trend and the second-largest |
| **AI-33** `PEER_DIVERGENCE` | A school's cost per pax exceeds the median by > 50% for 2 months | warning | Names the school and the category driving it. Suppressed under k = 5 |
| **AI-36** `COLLECTION_TAIL` | Uncollected amount exceeds a configured floor within 7 days of an event | serious | Names the events and the amount — never registrants (R9) |
| **AI-23** `UNPRICED_EXPOSURE` | M58 below 95% institution-wide | warning | Every figure on this page understates; states the affected outlets |
| **AI-40** `RUNWAY_CONCENTRATION` | One month carries > 40% of the six-month runway | warning | A cash-flow timing signal, not a spend signal, and labelled as such |
| **AI-20** `GATE_BOTTLENECK` | `cfo_review` is the slowest stage by M14 for 2 weeks | serious | The CFO gate is the delay |
| **AI-22** `DEAD_CATALOGUE` | Funding code with 0 selections in 90 days | info | Retire it |
| **AI-31** `STRANDED_AT_GATE` | Any proposal matches M78 | critical | Institution-wide detector. The CFO is the only role that sees **all** of them, so the systemic version of this defect surfaces here first. See [01](01-role-hierarchy-and-access.md) § 2.3(b) |

---

## 6. Layout

```
┌ FINANCE · Executive ─────────────────────── [profile ▾]  ⟳ 09:14 ─┐
├ [30d][90d][Term][YTD]  [ school ▾ ] [ format ▾ ] [ category ▾ ]   │
├───────────────────────────────────────────────────────────────────┤
│ ┌── HERO ────────┐ ┌ Gate     ┐┌Cost/pax  ┐┌Collection┐┌ Price    │
│ │ Forward spend  │ │ coverage ││ RM 14.10 ││   87%    ││ coverage │
│ │  RM 128,400    │ │  4% prop ││ spread   ││ RM 3,120 ││   84%    │
│ │  next 90 days  │ │ 31% spend││ 1.3× ⚠   ││ unpaid ⚠ ││ ⚠ ≥95%   │
│ │  84% priced    │ │ ⚠ ≥60%   ││          ││          ││          │
├───────────────────────────────────────────────────────────────────┤
│ ┌── GATE COVERAGE MATRIX ───────────────────────────────────────┐ │
│ │ cost                    │ HIGH_PAX_THRESHOLD = 50  ◄ drag     │ │
│ │ > RM5k   ░░  ▒▒  ⚠▓▓    │  ██  ██                             │ │
│ │ 1k–5k    ░░  ▒▒  ⚠▓▓    │  ██  ▓▓                             │ │
│ │ 200–1k   ▒▒  ▓▓  ▓▓     │  ▒▒  ░░                             │ │
│ │ < RM200  ██  ▓▓  ▒▒     │  ░░  ░░                             │ │
│ │          0-10 10-25 25-50│ 50-100 100+          pax           │ │
│ │ ⚠ = spend below the gate · 212 proposals, 31 openable         │ │
│ └───────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│ ┌── Spend by category (6) ─────┐ ┌── Forward runway (6) ────────┐ │
│ ┌── Cost/pax by school (4) ┐ ┌ Collection funnel (4) ┐ ┌Gate (4)┐│
│ ┌── Finance catalogue health (12) ─────────────────────────────┐  │
├───────────────────────────────────────────────────────────────────┤
│ ┌── AI insights (8) ───────────────┐ ┌── Financial alerts (4) ──┐ │
├───────────────────────────────────────────────────────────────────┤
│ [Gate queue · 4] [Funding main] [Funding sub] [Menu oversight]    │
└───────────────────────────────────────────────────────────────────┘
```

The `212 proposals, 31 openable` caption under the signature panel is the honesty this
dashboard runs on. Everything above it is an institution-wide aggregate; everything
reachable by clicking is the subset `_VISIBLE_SQL` already permits. Stating the
difference is what makes the aggregate defensible rather than a quiet widening.

---

## 7. Navigation & drill-down

| From | To | Filters | Journey |
|---|---|---|---|
| Hero | Panel C | — | In-page: runway by month |
| Gate coverage KPI | Panel A | — | In-page |
| Cost/pax KPI | Panel D | — | In-page |
| Collection KPI | Panel E | — | In-page |
| Price coverage KPI | `/app/cafeterias/menu-oversight` | `unpriced=true` | Fix the prices |
| Gate queue KPI | `/app/inbox/proposals` | `stage=cfo-review` | Decide |
| Panel A cell | `/app/history/proposals` | `paxBand`, `costBand` | CFO-visible subset, count difference stated |
| Panel A threshold drag | — | — | Server-computed preview; changes no config |
| Panel B segment | `/app/history/proposals` | `fundingCategory`, `month` | — |
| Panel C column | `/app/ongoing/proposals` | `month` | Committed events that month |
| Panel D bar | `/app/history/proposals` | `school`, `format` | CFO-visible subset |
| Panel E stage | `/app/history/proposals` | `payment=<stage>` | Counts only |
| Panel F segment | `/app/history/proposals` | `stage=cfo-review`, `outcome`, `month` | Past decisions |
| Panel G bar | `/app/dropdown-options/fundingMain` | — | Edit finance codes |

**Every drill-through from an R7 aggregate lands filtered by `_VISIBLE_SQL` and shows
the gap.** A cell reporting 34 proposals that opens a list of 6 renders *"6 of 34
visible to you"* at the top. Silently showing 6 would look like a bug; showing 34
without the filter would be a leak.

New parameters: `paxBand`, `costBand`, `fundingCategory`, `school`, `format`,
`payment`, `stage`, `outcome`, `month`, `unpriced`. See
[60-navigation-and-drilldown.md](60-navigation-and-drilldown.md) § 2.
