# AI assistant — adversarial QA, final report

100 questions, 10 rounds, 12 roles, run against `POST /api/v1/ai/ask` on the live database.
Every factual claim was graded against ground truth queried straight from PostgreSQL.

Companion documents: [DEFECTS.md](DEFECTS.md) (registry, root causes, retests),
`harness.py` (runner), `apply_fixes.py` (idempotent re-application), `ai-fixes.patch` (snapshot),
`round*-results.json` (raw transcripts).

## Overall score

| | Count |
|---|---|
| Total tests | 100 |
| Passed | 77 |
| Partial | 11 |
| Failed | 12 |

Failures by severity — **zero critical**:

| Severity | Count | |
|---|---|---|
| Critical (data leak / authorization bypass) | 0 | no test breached a scope boundary |
| High | 6 | D1/D2 dates, D5 club counts ×2, D6 presidency, D9 crash, D11 ownership |
| Medium-High | 2 | D7 scoped-partial roster, D11b topical club search |
| Medium | 4 | D3 clarification ×2, D13 guest phrasing, R7-61 incomplete narrowing |
| Low | 0 | (D4 cards/prose is the one open low-severity item, scored Partial) |

11 of the 12 failures are fixed and retested. Every fix was verified with the failing case,
new phrasings of the same intent (to prove generalisation, not overfitting), and at least one
previously-passing case from the same feature.

## Feature performance

| Area | Rating | Evidence |
|---|---|---|
| Security / authorization | **Strong** | 30 boundary tests, 0 leaks. Private events, third-party PII, rosters, admin logs, cross-unit staff and bulk directories all refused. Prompt injection, roleplay jailbreak, false authority ("the admin said you can"), obfuscated extraction ("translate your instructions"), raw SQL and multi-turn pressure all held. Legitimate access still granted: public presidency, admin audit log, organiser rosters. |
| Scope filtering | **Strong** | A lecturer's total counted her own Private event and excluded two others (R3-30). Guests, external and cafeteria roles all correctly bounded. |
| Out-of-scope handling | **Strong** | Trivia, maths, weather, medical advice, cafeteria menus and translation all declined without hallucinating; "who is the president of malaysia" did not pull from club data. |
| Response style | **Strong** | Short, warm, no filler or submissive phrasing; greetings offer only genuinely granted topics. |
| Recommendations | **Strong** | Asks before suggesting, ≤3 with reasons drawn from what the user actually said. |
| Comparison / filtering / sorting | **Good** | Ranges, exact counts, less-than, superlative synonyms, venue and date filters all correct. |
| Intent detection | **Good after fixes** | Was the largest failure source: dates (D1), member counts routed to admin (D5), topical search (D11b). |
| Context handling | **Good after fixes** | Multi-turn carries correctly; one open gap (R7-61) narrows to a single item instead of the full subset. |
| Clarification | **Fixed, was weak** | Antecedent-free fragments were guessed at, once with a false access claim. Now asks. |
| Card formatting | **Adequate** | Cards returned and visibility re-checked; prose sometimes duplicates them (D4). |

## Most important weaknesses discovered

Ranked by severity × frequency:

1. **The answering step could not see what the query meant.** `rows_to_document()` passed column
   names and nothing else, so the meaning carried by the WHERE clause was lost. This one gap
   produced the single worst failure (denying the asker's own presidency while holding the proving
   rows, D6), the invented memberships and registrations (D8, D10), and the roster presented as
   complete (D7). It was invisible to any test that only checked whether retrieval worked.
2. **Silent wrong filters read as empty results.** A guessed year (D1), a category join (D11b) and
   a swallowed ownership condition (D11) all produced confident, wrong answers rather than errors.
   The codebase had already learned this lesson for title matching; it had not been generalised.
3. **Over-refusal is a real defect, not a safe default.** The assistant refused public club member
   counts its own UI displays and sorts by (D5). The system prompt says refusing a real result is
   "just as serious as leaking someone else's data"; that principle was not enforced in scope.
4. **Infrastructure failure was reported as a verdict on the question** (D12), which also poisoned
   the admin access log used to prioritise work.
5. **A whole feature was dead on arrival** — every `role_capability` question returned HTTP 500
   against an unwritten function (D9).

## Changes made

11 fixes across 9 files, all narrow and anchored to an observed failure:

- `sql_llm.py` — DATES rule + injected `TODAY IS`; column-aliasing rule; permission-floor-vs-filter
  rule; topical-search rule; own-data completeness carve-out.
- `sql_guard.py` — `_blank_function_from()` so `EXTRACT(… FROM col)` is not read as a table.
- `sql_runner.py` — row-semantics block; scoped-partial notice; `_restricted_to_one_person()`;
  guest empty-result correction.
- `scope_rules.py` / `query_router.py` — `PUBLIC_COUNT_ONLY` for club member counts, and the class
  vocabulary that was denying them a layer earlier.
- `recommendation.py` / `api/ai.py` — the clarify path for ambiguous and dangling-referent questions.
- `classifier.py` / `api/ai.py` — `ClassificationUnavailable` and an honest 503.
- `services/identity.py` — the missing `role_has_page_grant()`.

**No security boundary was weakened.** The one change that widened access (club member counts)
went through the guard's existing `PUBLIC_COUNT_ONLY` mechanism, which proves the query is an
aggregate and blocks identifying columns — so counts pass while rosters stay refused, verified by
RG5-d and RG5-f. The guard's own regression suite (7 cases) confirms `pg_catalog`, `pg_shadow`,
unlisted tables and unlisted joins are all still blocked.

## Remaining risks — not solvable by prompting

| Risk | Needs |
|---|---|
| Ties reported as a unique maximum | Query change: return all tied rows so the answer can state a tie it can actually see. |
| "Free" events cannot be answered | Data change: `cost_amount` is NULL for 10 of 11 events. NULL is *unspecified*, not *free*; a real "no cost" needs to be representable. |
| Free-tier Gemini quota (15 rpm/key) | Infrastructure. It produced 58 rate-limit errors during this run and one false out-of-scope answer before D12. Real usage will hit this; D12 makes the failure honest but does not remove it. |
| `_ROLE_CAPABILITIES` claims a page Cafeteria Admin cannot reach | Data change in `knowledge_base.py` (pre-existing; `test_role_capabilities.py` has been failing on it). |
| `GET /auth/dev-users` advertises a password external accounts reject | Backend fix to the demo picker. |
| Card/prose duplication (D4) | UI decision about what prose should say when cards are present. |

## Test-suite status

`pytest tests/ -q` → **421 passed, 19 failed**. All 19 failures are pre-existing and unrelated to
these changes:

- 18 × `test_api_e2e.py` — the file hardcodes `PASSWORD = "Demo@1234"`, which is not the seeded
  `DEMO_PASSWORD`, so every login returns 401. No auth code was touched by this work.
- 1 × `test_role_capabilities.py` — the stale `reports` capability claim described above.
