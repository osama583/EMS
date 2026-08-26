# AI & decision-support insight engine

The insights rail on every dashboard. Forty-five rules, each of which reads the metric
catalog and produces a claim, its evidence, and one action.

---

## 1. What "AI" means here, and what it does not

**The engine is deterministic.** Every rule is a threshold, a trend test, or a
set-difference over metrics from [02-metric-catalog.md](02-metric-catalog.md). No model
is in the path that produces a claim.

That is a deliberate choice, not a limitation:

- **A dashboard insight is an accusation.** "Level 3 Food Court is degrading" will be
  read by the person who runs Level 3 Food Court. It has to be reproducible, auditable,
  and defensible from the row data. A generated sentence is none of those.
- **Every claim needs a drill-down that agrees with it.** A rule that fired on a
  computable condition can hand the user the exact filtered list behind it. A rule that
  fired on a model's impression cannot.
- **Thresholds are the product.** Half of these rules are useful mainly because a
  head of department can retune them in `config` when they turn out to be wrong for
  that unit. A tunable threshold is a feature; an untunable inference is not.

**Where a language model earns its place** is § 6 — an optional narration layer that
rewrites an already-decided rule's evidence into a sentence, and never decides whether
the rule fired. If that layer is unavailable, the rail still works; the sentences are
just templated instead of phrased.

---

## 2. Rule anatomy

```python
@dataclass(frozen=True)
class InsightRule:
    id: str                       # "AI-07"
    code: str                     # "LOW_SEAT_FILL"
    family: str                   # anomaly | capacity | sla | quality | cost | people | risk | data
    severity: Severity            # info | warning | serious | critical
    applies_to: frozenset[str]    # profile keys
    metrics: tuple[str, ...]      # ("M32",) — what it reads
    condition: Callable           # (metrics, config, scope) -> Evidence | None
    title: str                    # template, evidence-interpolated
    body: str                     # template
    action: Action | None         # label + route + params, or None
    cooldown_days: int = 7        # do not re-raise the same (rule, subject) inside this
```

**Evidence is mandatory.** A rule that cannot name the value, the window, and the
comparison it used does not ship. The card renders the evidence beneath the claim, so
the reader can disagree with the number rather than with the assertion.

**An action is a route with filters, or nothing.** `AI-33 PEER_DIVERGENCE` on a Head of
School dashboard has no action — the peer's rows are not theirs to open (R7) — and it
renders without a button rather than with one that lands on an empty list.

---

## 3. Severity and ranking

| Severity | Means | Example |
|---|---|---|
| `critical` | Something will fail on a known date unless someone acts | `AI-02 CAPACITY_BREACH` |
| `serious` | A trend that will become critical if unaddressed | `AI-06 OUTLET_DEGRADING` |
| `warning` | Worth knowing; no deadline attached | `AI-08 WORKLOAD_IMBALANCE` |
| `info` | An opportunity or a tidy-up | `AI-30 CONSOLIDATION_CANDIDATE` |

**Rail cap: five cards.** Ranked by severity, then by proximity of the deadline, then
by recency. An insights rail that scrolls is an insights rail nobody reads, and the
sixth card is the one that trains people to ignore the first five.

**Cooldown.** A fired rule does not re-raise for the same subject within
`cooldown_days`, so a chronic condition produces one card, not one per refresh. It
re-raises immediately if severity increases.

**Status rendering.** Every card is `icon + label + colour`, never colour alone. The
status palette in [03](03-dashboard-architecture.md) § 6 puts `warning` and `serious`
below 3:1 on white deliberately, and the icon-plus-label pairing is what discharges that.

---

## 4. The rules

### Capacity & resource (6)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-01 | `STOCKOUT_FORECAST` | M30 | An item's committed quantity exceeds available stock on a forward date | critical |
| AI-02 | `CAPACITY_BREACH` | M30, M35 | A unit's people or fleet ceiling is exceeded on a forward date. Names **which** ceiling where a unit has two | critical |
| AI-03 | `COLLISION_CLUSTER` | M31 | ≥ 3 collision dates fall inside one week | serious |
| AI-12 | `WATER_STOCKOUT` | M30 | Committed bottles exceed `available_stock` inside the horizon | critical |
| AI-13 | `CHRONIC_SHORTAGE` | M30 | The same item or vehicle type breaches on > 20% of horizon days | serious |
| AI-28 | `START_POINT_CROWDING` | M31 | One start point hosts more tours than its comfortable maximum on a date | serious |

### SLA & flow (6)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-05 | `SLA_DRIFT` | M10 | Median decision latency rises 3 consecutive weeks. Reports the weekday it concentrates on | warning |
| AI-11 | `RUNWAY_COLLAPSE` | M16, M47 | Median preparation runway falls below `SLA_FULFILMENT_LEAD_DAYS` | serious |
| AI-20 | `GATE_BOTTLENECK` | M14 | The viewer's own stage is the slowest by dwell time for 2 weeks | serious |
| AI-24 | `TURNAROUND_DRIFT` | M13 | Post-event turnaround p90 rises while volume is flat | serious |
| AI-27 | `STALE_UNASSIGNED` | M64 | An approved item stays unassigned past `SLA_ASSIGNMENT_HOURS` | serious |
| AI-41 | `POOL_STARVED` | M18 | An approved cafeteria order stays unclaimed past `SLA_ORDER_CLAIM_HOURS` | serious |

### Quality & rework (5)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-09 | `PUSHBACK_CONCENTRATION` | M25 | > 60% of push-backs originate from one outlet | serious |
| AI-14 | `FORM_MISMATCH` | M20, M27 | Send-back rate **and** off-catalogue rate rise together | warning |
| AI-26 | `REJECTION_DRIFT` | M22 | Rejection rate rises while intake is flat. **The card states that the data cannot distinguish "quality fell" from "the bar moved"** | warning |
| AI-06 | `OUTLET_DEGRADING` | M17, M18 | One outlet's acceptance or claim latency worsens 3 weeks running | serious |
| AI-34 | `SCOPE_INFLATION` | M42 | Requirements per proposal rise 3 months running | warning |

### Cost & finance (7)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-04 | `COST_SPIKE` | M50, M51 | Committed spend rises > 40% period on period | warning |
| AI-23 | `UNPRICED_EXPOSURE` | M58, M75 | Price coverage falls below the role's floor, or an unpriced item receives an order | warning |
| AI-35 | `RECOVERY_SHORTFALL` | M53, M54 | A future paid event's projected recovery is under 40%. Reports the break-even registration count | serious |
| AI-36 | `COLLECTION_TAIL` | M54 | Unpaid registrations remain within 7 days of an event. **Counts only, never registrants (R9)** | serious |
| AI-38 | `THRESHOLD_MISCALIBRATED` | M56 | Spend coverage below 60% for a term. Presents the coverage curve and queue cost at three candidate thresholds | serious |
| AI-39 | `CATEGORY_CONCENTRATION` | M52 | One finance code exceeds 50% of committed spend | warning |
| AI-40 | `RUNWAY_CONCENTRATION` | M57 | One month carries > 40% of the six-month runway. **Labelled a timing signal, not a spend signal** | warning |

### People & workload (6)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-08 | `WORKLOAD_IMBALANCE` | M60, M61 | Spread across active staff exceeds 3× | warning |
| AI-19 | `SPOF_LANE` | M73 | Active staff in a lane ≤ 1, or ≤ 2 where one absence halves capacity. Standing card while true; states the capacity loss per absence | serious |
| AI-21 | `DOUBLE_BOOKED` | M60 | One person holds two rows with overlapping windows | critical |
| AI-42 | `CLAIM_CONCENTRATION` | M65 | One staff member claims > 60% of the pool. **The card notes this may simply be one person's shift** | warning |
| AI-43 | `STAFFING_REQUEST_STALLED` | M67 | A staffing request is pending beyond the median resolution time | warning |
| AI-44 | `CHURN_SPIKE` | M66 | Suspend or remove actions exceed the trailing mean + 2σ | warning |

### Demand & opportunity (6)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-07 | `LOW_SEAT_FILL` | M32 | Median seat fill below 0.55 for 3 weeks | serious |
| AI-25 | `GROUP_SPLIT_SURGE` | M33 | Mean group-split factor rises 3 weeks running | warning |
| AI-30 | `CONSOLIDATION_CANDIDATE` | M32 | Same date, same normalised route, both trips under 50% fill, combined pax fits one vehicle | info |
| AI-37 | `ENGAGEMENT_DECLINE` | M46 | External guest-band share falls 3 months running | warning |
| AI-45 | `PORTION_SURGE` | M08 | Median order quantity rises 3 weeks running. Flags kitchen capacity rather than throughput | warning |
| AI-32 | `DEPENDENCY_DRAG` | M14, M42 | One requirement contributes > 40% of a school's median cycle time | serious |

### Risk & correctness (5)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-10 | `VENUE_CONFLICT` | M31 | Two bookings at one normalised location with a gap below the teardown window | serious |
| AI-16 | `DELIVERY_BACKLOG` | M70 | Work outstanding after its event date — undelivered shoots, or a passed event with open tasks | serious |
| AI-17 | `SERVE_TIME_RISK` | M70 | A live order is not `ready` inside the risk window | critical |
| AI-18 | `COVERAGE_GAP` | M64 | A forward booking is unassigned inside `AT_RISK_WINDOW_DAYS` | critical |
| AI-31 | `STRANDED_AT_GATE` | M78 | A proposal sits at `hos_hod_review` with no qualifying actor. **Detects the defect recorded in [01](01-role-hierarchy-and-access.md) § 2.3(b); it does not fix it** | critical |

### Data quality & catalogue (4)

| ID | Code | Metrics | Fires when | Severity |
|---|---|---|---|---|
| AI-15 | `DIETARY_GAP` | M38 | A dietary option has zero coverage at an outlet receiving orders | warning |
| AI-22 | `DEAD_CATALOGUE` | M76 | An active option has zero selections in 90 days | info |
| AI-29 | `UNCAPPED_START_POINT` | M33 | An uncapped start point receives a tour, so guide demand is under-stated | warning |
| AI-33 | `PEER_DIVERGENCE` | M55, varies | A school exceeds the peer or institutional median by > 50% for 2 months. **Suppressed if either side is under k = 5 (R8); no action button (R7)** | warning |

---

## 5. Role coverage

| Rule | AV | F&B | Log | Photo | StuSvc | Trans | Comp | Bus | CFO | Caf |
|---|---|---|---|---|---|---|---|---|---|---|
| AI-01 `STOCKOUT_FORECAST` | | | ● | | | | | | | |
| AI-02 `CAPACITY_BREACH` | ● | | ● | | ● | ● | | | | |
| AI-03 `COLLISION_CLUSTER` | ● | | | | | | | | | |
| AI-04 `COST_SPIKE` | | ● | | | | | | ● | ● | |
| AI-05 `SLA_DRIFT` | ● | | ● | ● | ● | ● | ● | | | |
| AI-06 `OUTLET_DEGRADING` | | ● | | | | | | | | ● |
| AI-07 `LOW_SEAT_FILL` | | | | | | ● | | | | |
| AI-08 `WORKLOAD_IMBALANCE` | ● | | ● | | ● | | | | | |
| AI-09 `PUSHBACK_CONCENTRATION` | | ● | | | | | | | | |
| AI-10 `VENUE_CONFLICT` | | | ● | | | | | | | |
| AI-11 `RUNWAY_COLLAPSE` | ● | | | ● | ● | ● | ● | | | |
| AI-12 `WATER_STOCKOUT` | | ● | | | | | | | | |
| AI-13 `CHRONIC_SHORTAGE` | | | ● | | | ● | | | | |
| AI-14 `FORM_MISMATCH` | ● | | ● | ● | | | | | | |
| AI-15 `DIETARY_GAP` | | ● | | | | | | | | ● |
| AI-16 `DELIVERY_BACKLOG` | | | | ● | | | ● | ● | | |
| AI-17 `SERVE_TIME_RISK` | | ● | | | | | | | | ● |
| AI-18 `COVERAGE_GAP` | | | | ● | | | | | | |
| AI-19 `SPOF_LANE` | ● | | | ● | | ● | | | | |
| AI-20 `GATE_BOTTLENECK` | | ● | | | | | ● | ● | ● | |
| AI-21 `DOUBLE_BOOKED` | | | | ● | | | | | | |
| AI-22 `DEAD_CATALOGUE` | ● | | ● | ● | ● | ● | | | ● | ● |
| AI-23 `UNPRICED_EXPOSURE` | | ● | | | | | | ● | ● | ● |
| AI-24 `TURNAROUND_DRIFT` | | | | ● | | | | | | |
| AI-25 `GROUP_SPLIT_SURGE` | | | | | ● | | | | | |
| AI-26 `REJECTION_DRIFT` | | ● | | | | | ● | ● | | |
| AI-27 `STALE_UNASSIGNED` | ● | | ● | | ● | ● | | | | |
| AI-28 `START_POINT_CROWDING` | | | | | ● | | | | | |
| AI-29 `UNCAPPED_START_POINT` | | | | | ● | | | | | |
| AI-30 `CONSOLIDATION_CANDIDATE` | | | | | | ● | | | | |
| AI-31 `STRANDED_AT_GATE` | ● | ● | ● | ● | ● | ● | ● | ● | ● | |
| AI-32 `DEPENDENCY_DRAG` | | | | | | | ● | | | |
| AI-33 `PEER_DIVERGENCE` | | | | | | | ● | ● | ● | |
| AI-34 `SCOPE_INFLATION` | | | | | | | ● | | | |
| AI-35 `RECOVERY_SHORTFALL` | | | | | | | | ● | | |
| AI-36 `COLLECTION_TAIL` | | | | | | | | ● | ● | |
| AI-37 `ENGAGEMENT_DECLINE` | | | | | | | | ● | | |
| AI-38 `THRESHOLD_MISCALIBRATED` | | | | | | | | | ● | |
| AI-39 `CATEGORY_CONCENTRATION` | | | | | | | | | ● | |
| AI-40 `RUNWAY_CONCENTRATION` | | | | | | | | | ● | |
| AI-41 `POOL_STARVED` | | | | | | | | | | ● |
| AI-42 `CLAIM_CONCENTRATION` | | | | | | | | | | ● |
| AI-43 `STAFFING_REQUEST_STALLED` | | | | | | | | | | ● |
| AI-44 `CHURN_SPIKE` | | | | | | | | | | ● |
| AI-45 `PORTION_SURGE` | | | | | | | | | | ● |
| **Total per role** | **10** | **10** | **10** | **10** | **10** | **10** | **9** | **10** | **10** | **10** |

Nine or ten candidate rules per role, five shown. That headroom is intentional — the
rail should be selecting, not padding.

**AI-31 appears on nine of the ten.** The Cafeteria Manager is excluded: they have no
gate, no applicants, and no action available. Everyone who could escalate it sees it.

---

## 6. Optional narration layer

A language model may rewrite a fired rule's title and body into a sentence fitted to
its evidence. It is strictly downstream of the decision.

**Contract**

```
input :  { rule_id, severity, evidence: {...}, scope: {unit, period}, action }
output:  { title: str (≤ 80 chars), body: str (≤ 240 chars) }
```

**Guardrails**

1. **The model never decides whether a rule fired**, and never changes its severity,
   its evidence, or its action.
2. **It receives only the evidence dict.** No proposal rows, no names, no free text
   from user-authored fields. The dict has already passed R7, R8 and R9, so the
   narration layer cannot leak what the rule could not.
3. **Numbers are interpolated, not generated.** Output is validated to contain only
   figures present in the evidence dict; a mismatch falls back to the template.
4. **Failure is silent and total.** Timeout, error, or a validation miss renders the
   template. The rail never blocks on it and never shows a partial sentence.
5. **Off by default**, behind a `config` flag, so a deployment with no model access
   behaves identically minus the phrasing.

The app already ships an assistant surface (`shared/components/ai-assistant`), so the
client-side affordance exists; this is a server-side text pass, not a second chat.

---

## 7. Feedback and suppression

Rules that cannot be dismissed get ignored wholesale, which loses the ones that matter.

- **Snooze** — hide this card for this subject for 7, 30 days, or the term. Stored per
  user, per (rule, subject).
- **Not useful** — records a signal against the rule for that profile. Aggregated, it
  is the evidence for retuning a threshold or retiring a rule; it does not silently
  disable anything.
- **Tune** — for the fifteen rules whose threshold lives in `config`, a link to
  `/app/admin/settings/policies` with the code pre-selected. Whether that link renders
  depends on whether the viewer holds `system-admin`; for everyone else the card names
  the code so they can ask for it by name.
- **Never suppressible:** `critical` rules with a dated deadline — `AI-02`, `AI-12`,
  `AI-17`, `AI-18`, `AI-21`, `AI-31`. These can be acknowledged, which records who saw
  it and when, but they stay on the rail until the underlying condition clears.
