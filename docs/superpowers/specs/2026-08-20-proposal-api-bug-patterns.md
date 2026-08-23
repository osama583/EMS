# Proposal API: recurring bug patterns and how to work this codebase

Companion to [2026-08-20-proposal-list-server-side-bucketing.md](2026-08-20-proposal-list-server-side-bucketing.md),
which has the full blow-by-blow of every bug found/fixed while porting the
list pages to server-side bucketing. This file is the distilled version:
not "what happened," but "what kind of mistake this always turns out to be,"
so the next bug gets found faster and doesn't get re-introduced somewhere
else in the same codebase.

## The one root pattern behind almost every bug so far

**The frontend and backend independently agreed on a JSON shape for each
field, and nobody kept them in sync when one side changed.** Every single
bug logged in the companion doc — the stage-casing mismatch, the missing
`departmentConfirmations`, the missing `requests` array, the un-stringified
`agenda.time`, the `coOwners`/`organizers` `name`/`notes` mismatch, and the
Event Category id-vs-name mismatch — is a variant of this same thing:
**one side changed its idea of the contract; the other side didn't move.**

None of these were logic bugs. All of them were silent, because:
- Python dicts and TypeScript's loose `EditableRow = Record<string, any>`
  type both happily let you read a key that was never set (`undefined` /
  `KeyError`-free `.get()`), so a shape mismatch produces **wrong data, not
  a crash** — until something downstream (a `NOT NULL` constraint, a
  `UniqueViolation`, `jsonify()` hitting a non-serializable type) turns it
  into a loud failure far from the actual mistake.
- `jsonify()`/Flask will happily serialize almost anything except a handful
  of Python types (`datetime.time`, `Decimal` in older Flask, etc.) — so a
  raw DB row passed straight through works fine for months until a row with
  that one column populated finally reaches it.

**How to apply this**: when a field looks wrong on screen (blank, missing,
falling back oddly) — before touching frontend styling/logic — go read
*both* sides' idea of that field's shape side by side: the TypeScript
model/computed that builds the save payload, and the Python function that
reads `payload.get(...)` for that same key. Diff them by hand. This is
almost always faster than adding logging or guessing.

## Concrete rules that fell out of this

1. **A picker's `value` is not guaranteed to be a name just because it looks
   like one, and is not guaranteed to be an id just because a `staffId`
   field exists in the DB schema.** Check the actual `SelectOption`/
   `StaffOption` construction in the `.ts` file (e.g. `event-proposal.ts`'s
   `categoryOptions`/`coOwnerStaffOptions` computeds) before assuming what a
   save payload's array actually contains. `_resolve_format()` already had
   the right pattern (accept id-or-name, id first) — `_resolve_category()`
   didn't exist and should have mirrored it from the start. **When adding a
   new picker-backed field, always ask: does the picker's `value` carry an
   id or a name, and does the write path resolve the same way as every
   other picker in this file?**

2. **Every raw `fetch_all()`/cursor row that gets projected straight into a
   JSON response is a liability if any of its columns can be a
   `date`/`time`/`Decimal`/other non-JSON-native type.** `project()` in
   `proposals.py` is inconsistent on this today: `scheduleRows`,
   `_read_requirement_rows()`, and `_flatten_requests()` all wrap every row
   in an explicit dict with `str(...)` on date/time columns; `agenda` didn't,
   and that's what 500'd on proposal 181. **When adding a new child-table
   projection, always build the explicit dict-with-`str()` version, never
   `return fetch_all(...)` directly, unless every column is text/int/bool.**

3. **A table's primary key is the actual contract for "can this array have
   duplicates," not client-side assumptions.** `request_categories`'
   `(request_id, category_id)` PK meant a duplicate value in the
   `eventCategories` payload — or two overlapping saves of the same draft —
   was always one `UniqueViolation` away from a 500, and nothing in
   `write_children()` defended against either case. **Any insert loop
   writing into a table with a composite PK derived from payload values
   needs either an in-payload dedupe, an `ON CONFLICT DO NOTHING`, or both —
   don't assume the frontend will never send you a duplicate, and don't
   assume `clear_children()` + re-insert inside one transaction protects you
   from a second overlapping request's transaction.**

4. **`EditableRow = Record<string, any>` (and Python's dict-typed payloads)
   mean TypeScript/mypy will never catch a field-name mismatch here.**
   `row['name']` vs `row['firstName']`/`row['lastName']`, `row.get('note')`
   vs `row.get('notes')` — none of these are type errors, so `tsc --noEmit`
   passing clean is *not* evidence the contract is correct, only that the
   code compiles. **Don't treat a clean `tsc`/pytest run as proof a
   read/write round-trip is correct — always verify the actual round-trip
   live (`POST`/`PATCH` a payload shaped exactly like the real client sends,
   then `GET` it back and diff) for anything touching one of these loose-
   typed row collections.**

## How to verify a fix in this codebase (the pattern that kept working)

Every bug in the companion doc got the same verification recipe, and it's
worth repeating on purpose rather than reinventing each time:

1. **Reproduce first, against the live dev server, with a payload shaped
   exactly like the real client sends** (check the `.ts` file's actual
   `save()`/payload-building method for the real key names/value types —
   don't guess). Confirm you get the *exact* reported error before touching
   any code.
2. **Fix at the layer the contract actually lives in.** These bugs were
   consistently backend-side (the frontend's shape was usually the "real"/
   intended contract; the backend hadn't kept up) — check `git log`/read the
   frontend field-by-field before assuming the frontend needs to change.
3. **Re-run the exact repro** and confirm it now returns the expected
   status/shape.
4. **Run the full backend suite** (`pytest tests/ -q`) and diff against the
   known baseline — at the time of writing this is **151 passed / 18
   failed**, where all 18 failures are `test_api_e2e.py` tests hitting
   `429 rate_limited` because that file's hardcoded `PASSWORD = "Demo@1234"`
   doesn't match the real seeded password (`Demo-EMS-2026`), which burns the
   login rate limit retrying with the wrong password before ever reaching a
   real assertion. **This is a pre-existing fixture bug, not a regression
   signal** — if the failure count or the specific failing tests change from
   this baseline, that's real; if it's still exactly these 18 for the same
   reason, it's not related to your change. (Worth fixing the fixture's
   password some day so this baseline stops needing to be memorized — see
   `docs/superpowers` for whether that's already tracked.)
5. **Run `npx tsc -p tsconfig.json --noEmit`** — clean is necessary but,
   per the rule above, not sufficient on its own for row-shape bugs.
6. **Clean up any test data created during reproduction** (`DELETE` draft
   proposals created via curl, restore any real record you PATCHed for a
   round-trip test back to its original values) before considering the fix
   done.

## What NOT to do

- Don't add defensive fallbacks on the frontend for a field the backend is
  sending wrong (e.g. `row['name'] ?? row['firstName']`) — that hides the
  contract mismatch instead of fixing it, and the two sides drift further
  apart next time either one changes. Fix the shape at its source.
- Don't assume a clean compile or a clean test run means a specific
  read/write round-trip works — see rule 4 above.
- Don't skip the "reproduce first" step even when the cause seems obvious
  from reading the code — the Event Category bug turned out to be *two*
  independent bugs stacked on each other (id-vs-name AND a duplicate-key
  race), and only live reproduction of each scenario separately made that
  visible.

## A second pattern: "give me everyone" endpoints that were never actually scoped

Distinct from the shape-mismatch pattern above — this one is about
**over-broad data**, not wrong-shaped data. `GET /auth/internal-users`
(`backend/app/api/auth.py`) returns literally every active internal account,
and its own docstring already half-admits the smell: *"Proposal authors need
a small, read-only list of internal colleagues... and department heads need
it to populate assignment pickers"* — one endpoint, two unrelated real
questions ("who can be a co-owner/organizer on THIS proposal" vs "who's on
MY OWN department's staff roster"), neither of which is "every active
internal account," bolted onto the same unfiltered response and left for
each caller to filter (or not) on its own.

- `proposal-department-view.ts`'s "Assign Department Work" picker filters
  this list client-side by `unitCode` — correct in effect (a department
  manager really can only assign their own unit's staff), but only because
  it happens to filter at all.
- `event-proposal.ts`'s Co-owner/Organizer picker did **no filtering
  whatsoever** — every active internal account (the CFO, a Cafeteria
  Manager, anyone) was offered as a candidate to act in the applicant's
  place, regardless of whether that role could ever plausibly submit or
  touch a proposal.

**Fixed** by adding `identity.users_with_page_access(page_code)` in
`backend/app/services/identity.py`, which reuses the *exact* predicate
(`_satisfies_grant`) the admin's Page Visibility system already uses to
decide sidebar-page access (`nav_tree_for()`, called from `/auth/me` on
every login) — run once across every active internal user instead of once
per logged-in user. `GET /proposals/collaborator-candidates` exposes it
scoped to the `proposal-form` page code specifically: whoever the admin has
granted access to `/app/forms/event-proposal` is exactly "could plausibly BE
an applicant," which is the actual eligibility rule for both Co-owner (can
resubmit/act exactly as the applicant) and Organizer (helps run the event) —
confirmed live: 41 total active internal users → 28 candidates, correctly
excluding CFO and Cafeteria Manager (neither holds that page's grant) while
keeping F&B's head-of-department (who does).

**The rule this generalizes to**: when a picker offers "which user(s)" for
some proposal-facing purpose, the question is almost never "every active
internal account" — it's "who is *structurally eligible* for this specific
role in this specific flow." If that eligibility rule already exists
somewhere else in the system (here: the Page Visibility admin settings,
which already answer "can this user reach this part of the app" precisely),
reuse that predicate server-side rather than inventing a new one, and
**never** solve it by shipping the unfiltered list and filtering in the
browser — the browser doesn't decide who's allowed to be a collaborator,
the server's authorization model does, and every caller of an unfiltered
"everyone" endpoint is one missed `.filter()` away from repeating this bug.

### The same bug, found a second time in the sibling picker

The very next report was "Assign Department Work" — a picker inside the
*same file* (`proposal-department-view.ts`) that the doc above already flagged
as "correct in effect, but only because it happens to filter at all." That
caveat turned out to matter: the client-side filter kept `/auth/internal-users`
(every active internal account, over the wire, to every department head who
opens the page) and trusted the browser to only show the manager's own unit.
Nothing stopped a modified request or a bug in that `.filter()` from leaking
another department's staff roster.

**Fixed** the same way: added `identity.staff_in_units(unit_codes)` and
`GET /proposals/department-staff-candidates`, which derives the caller's own
headed unit(s) from their **own session** (`current_principal().headed_units`
— never a client-supplied unit code, which is the part that actually closes
the hole) and returns only that unit's non-head staff. The frontend dropped
its `unitCode` filter entirely; there's nothing left to filter, because the
server never sends the wrong department's roster in the first place.

**The generalized rule sharpens further**: "it happens to filter correctly
client-side today" is not the same as "it's safe." A correct client-side
filter over an unfiltered endpoint is still one edit away from a leak — the
authorization boundary has to be where the data leaves the server, not where
the UI happens to hide it afterward.

### The same report also carried a caching bug, not a scoping bug

The user's exact words: *"I updated who can view the proposal through the
page visibility in admin setting and it did not work, the 'Co-requesters /
Co-owners' still showing the user I excluded... if you hardcoded it, I don't
want that — I want the permission to update when I update it in the admin
setting."` The backend was never hardcoded — `users_with_page_access()`
queries `nav_page_grants` fresh on every request, and this was verified live:
editing a grant's role list via raw SQL (simulating what the admin UI's
`PATCH` does) changed the candidate count from 14 to 10 immediately, no
delay, no restart needed.

The actual cause was `internal-user-directory.service.ts`'s
`.pipe(shareReplay({ bufferSize: 1, refCount: true }))` on both `users$` and
`proposalCollaboratorCandidates$`. `shareReplay` caches the *first* HTTP
response for as long as the Angular service instance (root-provided, so
effectively the whole session) stays alive and subscribed — so once any
component subscribed once, every later subscriber across the whole app
session got that same stale snapshot, even after the admin's edit landed in
the database seconds later. This looks exactly like "hardcoded" from the
outside (same answer no matter what changes server-side) without actually
being hardcoded anywhere.

**Fixed** by removing `shareReplay` from both observables — every
subscription now issues a fresh `HttpClient.get()`, matching how every other
list endpoint in this app already behaves. There's no per-render cost here
worth caching against (these pickers open rarely, not per-keystroke), so
there was no tradeoff to weigh.

**The rule this adds**: `shareReplay` (or any cache) over an HTTP call is a
correctness bet that the underlying data won't change during the cached
lifetime. For anything gated by an *admin-editable* permission — a grant, a
role, a flag someone can flip from a settings screen — that bet is wrong by
construction, because the whole point of the settings screen is to let it
change. Reserve `shareReplay` for data that's genuinely static for the
process lifetime (catalog config, option lists tied to a schema migration),
never for anything whose source of truth includes an admin "Save" button.
