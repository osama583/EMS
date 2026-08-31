# Figure index - Chapter 4

Every implementation figure exists twice: `desktop.png` (1440x900 at 2x) and `mobile.png` (iPhone 14, 390x844 at 3x).

Figures are viewport captures, never full-page. A full-page screenshot paints
position:fixed chrome - the assistant orb, the sticky top bar - once at the
initial scroll offset, which lands it halfway down a tall image and produces a
strip too tall to place in a document. Viewport shots keep every figure at 100%
and put the chrome where it belongs.

| Figures | Location |
|---|---|
| 4.4 Interface Design | `ui png/Interface Design/` |
| 4.5 Implementation | `ui png/Implementation/` |
| 4.6 Sample codes | `ui png/Sample Codes/` |


## Interface Design artefacts (section 4.4)

| # | Figure title | How it was produced |
|---|---|---|
| 4.4.01 | System Navigation Site Map | Rendered from digrams/12-sitemap.html |
| 4.4.02 | Screen Layout Anatomy - Desktop | Annotated from measured element bounds |
| 4.4.03 | Screen Layout Anatomy - Mobile | Annotated from measured element bounds |
| 4.4.04 | Role-Based Menu Design | Student / HOD / CFO / System Admin sidebars |
| 4.4.05 | Design System Tokens | Read from the running app's computed styles |
| 4.4.06 | Shared Component Library | The /shared route, in six screen-sized parts |
| 4.4.07 | Storyboard - Event Proposal Lifecycle | Six steps, draft through tracking |
| 4.4.08 | Storyboard - Event Registration Lifecycle | Six steps, browse through confirmed |
| 4.4.09 | Storyboard - Club Joining Lifecycle | Four steps, discover through roster |
| 4.4.10 | Responsive Breakpoint Strategy | One page at 1440 / 768 / 390 |

## A - Public and Authentication

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.01 | Landing Page - Hero | Signed out (public visitor) | `/` |
| 4.5.02 | Landing Page - Happening Soon Carousel | Signed out (public visitor) | `/` |
| 4.5.03 | Landing Page - Explore Events | Signed out (public visitor) | `/` |
| 4.5.04 | Landing Page - Campus Life | Signed out (public visitor) | `/` |
| 4.5.05 | Landing Page - Public Event Calendar | Signed out (public visitor) | `/` |
| 4.5.06 | Event Details Modal | Signed out (public visitor) | `/` |
| 4.5.07 | Login Page | Signed out (public visitor) | `/login` |
| 4.5.08 | Forgot Password Modal | Signed out (public visitor) | `/login` |
| 4.5.09 | Guest Registration - Account Details | Signed out (public visitor) | `/login` |
| 4.5.10 | Guest Registration - Completed Form | Signed out (public visitor) | `/login` |
| 4.5.11 | Reset Password Page | Signed out (public visitor) | `/reset-password` |

## B - External and Student User

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.12 | My Events | Student - applicant@demo.apu.edu.my | `/app/events/my-events/saved` |
| 4.5.13 | My Events - External User | External user - j.tanaka@example.com | `/my-events/saved` |
| 4.5.16 | User Profile | Student - applicant@demo.apu.edu.my | `/app/profile` |

**Covers more than one tab - say so in the caption:**

- **4.5.12 My Events** - Shows the **Saved** tab. The same page carries **Registered** (confirmed places on events still to come) and **Conducted** (events actually attended - a confirmed place on an event that has since finished). All three render the same card list; the server decides which registrations belong to each.
- **4.5.13 My Events - External User** - The external-user shell, which is a different layout from the internal one in 4.5.12 and has four tabs of its own: **Saved**, **Pending** (manual-approval sign-ups still awaiting the organiser), **Registered**, and **History** (sign-ups that were turned down, plus events already attended).

## C - Internal Shell and Onboarding

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.17 | Internal Layout and Sidebar Navigation | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.18 | How It Works - Onboarding Guide | Student - applicant@demo.apu.edu.my | `/app/how-it-works` |
| 4.5.19 | Master Event Calendar | Head of School - hoshod@demo.apu.edu.my | `/app/event-calendar` |
| 4.5.20 | Internal Explore Events | Student - applicant@demo.apu.edu.my | `/app/events/explore-events` |

## D - Proposal Creation

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.21 | Proposal Form - Step 1 Applicant Info | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |
| 4.5.22 | Proposal Form - Step 2 General Event Info | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |
| 4.5.23 | Proposal Form - Step 3 Required for Event | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |
| 4.5.24 | Proposal Form - Step 4 Request Details | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |
| 4.5.25 | Proposal Form - Step 5 Detailed Event Info | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |
| 4.5.26 | Proposal Form - Step 6 Final Review | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |
| 4.5.27 | Proposal Form - Validation Errors | Student - applicant@demo.apu.edu.my | `/app/forms/event-proposal` |

## E - Proposal Tracking and Review

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.28 | Draft Proposals | Student - applicant@demo.apu.edu.my | `/app/proposals/drafts` |
| 4.5.29 | Created by Me - Status Tracking | Student - applicant@demo.apu.edu.my | `/app/created-by-me` |
| 4.5.30 | Proposal Review - Reviewer View | Head of School - hoshod@demo.apu.edu.my | `/app/proposals/review/:hosProposal` |
| 4.5.31 | Proposal Review - Department View | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/proposals/review/:deptProposal` |
| 4.5.32 | Proposal Review - Summary KPI Bar | Head of School - hoshod@demo.apu.edu.my | `/app/proposals/review/:hosProposal` |
| 4.5.33 | Reject Proposal - Reason Required | Head of School - hoshod@demo.apu.edu.my | `/app/proposals/review/:hosProposal` |
| 4.5.34 | Workflow Actions Panel | Head of School - hoshod@demo.apu.edu.my | `/app/proposals/review/:hosProposal` |

## F - Department Task Handling

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.35 | Inbox - Action Queues | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/inbox/proposals` |
| 4.5.38 | Staff Task Assignment | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/proposals/review/:deptProposal` |
| 4.5.39 | Ongoing Records Hub | Head of School - hoshod@demo.apu.edu.my | `/app/ongoing/proposals` |
| 4.5.40 | History Records Hub | Head of School - hoshod@demo.apu.edu.my | `/app/history/proposals` |

**Covers more than one tab - say so in the caption:**

- **4.5.35 Inbox - Action Queues** - Shows the **Proposals** queue. The Inbox is one shell whose tab strip is computed per role, and it holds everything waiting on this person to act: **Proposals** (awaiting their approve / reject / send-back decision), **Requests** (department-service requests routed to the unit they head), **Events** (event registrations awaiting the organiser's decision - 4.5.62), **Tasks** (the shared-pool work queue for department staff, and the claim / prepare / fulfil queue for cafeteria staff - 4.5.42), **Clubs** (join requests awaiting a club President - 4.5.52) and **President Change Requests** (handovers awaiting a Club Admin - 4.5.53). No single role holds all six; the strip in this figure is HOD Logistics's.
- **4.5.39 Ongoing Records Hub** - Shows the **Proposals** tab. Ongoing is the same records shell as the Inbox but holds what is in flight rather than what needs a decision now: **Proposals** (submitted and still moving through approval), **Events** (the viewer's own event registrations still awaiting an organiser's decision) and, for a student, **Clubs** (join requests still pending).
- **4.5.40 History Records Hub** - Shows the **Proposals** tab. History is the settled counterpart of Ongoing: **Proposals** (approved, rejected or cancelled), **Events** (registrations confirmed and since finished, or turned down), **Tasks** (completed department work, for staff), **Clubs** (decided join requests, for a student) and **President Change Requests** (decided handovers, for a Club Admin).

## G - Cafeteria Module

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.42 | Cafeteria Staff Tasks | Cafeteria Staff - cafeteria.staff2@demo.apu.edu.my | `/app/inbox/cafeteria-tasks` |
| 4.5.43 | My Menu Management | Cafeteria Manager - cafeteria.manager@demo.apu.edu.my | `/app/menu` |
| 4.5.44 | Manage Cafeterias | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/manage` |
| 4.5.45 | Cafeteria Staff Assignments | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/staff-assignments` |
| 4.5.46 | Menu Oversight | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/menu-oversight` |
| 4.5.47 | My Staff | Cafeteria Manager - cafeteria.manager@demo.apu.edu.my | `/app/cafeterias/my-staff` |
| 4.5.48 | Staff Action History | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/staff-requests-history` |

## H - Clubs Module

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.49 | Discover Clubs | Student - applicant@demo.apu.edu.my | `/app/clubs/discover` |
| 4.5.50 | My Clubs | Student - applicant@demo.apu.edu.my | `/app/clubs/my-clubs` |
| 4.5.51 | Club Roster Modal | Student - applicant@demo.apu.edu.my | `/app/clubs/my-clubs` |
| 4.5.52 | Club Join Requests | Student - applicant@demo.apu.edu.my | `/app/inbox/club-requests` |
| 4.5.53 | President Change Requests | Club Admin - club.admin@demo.apu.edu.my | `/app/inbox/president-change-request` |
| 4.5.54 | Manage Clubs | Club Admin - club.admin@demo.apu.edu.my | `/app/clubs/manage` |
| 4.5.55 | Club Categories | Club Admin - club.admin@demo.apu.edu.my | `/app/club-category` |

## I - Dashboards

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.56 | Dashboard - HOD Logistics | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.60 | Dashboard - CFO Finance | CFO - cfo@demo.apu.edu.my | `/app/dashboard` |
| 4.5.61 | Dashboard - Cafeteria Manager | Cafeteria Manager - cafeteria.manager@demo.apu.edu.my | `/app/dashboard` |

**Covers more than one tab - say so in the caption:**

- **4.5.56 Dashboard - HOD Logistics** - The dashboard is one page whose KPI tiles and charts are computed for the viewer own unit. The identical screen serves HOD Logistics (shown here), HOD Food & Beverage, HOD Audio Visual and HOD Transport - only the unit name and the numbers change. The CFO and Cafeteria Manager variants read genuinely different measures and are kept as separate figures (4.5.60, 4.5.61).

## J - Events and Registrations

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.62 | Event Registrations Hub | Student organiser - student.computing2@demo.apu.edu.my | `/app/inbox/registrations` |

## K - System Administration

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.65 | Users Directory | System Admin - system.admin@demo.apu.edu.my | `/app/users` |
| 4.5.66 | Units Directory | System Admin - system.admin@demo.apu.edu.my | `/app/units` |
| 4.5.67 | Roles Management | System Admin - system.admin@demo.apu.edu.my | `/app/roles` |
| 4.5.68 | Page Visibility | System Admin - system.admin@demo.apu.edu.my | `/app/admin/page-visibility` |
| 4.5.69 | System Configuration - Approval Policies | System Admin - system.admin@demo.apu.edu.my | `/app/admin/settings/policies` |
| 4.5.72 | Option Catalogue - Logistics Items | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dropdown-options/logistics` |
| 4.5.76 | Option Catalogue - Venue Management | CFO - cfo@demo.apu.edu.my | `/app/dropdown-options/venue` |

**Covers more than one tab - say so in the caption:**

- **4.5.69 System Configuration - Approval Policies** - Shows the **Approval Policies** tab. System Configuration is one page with three: **Approval Policies** (high-pax threshold, cancellation deadline, minimum lead time, maximum event categories), **Event Categories** and **Event Formats** - the last two being the same add / edit / deactivate / delete catalogue table pointed at different lists.
- **4.5.72 Option Catalogue - Logistics Items** - Shows the **Logistics** catalogue. One component serves every option list a proposal picks from - Transportation, Sound & Light, Photography and Videography, Campus Tour, Funding, Dietary Information and Serving Units - each owned by the department answerable for it. Venue Management (4.5.76) is kept separate because it carries capacity and location fields the others do not.

## L - AI Assistant

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.78 | AI Assistant Dock | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.79 | AI Assistant Full Page | HOD Logistics - logistics.manager@demo.apu.edu.my | `/assistant` |
| 4.5.80 | AI Access Log | System Admin - system.admin@demo.apu.edu.my | `/app/admin/ai-access-log` |


## Consolidation

Tab strips are captured once. Where a page differs from a sibling only by
which tab is open, whose data it renders, or which catalogue it points at,
one figure carries it and the caption names the rest - see the "Covers more
than one tab" notes above. That retired 17 near-duplicate figures without
dropping a single screen from the coverage.

The registration queue (4.5.62) is captured as a student who organises events
with sign-ups awaiting a decision. It was previously taken as a Head of School,
who organises none - which is why it used to record an empty state.


## Note keys

- `EMPTY-STATE` - the page rendered its "nothing here yet" state; correct behaviour, but pick a different account if you want a populated figure.
- `PREP-MISSED` - the scripted interaction (open a modal, switch a tab) found no matching control, so the figure shows the page beneath it.
- `LANDED->` - the app redirected; the figure shows where it actually ended up.
