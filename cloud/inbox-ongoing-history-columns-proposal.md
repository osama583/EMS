# Inbox / Ongoing / History — Table Columns & Action Icons Proposal

## Scope confirmed with you before writing this

- **Inbox** = items requiring action right now (proposals awaiting the viewer's review, or department requests just assigned to a manager/staff member).
- **Ongoing / Pending** = items already submitted/in motion that the viewer cannot currently act on (applicant's own proposal moving through review, or a manager/staff's approved-and-being-prepared request).
- **History** = completed items, whatever the final outcome (approved, rejected, completed, cancelled) — covering **both** proposal History and Request History, since you confirmed "Both."
- The **approve / reject / resubmit / take-action** UI is **not** being built now — it will live on a future detail page reached by a "view" row action. Confirmed: managers can approve or resubmit only (no reject); HOS/HOD (and FMB under a pax rule you'll define later) can additionally reject. Staff can only "take action" (update status). None of this logic touches the table — the table only needs one navigation action per row.
- Confirmed new, not-yet-implemented icons to include as placeholders only (no working logic yet): a **print** icon (all roles, prints the form) and a **bill** icon (Cafeteria Manager only, prints a bill). You confirmed a real priced bill needs a price field added to the menu item model later — flagged below, not built now.

## What exists today that this proposal must not contradict

- The proposal record model, `ProposalReviewRecord` (`src/app/core/proposals/proposal-review.models.ts:16-30`), has exactly these fields — nothing else exists to show:
  `id, proposalId, eventTitle, applicant, applicantInitials, schedule, shortIntroduction, goals, benefits, totalPax, status, category, requests[]`.
  Each `requests[]` entry (`ProposalDepartmentRequest`, same file, lines 6-14) has: `id, department, item, quantity, schedule, location, notes`.
- There is **no** structured price/cost field anywhere in the proposal or menu-item models — cost only ever appears as free text inside a `notes` string. A "bill" icon cannot compute a real total until a price field is added to `FoodRequestOption` (or similar) — this is flagged as a prerequisite, not part of this table refactor.
- There is **no formal status enum** — `status` is a plain string today. This proposal reuses existing status strings and status→tone mapping already in `records-page.ts` (`statusTone()`), rather than inventing a new enum.
- Today, "Inbox," "Ongoing/Pending," and "History" render through **two different generic components** with **two different data shapes**:
  - Applicant-facing proposal pages (Drafts/Pending/History) and the Inbox use `ProposalReviewRecord`-shaped fields.
  - Manager/staff-facing request pages (Ongoing Requests/Request History) and Staff Tasks use `ProposalDepartmentRequest`-shaped fields (department request, not the full proposal).
  This proposal keeps that distinction, because collapsing them would require inventing fields that don't exist on one side or the other.

## Roles, grouped by what they see in these three pages

| Role group | Roles | What "Inbox / Ongoing / History" means for them |
|---|---|---|
| Applicant / proposal submitters | `Applicant`, `ClubPresident`, `HosHod`, `Cfo` | Their own proposals: submitted → in review → completed |
| Department managers | `LogisticsManager`, `StudentServicesManager`, `FmbManager`, `CafeteriaManager`, `AvManager`, `PhotographyManager`, `TransportManager` | Department requests routed to them: needs assignment/approval → assigned & in progress → completed/cancelled |
| Department staff | `LogisticsStaff`, `StudentServicesMember`, `FmbWaterServicesStaff`, `CafeteriaStaff`, `AvTechnician`, `PhotographyStaff`, `TransportStaff` | Tasks assigned to them: needs action → in progress → done (this is the existing Staff Tasks page, included here for completeness since it's the staff equivalent of Inbox/Ongoing/History) |
| Not applicable | `ExternalUser`, `CafeteriaAdmin` | No proposal/request visibility at all today — excluded |

HOS/HOD and Cfo are proposal **submitters** in the current model (they get "Event Proposals" nav, same as applicants) — I found no separate HOS/HOD *reviewer* inbox in the codebase today. Your earlier note that HOS/HOD can approve/reject refers to the future detail page's permissions, not a distinct table page — flagged as an open item below.

---

## Proposed columns

### A. Applicant-facing: Inbox, Pending ("Ingoing"), History

One consistent column set across all three, built entirely from existing `ProposalReviewRecord` fields (plus the notification-only fields already used for Inbox, since Inbox today mixes messages and proposal updates):

| Column key | Label | Source field | Notes |
|---|---|---|---|
| `proposalId` | Proposal ID | `proposalId` | Already shown in Inbox; adding to Pending/History for consistency (currently missing there) |
| `eventTitle` | Event Title | `eventTitle` | Already shown everywhere |
| `applicant` | Applicant | `applicant` + `applicantInitials` | Already shown |
| `schedule` | Event Schedule | `schedule` | Already shown |
| `category` | Category | `category` | Currently used only for filtering, not shown as a column — proposing to surface it since it's already loaded data, not new |
| `totalPax` | Total Pax | `totalPax` | Already shown in Inbox; adding to Pending/History |
| `status` | Status | `status` | Already shown everywhere |
| `actions` | Actions | — | See action icons below |

Dropped from the current Inbox-only column set: `shortIntroduction` ("Short Introduction," currently a wide free-text column). Reasoning: it duplicates information available on the detail page, crowds the table, and isn't essential for triage — but flagging this as a judgment call for you to confirm or reject, since removing a column is a bigger change than adding one.

### B. Manager/staff-facing: Ongoing Requests, Request History (and Staff Tasks, included for consistency)

Built from existing `CollectionRecord`/`ProposalDepartmentRequest`-shaped fields already in use:

| Column key | Label | Source field | Notes |
|---|---|---|---|
| `reference` | Request Code | `reference` | Already shown |
| `title` | Event | `title` | Already shown |
| `category` | Service | `category` | Already shown (e.g. "Catering," "A/V Services") |
| `owner` | Assigned To | `owner` + `initials` | Already shown |
| `date` | Date | `date` | Already shown |
| `status` | Status | `status` | Already shown |
| `actions` | Actions | — | See action icons below |

No changes proposed to this column set — it's already consistent across Ongoing Requests and Request History today (both use the same shared block), and every field already exists.

---

## Proposed action icons

Single row action model per your confirmation: **one "view" icon on every row, every page, every role** — opens the (future) detail page. No approve/reject/resubmit appears in the table itself.

| Icon | Key | Label | Where it applies | Status |
|---|---|---|---|---|
| `visibility` | `view` | "View proposal" / "View request" | Every row, Inbox + Pending + History, all applicant-facing and manager/staff-facing pages | **Existing** — already used everywhere except Inbox (which currently uses the same icon under the key `open`); proposing to standardize the key name to `view` for consistency, icon stays identical |
| `print` (Material Symbols `print`) | `print` | "Print form" | Every row, every page, every role | **New placeholder** — no PDF/print logic exists yet; icon + button wiring only |
| `receipt_long` (Material Symbols) | `bill` | "Print bill" | Cafeteria Manager only — Ongoing Requests + Request History rows where `requestKind === 'fnb'` | **New placeholder** — requires a price field on menu items (`FoodRequestOption`) before it can generate a real total; icon + button wiring only for now |

Dropped: the Inbox `reply` action (icon `reply`) — confirmed unused/unwired in the current code (`inbox.ts:309-314` has no handler for it), so removing it is cleanup, not a functional change. The Notifications page's `read`/`open` pair is untouched, since Notifications wasn't named in your ask.

---

## Open items I'm flagging rather than deciding for you

1. **HOS/HOD reviewer view.** You said HOS/HOD can approve/reject on the future detail page, but today HOS/HOD only has a *submitter* Inbox/Pending/History (same as Applicant/Cfo) — there's no separate HOS/HOD reviewer queue in the routes or nav. When you're ready to build the detail page, you'll likely also need a reviewer-facing Inbox for HOS/HOD (and FMB, for the pax-threshold case) — out of scope for this table-column pass, just noting it so it isn't a surprise later.
2. **FMB pax-threshold rule.** You said you'll clarify this later — noted, no assumption made, nothing in this proposal depends on it.
3. **Bill icon data gap.** Confirmed with you: needs a price/cost field added to the menu item model before it can print a real bill. This proposal only adds the icon; the field addition is separate future work.
4. **Dropping `shortIntroduction` from the applicant-facing table.** Flagged above — please confirm this is wanted, since it's a removal, not just a standardization.

## What I did not propose

- No new status enum (kept using existing status strings + existing tone mapping).
- No changes to Notifications (not named in your ask).
- No new fields invented on `ProposalReviewRecord` or `ProposalDepartmentRequest`.
- No approve/reject/resubmit table actions (explicitly deferred to the future detail page per your instruction).
