# Proposal list pages: server-side bucketing, pagination, sorting

Status: implemented
Date: 2026-08-20

See also: [2026-08-20-proposal-api-bug-patterns.md](2026-08-20-proposal-api-bug-patterns.md) —
the recurring *patterns* behind the bugs logged below (frontend/backend
contract drift, unstringified DB rows, composite-PK dedup), distilled so
they're easier to spot next time instead of re-discovered one at a time.

## Problem

`GET /proposals` returned every proposal the caller may see (up to 200 rows,
one page) in a single request, and four different Angular pages —
Inbox/Ongoing/History (`hub-proposals.ts`), Drafts (`records-page.ts`), and
the department-scoped Requests hub (`hub-requests.ts`) — each fetched that
same full set and then, entirely in the browser:

- split it into Inbox / Ongoing / History via `proposal-visibility.ts`'s
  `proposalSectionForUser()` (a large role/stage decision tree),
- filtered it by search text and status/category,
- sorted it,
- and sliced out one page's worth of rows.

This meant pagination only controlled how many rows were *shown*, not how
many were *fetched* — page 2 of any bucket was still served from the same
200-row fetch, so anything past that ceiling silently vanished. It also meant
every tab switch re-fetched and re-computed the same full set from scratch.

The user asked for all of this to move server-side: each page's bucket
filtered in SQL, pagination controlling the actual fetch, and sorting
(specifically by Event Schedule) added.

## Bugs found while porting this (fix them first if something looks wrong)

Porting `proposalSectionForUser()` faithfully required first fixing three
**pre-existing, independent bugs** it was silently working around or being
broken by. If proposal stage/status/bucket display ever looks wrong again,
check these first — they are not part of the new bucket logic itself, but
everything downstream depends on them being correct:

1. **Stage string casing mismatch.** The backend sent `request.status` as
   snake_case (`hos_hod_review`, `completed_approved`, ...) directly as
   `workflow.stage`, but the client's `ProposalStage` enum is kebab-case
   (`'hos-hod-review'`) and additionally splits `completed_approved` /
   `completed_rejected` into `'approved'` / `'rejected'` with no `completed_`
   prefix. Every `===` comparison against `ProposalStage.*` in
   `proposal-visibility.ts`, `proposal-status.models.ts`, and
   `proposal-reviewer-view.ts` was therefore silently false for any proposal
   past `draft`. **Fixed** in `backend/app/services/workflow/constants.py`
   (`STAGE_FOR_CLIENT` dict + `stage_for_client()`), applied to
   `workflow.stage` and `workflow.resumeStage` in `proposals.py`'s
   `project()`. The top-level `status` field on single-proposal reads is left
   as the raw DB value on purpose — `event-proposal.ts` and
   `records-page.ts` compare it against `'draft'` literally, which needs no
   translation either way.

2. **`departmentConfirmations` was never populated.** `project()` never set
   this key at all — `proposal.workflow.departmentConfirmations` was always
   `undefined`, and `proposal-visibility.ts:81`
   (`departmentAwaitingApplicant`) calls `.some()` on it with no `?? []`
   guard, which would throw on any proposal that had reached
   `department_review`. **Fixed**: `_department_confirmations()` in
   `services/proposals.py`, built from `request_task` rows at
   `stage_code = 'department_review'`. `confirmed` is `true` for any status
   except `pending`/`resubmitted` (mirrors `authorize_department_task`'s
   "has the department actually acted" test).

3. **`proposal.requests` (the flattened per-department display rows) was
   never populated either.** `hub-requests.ts` iterated
   `for (const request of proposal.requests)` — `undefined`, so that entire
   tab threw on every real (non-empty) proposal. **Fixed**: `_flatten_requests()`
   in `services/proposals.py`, reading each `request_*` table's frozen label
   column directly (`item`/`type`/`service`/`food_type`/`option_label`/
   `main_item`+`sub_item`) — a read-only display summary, not the
   editable/option-id-referencing shape `_read_requirement_rows()` produces
   for the applicant's own form.

Verified live for all three: submitted a real proposal through
HOS/HOD-approve → department_review, and confirmed `workflow.stage`,
`departmentConfirmations`, and `requests` all came back correct and
consistent with what each consuming page expects.

4. **`agenda` (brief_agenda rows) returned a raw `datetime.time` in the
   `"time"` column, un-stringified, causing `GET /proposals/<id>` to 500 with
   `TypeError: Object of type time is not JSON serializable` for any proposal
   with at least one agenda row.** `project()` was assigning
   `fetch_all(cur, 'SELECT "time", activity, ...')`'s result straight to
   `projected["agenda"]` — every other date/time column read in this file goes
   through `str(...)` before landing in the response dict (see `scheduleRows`,
   `_read_requirement_rows`, `_flatten_requests` above), but this one spot
   didn't. Found when reopening draft proposal 181, which has an agenda row.
   **Fixed**: `project()` now maps each `brief_agenda` row into a plain dict
   with `"time": str(r["time"])`, same pattern as everywhere else. Verified
   live: `GET /proposals/181` now returns 200 with
   `agenda: [{"time": "18:06:00", ...}]` and the draft loads end to end
   (`requestRows` has all 8 types, `requests` has 8 rows, `workflow.stage` is
   `"draft"`).

5. **`coOwners`/`organizers` had a long-standing field-name mismatch between
   frontend and backend that made every saved co-owner/organizer come back
   with no display name, which is why reopening a draft showed blank "Staff
   Name" cells, a false "Co-requesters / Co-owners is required" validation
   error even with rows present, and a completely empty Edit modal.** The
   frontend's picker (`event-proposal.ts`'s `confirmAddCoOwner` /
   `setTableDraftValue`) has never used a numeric staff id — `StaffOption`
   sets both `value` and `label` to the staff member's display name — and it
   sends/expects rows shaped `{name, email, role}` (organizers add `notes`,
   plural). The backend, on both write and read, instead spoke
   `{staffId, firstName, lastName, email, role}` (organizers: `note`,
   singular) — a shape that was never sent by the client, so every write
   silently stored `staff_first_name/staff_last_name = ''` and
   `staff_id = NULL`, and every read handed back an object with no `name` key
   at all. `row['name']` was therefore always `undefined`, which is exactly
   what fed the `required` validator at `event-proposal.ts:995`
   (`this.coOwners().some((row) => row['name'] && row['email'])`) and the
   Edit modal's prefill (`editCoOwner`'s `row['name']`, and the generic table
   editor's `editTableRow` which spreads the row straight into `tableDraft`).
   This bug predates the bucketing work entirely — it's in `write_children`
   and `project()`, not anything touched while porting the list pages — but
   surfaced during the same "reopen a draft end-to-end" testing pass.
   **Fixed**: `write_children()` now inserts `row.get("name")` into
   `staff_first_name` (leaving `staff_last_name` as `''` — the schema's
   `NOT NULL` split into first/last was never populated correctly since this
   feature shipped, and there is no first/last split available from the
   picker to begin with) and organizers' note column from `row.get("notes")`
   instead of `row.get("note")`. `project()` now projects `coOwners`/
   `organizers` as `{staffId, name, email, role}` /
   `{staffId, name, email, role, notes}`, joining
   `firstName + " " + lastName` (falling back to email for rows saved before
   this fix, where both are blank) instead of exposing the raw
   `firstName`/`lastName` columns.
   **Data note**: rows saved before this fix have no first/last name in the
   database — that information was never captured, so it cannot be recovered.
   Their `name` now falls back to showing the email address until the
   applicant re-picks/re-saves that row. Verified live: PATCHed proposal 181
   with `coOwners`/`organizers` payloads shaped like the real client
   (`{name, email, role}` / `{..., notes}`), confirmed the response echoed
   `name`/`notes` back unchanged (round-trip verified with distinguishable
   test values before restoring the draft's real names), then re-ran the full
   pytest suite (151 passed / 18 failed, same pre-existing rate-limit-only
   baseline as before this change) and `tsc --noEmit` (clean).

6. **Selecting an Event Category and saving a draft (`POST /proposals/drafts`)
   could 500 with `UniqueViolation: duplicate key value violates unique
   constraint "request_categories_pkey"`, and even when it didn't 500, the
   category silently failed to save at all.** Two independent bugs stacked
   here:
   - `event-proposal.ts`'s `eventCategories` signal holds catalog **ids**
     (`categoryOptions()` maps `entry.id` as the picker's `value` — see the
     comment at `event-proposal.ts:106`), and that's what's sent in the save
     payload. But `write_children()`'s category loop only ever looked a value
     up by `event_category.name`, exactly like `eventCategories` used to
     before the id-based picker existed. An id like `"1"` never matches a
     `name`, so `fetch_one` returned `None` and the category was silently
     dropped — reproduced live: `POST /proposals/drafts` with
     `eventCategories: ["1"]` returned 201 with `eventCategories: []` in the
     response. This is the same id-vs-name split `_resolve_format()` already
     solved for `eventFormat` (its docstring: "Older drafts stored the name;
     the picker now sends the id") — categories never got the equivalent fix.
     **Fixed**: new `_resolve_category()`, mirroring `_resolve_format()`
     exactly (tries numeric id first, falls back to name lookup).
   - Separately, `request_categories`' primary key is `(request_id,
     category_id)`. `write_children()` had no guard against inserting the
     same category twice — reproduced live by sending
     `eventCategories: ["Academic & Career", "Academic & Career"]`, which
     500'd with the exact `UniqueViolation` from the bug report. Worse,
     `save_content()`'s `clear_children()` (DELETE) then `write_children()`
     (INSERT) is two statements in one transaction, so two *overlapping*
     saves of the same draft (e.g. an autosave firing while the user is still
     interacting) can race across transactions and hit the same
     `UniqueViolation` even with a single, non-duplicated category in each
     individual payload — reproduced live by firing two concurrent
     `POST /proposals/drafts` calls at the same draft; one consistently 500'd
     before the fix. This matches the bug report precisely: "I get this error
     ... only cuz of that field ... when I delete it it works" — deleting the
     category removes the only row that could collide.
     **Fixed**: the insert now dedupes within the payload (`seen_category_ids`
     set) and also uses `INSERT ... ON CONFLICT (request_id, category_id) DO
     NOTHING` so a genuine cross-request race can no longer surface a 500 —
     `clear_children()` at the start of every save already guarantees the
     final state reflects the latest payload regardless of which racing
     request's insert "wins".
   Verified live: reproduced both the 500 (single-payload duplicate name, and
   4 concurrent duplicate-category saves) and the silent-drop (id sent, name
   expected) against the running dev server before fixing, then reproduced
   the exact same three scenarios again after the fix — all now return 200
   with the category correctly present exactly once. Re-ran the full pytest
   suite after each change (151 passed / 18 failed, same baseline) and
   `tsc --noEmit` was already clean (no frontend changes were needed — the
   picker was already sending the right shape, only the backend was wrong).

## Design

### Whole-proposal bucketing (Inbox / Ongoing / History / Drafts)

`backend/app/api/proposals.py`:

- `_BUCKET_SQL` — one `CASE` expression, computed per row in the same query
  as the rest of the listing (not a second round-trip per row). Three
  buckets:
  - **history**: `r.status = ANY(TERMINAL_STATUSES)`
    (`completed_approved`/`completed_rejected`/`cancelled`)
  - **inbox**: `_INBOX_SQL` — true when the caller can act *right now*:
    - applicant, AND (`resubmission_required` OR a `department_review` task
      is `resubmitted` — `_DEPARTMENT_PUSHBACK_SQL`), OR
    - `hos_hod_review` and caller holds `head-of-school` on a unit the
      applicant also belongs to (narrower than the old *visibility* rule,
      which also allowed `head-of-department` — visibility ≠ can-act), OR
    - `fmb_review`/`cfo_review` and caller is the F&B head / CFO, OR
    - `department_review` and caller heads a unit with a `pending` task on
      this proposal, OR
    - caller is a cafeteria-manager with a `pending` selection for their own
      cafeteria, OR caller is the F&B head and any selection on this
      proposal is `resubmitted` (a Cafeteria Manager pushed an order back)
  - **ongoing**: everything else visible and non-terminal
  - No `isApplicantLike` short-circuit is needed (unlike the client
    version): in this app's role model an applicant-like account
    (student/lecturer/staff/external-user) never *also* holds a
    reviewer/department-head/cafeteria-manager role, so "applicant owed an
    action" and "caller owns a reviewer action" can never both be reachable
    for the same proposal by the same account. A plain `OR` is exact.
- `_STATUS_LABEL_SQL` — the human-readable label list pages show
  (`'HOS/HOD review'`, `'Revision required'`, `'Approved'`, ...), including
  the `'Changes requested'` override for an applicant whose proposal has a
  department push-back. Replaces `hub-proposals.ts`'s old `displayStatus()`.
- `GET /proposals` gained `?bucket=inbox|ongoing|history|drafts`,
  `?sort=updatedAt|schedule|eventTitle|applicant|status`, `?order=asc|desc`,
  `?q=` (substring, case-insensitive, on proposal code / event title /
  applicant name), `?statusLabel=` (exact match), `?category=` (exact match
  on an event category, drafts only). All applied inside one `WITH scoped AS
  (...)` CTE shared by the count query and the paginated row query, so the
  `WHERE`/`ORDER BY` SQL isn't duplicated. `sort=schedule` sorts by
  `MIN(event_schedule.date)` per proposal, `NULLS LAST` regardless of
  direction (an undated draft never jumps to the top of a descending sort).
- `GET /proposals/status-labels?bucket=` and `GET /proposals/categories?bucket=`
  — small, unpaginated `DISTINCT` queries feeding each list page's filter
  dropdowns (there are at most ~10 possible status labels total, so this is
  always cheap).
- The old unbucketed `GET /proposals?pageSize=200` behaviour is unchanged
  when `?bucket=` is omitted — `ProposalWorkflowService.list()` still works
  exactly as before, since nothing besides the three ported pages needed to
  change.

### Department-scoped bucketing (the Requests hub)

`hub-requests.ts` is a genuinely different question from the above: it shows
one row **per department_review task**, not per proposal, and a department's
own row must move to History the instant *their* task is done — independent
of sibling departments still working on the same proposal (`request.status`
stays `department_review` the whole time; see `request_task`'s own
docstring on parallel independence). Reusing `_BUCKET_SQL` (proposal-level)
would have been wrong here.

- `_TASK_BUCKET_SQL` — bucketed off `request_task.status` directly:
  `pending` → inbox, `completed`/`cancelled` → history, everything else
  (`approved`/`preparing`/`resubmitted`) → ongoing. `resubmitted` is
  deliberately *ongoing*, not inbox — the department sent it back, so they
  are now waiting on the applicant, not the other way around.
- `_routed_request_kinds()` — the caller's own department-request kinds,
  computed from `Principal.headed_units` against `UNIT_CODE_FOR_REQUIREMENT`
  (the 5 unit-scoped kinds) plus `['fmb', 'waterNormal']` if they head
  `food_beverage_services`. Mirrors `department-workflow.config.ts`'s
  `requestKindsForRole()` for the roles that actually appear in this tab.
- `GET /proposals/requests?bucket=&requestKind=&page=&pageSize=` — one row
  per (proposal, department request). Water folds into the same task row as
  food (one F&B task covers both `request_fmb` and `request_mineral_water`
  rows — see `create_department_tasks`), so a task whose `requirement_name`
  is `'fmb'` is split back into separate `fmb` and `waterNormal` rows by
  `_flatten_requests_for_task()`, filtered to whichever of those two kinds
  the caller is actually routed to (an F&B head gets both; nobody else is
  ever routed to either).
- `fmbSelections` (the cafeteria orders placed against one `fmb`/`waterNormal`
  request) are deliberately **not** included in the list response — fetched
  on demand via the existing `GET /proposals/{id}` only when
  `hub-requests.ts`'s details modal opens on an `fmb`/`waterNormal` row, then
  filtered client-side by `requestFmbId`. Embedding them on every row would
  cost a query per row for data nobody looks at most of the time.

### Frontend

- `proposal-workflow.repository.ts` gained `listPage()`, `listStatusLabels()`,
  `listCategories()`, `listDepartmentRequests()` alongside the existing
  `list()` (kept, unchanged, for callers that still want the raw feed).
- `hub-proposals.ts` and `records-page.ts` (drafts only — `notifications`
  is untouched, it's still explicitly flagged placeholder data, see the
  FLAGGED GAP comment in that file) now drive off `listPage()`: a debounced
  (300ms) search signal, a `sort` signal, and every filter/page/pageSize
  change triggers a fresh scoped request via `switchMap`. Both the status
  and category filter dropdowns are populated from the new small
  `/status-labels` / `/categories` endpoints rather than derived from
  whatever happened to already be in memory.
- `hub-requests.ts` now drives off `listDepartmentRequests()`, one row shape
  (`DepartmentRequestListItem`) replacing the old client-assembled
  `RequestRow` that iterated `proposal.requests` per proposal.
- `InternalTableColumn` gained an optional `sortKey` — when set, the column
  header renders as a sort-toggle button (`InternalDataTableComponent` in
  `internal-data-page-parts.ts`) and emits `InternalSortChange` up through
  `InternalDataPageComponent`. Every other page's columns are unaffected
  (the field is optional and defaults to a plain header). Only the Event
  Schedule column on the proposals/drafts pages sets it.

## What's still client-side, on purpose

- `notifications` (`records-page.ts`'s other `kind`) — unchanged, still a
  hardcoded static list. There is no `notification` table or concept in the
  schema; building one was explicitly out of scope (flagged, not
  implemented, per the FLAGGED GAP comment already in that file before this
  change).
- **`proposal-visibility.ts` in full, including `proposalSectionForUser` /
  `userOwnsCurrentProposalAction` / `roleOwnsWorkflowAction` /
  `userIsRelatedToProposal` / `reviewerHasRelation`.** These were the
  intended cleanup target once the four list pages stopped calling them —
  but `proposal-review-page.ts` (the single-proposal detail screen, opened
  when a row is clicked) turned out to *still depend on them directly and
  is unrelated to any list page*:
  - `readOnly` computed (line 54): `!userOwnsCurrentProposalAction(...)` —
    can *this* viewer edit *this* proposal right now.
  - `canView` computed (line 58): `proposalSectionForUser(...) !== null` —
    should this viewer be allowed to open this proposal at all.
  - `applicantCanResubmit` computed (line 63): also
    `userOwnsCurrentProposalAction(...)`.

  These are per-item authorization/display checks on a single
  already-fetched `ProposalReviewRecord` — the client-side mirror of what
  `authorize_stage_action`/`authorize_department_task` decide server-side for
  real mutations — not bucket computation for a list. Deleting them would
  break the review page. **Nothing was deleted from `proposal-visibility.ts`.**
  Only `hub-proposals.ts`, `records-page.ts`, and `hub-requests.ts` stopped
  calling the list-bucketing entry points (`proposalSectionForUser` /
  `userOwnsCurrentProposalAction`) for their own list rendering; the file
  itself, and every function in it, is still live code reachable from
  `proposal-review-page.ts`.

  If `proposal-review-page.ts` is itself ever rewritten to ask the server
  the same question (e.g. a `canAct`/`bucket` field on `GET
  /proposals/{id}`, mirroring `_INBOX_SQL` for a single row instead of a
  list), *then* this file's exported functions would finally have no
  callers and could be removed — but that page was out of scope here and
  was left exactly as it was found.
- Per-row click routing (`userIsApplicantForProposal`,
  `proposalNeedsApplicantAction`, `departmentAwaitingApplicant` in the same
  file) — decide what happens when *one specific, already-fetched* row is
  clicked (which page to navigate to), same category as the above: kept,
  unchanged, still needed by `hub-proposals.ts`'s `openProposal()`.

## Verification performed

All via direct API calls against the real dev database (not unit tests —
this is authorization/routing logic, verified end-to-end per role):

- Applicant sees their own submitted proposal in Ongoing (not Inbox) while
  it's at `hos_hod_review`; the HOS/HOD reviewer sees it in *their* Inbox.
- Department push-back (`send-back` on a task) puts the proposal in the
  applicant's Inbox with status label `'Changes requested'`, and the pushed-
  back department's own row lands in Ongoing (not History) for them.
- Logistics head approving their own task moves that task to Ongoing (not
  History — `approved` isn't terminal until `completed`), while F&B's
  separate task on the *same* proposal stays `pending` / Inbox for the F&B
  head the whole time (parallel independence, proven, not just asserted).
- F&B head's `/proposals/requests?bucket=inbox` returns both `fmb` and
  `waterNormal` rows from one folded task; `?requestKind=waterNormal`
  correctly isolates just the water row.
- Drafts: search (`?q=`), status filter, category filter, sort-by-schedule,
  and pagination all verified individually and in combination against the
  live drafts.
- `tsc --noEmit` clean throughout. Backend `pytest`: 151 passed / 18 failed
  both before and after this change, confirmed identical — the 18 failures
  are a pre-existing, unrelated fixture bug: `tests/test_api_e2e.py` hardcodes
  `PASSWORD = "Demo@1234"` but the seeded dev database's actual demo password
  is `Demo-EMS-2026` (from `backend/.env`'s `DEMO_PASSWORD`), so every test
  that logs in gets a real `401 invalid_credentials`. Confirmed via
  `git stash` that this fails identically on the pre-change code — not a
  regression, not touched by this work. If someone fixes that password
  mismatch later, expect the pass count to jump, not drop.

## Cleanup performed after verification

None needed, once actually checked — see "What's still client-side, on
purpose" above. The plan going in was to delete
`proposal-visibility.ts`'s bucket-computation functions once the four list
pages stopped using them, but `proposal-review-page.ts` turned out to still
depend on them directly for its own (non-list) authorization checks. No code
in `proposal-visibility.ts` was removed; only the four list pages' *own*
code was rewritten to stop calling it.
