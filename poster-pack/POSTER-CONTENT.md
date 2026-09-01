# FYP Poster Content

Everything below is final copy. Use it as written; nothing here needs to be
invented or paraphrased.

---

## 1. Header

| Field | Value |
|---|---|
| **Logo** | APU logo — `logo/apu-logo-text.png` (full lockup) or `logo/apu-logo-mark.png` (mark only) |
| **Project title** | Developing a Centralized Role-Based Event Coordination Platform for Multi-Department University Workflow Management |
| **Student name** | Osamah Ahmed Mohammed Al-Naggar |
| **Student no.** | TP078781 |
| **Programme** | B.Sc. (Hons) Computer Science — Asia Pacific University of Technology and Innovation (intake code APD3F2601CS) |
| **Supervisor** | Mr. Mustafa Othman |
| **2nd Marker** | Ms. Aida Raihanah |

Optional footer line: *Contributes to SDG 9: Industry, Innovation and Infrastructure.*

---

## 2. Introduction

University events depend on several departments at once — logistics, transport,
photography, A/V, student services and food & beverage. Today that coordination
runs on WhatsApp messages, phone calls and verbal instruction, so information is
scattered, progress is invisible and nobody owns the record.

This project delivers a centralized, role-based coordination platform for Asia
Pacific University of Technology and Innovation. One structured event request is
raised by an applicant and distributed to every relevant department at the same
time, each working its own independent approval and execution workflow. Approved
events are published to a public portal for discovery and registration, and a
built-in AI assistant answers questions strictly within each user's own access
rights.

Built with **Angular** (frontend), **Flask / Python** (REST API) and
**PostgreSQL on Supabase** (database).

**Short version for a tight poster (2 sentences):**

> A centralized, role-based platform that replaces WhatsApp-and-phone event
> coordination at APU with one structured request distributed to every
> department at once. Angular + Flask + PostgreSQL, with parallel departmental
> workflows, a full audit trail, role-scoped dashboards and an access-aware AI
> assistant.

---

## 3. Problem Statements

1. **Fragmented communication and coordination.** Requests live across messaging
   apps, calls and verbal instruction instead of one system — causing
   miscommunication, missed requests and inconsistent execution.
2. **Inefficiency and delays.** Manual, sequential handling means departments
   wait on each other's confirmations, so preparation time is the *sum* of every
   department rather than the slowest one.
3. **No role clarity or guided process.** Without structured digital workflows
   and defined roles, tasks are duplicated or dropped entirely.
4. **Weak accountability and transparency.** Approvals, actions and task
   ownership are not systematically recorded, so responsibility for a decision
   or a delay cannot be traced.
5. **No data for decision-making.** With no centralized records or analytics,
   progress cannot be monitored and performance cannot be evaluated.

---

## 4. Project Aim and Objectives

**Aim** — To develop a centralized, role-based event coordination platform using
Angular, Flask and PostgreSQL for university-wide multi-departmental event
management at Asia Pacific University of Technology and Innovation (APU).

**Objectives**

1. Replace manual, disconnected channels (WhatsApp, phone, verbal instruction)
   with a structured digital coordination system.
2. Improve efficiency and reduce delays through simultaneous request
   distribution and independent departmental processing.
3. Minimise task duplication and miscommunication by scoping responsibilities so
   each department handles only what is relevant to it.
4. Strengthen accountability with a clear record of approvals, actions and task
   ownership across the event lifecycle.
5. Support data-driven decision-making through dashboards visualising event
   activity and user engagement.

---

## 5. Methodology

**Waterfall–Agile Hybrid with Evolutionary Prototyping.**

Waterfall fixes the architecture that must not change late — the identity model
pairing user, role and unit, and the transaction binding an audit record to its
state change. Agile-inspired short iterations and continuous testing govern
module delivery. Figma prototyping resolves interface requirements before
backend work begins.

*Why not the pure alternatives:* Waterfall assumes settled requirements, which
did not hold. Pure Scrum solves team-coordination problems that do not exist for
a single developer. RAD de-emphasises exactly the planning this system's
architecture depends on.

**Phases**

| Phase | Activities |
|---|---|
| 1. Requirement analysis & investigation | Define departmental roles, request workflows, system scope |
| 2. System design | Database schema, role-based access control, request distribution logic |
| 3. Evolutionary prototyping | High-fidelity Figma interfaces and dashboards, refined by feedback |
| 4. Iterative implementation | Modules built and unit-tested incrementally (Agile cycles) |
| 5. Integration & testing | Continuous testing of routing, permissions and usability |
| 6. Deployment & evaluation | Stabilisation, documentation, final validation |

**Data gathering** — Quantitative survey of APU students, lecturers and staff on
current event-request practice, coordination challenges and willingness to adopt
a centralized platform.

**Evaluation** — Unit testing across eight functional areas, plus User
Acceptance Testing with five testers covering the applicant, two service
departments, the cafeteria module and the system administrator.

---

## 6. System Features (with screenshots)

Screenshots are in `screenshots/`. Diagrams are in `diagrams/`.

| # | Feature | Caption for the poster | Image |
|---|---|---|---|
| 1 | Public Event Portal | Approved events published for browsing, calendar view and attendee registration | `screenshots/01-public-event-portal.png` |
| 2 | Six-Step Proposal Form | One structured request captures applicant info, event details and every departmental requirement | `screenshots/02-proposal-form-requirements.png` |
| 3 | Departmental Review | The same proposal, narrowed in SQL to the reviewing department's own scope | `screenshots/03-departmental-review.png` |
| 4 | Inbox — Action Queues | Each user sees only the requests currently awaiting their decision | `screenshots/04-inbox-action-queues.png` |
| 5 | Task Assignment | Approving a requirement *is* assigning it — no agreed work belongs to nobody | `screenshots/05-task-assignment.png` |
| 6 | Departmental Dashboard | Outstanding, late and completed work, on-time rates, load per staff member | `screenshots/06-dashboard-department.png` |
| 7 | CFO Finance Dashboard | Committed spend, cost per attendee, funding breakdown, dwell time at each approval gate | `screenshots/07-dashboard-cfo.png` |
| 8 | AI Assistant | Natural-language answers about the user's own events and tasks, bounded by their access rights and fully logged | `screenshots/08-ai-assistant.png` |
| 9 | Role-Based Page Visibility | Administrators change what a role reaches at run time — no redeployment | `screenshots/09-role-page-visibility.png` |
| 10 | Clubs Module | Club directory, membership, join requests and president-change approvals | `screenshots/10-clubs-module.png` |
| 11 | Cafeteria Module | Outlets, menus and orders generated from approved F&B selections | `screenshots/11-cafeteria-module.png` |
| 12 | Proposal Status Tracking | The applicant sees the stage, the owner and the reason at every point | `screenshots/12-status-tracking.png` |
| 13 | Responsive Design | The full platform on mobile — no native app required | `screenshots/13-responsive-mobile.png` |

**Diagrams**

| Diagram | Use it for | Image |
|---|---|---|
| System Architecture | Angular client → Flask REST API → PostgreSQL / Supabase | `diagrams/01-system-architecture.png` |
| Proposal Lifecycle | Draft → submit → approve → parallel departmental fan-out → publish | `diagrams/02-proposal-lifecycle.png` |
| Role-Based Access Model | User + role + organisational unit; server-side permission decisions | `diagrams/03-role-based-access-model.png` |
| Entity Relationship Diagram | The 68-table schema (only if the poster has room) | `diagrams/04-erd.png` |

**Feature summary bullets (if the poster prefers a list over a table):**

- Single structured request fanned out to **all departments in parallel**
- **12 roles** held *per organisational unit* — authority follows the posting, not the account
- Complete audit trail: every stage change written in the same transaction as the change
- Rejections and send-backs **refused without a reason**
- **6 role-specific dashboards** from one component driven by a server-supplied profile
- Access-aware **AI assistant** — every generated query checked before execution, every refusal logged
- Public event portal with registration, saved events and reminders
- Clubs and cafeteria modules; venue and option catalogues owned by the departments answerable for them
- Configurable at run time: approval thresholds, cancellation deadlines, page grants
- Nothing is destroyed — deletions are checked, reversible, and purged only after a retention period
- **68 database tables**, 64 implementation figures and 12 source listings documented

---

## 7. Conclusion

The aim was met. The delivered system is an Angular single-page client over a
Flask REST API on PostgreSQL, covering the full event lifecycle from proposal
through parallel multi-departmental fulfilment to publication and attendance,
across 68 database tables and 12 unit-scoped roles. All five objectives are met,
with evidence from unit testing across eight areas and User Acceptance Testing
with five testers.

The contribution sits between what existing systems do: commercial event
platforms model an organisation as a flat set of users with global roles, which
is not how a university works; institutional systems model the hierarchy but
treat departments as a *sequence* of approvals. This project holds both at once
— authority scoped to the organisational unit a role is held in, and
departmental work issued in **parallel** and tracked independently.

Its principal strength is that the access model has exactly one implementation:
navigation, page access, list queries and the AI assistant all consult the same
grant table, so there is no second permission logic to fall out of step.

**Limitations** — deployment is local against a managed database rather than on
institutional infrastructure; acceptance testing covered five testers, one per
role; dense tables are reflowed rather than redesigned for small screens; the
assistant depends on an external language model.

**Future work** — deploy to institutional infrastructure behind university
single sign-on, give dense tables a genuine small-screen layout, extend
acceptance testing across a full event season, and extend the analytics from
description to prediction.

**Closing line for the poster:**

> The project replaced a coordination process that ran on messages, memory and
> goodwill with one that runs on a record. A request has a stage, a stage has an
> owner, an owner's authority is bounded by their unit, and every decision is
> written down with its reason at the moment it is taken.

---

## 8. Technology Stack (for an icon strip)

Angular 21 · Flask (Python) · PostgreSQL · Supabase · JWT authentication ·
Visual Studio Code · Chrome / Firefox

## 9. Keywords

Event Management · Role-Based Access Control · Workflow Coordination ·
Departmental Collaboration · Digital Infrastructure · SDG 9
