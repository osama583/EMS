# APU Event Management System (EMS) — Source of Truth

This document is the single reference for the EMS project: what it does, who
uses it, what the forms collect, how approval works, and the full database.
Everything here reflects decisions confirmed in conversation with the
project owner. Where something is still unresolved or is an assumption made
to keep the design moving, it's marked explicitly — treat those as open,
not settled.

---

## 1. Intro

**What it is:** a role-based platform for submitting, reviewing, approving,
and fulfilling university event requests at APU.

**Stack:** Angular/TypeScript frontend. Backend framework/database engine
not yet fixed — this document (and the schema) assumes PostgreSQL, ported
easily to MySQL 8+.

**Two design principles everything else is built on:**

1. **The backend owns the workflow, not the frontend.** The frontend
   displays the current state, shows available actions, sends actions
   (approve/reject/resubmit/assign), and does normal UI validation. The
   backend determines the current step, validates whether the acting user
   is authorized, decides the next step and next responsible party, updates
   status, creates/updates tasks, and records history. The frontend is
   never trusted to decide who can act.

2. **Manager-configured options are not request data.** Department managers
   configure reusable dropdown options (e.g. "Projector" in Logistics).
   When an applicant picks one for their event, the system copies
   ("snapshots") the relevant fields into the request-specific table. If a
   manager edits or deletes the option later, already-submitted requests
   keep their original snapshotted values — history doesn't change
   retroactively.

---

## 2. Roles

17 roles total. All can explore/register/save public events regardless of
role; only the ones marked **Applicant** can submit a new proposal.

| Role | Applicant? | What they do |
|---|---|---|
| Student | Yes | Submits proposals; explores/registers/saves events |
| Staff | Yes | Same as Student |
| HOS/HOD | Yes | Reviews proposals from students/staff under their school (HOS) or department (HOD); approve/reject/resubmit. Cannot review their own submission — see workflow exception below. |
| CFO | Yes | Reviews high-pax applications (pax > `HIGH_PAX_THRESHOLD`) alongside F&B, before the department stage. Self-applications skip straight to department review. |
| F&B | Yes | Two duties: (1) high-pax reviewer alongside CFO; (2) reviews F&B/Cafeteria requirement requests, picks a cafeteria + specific menu item to fulfil them. Also manages the Mineral Water (Logo/Normal) and Dietary Information dropdowns. Self-applications skip straight to department review. |
| Logistics Manager | Yes | Reviews Logistics requests, approves + assigns to available staff, or resubmits with comment. Manages the Logistics Items dropdown. |
| Logistics Staff | No | Views and handles assigned tasks + history only |
| Transportation Manager | Yes | Same pattern as Logistics Manager, for Transportation. Manages Transportation Types dropdown. |
| Transportation Staff | No | Views and handles assigned tasks + history only |
| Photography/Videography Manager | Yes | Same pattern, for Photography/Videography. Manages Photography Services dropdown. |
| Photography/Videography Staff | No | Views and handles assigned tasks + history only |
| Sound & Light Manager | Yes | Same pattern, for Sound & Light. Manages Sound & Light dropdown. |
| Sound & Light Staff | No | Views and handles assigned tasks + history only |
| Cafeteria Admin | No | Adds/manages cafeterias; assigns which users are Cafeteria Manager or Cafeteria Staff for each cafeteria. Org-management role, not a reviewer. |
| Cafeteria Manager | No | Manages one or more specific cafeterias (assigned by Cafeteria Admin). Manages "My Menu" for their cafeteria(s), plus Serving Units. Receives F&B's food selection and routes it toward Cafeteria Staff fulfilment. |
| Cafeteria Staff | No | Works from a **shared inbox** — an F&B fulfilment task is visible to every staff member assigned to that cafeteria; whoever claims it first owns it, and it moves into their own ongoing/history and out of everyone else's inbox. |
| System Admin | No | Manages Units (create/deactivate), Users (create/deactivate), and system Config (pax threshold, cancellation deadline, max event categories). |

**⚠️ Open gap:** the Dropdown Settings field doc names a **"Student
Services Manager"** as the owner of the Campus Tour dropdowns. This role
doesn't exist anywhere else in the confirmed role list — it was never
added. Needs a decision: is this actually a distinct 18th role, or is it
one of the existing roles under a different label?

---

## 3. System Config

Stored in one `config` table as admin-settable numbers:

| Code | Meaning | Current value |
|---|---|---|
| `HIGH_PAX_THRESHOLD` | Above this expected attendee count, F&B + CFO must review before department stage | 50 |
| `CANCELLATION_DEADLINE_DAYS` | Applicant/co-owners can cancel up to this many days before the event date; after that, cancellation is locked | 3 |
| `MAX_EVENT_CATEGORIES` | Max categories an applicant can tag a public event with | 2 |

---

## 4. Approval Workflow

```
Applicant submits
      │
      ▼
HOS/HOD of applicant's unit reviews (approve / reject / resubmit)
      │  (approved)
      ▼
total_pax > HIGH_PAX_THRESHOLD?
      │                              │
     yes                             no
      │                              │
      ▼                              │
F&B reviews → CFO reviews            │
      │  (approved)                  │
      └──────────────┬───────────────┘
                      ▼
        DEPARTMENT REVIEW — one task per
        selected requirement, running in
        PARALLEL, fully independent
                      │
      ┌───────────────┼──────────────────┐
      ▼               ▼                  ▼
  Logistics       Transportation      ... (each requirement's
  Manager          Manager             own manager approves +
  approves+                            assigns staff, or
  assigns staff                        resubmits with comment)
      │
      ▼
  Assigned staff completes the task
```

**F&B / Cafeteria is a longer sub-chain, not a single step:**
```
F&B reviews the food request → picks a cafeteria + a real menu item
    (from that cafeteria's "My Menu")
      │
      ▼
Cafeteria Manager (of that cafeteria) reviews
      │
      ▼
Cafeteria Staff — SHARED INBOX (no one pre-assigned; visible to
    every staff member assigned to that cafeteria; first to claim
    it owns it, it then leaves everyone else's inbox)
```

**Self-application exceptions (confirmed):**
- Applicant IS the HOS/HOD of their own unit → skip the HOS/HOD step, F&B
  reviews instead (unconditionally, not gated by pax). **Open:** does CFO
  still get involved afterward if pax is also high? Not yet confirmed.
- Applicant is CFO or F&B → skip **all** higher approval, straight to
  department review.

**Parallel independence (confirmed):** if one department resubmits back to
the applicant, the other departments' reviews continue unaffected — nothing
pauses except that one department's own task.

**Staff assignment:** a manager assigns one or more available staff
(checked for no other overlapping assigned task at that time — this is a
query at assignment time, not a stored "availability calendar").

**Cancellation:** applicant or designated co-owners can cancel up to
`CANCELLATION_DEADLINE_DAYS` before the event date. After that, the
application is read-only with respect to cancellation.

**Visibility (Inbox / Ongoing / History):**
- **Inbox / My Task** — it's currently this user's turn to act. Nothing
  else appears here; it is not a general "related to me" list.
- **Ongoing / Ingoing** — the user is involved (applicant, co-owner,
  previously acted, etc.) but it is *not* currently their turn. Read-only.
- **History** — completed (approved or rejected), and the user was
  involved. Applicants/approvers see the actual result either way.
  Department staff only ever see **approved** ones in history, since by
  the time it reaches them the decision has already been made.

**Registration (separate from the proposal-approval flow):** users can
explore, register for, and save public approved events. If
`registration_approval = 'manual'`, the applicant/organizer sees pending
registrations in their own inbox — including the registrant's name, email,
and a short (≤100 character) reason for attending.

---

## 5. Form Fields

### A. Create/Edit Proposal — 6-step applicant form

**Step 1 — Applicant Info**
- Applicant Name, School/Department, Email (all read-only, auto-loaded)
- Co-owners table — Staff Name (searchable dropdown, required), Email
  (read-only), Role (read-only)

**Step 2 — General Event Info**
- Event Title (required)
- Event Schedule table — Date, Start Time, End Time, Location (all
  required)
- Organizer/PIC table — Name (staff dropdown, required), Email (read-only),
  Role (read-only), Responsibility/Notes
- Important People table — Name, Type (select: VIP / Speaker / Partner /
  Important Guest), Organization, Designation
- General Guest/Pax table — Guest Type (select: Students / APU Staff /
  External Guests / Parents-Guardians / Industry Partners / Alumni /
  Others), Count (min 0), Notes

**Step 3 — Required for Event**
- Checklist: Logistics, Transportation, Photographer/Videographer, Sound &
  Light, F&B, Campus Tour, Mineral Water (Logo), Mineral Water (Normal),
  Funding/Purchase

**Step 4 — Request Details** (one table per requirement checked in Step 3)

| Requirement | Fields |
|---|---|
| Logistics | Item/Need (select), Quantity, Date, Start, End, Location, Notes |
| Transportation | Type (select), Requested Pax, Pickup, Drop-off, Date, Start, End, Location, Notes |
| Photographer/Videographer | Service (select), Personnel Quantity, Date, Start, End, Location, Coverage, Notes |
| Sound & Light | Item/Service (select), Date, Start, End, Location, Notes |
| F&B | Food Type (select), Pax, Date, Start, End, Location, Notes |
| Campus Tour | Date, Start, End, Location, Pax, Starting Point (select), Tour Area (select), Campus Map (select), Notes |
| Mineral Water (Logo/Normal) | Quantity (select), Date, Start, End, Location, Notes |
| Funding/Purchase | Main Item (select), Sub-item (select, depends on Main Item), Quantity, Unit RM, Notes |

**Step 5 — Detailed Event Info**
- Short Introduction, Goals & Objectives, Expected Benefits (all required
  textareas)
- Event Categories (multi-select, max = `config.MAX_EVENT_CATEGORIES`,
  only shown if Visibility = Public)
- Event Visibility (dropdown, required)
- Event Format (dropdown, required)
- Registration Approval (dropdown, required)
- Event Image (upload)
- Promotion/Publicity Method (textarea, required only if Public)
- Brief Agenda table — Time, Activity, Location, PIC, Notes
- Discussion Topics table — Discussion Topic

**Step 6 — Final Actions**
- Read-only review summary, "Proposal preview" popup, "Missing Required
  Fields" warning popup — no editable fields

### B. Reviewer view (HOS/HOD, F&B, CFO)

Read-only display of everything submitted, plus:
- Reviewer comment (required for Reject/Resubmit)
- Popups: Approve, Resubmit with comment, Reject, Cancel Application

### C. Department view (fulfilment)

Same read-only display, plus:
- Reviewer comment (required for Resubmit)
- Assigned team member (searchable dropdown, "Assign Department Work"
  panel)
- Popups: Confirm department fulfilment (approve), Resubmit with comment

### D. Manager Dropdown Settings — one page per department

Every option shares: **label** (required), **description**, **active**.

| Manager | Page | Extra fields |
|---|---|---|
| Logistics Manager | Logistics Items | Available Quantity, Quantity Unit, Item Image |
| Transportation Manager | Transportation Types | Passenger Capacity, Available Vehicle Count, Instructions, Vehicle Image |
| Photography Manager | Photography Services | Maximum Personnel/Availability |
| AV Manager | Sound & Light | Available Quantity, Technical Description/Setup Requirements |
| Cafeteria Manager | My Menu | Serving Unit (FK), Availability/Ordering Notes, Dietary Information (FK), Menu Image |
| Cafeteria Manager | Dietary Information | none beyond common fields |
| Cafeteria Manager | Serving Units | none beyond common fields |
| *(role gap — see §2)* | Campus Tour Starting Points | Meeting Instructions, Maximum Group Size |
| *(role gap — see §2)* | Campus Tour Areas | Estimated Duration (min), Access Restrictions/Availability Notes |
| *(role gap — see §2)* | Campus Map Information | Campus Map URL, Map/Route Guidance |
| F&B (FMB Manager) | Mineral Water (Logo) | Number of Bottles, Available Stock, Logo/Branding Requirement, Lead Time/Ordering Instructions |
| F&B (FMB Manager) | Mineral Water (Normal) | Number of Bottles, Available Stock, Ordering/Delivery Instructions |
| F&B (FMB Manager) | Dietary Information | shared with Cafeteria Manager, no extra fields |
| CFO | Funding Main Items | Budget Category/Finance Code, Purchasing Guidance |
| CFO | Funding Sub-items | Parent Main Item (FK, required), Finance/Procurement Code, Default Unit/Purchasing Note |

---

## 6. Database — Tables & Columns

51 tables. Grouped to match the schema file (`ems_database_schema.sql`).

### Identity & Organization
- **users**: user_id, first_name, last_name, email, phone_number, role, is_active
- **staff**: staff_id, user_id, department_or_school
- **student**: student_id, user_id, school
- **unit**: code, description, head_user_id, is_active
- **unit_users**: user_id, unit_code
- **clubs**: club_id, user_id, club_name
- **student_clubs**: club_id, student_id, date_joined

### Cafeteria Domain
- **cafeteria**: cafeteria_id, name, active
- **cafeteria_assignment**: cafeteria_assignment_id, cafeteria_id, user_id, assignment_role, assigned_by_user_id, assigned_at

### Categories & Requirements
- **event_category**: event_category_id, name, active
- **event_requirements**: requirement_id, requirement_name

### Manager-Configured Options
- **logistics_options**: logistics_option_id, requirement_id, label, description, active, available_quantity, quantity_unit, item_image_url
- **transportation_options**: transportation_option_id, requirement_id, label, description, active, passenger_capacity, available_vehicle_count, instructions, vehicle_image_url
- **media_options**: media_option_id, requirement_id, label, description, active, max_personnel
- **sound_light_options**: sound_light_option_id, requirement_id, label, description, active, available_quantity, technical_description
- **dietary_information_options**: dietary_information_option_id, label, description, active
- **serving_unit_options**: serving_unit_option_id, label, description, active
- **fnb_options**: fnb_option_id, requirement_id, cafeteria_id, label, description, active, serving_unit_option_id, dietary_information_option_id, availability_ordering_notes, menu_image_url
- **campus_tour_start_options**: campus_tour_start_option_id, requirement_id, label, description, active, meeting_instructions, max_group_size
- **campus_tour_area_options**: campus_tour_area_option_id, requirement_id, label, description, active, estimated_duration_minutes, access_restrictions_notes
- **campus_tour_map_options**: campus_tour_map_option_id, requirement_id, label, description, active, campus_map_url, map_route_guidance
- **water_logo_options**: water_logo_option_id, requirement_id, label, description, active, number_of_bottles, available_stock, logo_branding_requirement, lead_time_ordering_instructions
- **water_normal_options**: water_normal_option_id, requirement_id, label, description, active, number_of_bottles, available_stock, ordering_delivery_instructions
- **funding_main_options**: funding_main_option_id, requirement_id, label, description, active, budget_category_finance_code, purchasing_guidance
- **funding_sub_options**: funding_sub_option_id, main_option_id, label, description, active, finance_procurement_code, default_unit_purchasing_note

### Config
- **config**: code, number

### Request Core
- **request**: request_id, request_code, applicant_user_id, applicant_name, applicant_email, applicant_department_or_school, event_title, short_introduction, goals_objectives, expected_benefits, event_visibility, event_format, registration_approval, promotion_publicity_method, event_image, total_pax, max_pax, status, submitted_at, cancelled_at, cancelled_by_user_id, created_at, updated_at
- **request_categories**: request_id, category_id
- **application_requirements**: request_id, requirement_id

### Request-Specific Department Data (snapshots)
- **request_logistics**: request_logistics_id, request_id, option_id, item, quantity, date, start_time, end_time, location, notes
- **request_transportation**: request_transportation_id, request_id, option_id, type, requested_pax, pickup, dropoff, date, start_time, end_time, location, notes
- **request_photography_videography**: request_photography_videography_id, request_id, option_id, service, personnel_quantity, date, start_time, end_time, location, coverage, notes
- **request_sound_light**: request_sound_light_id, request_id, option_id, item, date, start_time, end_time, location, notes
- **request_fnb**: request_fnb_id, request_id, option_id, food_type, pax, date, start_time, end_time, location, notes
- **request_fnb_selection**: request_fnb_selection_id, request_fnb_id, cafeteria_id, fnb_option_id, menu_item_label, quantity, notes
- **request_campus_tour**: request_campus_tour_id, request_id, date, start_time, end_time, location, pax, start_point_option_id, start_point, tour_area_option_id, tour_area, campus_map_option_id, campus_map, notes
- **request_mineral_water_logo**: request_mineral_water_logo_id, request_id, option_id, quantity, date, start_time, end_time, location, notes
- **request_mineral_water_normal**: request_mineral_water_normal_id, request_id, option_id, quantity, date, start_time, end_time, location, notes
- **request_funding_purchase**: request_funding_purchase_id, request_id, main_option_id, main_item, sub_option_id, sub_item, quantity, unit_price_rm, notes

### Request Support Tables
- **co_owners**: co_owner_id, request_id, staff_id, staff_first_name, staff_last_name, staff_email, staff_role
- **organizers**: organizer_id, request_id, staff_id, staff_first_name, staff_last_name, staff_email, staff_role, note
- **important_people**: important_person_id, request_id, name, type, organization, designation
- **general_guest**: general_guest_id, request_id, guest_type, count, notes
- **event_schedule**: event_schedule_id, request_id, date, start_time, end_time, location
- **brief_agenda**: brief_agenda_id, request_id, time, activity, location, pic, notes
- **request_discussion_topics**: request_discussion_topic_id, request_id, discussion_topic

### Event Discovery / Registration
- **event_registration**: event_registration_id, request_id, user_id, registrant_name, registrant_email, reason_for_attending, status, registered_at
- **saved_event**: user_id, request_id, saved_at

### Workflow — Tasks, Assignments, History
- **request_task**: request_task_id, request_id, requirement_id, stage_code, sequence_no, assigned_role, assignment_mode, status, comment, created_at, resolved_at, resolved_by_user_id
- **task_assignment**: task_assignment_id, request_task_id, staff_user_id, assigned_by_user_id, assigned_at
- **workflow_history**: workflow_history_id, request_id, request_task_id, requirement_id, action, actor_user_id, actor_role, comment, previous_status, new_status, created_at

Full column types/constraints/CHECKs live in `ems_database_schema.sql` —
this section is the field-name reference; that file is the exact DDL.

---

## 7. Open Questions (not yet resolved — don't assume an answer)

- **Campus Tour structure**: built as 3 separate tables
  (start/area/map) based on the detailed field doc, but an earlier message
  said "only Starting Point." Needs a final call.
- **"Student Services Manager"** role — appears in the dropdown field doc,
  not in the confirmed 17-role list. Needs to be added or reconciled.
- **HOS/HOD self-review + high pax**: when applicant = HOS/HOD, F&B reviews
  instead of the HOS/HOD step. Unclear whether CFO still reviews afterward
  if pax is also above threshold.
- **Cafeteria Manager's decision options** at their step in the F&B chain
  (approve/resubmit, same as other managers) — assumed, not confirmed.
- **PK datatype convention** — using surrogate integer IDs throughout;
  UUID was never explicitly ruled in or out.
- **Exact allowed values** for `event_visibility`, `event_format`, and
  `registration_approval` — left as free text since no fixed list was
  given.

## 8. Suggested Additions Not Yet Covered

Things a system like this typically needs that haven't come up yet:

- **Notifications** — email/push when a task is assigned, approved,
  resubmitted, or when a registration is approved/rejected.
- **File/attachment storage** — every image field (logistics item, vehicle,
  menu, event image, campus map) is currently just a URL/path column; needs
  an actual upload/storage strategy (S3-style bucket, CDN, etc.) behind it.
- **Search/filter on the public Explore page** — by category, date range,
  location; not designed yet.
- **Reporting/analytics for admin** — volume per month, average approval
  time per stage, most-requested departments, etc.
- **Audit log retention** — `workflow_history` grows forever by design;
  worth deciding an archival policy before it's a problem, not after.
- **Time zone handling** — all date/time fields are currently naive; worth
  deciding early if APU ever needs multi-campus/time-zone support.
- **Draft autosave** — the 6-step form implies a long fill-out session;
  consider whether partial/draft `request` rows need their own handling
  (`status = 'draft'` already supports this, just flagging the UX side).
