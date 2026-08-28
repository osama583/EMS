# EMS seed dependency map

What had to be understood before a single row could be generated. Sources read:
`backend/migrations/001_initial_schema.sql` plus migrations 002–028, the
workflow package (`backend/app/services/workflow/`), `services/proposals.py`,
and the bucket SQL in `backend/app/api/proposals.py`.

## 0. The single most important fact

**There is no `event` table.** An Event *is* a `request` row that reached
`status = 'completed_approved'`. Publication is a query, not a record:

```sql
-- app/api/events.py::_published_clause
r.status = 'completed_approved'
AND r.event_visibility IN ('Public','Club Only')        -- +'Internal' when signed in
```

The event's date comes from `event_schedule`, its organiser from
`request.applicant_*`, its attendee counts from `event_registration`. So
"generate 50 published events" can only mean "drive 50 proposals to
`completed_approved` with a discoverable visibility and a schedule row".

## 1. Build order (parents before children)

```
L0  unit · role · users · config · event_requirements · event_category
    event_format · club_categories · dietary_information_options
    serving_unit_options
      |
L1  role_unit · user_unit_roles · staff/student/external_user_profile
    nav_page -> nav_page_grants -> nav_page_grant_roles / _grant_units
    logistics_options · transportation_options · media_options
    sound_light_options · campus_tour_start_options · campus_tour_type_options
    fmb_options (-> unit, serving_unit_options, dietary_information_options)
    funding_main_options -> funding_sub_options
      |
L2  clubs -> club_category_links · club_members
    club_join_requests · club_president_change_requests
      |
L3  request  (the proposal AND the published event)
      -> request_categories · application_requirements
      |
L4  request_logistics · request_transportation
    request_photography_videography · request_sound_light
    request_fmb · request_campus_tour · request_mineral_water
    request_funding_purchase
      |
L5  event_schedule · co_owners · organizers · important_people
    general_guest · brief_agenda · request_discussion_topics
      |
L6  request_task -> task_assignment
                 -> request_row_assignment
    request_fmb -> request_fmb_selection
    workflow_history   (audit row for every transition above)
      |
L7  event_registration · saved_event · notification_preference
      |
L8  cafeteria_staff_audit_log · ai_access_denial
```

Dropped by later migrations, must never be written: `water_normal_options` and
`request_mineral_water.option_id / option_label` (028), `cafeteria_staff_requests`
(015), `cafeteria` / `cafeteria_assignment` (already absent in 001).

## 2. Role ownership of records

| Record | Owned / actioned by | Mechanism |
|---|---|---|
| `request` (draft, edits, resubmit, cancel) | applicant | `request.applicant_user_id` |
| `hos_hod_review` | head-of-school of a unit the **applicant** belongs to | `user_unit_roles` self-join |
| `fmb_review` | head-of-department @ `food_beverage_services` | `heads_unit()` |
| `cfo_review` | flat `cfo` role | `has_role()` |
| `request_task` (department) | head-of-department of `assigned_unit_code` | `authorize_department_task` |
| `request_row_assignment` | the `staff`-role holder assigned to that row | `staff_user_id` |
| `request_fmb_selection` accept / push back | `cafeteria-manager` @ `unit_code` | `is_cafeteria_manager_of` |
| `request_fmb_selection` claim → ready → deliver | any `cafeteria-staff` @ `unit_code`, first claim wins | `claimed_by_user_id` |
| `clubs` | president = `clubs.user_id`; creator = `club-admin` | plain FK, **not** a role |
| `club_join_requests` | that club's president | `clubs.user_id` |
| `event_registration` approve / reject | the event's applicant or co-owner | `decided_by_user_id` |

`club-president` is not a role. A cafeteria is not an entity — it is a `unit`
whose code starts `cafeteria__`, and its staffing is ordinary `user_unit_roles`.

## 3. The proposal state machine

`request.status` (chk_request_status):

```
draft
  --submit--> hos_hod_review --approve--> [gate] --> fmb_review --approve--> cfo_review
                    |                                    |                       |
                    |                                    +--approve--------------+
                    |                                                            |
                    +- reject ---> completed_rejected                            v
                    +- send_back -> resubmission_required --applicant--> department_review
                                    (resume_stage remembers where)               |
                                                                                 v
                                          every request_task terminal --> completed_approved

cancel (owner only, while non-terminal AND
        today <= first_event_date - CANCELLATION_DEADLINE_DAYS) --> cancelled
```

The `[gate]` after HOS/HOD (`stages.stage_after_hos_hod`):

1. applicant is the CFO **or** heads F&B → straight to `department_review`
2. `total_pax > HIGH_PAX_THRESHOLD` → `fmb_review`, then `cfo_review`
3. otherwise → `department_review`

`hos_hod_review` is skipped entirely when the applicant heads their own school,
is the CFO or F&B head, or belongs to no unit at all.

Live config in this database (read at runtime, never hardcoded):
`HIGH_PAX_THRESHOLD = 30`, `CANCELLATION_DEADLINE_DAYS = 19`,
`MAX_EVENT_CATEGORIES = 2`.

## 4. Department review — parallel and independent

`create_department_tasks` fires once, on entry to `department_review`:

- one task per **distinct** selected requirement
- `waterNormal` folds into the `fmb` task (F&B reviews food and water together)
- `fundingPurchase` is dropped — recorded, never routed. A funding-only
  proposal creates zero tasks and auto-completes on the spot.

Routing (chk_task_routing — exactly one of the two columns is non-null):

| requirement | `assigned_unit_code` | `assigned_role` |
|---|---|---|
| logistics | `logistics_and_facilities` | — |
| transportation | `transport_services` | — |
| photoVideo | `photography_services` | — |
| soundLight | `a_v_services` | — |
| campusTour | `student_services` | — |
| fmb (+ waterNormal) | — | `fmb` |

Task lifecycle (`chk_task_status`). **Departments cannot reject** — only the
three single-actor stages can end a proposal:

```
pending --assign_to_row / approve_task--> approved --> preparing --> completed
   +---- send_task_back(comment) ----> resubmitted --applicant--> pending
   (cancelled only as a cascade from request cancellation)
```

For the five row-assignable kinds the manager approves *by assigning rows*
(`assign_to_row` flips the task to `approved` on its first assignee), each row
runs `assigned → preparing → completed`, and the task completes when every row
is done. `transportation` is capped at one assignee per row (one vehicle, one
driver).

## 5. F&B fan-out — the only two-level lane

```
fmb task approved by the F&B head
   +-> request_fmb_selection, one per cafeteria order:
         pending --manager approves--> approved   (enters that cafeteria's SHARED POOL)
            |                              +--staff claims--> preparing --> ready
            |                                                                +--deliver(photo)--> fulfilled
            +--manager sends back--> resubmitted --F&B edits--> pending
       the task completes only when EVERY selection is terminal
```

A manager's pushback goes to **F&B**, never to the applicant. A water-only
proposal has no `request_fmb` rows, so approving the task *is* the fulfilment.

## 6. Which screen each row lands on

`app/api/proposals.py` computes the buckets in SQL:

| Bucket | Rule |
|---|---|
| `history` | `r.status` terminal (approved / rejected / cancelled) |
| `inbox` | applicant with `resubmission_required` or a `resubmitted` task; or the reviewer / department head / cafeteria manager who owns the next action |
| `ongoing` | visible, not terminal, not the caller's turn |
| `drafts` | `status = 'draft'`, own rows |

The Department Requests tab buckets on the **task's own** status, not the
proposal's: `pending → inbox`, `completed`/`cancelled → history`, everything
else → `ongoing`. Cafeteria managers are bucketed on
`request_fmb_selection.status` by the same rule.

Filling every screen therefore requires, per role: pending tasks (inbox),
approved and preparing tasks/rows (ongoing), completed tasks (history),
`resubmitted` tasks (applicant inbox + department ongoing), pending selections
(cafeteria manager inbox), approved unclaimed selections (staff shared pool),
drafts, rejected proposals and cancelled proposals.

## 7. Timeline hazard

Every workflow function stamps `now()`, and inside a transaction Postgres
`now()` is the *transaction start*. Driving the real state machine therefore
produces a perfectly correct audit trail on a completely wrong clock — every
row would claim the event was approved today. The generator drives the real
functions and then rewrites the `now()`-stamped columns to a virtual clock
after each step, which is exact precisely because every such value equals the
one transaction timestamp.

Columns rewritten: `request.created_at / submitted_at / updated_at /
cancelled_at`, `request_task.created_at / resolved_at`,
`task_assignment.assigned_at`, `request_row_assignment.assigned_at /
resolved_at`, `request_fmb_selection.created_at / approved_at / ready_at /
delivered_at`, `workflow_history.created_at`, `event_registration.registered_at`.

## 8. Requirement-name mapping

The brief's generic department list maps onto the eight real
`event_requirements.requirement_name` values. These are routing keys, not free
text, and no others exist:

| Brief | Real requirement |
|---|---|
| Logistics — chairs, tables, stage, hall prep | `logistics` |
| Technical / AV — projector, mics, sound system | `soundLight` |
| Recording / media coverage | `photoVideo` |
| Transportation | `transportation` |
| Catering / F&B | `fmb` (+ `waterNormal`) |
| Facilities — venue booking, maintenance | `logistics` (Logistics **and Facilities**) |
| Finance / budget | `fundingPurchase` (recorded, never routed) |
| Campus tour | `campusTour` |

There is no sponsorship, vendor or standalone equipment-request entity in this
schema. Equipment is quantities on `logistics_options` and
`sound_light_options` referenced by the logistics and sound-light rows.
