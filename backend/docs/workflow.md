# The Proposal Workflow

The backend owns this entirely. Implementation is `app/services/workflow/`, and
every branch below is covered by `tests/test_workflow_e2e.py`.

## Overview

```
                          draft
                            │  POST /proposals
                            ▼
                    ┌─── skip rules ───┐
                    │                  │
                    ▼                  ▼
              hos_hod_review     (skipped — see below)
                    │                  │
         approve    │                  │
                    ▼                  ▼
              ┌──── total_pax > HIGH_PAX_THRESHOLD? ────┐
              │ yes                                   no │
              ▼                                          │
          fmb_review                                     │
              │ approve                                  │
              ▼                                          │
          cfo_review                                     │
              │ approve                                  │
              └──────────────┬───────────────────────────┘
                             ▼
                     department_review
              (parallel, independent tasks)
                             │  all tasks terminal
                             ▼
                     completed_approved
```

Any single-actor stage can also **reject** (→ `completed_rejected`) or **send
back** (→ `resubmission_required`). The applicant can **cancel** until the
deadline (→ `cancelled`).

## Statuses

`draft` · `hos_hod_review` · `fmb_review` · `cfo_review` · `department_review` ·
`resubmission_required` · `completed_approved` · `completed_rejected` · `cancelled`

## When `hos_hod_review` is skipped

That stage is answered by the head of a School the **applicant** belongs to.
Three cases make it inapplicable:

1. **The applicant heads their own School.** They would be reviewing themselves.
2. **The applicant is the CFO or the F&B head.** They are also the actors at
   `fmb_review` and `cfo_review`, so no stage above department review has an
   impartial reviewer for their proposal. Straight to `department_review`.
3. **The applicant belongs to no unit at all** — a flat-role-only account
   (System Admin, Club Admin, Cafeteria Admin). There is no head who qualifies.

Case 3 is a **fix over the mock**, which routed such proposals into
`hos_hod_review` where nobody could ever act on them. A permanent deadlock with
no error message: the proposal simply sat there.

## `resume_stage` — the send-back mechanism

When a reviewer sends a proposal back, the stage that did so is stamped on
`request.resume_stage`. The applicant's resubmission resumes **there**, not at
the start.

```
hos_hod → approved → fmb_review → approved → cfo_review
                                                 │ send back
                                                 ▼
                                        resubmission_required
                                        (resume_stage = 'cfo_review')
                                                 │ applicant resubmits
                                                 ▼
                                             cfo_review
```

F&B already approved. Without `resume_stage` the proposal would restart at
HOS/HOD and F&B would be asked again for a decision it has already given. Once
F&B has approved, it never sees the proposal again at approval level.

Resubmitting clears both `resume_stage` and `reviewer_comment`.

## Department review

One `request_task` per selected requirement, created the moment the stage opens.

| Requirement | Routed to |
|---|---|
| `logistics` | `logistics_and_facilities` |
| `transportation` | `transport_services` |
| `photoVideo` | `photography_services` |
| `soundLight` | `a_v_services` |
| `campusTour` | `student_services` |
| `fmb` | F&B (flat `assigned_role`) |
| `waterNormal` | **folded into `fmb`** — no task of its own |
| `fundingPurchase` | **never routed** — recorded only |

Water folds into F&B because F&B reviews food and water together as one unit of
work. Funding/Purchase is informational; the CFO's only workflow role is the
`cfo_review` stage.

A proposal whose only requirement is Funding/Purchase — or which selects nothing
— has nothing to fulfil and auto-completes immediately. Without that, it would
sit in `department_review` with no actor able to move it.

**Departments cannot reject.** Only `hos_hod_review`, `fmb_review` and
`cfo_review` can end a proposal. A department's only pushback is
send-back-with-comment, and the comment is mandatory — it is the entire message
to the applicant.

**Parallel independence.** One department sending its task back does *not* change
`request.status` or touch any sibling task. The proposal stays in
`department_review` while other departments carry on. When the applicant
resubmits, only tasks with status `resubmitted` reset to `pending`.

### Task lifecycle

```
pending ──approve+assign──▶ approved ──staff──▶ preparing ──staff──▶ completed
   │                                                                     │
   └──send back──▶ resubmitted ──applicant resubmits──▶ pending          │
                                                                          ▼
                                            all tasks terminal → completed_approved
```

Only the head of the routed unit may approve or assign, and only to someone who
belongs to that unit. Only the assigned staff member may move it to `preparing`
or `completed`.

## F&B cafeteria orders

Beneath the F&B task, each order lives its own life.

```
F&B approves the food request
        │ creates one request_fmb_selection per cafeteria
        ▼
     pending ──manager approves──▶ approved ──staff claims──▶ preparing ──▶ fulfilled
        │                            (shared pool)
        └──manager sends back──▶ resubmitted ──F&B edits──▶ pending
```

The F&B task completes only once **every** order is `fulfilled` or `cancelled`.

Two things differ from department review:

**A manager's send-back goes to F&B, not the applicant.** The applicant is never
involved in a cafeteria's pushback — F&B edits the order and re-sends it. Saving
the edit *is* the re-send; there is no separate re-approve step, and F&B may
switch the order to a different cafeteria entirely.

**Claiming is first-come-first-served.** An approved order sits in the shared
pool for every staff member of that cafeteria. The claim is a status-guarded
UPDATE:

```sql
UPDATE request_fmb_selection
   SET status = 'preparing', claimed_by_user_id = %s
 WHERE request_fmb_selection_id = %s AND status = 'approved'
```

Two staff clicking simultaneously cannot both win — the second gets `rowcount 0`
and a clear error. A read-then-write would let both through.

A water-only request has no food to fan out, so F&B's approval *is* the
fulfilment and the task completes there.

## Cancellation

The applicant or a co-owner may cancel until `CANCELLATION_DEADLINE_DAYS`
(default 3) before the event's **first** scheduled day. A multi-day event locks
on its first day, not its last.

Cancelling cascades: every open task and every open cafeteria order is cancelled
too, each with its own history row. Without the cascade, departments and
cafeteria staff mid-fulfilment would keep a dead event in their queue as pending
work.

`GET /proposals/{id}/cancellation` reports whether the window is open, computed
by the same function that enforces it — so the button's state and the rule can
never disagree.

## Audit trail

Every transition writes a `workflow_history` row inside the same transaction as
the change: action, actor, role, previous status, new status, comment,
timestamp. A state change without its audit record is not representable.

Auto-completions are recorded with `actor_role = 'system'`.

`GET /proposals/{id}/history` returns the trail, visible to anyone who can see
the proposal.

## Configuration

Read live from the `config` table — never hardcoded, so an admin change takes
effect without a deploy.

| Code | Default | Effect |
|---|---|---|
| `HIGH_PAX_THRESHOLD` | 50 | Above this, F&B and CFO review |
| `CANCELLATION_DEADLINE_DAYS` | 3 | Days before the event that cancelling closes |
| `MAX_EVENT_CATEGORIES` | 2 | Categories a proposal may select |
