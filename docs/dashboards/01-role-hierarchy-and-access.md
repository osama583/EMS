# Role hierarchy, data access, and access-control rules

Everything a dashboard is allowed to show, and why.

---

## 1. Authority tiers

The twelve roles in `role` are not a flat list. Sorting them by *what decision they
own* produces four tiers, and the tier is what determines whether a dashboard is
strategic, operational, or executive.

```
TIER 0  INSTITUTIONAL          CFO                     ends proposals; owns money
        (flat role, no unit)   System Admin            owns configuration
                                                        ↑ no unit boundary at all

TIER 1  UNIT GATEKEEPER        Head of School          ends proposals from their School
        (heads a unit)         Head of Department      cannot end a proposal; owns a
                                                        service lane end to end
                               ↳ F&B head is BOTH: a gatekeeper at fmb_review AND a
                                 department lane AND a supply orchestrator

TIER 2  UNIT OPERATOR          Cafeteria Manager       owns one or more outlets
        (assigned to a unit)   Cafeteria Admin         owns every outlet's staffing
                               Club Admin              owns the club catalogue

TIER 3  INDIVIDUAL CONTRIBUTOR Lecturer / Staff /      submits proposals, fulfils
        (assigned to a unit)   Student / Cafeteria     assigned work
                               Staff / External User
```

**What separates Tier 1 from Tier 0.** A Head of School can reject a proposal
outright; so can the CFO and the F&B head. A Head of Department of any other service
unit cannot — `chk_task_status` has no `rejected` value, and departments' only
pushback is send-back-with-comment. That single constraint is why a service HOD's
dashboard is an *operations* dashboard and a Head of School's is a *portfolio*
dashboard: one manages a queue it must eventually clear, the other manages a
gate it can close.

**What separates the six service HODs from each other.** Not authority — they have
identical authority. Their *resource model*:

| Unit | Requirement | Scarce resource | Capacity column in schema |
|---|---|---|---|
| `logistics_and_facilities` | `logistics` | consumable stock | `logistics_options.available_quantity` |
| `transport_services` | `transportation` | vehicles **and** drivers | `transportation_options.available_vehicle_count`, `.passenger_capacity` |
| `student_services` | `campusTour` | guides, per-start-point group cap | `campus_tour_start_options.max_group_size` |
| `food_beverage_services` | `fmb` + `waterNormal` | cafeteria food cost, gate outcomes, outlet fan-out, water requested | `fmb_options.unit_price_rm`, `request_mineral_water.quantity` |
| `a_v_services` | `soundLight` | **technician-hours only** | *none — no capacity column exists* |
| `photography_services` | `photoVideo` | **photographer-hours only** | *none — `media_options.max_personnel` was dropped* |

Three departments have a catalogue-derived capacity ceiling and can forecast
stock-outs. Two have none at all and can only forecast *people* shortages. One (F&B)
has both plus a downstream supply chain. Those are three genuinely different
dashboards before a single pixel is drawn.

**Why the two Heads of School still differ.** The schema does not distinguish
schools — both are `unit` rows whose head holds `head-of-school`. So the
differentiation is by **portfolio profile**, computed from each school's own data
rather than hardcoded. The rule:

> A school's signature panel is chosen by whichever of its two profile scores is
> higher over the trailing term:
> **service-intensity** = mean requirements selected per proposal, weighted toward
> `soundLight` / `photoVideo` / `logistics`;
> **commercial-intensity** = share of proposals with `cost_amount > 0` or a
> `request_funding_purchase` row, weighted by `general_guest` external mix.

On the current data that gives Computing the *Technical Service Dependency* panel and
Business the *Cost Recovery & External Engagement* panel. A third school added later
gets a signature panel deterministically instead of by hand. Both dashboards are
specified in full in [20-](20-hos-school-of-computing.md) and [21-](21-hos-school-of-business.md);
the panels, benchmarks, comparison peers and alert thresholds differ, not just the data.

---

## 2. How visibility is actually computed today

Two independent mechanisms. A dashboard must respect both.

### 2.1 Page visibility — `nav_page_grants`

Whether `/app/dashboard` appears in the sidebar at all. Evaluated by
`_satisfies_grant()` in `app/services/identity.py`. Four grant types, OR'd:

| Type | Matches when the actor… |
|---|---|
| `role` | holds any listed role (flat roles only) |
| `unit` | holds any role in any listed unit |
| `unit_role` | holds a listed role in a listed unit (cross-product within the row) |
| `cafeteria` | holds a listed role in **any** unit prefixed `cafeteria__` |

**The dashboard page is currently granted to `HEAD_ROLES` only** —
`seed/nav.py:88`, `grants_for(["head-of-school", "head-of-department"])`. That
covers eight of the ten roles in this design. The CFO and the Cafeteria Manager
cannot see the page.

Required change (Phase 1 of the roadmap):

```python
page("dashboard", "Dashboard", "space_dashboard", "/app/dashboard", None, 1,
     grants_for([*HEAD_ROLES, "cfo"]) + [cafeteria_manager_grant()])
```

`grants_for()` splits that into a `role` row (`cfo`) and a `unit_role` row (the two
head roles across every unit); `cafeteria_manager_grant()` adds the `cafeteria` row.
A page holds at most one grant per type (`UNIQUE (page_code, grant_type)`), and these
three are distinct types, so they coexist. Use the `cafeteria` grant, not a
`unit_role` row enumerating outlets — enumerating outlets is exactly what went stale
in commit `7ee8930` and left a new outlet's staff with an empty sidebar.

### 2.2 Row visibility — `_VISIBLE_SQL`

Whether a specific proposal is readable. Nine OR'd clauses in
`app/api/proposals.py`. Reading a proposal outside them returns **404, not 403** —
a 403 would confirm it exists.

| # | Clause | Who it serves |
|---|---|---|
| 1 | `applicant_user_id = me` | applicant |
| 2 | co-owner by `staff_id` **or** lowercased email | co-owner |
| 3 | `status='hos_hod_review'` and I head a unit the applicant belongs to | HOS at the gate |
| 4 | `status='fmb_review'` and I head `food_beverage_services` | F&B at the gate |
| 5 | `status='cfo_review'` and I hold `cfo` | CFO at the gate |
| 6 | a `request_task` routed to a unit I head (or `assigned_role` `fmb`/`cfo`) | service HOD — **permanent**, tasks persist |
| 7 | a `task_assignment` to me | assigned staff |
| 8 | a `request_fmb_selection` at a cafeteria I belong to | cafeteria manager/staff |
| 9 | a `workflow_history` row where I was the actor | anyone who ever acted — **durable** |

Clauses 3, 4 and 5 are **stage-gated**: they stop matching the instant the proposal
moves on. Clause 9 is what keeps a decided proposal in the decider's History.

### 2.3 Three consequences that shape this design

**(a) The CFO is nearly blind outside their own gate.** Clause 5 only fires at
`cfo_review`, and `cfo_review` is only reached when `total_pax > HIGH_PAX_THRESHOLD`
(default 50). Clause 6's `assigned_role = 'cfo'` branch is **dead code** — no such
task is ever created, because `fundingPurchase` is in `NON_WORKFLOW_REQUIREMENTS`
and is never routed. So a CFO sees a proposal only while it sits at their gate, or
afterwards if they acted on it.

Every proposal at or below the threshold — including all its
`request_funding_purchase` rows, which are recorded on *every* proposal — is
invisible to the person who owns the budget. A CFO dashboard built strictly on
`_VISIBLE_SQL` would report on a minority of spend and silently omit the rest. Rule
**R7** below is how this design resolves it without widening row access.

**(b) A service HOD wears two hats, and the visibility rules disagree about the
second one.** Clause 6 gives every service HOD their routed tasks permanently — the
service-provider hat. Clause 3 *also* shows them any `hos_hod_review` proposal from
an applicant in their own department — the gatekeeper hat. But
`is_hos_hod_for_applicant()` in `services/workflow/authorization.py` additionally
requires `is_school_unit()`, so a service HOD can **see** that proposal and cannot
**act** on it.

> **Verified defect, out of scope to fix here, in scope to surface.** A proposal
> submitted by a staff member whose only unit is a service department (e.g.
> `logistics.staff@demo.apu.edu.my`) routes to `hos_hod_review` — `_skips_hos_hod()`
> does not skip, because the applicant does belong to a unit — but no actor
> qualifies, because `is_hos_hod_for_applicant()` demands a School. The proposal is
> stranded with no error message. This is the same deadlock the code documents
> itself as having fixed for flat-role accounts (`_has_no_reviewable_unit`), left
> open for service-department accounts. `seed/nav.py` grants the proposal form to
> `staff` in every unit, so the path is reachable with seeded data.
>
> Insight rule **AI-31** (`STRANDED_AT_GATE`) detects it and raises it on the
> affected HOD's dashboard and the CFO's. It is a detector, not a fix — the fix is a
> one-line change to `_skips_hos_hod()` and belongs in its own change.

**(c) A Cafeteria Manager's scope is their outlets, not "all cafeterias".**
`_scope_params()` builds `cafeteria_units` from
`units_for_role('cafeteria-manager') | units_for_role('cafeteria-staff')`. The page
*grant* is all-cafeterias (any manager, any outlet, so a new outlet works
immediately); the *data* is only outlets they hold a row for. A manager holding two
outlets gets one dashboard with an outlet switcher and a combined view — not two
dashboards, and never another manager's outlet.

---

## 3. Role-to-data access matrix

`●` full row access · `◐` aggregate only (rule R7) · `○` none

| Data | HOD A/V | HOD F&B | HOD Log | HOD Photo | HOD StuSvc | HOD Trans | HOS Comp | HOS Bus | CFO | Caf Mgr |
|---|---|---|---|---|---|---|---|---|---|---|
| Proposals routed to my unit | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| Proposals from my school's people | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ |
| Proposals at my gate now | ○ | ● | ○ | ○ | ○ | ○ | ● | ● | ● | ○ |
| Proposals I ever decided | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Proposals with an order at my outlet | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| Every other proposal | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ◐ | ◐ | ○ |
| `request_task` — my unit | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| `request_task` — other units | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ◐ | ◐ | ○ |
| My unit's detail rows (`request_logistics` etc.) | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| `request_funding_purchase` | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ◐ | ◐ | ○ |
| `request.cost_amount` | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ◐ | ◐ | ○ |
| `request.bank_account_name` / `_number` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `request_fmb_selection` — my outlets | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| `request_fmb_selection` — all outlets | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| `fmb_options` (menu + `unit_price_rm`) | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ● |
| My unit's option catalogue | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ● |
| Other units' option catalogues | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| `task_assignment` / `request_row_assignment` — my unit | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| Staff roster — my unit | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ● |
| Staff roster — other units | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| `event_registration` (counts) | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ◐ | ○ |
| `event_registration` attendee identity | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| `event_registration.payment_status` | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | ◐ | ◐ | ○ |
| `workflow_history` — my unit's lane | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `cafeteria_staff_audit_log` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● (own outlets) |
| `cafeteria_staff_requests` | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● (own, raised by me) |
| `config` thresholds | read | read | read | read | read | read | read | read | read | read |
| `users.password`, tokens | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Notes on the `◐` cells:

- **HOS cross-school aggregates** exist so a school can benchmark against the
  institutional mean and against the one named peer school. Bucket floor applies (R8).
- **CFO aggregates** are the finance read scope — R7. Every `◐` on the CFO row is
  money or its denominators.
- **`bank_account_number` is `○` everywhere including the CFO.** It is a payout
  destination, not an analytic. No dashboard widget reads that column.
- **Attendee identity is `○` everywhere.** `backend/docs/security.md` records the
  attendee list as organiser-only; counts and status distributions are derivable
  without names, and that is all any dashboard needs.

---

## 4. Access-control rules

Numbered so widget specs can cite them.

**R1 — Fail closed.** A widget with no explicit grant renders nothing. Never a
default-visible panel with a filter applied on top.

**R2 — Scope in SQL, never in the response handler.** Every dashboard query carries
the caller's scope in its `WHERE` clause. A query that fetches broadly and filters in
Python is the defect `backend/docs/security.md` was written to record; a dashboard
must not reintroduce it one aggregate at a time.

**R3 — Row visibility is `_VISIBLE_SQL` and nothing else.** Any widget that can
drill to individual proposals reuses that predicate verbatim, by import rather than
by copy. A proposal that is listable must be readable, and the reverse.

**R4 — Unit scope comes from `principal.headed_units`.** Never from a client-supplied
`unitCode`. A department head passing another unit's code gets their own unit's data,
not a 403 — the parameter is not read at all.

**R5 — Cafeteria scope comes from `units_for_role('cafeteria-manager')`.** An outlet
switcher's value is validated against that set before it reaches SQL.

**R6 — Suspended assignments confer nothing.** Every scope query filters
`user_unit_roles.is_active` (migration 008), matching `_ASSIGNMENTS_SQL`. A suspended
manager's dashboard is empty, not stale.

**R7 — The aggregate/detail split.** A widget may compute over rows the caller cannot
open, provided **all four** hold:

1. The response contains no per-row identifier, name, email, or free text.
2. The result is a count, sum, mean, median, percentile, ratio or bucketed
   distribution — never a min/max that names its row, and never a top-N list of
   entities the caller cannot open.
3. The bucket floor (R8) is satisfied.
4. Drill-through from that widget re-applies `_VISIBLE_SQL` (R3), so the caller lands
   on the subset they may actually read — and the widget states the subset size, so
   the gap between the aggregate and the drill-through is visible rather than
   confusing.

This is what makes the CFO dashboard possible without widening `_VISIBLE_SQL`, and
what lets a Head of School see "your median approval latency is 31h against an
institutional 26h" without seeing another school's proposals.

**R8 — Bucket floor: k ≥ 5.** Any aggregate crossing a scope boundary suppresses
buckets with fewer than five underlying rows, rendering `—` with a "below reporting
threshold" tooltip. Without it, "School of Business: 1 rejected proposal" plus a
calendar identifies a person. Applies to every `◐` cell; does not apply within the
caller's own scope, where they can read the rows anyway.

**R9 — Money is aggregate-only outside the CFO.** `cost_amount`, `unit_price_rm`
and funding totals reach a Head of School only as school-level sums and per-pax
ratios. `bank_account_name` and `bank_account_number` reach nobody.

**R10 — Staff identity stays inside the unit.** Per-person productivity names people
only within the viewer's own unit. Cross-unit staffing comparisons are headcount and
distribution shape, never names. A Cafeteria Manager sees their own outlets' staff by
name (they already manage them on `/app/cafeterias/my-staff`) and never another
outlet's.

**R11 — Config, not constants.** SLA targets, capacity assumptions, risk windows and
forecast horizons read from `config` at query time. New codes are listed in
[03-dashboard-architecture.md](03-dashboard-architecture.md) § 8.

**R12 — Every drill-down re-authorises at the destination.** The dashboard passes
filters, never rows or ids the destination would not have granted on its own. A
tampered query string yields an empty filtered page, not a leak.

---

## 5. Multi-role resolution

`user_unit_roles` lets one account hold several roles. `cafeteria.manager@` could
also hold `head-of-department`. The dashboard must resolve deterministically.

**Algorithm** (`resolve_dashboard_profile()`, specified in
[03-dashboard-architecture.md](03-dashboard-architecture.md) § 3):

1. Collect every active assignment that maps to a dashboard profile.
2. Order by tier: `cfo` → `head-of-school` → `head-of-department` → `cafeteria-manager`.
3. The first match is the **default** profile; the rest become entries in a profile
   switcher in the page header.
4. Within a profile, if the actor heads several units of the same kind, the *unit*
   switcher lists them, defaulting to the lowest `unit.code` for stability across sessions.
5. Zero matches → the existing `/app/no-access` placeholder. Never a blank dashboard.

The switcher is a scope change, not a permission change: each entry re-runs the whole
resolution, so it can only ever reach scopes the actor already holds.

---

## 6. Roles without a dashboard in this phase

Recorded so adding them later is a new profile, not a new architecture.

| Role | Would need | Why deferred |
|---|---|---|
| System Admin | Config drift, grant coverage gaps, orphaned pages, soft-delete purge queue, login failure rates | Platform health, not business analytics — a different metric family |
| Cafeteria Admin | Cross-outlet comparison, staffing request SLA, menu-oversight coverage, outlet lifecycle | Already has `/app/reports` granted in `seed/nav.py:95` — that page is the natural home |
| Club Admin | Club membership growth, join-request SLA, category balance, president-change queue | Club domain is disjoint from the proposal workflow |
| Lecturer / Staff / Student | Personal proposal status, assigned work, upcoming events | Tier 3 needs a task list, not analytics — `/app/inbox` already is that |
| External User | Registrations, saved events, payment status | No internal layout access at all (`externalUserGuard`) |
