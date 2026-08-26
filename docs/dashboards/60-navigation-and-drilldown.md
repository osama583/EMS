# Navigation & drill-down

Every KPI and every chart mark has a destination. This document is the contract
between the dashboard and the pages it hands off to, and the work list for making those
pages accept what the dashboard sends.

---

## 1. Principles

**P1 — No dead ends.** A number with no destination should not be on the dashboard.
The only exceptions are informational tiles that state a structural fact (Photography's
roster resilience) and R7 aggregates the viewer may not open (a Head of School's peer
series). Both render **without a link and without a pointer cursor**, so nothing looks
clickable that is not.

**P2 — Destinations are existing pages.** No drill-down opens a page built only for
drilling. `/app/inbox/requests`, `/app/history/proposals`, `/app/menu`,
`/app/dropdown-options/*` and `/app/proposals/review/:id` already exist, already
authorise correctly, and already render these records. The dashboard supplies filters,
not a parallel UI.

**P3 — Filters travel as query parameters; the destination re-authorises.** Rule R12.
The dashboard never passes row ids the destination would not have granted on its own.
A tampered query string produces an empty filtered list, never a leak.

**P4 — An aggregate drill lands on the visible subset, and says so.** Rule R7 clause 4.
A CFO cell reporting 34 proposals that opens a list of 6 renders *"6 of 34 visible to
you"*. Showing 6 silently reads as a bug; showing 34 would be one.

**P5 — Return path.** Every drill carries `returnTo=<dashboard url with its filters>`.
`hub-proposals.ts` already uses this pattern when opening a review page, so the
convention exists — the dashboard adopts it rather than inventing a second one.

**P6 — In-page drills stay in the page.** A KPI whose evidence is a panel on the same
dashboard scrolls and highlights that panel; it does not navigate. Panels carry
anchors so the scroll target is stable.

---

## 2. Query-parameter contract

### 2.1 What the API already accepts

| Endpoint | Existing parameters |
|---|---|
| `GET /proposals` | `bucket`, `q`, `statusLabel`, `status`, `mine`, `requester`, `sort`, `order`, `page`, `pageSize` |
| `GET /proposals/requests` | `bucket` *(required)*, `requestKind`, `q`, `sort`, `order`, `page`, `pageSize` |
| `GET /tasks` | task listing for staff |
| `GET /options/{kind}` | catalogue by kind |

Sorting and pagination are already server-side after the bucketing pass, so the
dashboard's `sort=schedule&order=asc` drills work today with no backend change.

### 2.2 What the frontend already accepts

**Almost nothing.** `records-hub`, `hub-requests`, `hub-proposals`, `staff-tasks` and
`request-option-management` inject `ActivatedRoute` to read route **`data`**
(`bucket`, `taskPage`, `optionKind`) — not query parameters. `hub-proposals` *emits*
`proposalId`, `returnTo` and `readOnly` when opening a review page, but no list page
reads an incoming filter from the URL.

**Consequence:** without the work in § 2.4, every drill-down in this design lands on an
unfiltered list. The link would technically work and would be useless — a dead end
wearing a link, which is worse than P1's honest no-link.

### 2.3 The full parameter inventory

Grouped by destination. **New** means it does not exist on either end today.

#### `/app/inbox|ongoing|history/proposals` → `GET /proposals`

| Param | Values | Backend | Frontend | Used by |
|---|---|---|---|---|
| `stage` | `hos-hod-review` `fmb-review` `cfo-review` `department-review` | **new** — maps to `request.status`; the client vocabulary already exists in `STAGE_FOR_CLIENT` | **new** | F&B, both schools, CFO |
| `outcome` | `approved` `rejected` `resubmitted` `cancelled` | **new** | **new** | schools, CFO, F&B |
| `stalled` | `true` | **new** — open beyond 2× the institutional median for its status (M72) | **new** | schools |
| `horizon` | days | **new** — approved with a future event date inside N days | **new** | schools |
| `applicant` | `user_id` | maps to existing `requester` | **new** | schools |
| `school` | unit code or `mine` | **new** — applicant's school | **new** | schools, CFO |
| `requirement` | requirement name | **new** — has an `application_requirements` row | **new** | Computing |
| `paxBand` / `costBand` | band key | **new** — CFO matrix cells | **new** | CFO |
| `fundingCategory` | finance code | **new** | **new** | Business, CFO |
| `guestBand` | `internal` `external` `family` `other` | **new** | **new** | Business |
| `payment` | `unpaid` `required` `submitted` `approved` | **new** — over `event_registration.payment_status` | **new** | Business, CFO |
| `format` / `category` | format or category code | **new** | **new** | Business, CFO |
| `month` / `week` | ISO period | **new** — a period window, distinct from the page's own filter row | **new** | all |

#### `/app/inbox|ongoing|history/requests` → `GET /proposals/requests`

| Param | Values | Backend | Frontend | Used by |
|---|---|---|---|---|
| `requestKind` | requirement name | **exists** | **new** | every HOD |
| `date` | ISO date | **new** — the detail row's own `"date"` | **new** | every HOD |
| `assigned` | `none` `any` | **new** — zero assignment rows | **new** | every HOD |
| `assignee` | `user_id` | **new** | **new** | every HOD |
| `item` | option id | **new** | **new** | Logistics |
| `vehicleType` | option id | **new** | **new** | Transport |
| `route` | server-computed hash | **new** — stable hash of the normalised pickup/dropoff pair, so the client never reproduces the normalisation | **new** | Transport |
| `startPoint` / `tourType` | option id | **new** | **new** | Student Services |
| `split` | `true` | **new** — `pax > max_group_size` | **new** | Student Services |
| `phase` | `pre-event` `post-event` `undelivered` | **new** — server-side predicate over event date and assignment status | **new** | Photography |
| `outlet` | cafeteria code | **new** | **new** | F&B, Cafeteria Manager |
| `orderStatus` | selection status | **new** | **new** | F&B, Cafeteria Manager |
| `order` | `request_fmb_selection_id` | **new** — scroll to and expand one order | **new** | Cafeteria Manager |
| `claimedBy` | `user_id` | **new** | **new** | Cafeteria Manager |
| `risk` | `true` | **new** — inside `AT_RISK_WINDOW_DAYS` and not terminal | **new** | F&B, Cafeteria Manager |
| `delivery` | `late` `ontime` | **new** | **new** | F&B, Cafeteria Manager |
| `week` | ISO week | **new** | **new** | every HOD |

#### `/app/menu` and `/app/dropdown-options/{kind}` → `GET /options/{kind}`

| Param | Values | Backend | Frontend | Used by |
|---|---|---|---|---|
| `item` | option id | **new** — scroll to and open | **new** | Logistics, Cafeteria Manager |
| `type` | option id | **new** | **new** | Transport |
| `unpriced` | `true` | **new** | **new** | Cafeteria Manager, CFO |
| `dietary` | dietary option id | **new** | **new** | F&B, Cafeteria Manager |
| `outlet` | cafeteria code | **new** — Menu Oversight only | **new** | F&B, CFO |

#### `/app/cafeterias/*`

`my-staff`, `staff-requests-history` and `menu-oversight` take no parameters from the
dashboard beyond `outlet` on the last two. The manager's own pages are already scoped
server-side.

### 2.4 Frontend work list

Ordered by how many drills each unblocks.

- [ ] **A shared `useUrlFilters()` helper** — reads query parameters into a signal,
      writes them back on change, and keeps them through pagination and sorting. One
      implementation, used by every list page, so the pages cannot drift into reading
      the same parameter differently. This is the piece everything else depends on.
- [ ] **`hub-requests`** — accept the 18 parameters above; show an active-filter chip
      row with individual clears. Unblocks all six HOD dashboards and the Cafeteria
      Manager.
- [ ] **`hub-proposals`** — accept the 15 parameters above, plus the *"N of M visible
      to you"* banner when the dashboard passes an aggregate count. Unblocks both
      schools and the CFO.
- [ ] **`request-option-management`** — accept `item`, `type`, `unpriced`, `dietary`,
      `outlet`; scroll to and open the named option. Unblocks every catalogue drill.
- [ ] **Panel anchors** — stable `id` on each dashboard panel so in-page drills (P6)
      scroll to a fixed target.
- [ ] **`returnTo` on every drill** and a back affordance on each destination, matching
      the pattern `hub-proposals.ts` already uses.

### 2.5 Backend work list

- [ ] Extend `list_proposals()` with the § 2.3 predicates. Every one is an additional
      `WHERE` clause **inside** the existing `_VISIBLE_SQL` wrapper — a filter can only
      ever narrow what the caller may already see, never widen it. That ordering is the
      whole security property and should be asserted in a test, not just observed.
- [ ] Extend `list_department_requests()` similarly. It assembles rows in Python before
      filtering, so new predicates join the existing post-assembly filter chain rather
      than the SQL — matching how `q` and `sort` already work there.
- [ ] Add `route` hash computation (normalise, hash, expose) so Transport's route drill
      round-trips without the client knowing the normalisation rule.
- [ ] Add the `phase` predicate for Photography.
- [ ] Return `visibleCount` and `totalCount` separately on any list reached from an R7
      aggregate, so the destination can render P4's banner honestly.

---

## 3. Complete drill map

`→` navigates · `⇣` scrolls in-page · `✕` deliberately not clickable

### Department heads

| Role | From | To |
|---|---|---|
| **A/V** | Hero crew coverage | → `/app/inbox/requests?requestKind=soundLight&sort=schedule&date=<peak>` |
| | Collisions · Panel A bar/day | ⇣ Panel A · → `/app/proposals/review/:id` · → `…&date=<d>` |
| | Panel B segment · Panel D dot | → bucket + `week` · → `…&assignee=<id>` |
| | Panel E bar | → `/app/dropdown-options/soundLight` |
| **F&B** | Hero on-time | → `/app/history/requests?requestKind=fmb&delivery=late` |
| | Gate queue · Panel B | → `/app/inbox/proposals?stage=fmb-review` · → `…&outcome=<o>&week=<w>` |
| | Panel A segment/outlet | → `…&outlet=<code>&orderStatus=<s>` |
| | Panel D · Panel F cell | → `/app/cafeterias/menu-oversight?outlet=<c>` · `…&dietary=<id>` |
| | Water KPI · Panel E | → `/app/dropdown-options/waterNormal` |
| **Logistics** | Hero · over-capacity · venue | ⇣ Panel A · ⇣ Panel A filtered · ⇣ Panel D |
| | Panel A cell | → `/app/inbox/requests?requestKind=logistics&item=<id>&date=<d>` |
| | Panel B/F bar | → `/app/dropdown-options/logistics[?item=<id>]` |
| | Panel D connector | → `/app/proposals/review/:id` ×2 |
| **Photography** | Hero backlog | → `/app/ongoing/requests?requestKind=photoVideo&phase=post-event&sort=schedule&order=asc` |
| | Panel A stage | → `…&phase=<stage>` |
| | Panel C dot · Panel D dot | → `/app/history/requests` at that proposal · → `…&assignee=<id>` |
| | Roster KPI | ✕ structural fact, no action |
| **Student Services** | Hero · splits · congestion | ⇣ Panel A · → `…&split=true` · ⇣ Panel B |
| | Panel A segment · Panel B cell | → `…&startPoint=<id>&date=<d>` |
| | Uncapped KPI | → `/app/dropdown-options/campusTourStart` |
| | Panel D point | → `/app/history/requests?tourType=<id>&week=<w>` |
| **Transport** | Hero · seat fill · bound days | ⇣ Panel A · ⇣ Panel B · ⇣ Panel A filtered |
| | Panel A segment | → `…&vehicleType=<id>&date=<d>` |
| | Panel C bar · opportunity | → `…&route=<hash>` · → `/app/proposals/review/:id` ×2 |
| | Panel D bar | → `/app/dropdown-options/transportation?type=<id>` |

### Heads of School

| Role | From | To |
|---|---|---|
| **Both** | Gate KPI | → `/app/inbox/proposals?stage=hos-hod-review` |
| | Stage waterfall segment | → `/app/history/proposals?stage=<s>&month=<m>` |
| | Applicant dot | → `/app/history/proposals?applicant=<id>` |
| | Peer / institutional series | ✕ R7 aggregate — no link, no pointer |
| **Computing** | Hero · Panel A bar | ⇣ Panel A · → `…?requirement=<name>&school=mine` |
| | Stalled KPI | → `/app/ongoing/proposals?stalled=true&sort=schedule` |
| | Panel F column | → `…?outcome=resubmitted&month=<m>` |
| **Business** | Hero · Panel A stage | ⇣ Panel B · → `…?school=mine&stage=<funnel-stage>` |
| | Collection KPI | → `…?payment=unpaid&school=mine` — counts only |
| | Panel B/C segment | → `…?fundingCategory=<c>&month=<m>` · `…?guestBand=<b>&month=<m>` |

### CFO and Cafeteria Manager

| Role | From | To |
|---|---|---|
| **CFO** | Hero · gate coverage | ⇣ Panel C · ⇣ Panel A |
| | Panel A cell | → `/app/history/proposals?paxBand=<b>&costBand=<c>` — with the P4 banner |
| | Panel A threshold drag | ✕ server-computed preview; changes no config |
| | Panel B/C/D/E/F | → `…?fundingCategory` · `…?month` · `…?school&format` · `…?payment=<s>` · `…?stage=cfo-review&outcome&month` |
| | Price coverage · Panel G | → `/app/cafeterias/menu-oversight?unpriced=true` · → `/app/dropdown-options/fundingMain` |
| **Cafeteria** | Hero at risk | → `/app/inbox/requests?requestKind=fmb&risk=true&sort=schedule` |
| | Panel A block | → `…&order=<selection_id>` |
| | Panel B dot | → `/app/history/requests?requestKind=fmb&claimedBy=<id>` |
| | Panel D bar · Panel E column | → `/app/menu?item=<id>` · `/app/menu?dietary=<id>` |
| | Staff KPI · Panel F | → `/app/cafeterias/my-staff` · → `/app/cafeterias/staff-requests-history` |

---

## 4. Worked journeys

**A Logistics head clears a stock-out.**
Opens the dashboard at 09:05. Hero reads 1.24, critical. Clicks it, landing in Panel A
anchored to the breaching cell — round tables, 12 September, 30 committed against 24
available. Clicks the cell, arriving at `/app/inbox/requests?requestKind=logistics&item=44&date=2026-09-12`
with three proposals listed. Opens the latest-submitted one, sends it back with a note
proposing the adjacent day. Returns via `returnTo`; the dashboard refreshes and the
hero reads 0.92. Four clicks from "something is wrong" to "it is not any more".

**A CFO argues for a threshold change.**
Gate coverage reads *4% of proposals · 31% of spend*. Opens Panel A, drags the
threshold rule from 50 toward 35. The server recomputes: coverage rises to 41% of spend
and the gate queue grows by about six proposals a month. Exports the panel's table view
and takes both numbers — the gain and its cost — to the System Admin who owns
`/app/admin/settings/policies`. Nothing on the dashboard changed any configuration.

**A Cafeteria Manager saves a lunch.**
Hero reads 3 at risk, next in 02:14. The Outlet Service Board shows a sandwich order,
40 portions, approved and unclaimed, hatched. Panel B shows one staff member holding
most of today's claims and another idle. Clicks the block, opens the order, nudges. If
it is still unclaimed an hour later, AI-41 raises it as `serious` and the manager has
the evidence for a staffing request — which KPI 4 already tells them will take about
six days to clear.

**A Head of School escalates.**
End-to-end time reads 11.4 days against an institutional 8.6. Panel A attributes 4.1 of
those days to Sound & Light, against an institutional 2.4 for the same requirement, on
62% of the school's proposals. The head opens the school's proposals carrying that
requirement, confirms the pattern, and takes it to the A/V head — who, on their own
dashboard, is already looking at a crew coverage ratio of 0.94 and an AI-19 card saying
the lane is one absence from stopping. Two dashboards, two scopes, one conversation
that both sides arrive at prepared.

---

## 5. Sidebar and route

No new route. `/app/dashboard` exists and currently loads `InternalPlaceholderComponent`;
Phase 1 of the roadmap replaces that `loadComponent` with the real component. The
`nav_page` row exists. The only data change is the grant, in
[01](01-role-hierarchy-and-access.md) § 2.1 — adding `cfo` and the all-cafeterias
`cafeteria` grant to the three that already cover the eight head roles.

**Landing behaviour.** `defaultRoleRouteGuard` decides where `/app` lands. Once the
dashboard is real and granted, it becomes the natural default for the ten roles that
have one; the eight who already hold the grant get it immediately, and the guard needs
no change beyond confirming it prefers `dashboard` when the page is in the user's nav
tree. Everyone else keeps their current landing page.
