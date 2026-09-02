# Implementation stage

**Date:** 2026-09-02
**Status:** approved, not yet implemented

## The problem

A proposal stays in `department_review` from the moment it reaches the
departments until the last staff member ticks off the last row of work. Those
are two different phases with two different owners, and collapsing them costs
us twice.

An applicant watching EVT-07322 sees "Department review" even though all six
department managers approved hours ago and assigned their staff. Nothing is
waiting on a manager. The label names the wrong people, and there is no way to
tell "a department has not decided yet" from "everyone decided, the work is
under way".

The event is also invisible until the very end. `_published_clause()` publishes
on `completed_approved` alone, so an event that is fully approved, staffed and
scheduled stays out of Explore Events until the last staff member marks their
row done - which may be the day before the event, or after it. Registration
opens at the same late moment, so seats cannot be filled while the work is
being prepared.

## What we are building

A new workflow status, `implementation`, between `department_review` and
`completed_approved`.

A request enters it when every department manager has approved and assigned -
that is, when no department task is still `pending` or `resubmitted`. From then
on the work sits in staff inboxes, and the event is published: it appears in
Explore Events, on the landing page and in Created by Me, and people can
register, all subject to the existing visibility tiers.

When the last task reaches a terminal status the request completes to
`completed_approved` exactly as it does today.

## Design

### The transition

`check_all_tasks_resolved()` currently asks one question - is every task
terminal? It becomes a phase recompute over the same task rows:

| Condition | Status |
|---|---|
| every task terminal (`completed`/`cancelled`) | `completed_approved` |
| no task and no cafeteria order `pending` or `resubmitted` | `implementation` |
| otherwise | `department_review` |

The cafeteria manager's approval of a food order is part of department review,
not of implementation: F&B and the cafeteria are both departments deciding.
So an approved F&B task with an order still awaiting its cafeteria manager
keeps the whole request in `department_review`.

That gap is real, not theoretical: `assert_work_allocated()` only requires a
live order to EXIST, so the F&B head can approve the task the moment F&B
places the order, before its cafeteria has answered.

It runs at the sites that call the old completion check, plus at every action
that can be the last department decision - none of which had such a call:

- `approve_task()`, on both its return paths
- `assign_staff()` and `assign_to_row()`, because assigning IS approving (the
  usual way a task reaches `approved` in practice)
- `approve_selection()`, where the old `check_fmb_task_resolved()` no-ops until
  every order is terminal, which is delivery - far too late

Entering implementation always means every row of work has an assignee.
`approve_task()` already refuses to approve a task with unallocated rows via
`assert_work_allocated()`, so "approved" implies "staffed" and the new status
cannot describe a proposal nobody is working on.

Tasks that skip straight to `completed` (an F&B task on a water-only request)
satisfy the rule the same way - they are neither `pending` nor `resubmitted`.

### Nothing moves backwards

Once a request is in implementation, `send_task_back()` raises a
`WorkflowError`. Every manager has already approved; the only work left is the
staff's. One guard in the service covers the single route that reaches it
(`POST /tasks/<id>/decision`).

This closes the question of a published event un-publishing itself: no path
returns a request from `implementation` to `department_review`.

`send_selection_back()` - the cafeteria manager pushing one food order back to
F&B - is frozen on the same condition, for the same reason: both are
departments deciding, and implementation begins only once they have.

Staff never had either action. They approve, prepare and complete their own
rows; they cannot reject a request or ask the applicant for changes, and that
does not change here.

### Publication

`_published_clause()` changes from `r.status = 'completed_approved'` to
`r.status IN ('implementation', 'completed_approved')`.

That single clause is what Explore Events, the landing page, event detail,
search, the public calendar, saved events and Created by Me all read - the file
keeps one definition of "published" precisely "so the list and the detail view
can never disagree about what is visible". Editing it publishes the event
everywhere at once.

Visibility tiers are untouched. Public reaches everyone including signed-out
guests, Internal reaches signed-in non-external users, Club Only reaches
members of the named clubs.

`_MASTER_CALENDAR_STATUSES` gains the value too.

**Registration needs no code change.** `register()` gates on `_load_published()`,
so it opens the moment the event publishes, and manual approval, proof of
payment and the `max_pax` cap all keep behaving exactly as they do today.

### Per-department status stays on the task rows

`request_task` already holds one row per department with its own status. That
is the per-department tracking the new stage needs, and it already works.

Task rows keep `stage_code = 'department_review'` and go on progressing
`approved -> preparing -> completed` underneath the new request status.
Re-stamping them to `'implementation'` would mean rewriting the six queries
that filter on that code for no change in behaviour.

Staff inboxes need no change either: the My Tasks page filters on each
assignment's own status, never on `request.status`.

### Everything else that reads a status

- `STAGE_FOR_CLIENT` gains `implementation -> 'implementation'`.
- `_department_confirmations()` must return its rows during implementation, not
  only during `department_review`, so the applicant keeps seeing which
  department is where.
- `api/proposals.py`: the applicant-facing stage-label CASE, and the
  active-proposal filters that enumerate the in-flight statuses.
- Dashboard demand and finance status lists and their display labels.
- The AI schema catalog's status enum.
- The email stage vocabulary and the "who holds this now" lookup.

### Escalation

`OVERDUE_STATUS` gains `implementation -> overdue_department`, reusing the
existing bucket on purpose: a proposal that would go overdue today must still
go overdue, just from a different starting status.

Overdue only fires once the event date has passed, and `_NOT_ENDED` already
hides past events from Explore, so no published event visibly disappears when
it goes overdue.

### Frontend

`ProposalStage.Implementation = 'implementation'` and a `stageLabel()` case.
The switch is exhaustive, so the compiler finds every site that must handle it.

Action gating needs no change: a department head with no `pending` confirmation
already falls through to Ongoing, and the cafeteria-manager and F&B branches of
`roleOwnsWorkflowAction()` are stage-independent. `TERMINAL_STAGES` is
unchanged - implementation is in-flight, not history.

### Migration

Migration 045 recomputes the phase for every request currently in
`department_review` and moves those with no `pending` or `resubmitted` task to
`implementation`. EVT-07322 and its siblings publish immediately.

## Testing

In `test_workflow_e2e.py`, against the real database:

- approving the last department lands the request in `implementation`, not
  `completed_approved`
- completing every row then completes the request
- a department send-back during implementation is refused
- a cafeteria order send-back during implementation is refused
- an approved F&B task with an order still pending its cafeteria manager keeps
  the request in `department_review`
- a task that skips to `completed` (water-only F&B) still lets the phase advance

For publication, covering the tier rules rather than only the happy path:

- a Public event in implementation appears in the published listing for a
  signed-out caller
- a Club Only event in implementation appears for a member and not for a
  non-member
- registration succeeds against an event in implementation

## Out of scope

- Re-stamping `request_task.stage_code`.
- Any change to how staff progress their rows.
- A distinct overdue status for implementation.
