# Figure index - Chapter 4

Every implementation figure exists twice: `desktop.png` (1440x900 at 2x) and `mobile.png` (iPhone 14, 390x844 at 3x).

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
| 4.4.06 | Shared Component Library | The live /shared route |
| 4.4.07 | Form Control and Validation States | Proposal form after a failed submit |
| 4.4.08 | Data Table and Filter Pattern | Inbox proposals table workspace |
| 4.4.09 | Status and Workflow Badge Language | Created by Me status column |
| 4.4.10 | Page Navigation Storyboard | Six-step proposal journey |
| 4.4.11 | Responsive Breakpoint Strategy | One page at 1440 / 768 / 390 |

## A - Public and Authentication

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.01 | Landing Page - Hero | Signed out (public visitor) | `/` |
| 4.5.02 | Landing Page - Happening Soon Carousel | Signed out (public visitor) | `/` |
| 4.5.03 | Landing Page - Explore Events with Filters | Signed out (public visitor) | `/` |
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
| 4.5.12 | My Events - Saved | Student - applicant@demo.apu.edu.my | `/app/events/my-events/saved` |
| 4.5.13 | My Events - Registered | External user - j.tanaka@example.com | `/my-events/registered` |
| 4.5.14 | My Events - Pending Approval | External user - j.tanaka@example.com | `/my-events/pending` |
| 4.5.15 | My Events - History | External user - j.tanaka@example.com | `/my-events/history` |
| 4.5.16 | User Profile | Student - applicant@demo.apu.edu.my | `/app/profile` |

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
| 4.5.33 | Approval Decision Dialog | Head of School - hoshod@demo.apu.edu.my | `/app/proposals/review/:hosProposal` |
| 4.5.34 | Workflow Actions Panel | Head of School - hoshod@demo.apu.edu.my | `/app/proposals/review/:hosProposal` |

## F - Department Task Handling

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.35 | Inbox - Pending Proposals | Head of School - hoshod@demo.apu.edu.my | `/app/inbox/proposals` |
| 4.5.36 | Inbox - Department Tasks | Staff - logistics.staff@demo.apu.edu.my | `/app/inbox/tasks` |
| 4.5.37 | Inbox - Incoming Requests | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/inbox/requests` |
| 4.5.38 | Staff Task Assignment | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/inbox/tasks` |
| 4.5.39 | Task Date Filter Calendar | Staff - logistics.staff@demo.apu.edu.my | `/app/inbox/tasks` |
| 4.5.40 | Ongoing Records Hub | Head of School - hoshod@demo.apu.edu.my | `/app/ongoing/proposals` |
| 4.5.41 | History Records Hub | Head of School - hoshod@demo.apu.edu.my | `/app/history/proposals` |
| 4.5.42 | Task History | Staff - logistics.staff@demo.apu.edu.my | `/app/history/tasks` |

## G - Cafeteria Module

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.43 | Cafeteria Staff Tasks | Cafeteria Staff - cafeteria.staff2@demo.apu.edu.my | `/app/inbox/cafeteria-tasks` |
| 4.5.44 | My Menu Management | Cafeteria Manager - cafeteria.manager@demo.apu.edu.my | `/app/menu` |
| 4.5.45 | Manage Cafeterias | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/manage` |
| 4.5.46 | Cafeteria Staff Assignments | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/staff-assignments` |
| 4.5.47 | Menu Oversight | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/menu-oversight` |
| 4.5.48 | My Staff | Cafeteria Manager - cafeteria.manager@demo.apu.edu.my | `/app/cafeterias/my-staff` |
| 4.5.49 | Staff Action History | Cafeteria Admin - cafeteria.admin@demo.apu.edu.my | `/app/cafeterias/staff-requests-history` |

## H - Clubs Module

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.50 | Discover Clubs | Student - applicant@demo.apu.edu.my | `/app/clubs/discover` |
| 4.5.51 | My Clubs | Student - applicant@demo.apu.edu.my | `/app/clubs/my-clubs` |
| 4.5.52 | Club Roster Modal | Student - applicant@demo.apu.edu.my | `/app/clubs/my-clubs` |
| 4.5.53 | Club Join Requests | Student - applicant@demo.apu.edu.my | `/app/inbox/club-requests` |
| 4.5.54 | President Change Requests | Club Admin - club.admin@demo.apu.edu.my | `/app/inbox/president-change-request` |
| 4.5.55 | Manage Clubs | Club Admin - club.admin@demo.apu.edu.my | `/app/clubs/manage` |
| 4.5.56 | Club Categories | Club Admin - club.admin@demo.apu.edu.my | `/app/club-category` |

## I - Dashboards

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.57 | Dashboard - HOD Logistics | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.58 | Dashboard - HOD Food and Beverage | HOD Food & Beverage - fmb@demo.apu.edu.my | `/app/dashboard` |
| 4.5.59 | Dashboard - HOD Audio Visual | HOD A/V - av.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.60 | Dashboard - HOD Transport | HOD Transport - transport.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.61 | Dashboard - CFO Finance | CFO - cfo@demo.apu.edu.my | `/app/dashboard` |
| 4.5.62 | Dashboard - Cafeteria Manager | Cafeteria Manager - cafeteria.manager@demo.apu.edu.my | `/app/dashboard` |

## J - Events and Registrations

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.63 | Event Registrations Hub | Head of School - hoshod@demo.apu.edu.my | `/app/inbox/registrations` |
| 4.5.64 | Ongoing Events | Head of School - hoshod@demo.apu.edu.my | `/app/ongoing/events` |
| 4.5.65 | Event History | Head of School - hoshod@demo.apu.edu.my | `/app/history/events` |

## K - System Administration

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.66 | Users Directory | System Admin - system.admin@demo.apu.edu.my | `/app/users` |
| 4.5.67 | Units Directory | System Admin - system.admin@demo.apu.edu.my | `/app/units` |
| 4.5.68 | Roles Management | System Admin - system.admin@demo.apu.edu.my | `/app/roles` |
| 4.5.69 | Page Visibility | System Admin - system.admin@demo.apu.edu.my | `/app/admin/page-visibility` |
| 4.5.70 | System Configuration - Approval Policies | System Admin - system.admin@demo.apu.edu.my | `/app/admin/settings/policies` |
| 4.5.71 | System Configuration - Event Categories | System Admin - system.admin@demo.apu.edu.my | `/app/admin/settings/categories` |
| 4.5.72 | System Configuration - Event Formats | System Admin - system.admin@demo.apu.edu.my | `/app/admin/settings/formats` |
| 4.5.73 | Option Catalogue - Logistics Items | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dropdown-options/logistics` |
| 4.5.74 | Option Catalogue - Transportation Types | HOD Transport - transport.manager@demo.apu.edu.my | `/app/dropdown-options/transportation` |
| 4.5.75 | Option Catalogue - Sound and Light | HOD A/V - av.manager@demo.apu.edu.my | `/app/dropdown-options/soundLight` |
| 4.5.76 | Option Catalogue - Dietary Information | HOD Food & Beverage - fmb@demo.apu.edu.my | `/app/dropdown-options/dietaryInformation` |
| 4.5.77 | Option Catalogue - Venue Management | CFO - cfo@demo.apu.edu.my | `/app/dropdown-options/venue` |
| 4.5.78 | Option Catalogue - Funding Items | CFO - cfo@demo.apu.edu.my | `/app/dropdown-options/fundingMain` |

## L - AI Assistant

| # | Figure title | Captured as | Route |
|---|---|---|---|
| 4.5.79 | AI Assistant Dock | HOD Logistics - logistics.manager@demo.apu.edu.my | `/app/dashboard` |
| 4.5.80 | AI Assistant Full Page | HOD Logistics - logistics.manager@demo.apu.edu.my | `/assistant` |
| 4.5.81 | AI Access Log | System Admin - system.admin@demo.apu.edu.my | `/app/admin/ai-access-log` |


## Known empty states

Verified against the live database: these pages have no rows to show for any
account, so the figure is the application's empty state. That is a real screen
rather than a capture failure, but caption it accordingly.

| # | Figure | Why it is empty |
|---|---|---|
| 4.5.63 | Event Registrations Hub | No registration in the database is in "pending" status, so nothing awaits approval. |
| 4.5.64 | Ongoing Events | Same cause - the pending-registration queue is empty. |


## Note keys

- `EMPTY-STATE` - the page rendered its "nothing here yet" state; correct behaviour, but pick a different account if you want a populated figure.
- `PREP-MISSED` - the scripted interaction (open a modal, switch a tab) found no matching control, so the figure shows the page beneath it.
- `LANDED->` - the app redirected; the figure shows where it actually ended up.
