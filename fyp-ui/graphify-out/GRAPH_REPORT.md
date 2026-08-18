# Graph Report - fyp-ui  (2026-08-18)

## Corpus Check
- 0 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2836 nodes · 6085 edges · 169 communities (106 shown, 63 thin omitted)
- Extraction: 97% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 151 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- App Shell & AI Assistant
- Public Landing Page
- Event Registration API
- My Events Tab
- My Clubs Tab
- Permission Grant Labels
- Pending Registrations Tab
- Cafeteria Menu Oversight
- Auth Session & Navigation
- Proposal Review Page
- Editable Data Table
- Request Option Management
- Pending Clubs Tab
- Staff Task Model & API
- Event Calendar Component
- Cafeteria Staff History
- Requests Hub Tab
- Policies Config Tab
- Profile & Avatar
- Club Category Picker
- Users & Units Admin
- Routing Matrix Page
- Character Counter
- Happening Soon Carousel
- Page Visibility Admin
- Event Catalog Admin
- List View Modes & Records
- Roles Admin Page
- Logistics Availability Models
- Proposal Form Field Rules
- Admin Directory Service
- Shared Library Demo Page
- Proposal Stage Vocabulary
- Proposal Workflow Contract
- Cafeteria Directory
- Proposal Mock Fixtures
- Request Option Repository
- Internal Layout Shell
- Club Management Page
- Guest Registration & Saved Events
- Admin User Records
- Auth Test Fixtures
- Admin Page State & Tabs
- Published Event Models
- Event Proposal Form
- Option Cards & Image Upload
- How It Works Timeline
- Proposal Visibility Rules
- Department Review View
- Cafeteria Staff Requests
- Event Image Upload
- Editable Proposal Tables
- System Config & Step Indicator
- Request Option Service
- Role Admin Repository
- Club Domain Models
- Request Option Kinds
- Routing & Auth Guards
- Event Calendar & Favourites
- Guest Registration Modal
- Role Access Helpers
- Club Join Request Inbox
- Drafts & Notifications Page
- Review Action Confirmations
- Shared Form Controls
- Department Routing Config
- Cafeteria Backend Routes
- Club Category Manager
- Proposal Workflow HTTP Client
- Proposal Workflow Service
- Login Page
- Club Discover Page
- Proposals Hub Tab
- Event Details Modal
- Shared Form Modal
- Explore Events Page
- Nav Page Admin Records
- Admin Directory Models
- Deletion Preview Checks
- Payment Proof Upload
- Cafeteria My Staff
- Club Request History Tab
- Missing Field Navigation
- Table Workspace & Pagination
- Department Option Kinds
- Config Routes
- Proposal Content Persistence
- Admin Directory Actions
- Soft Delete Registry
- Page Code Derivation
- SVG Icon Upload
- Event Catalog Routes
- Nav Page Seeding
- Database Seeding
- Workflow E2E Test
- Nav Page Purge Actions
- Admin Routes & Role Eligibility
- Published Events Backend
- Auth Projection & Nav Tree
- Proposal Projection & Routes
- Logistics Availability
- Club Backend Routes
- Unit Role Migration Script
- Workflow State Machine
- Workflow Authorization
- Staff Task Backend Routes
- Server Bootstrap & Backfills
- Project Instructions
- Production Environment
- NPM Dependencies
- Schema Alignment Plan
- Angular Build Config
- Proposal Form Template
- Header & View Templates
- Club Page Templates
- Express Backend Design
- APU Logo Assets
- APU Wordmark Assets
- Role Label Derivation Notes
- Social Icons (Meta)
- Social Icons (Video)
- Project README
- Login Page Template
- HTML Bootstrap
- Auth Model Redesign Notes
- Evening Event Photos
- Tech Event Photos
- QS Ranking Badges
- Hero Video Stills
- Internal Explore Wrapper
- Career Fair Photo
- Green Day Photo
- Cultural Night Photo
- Wellness Run Photo
- Life at Work Badge
- Premier Digital Tech Badge
- Employability Index Badge
- AI Assistant Template
- Option Picker Grid
- Site Footer Template
- Admin Page Design Notes
- Option Management Templates
- How It Works Template
- Placeholder Page Template
- Landing Page Templates
- RBAC Seed Role Catalog
- Admin Modal Templates
- Backend Design Principles
- Workflow State Machine Notes
- RBAC Table Design
- RBAC Design Notes
- Unit Role Migration Notes
- Data Page Templates
- Workspace Templates
- Proposal Review Templates

## God Nodes (most connected - your core abstractions)
1. `EventProposalComponent` - 143 edges
2. `ProposalReviewRecord` - 73 edges
3. `PageVisibilityComponent` - 72 edges
4. `AdminDirectoryComponent` - 66 edges
5. `apiErrorMessage()` - 60 edges
6. `AuthService` - 51 edges
7. `RequestOptionManagementComponent` - 49 edges
8. `AdminDirectoryService` - 49 edges
9. `ApiAdminDirectoryRepository` - 47 edges
10. `InternalRowActionEvent` - 45 edges

## Surprising Connections (you probably didn't know these)
- `APU Logo Text with Globe Icon (legacy/old version)` --semantically_similar_to--> `AI-Generated APU Logo Text with Globe Icon (ChatGPT image asset)`  [INFERRED] [semantically similar]
  public/assets/media/old/apu-logo-text-old.png → src/assit/ChatGPT Image Jul 31, 2026, 07_20_29 PM.png
- `APU Logo Text with Globe Icon (legacy/old version)` --semantically_similar_to--> `APU Logo with Globe Icon (JPEG asset copy)`  [INFERRED] [semantically similar]
  public/assets/media/old/apu-logo-text-old.png → src/assit/logo.jpg
- `app-delete-confirm-dialog usage` --conceptually_related_to--> `Soft-delete with 7-day auto-purge`  [INFERRED]
  src/app/features/internal/pages/admin-directory/admin-directory.html → docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-design.md
- `derivedUnitCode() read-only unit code field` --conceptually_related_to--> `Unit Code auto-derived read-only field`  [INFERRED]
  src/app/features/internal/pages/admin-directory/admin-directory.html → docs/system-logic/rbac-unit-level-migration-prompt.md
- `page-visibility.html (Pages/Permissions/Deleted admin UI)` --conceptually_related_to--> `Page Visibility / Nav Builder`  [INFERRED]
  src/app/features/internal/pages/page-visibility/page-visibility.html → docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-design.md

## Import Cycles
- None detected.

## Communities (169 total, 63 thin omitted)

### Community 0 - "App Shell & AI Assistant"
Cohesion: 0.05
Nodes (26): App, AiAssistantComponent, ChatMessage, IdleGesture, OrbPhase, SuggestionCard, AiAwarenessEvent, AiOrbAwarenessService (+18 more)

### Community 1 - "Public Landing Page"
Cohesion: 0.05
Nodes (24): CampusLifeComponent, CampusLifePillar, HeroComponent, MockIntersectionObserver, LandingPageComponent, MyEventsComponent, CtaLinkArrow, CtaLinkComponent (+16 more)

### Community 10 - "Event Registration API"
Cohesion: 0.10
Nodes (13): EventRegistrationApi, RegisteredEventsResponse, EventRegistration, PendingEventRegistration, RegistrationResult, PublishedEventService, EventCard, EventDate (+5 more)

### Community 11 - "Auth Session & Navigation"
Cohesion: 0.09
Nodes (26): AuthNavigationItem, AuthNavigationSection, AuthUser, DemoAuthUser, RoleNavigation, RoleNavigationEntry, UserAccountType, AuthService (+18 more)

### Community 13 - "Staff Task Model & API"
Cohesion: 0.09
Nodes (17): StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus, ApiStaffTaskRepository, StaffTaskService, PageMode (+9 more)

### Community 14 - "Event Calendar Component"
Cohesion: 0.08
Nodes (4): EventCalendarComponent, isEventVisibleTo(), Component, HostListener

### Community 158 - "Profile & Avatar"
Cohesion: 0.40
Nodes (4): ProfileComponent, UserAvatarComponent, Component, Component

### Community 19 - "Event Catalog Admin"
Cohesion: 0.05
Nodes (13): ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogEntry, EventCatalogRepository, EventCatalogRepositoryImpl, EventCatalogResource, EventCatalogEntryService, EventCategoryService (+5 more)

### Community 2 - "List View Modes & Records"
Cohesion: 0.10
Nodes (44): ViewMode, ViewMode, ViewMode, ViewMode, CollectionRecord, RecordsPageDefinition, RecordsPageKind, LibraryCategory (+36 more)

### Community 20 - "Roles Admin Page"
Cohesion: 0.08
Nodes (4): RolesComponent, deriveRoleCode(), restoreLabelFor(), Component

### Community 22 - "Logistics Availability Models"
Cohesion: 0.16
Nodes (13): RegistrationMode, LogisticsAvailability, LogisticsCommittedWindow, LogisticsAvailabilityService, ProposalReviewItem, ProposalReviewSection, ProposalStep, RequirementKey (+5 more)

### Community 23 - "Proposal Form Field Rules"
Cohesion: 0.11
Nodes (3): RequestDefinition, EditableTableColumn, FormControlType

### Community 27 - "Proposal Stage Vocabulary"
Cohesion: 0.11
Nodes (20): DepartmentConfirmation, DepartmentTaskStatus, ProposalStage, ProposalWorkflowState, reviewerCommentEntry, ReviewerComment, ProposalFieldComponent, ProposalKpiBarComponent (+12 more)

### Community 30 - "Cafeteria Directory"
Cohesion: 0.06
Nodes (11): AssignableCafeteriaUser, Cafeteria, CafeteriaAssignment, CafeteriaAssignmentDraft, CafeteriaDraft, CafeteriaStaffRoleCode, CafeteriaService, CafeteriaManageComponent (+3 more)

### Community 31 - "Proposal Mock Fixtures"
Cohesion: 0.17
Nodes (15): ProposalDepartmentKey, coOwnersFor(), organizersFor(), proposal(), proposalForTitle(), requests(), SCHEDULE_ROWS(), workflowAt() (+7 more)

### Community 32 - "Request Option Repository"
Cohesion: 0.15
Nodes (11): RequestOptionDto, RequestOptionWriteDto, ArchivedRequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository, ApiRequestOptionRepository, mapRequestOptionResponse() (+3 more)

### Community 33 - "Internal Layout Shell"
Cohesion: 0.14
Nodes (3): InternalLayoutComponent, Component, HostListener

### Community 35 - "Guest Registration & Saved Events"
Cohesion: 0.10
Nodes (15): ExternalRegistrationService, GuestRegistrationFlowService, PendingChallenge, ExternalRegistrationApi, ExternalUserRegistrationRequest, ExternalUserRegistrationResponse, NotificationPreference, SavedEventMutationResponse (+7 more)

### Community 36 - "Admin User Records"
Cohesion: 0.16
Nodes (3): AdminUserDraft, AdminUserRecord, Archived

### Community 37 - "Auth Test Fixtures"
Cohesion: 0.09
Nodes (35): AuthNavNode, AuthUserRole, TestUserOptions, testNavPage(), testRole(), testUser(), unitManager(), activatedRouteStub() (+27 more)

### Community 38 - "Admin Page State & Tabs"
Cohesion: 0.07
Nodes (33): AdminEntity, AdminTab, AssignmentRow, UserAssignmentGroup, CafeteriaManageTab, PageVisibilityTab, RolesTab, Draft (+25 more)

### Community 39 - "Published Event Models"
Cohesion: 0.12
Nodes (17): RegisteredEventEntry, SavedEventRecord, EventVisibility, PaymentStatus, PublishedEvent, RegistrationStatus, MyEventsTabMode, TabEntry (+9 more)

### Community 4 - "Event Proposal Form"
Cohesion: 0.05
Nodes (4): EventProposalComponent, OptionPickerItem, allCommentEntries(), Component

### Community 40 - "Option Cards & Image Upload"
Cohesion: 0.12
Nodes (16): ViewMode, ManagerField, ImageUploadFieldComponent, OptionCardMetaField, OptionCardViewModel, OptionCardGridComponent, OptionItemDetailsModalComponent, StatusToggleComponent (+8 more)

### Community 41 - "How It Works Timeline"
Cohesion: 0.18
Nodes (8): HowItWorksComponent, ProcessPathMarker, ProcessPathPoint, ProcessPathPosition, ProcessStep, Component, HostListener, ViewChild

### Community 42 - "Proposal Visibility Rules"
Cohesion: 0.19
Nodes (24): ProposalVisibilitySection, ViewKind, departmentFor(), hasRole(), isExternalUser(), requestKindsForRole(), departmentsForRole(), isReviewerStage() (+16 more)

### Community 43 - "Department Review View"
Cohesion: 0.10
Nodes (3): FmbSelection, ProposalDepartmentViewComponent, Component

### Community 44 - "Cafeteria Staff Requests"
Cohesion: 0.07
Nodes (8): CafeteriaStaffRequest, CafeteriaStaffRequestAction, CafeteriaStaffRequestDraft, CafeteriaStaffRequestStatus, CafeteriaStaffRequestService, CafeteriaStaffAssignmentsComponent, Injectable, Component

### Community 45 - "Event Image Upload"
Cohesion: 0.16
Nodes (11): ApiEventImageUploadService, EventImageUploadApi, EventImageUploadRequest, EventImageUploadResponse, MockEventImageUploadService, EventImageAsset, EventImageUploadComponent, readAsDataUrl() (+3 more)

### Community 46 - "Editable Proposal Tables"
Cohesion: 0.13
Nodes (6): EditableRow, ProposalTableColumn, ProposalTableComponent, RowCounterComponent, Component, Component

### Community 47 - "System Config & Step Indicator"
Cohesion: 0.11
Nodes (9): SystemConfig, SystemConfigDraft, SystemConfigService, StepIndicatorComponent, StepStatus, WizardStep, DEFAULT_CONFIG, Injectable (+1 more)

### Community 48 - "Request Option Service"
Cohesion: 0.26
Nodes (3): RequestOption, RequestOptionService, Injectable

### Community 49 - "Role Admin Repository"
Cohesion: 0.13
Nodes (5): AdminRoleDraft, AdminRoleRecord, ApiAdminDirectoryRepository, AssignmentDraftRow, Injectable

### Community 50 - "Club Domain Models"
Cohesion: 0.10
Nodes (11): ClubCategoryRecord, ClubDraft, ClubJoinRequestRecord, ClubJoinRequestStatus, ClubMemberRecord, ClubMyStatus, ClubRecord, ClubUserSummary (+3 more)

### Community 51 - "Request Option Kinds"
Cohesion: 0.21
Nodes (14): CampusTourStartOption, CampusTourTypeOption, DietaryInformationOption, FoodRequestOption, FundingMainOption, FundingSubOption, LogisticsRequestOption, MediaRequestOption (+6 more)

### Community 53 - "Routing & Auth Guards"
Cohesion: 0.12
Nodes (16): ClubHubComponent, InternalPlaceholderComponent, CategoriesTabComponent, FormatsTabComponent, placeholderPage(), authGuard(), defaultRoleRouteGuard(), externalUserGuard() (+8 more)

### Community 54 - "Event Calendar & Favourites"
Cohesion: 0.06
Nodes (23): EventFavouriteService, InternalExploreEventsComponent, AgendaDay, CalendarDay, CalendarEvent, CalendarView, AppliedFilterChip, ExploreEvent (+15 more)

### Community 58 - "Role Access Helpers"
Cohesion: 0.16
Nodes (14): RecordsHubBucket, RecordsHubComponent, hasAnyRole(), isClubPresident(), isHeadOfAnyUnit(), isSchoolStudentOrLecturer(), isStaffLike(), isSystemAdmin() (+6 more)

### Community 62 - "Review Action Confirmations"
Cohesion: 0.13
Nodes (3): ProposalReviewerViewComponent, apiErrorMessage(), Component

### Community 63 - "Shared Form Controls"
Cohesion: 0.12
Nodes (10): EditableColumnType, SelectOption, StaffOption, SearchableDropdownComponent, ValidationMessageComponent, CLUB_CATEGORY_MAX, CLUB_CATEGORY_MIN, Component (+2 more)

### Community 64 - "Department Routing Config"
Cohesion: 0.16
Nodes (19): DepartmentRequestKind, WorkflowIdentity, FmbSelectionStatus, ProposalDepartmentRequest, FmbSelectionDraft, FmbSelectionEdit, RequestRow, RoutingMatrixRow (+11 more)

### Community 65 - "Cafeteria Backend Routes"
Cohesion: 0.12
Nodes (14): WorkflowError, cafeteriaUnits(), createAssignment(), findExistingManager(), updateAssignment(), deriveRoleCode(), isCafeteriaUnitCode(), CAFETERIA_ROLE_CODES (+6 more)

### Community 79 - "Shared Form Modal"
Cohesion: 0.23
Nodes (3): FormModalComponent, Component, HostListener

### Community 8 - "Explore Events Page"
Cohesion: 0.08
Nodes (4): ProposalEventSchedule, ExploreEventsComponent, Component, HostListener

### Community 83 - "Admin Directory Models"
Cohesion: 0.12
Nodes (9): AdminDirectoryRepository, AdminNavPageGrant, AdminNavPageGrantDraft, AdminUnitDraft, AdminUnitRecord, AdminUserAssignment, NavEntryType, PageVisibilityDraft (+1 more)

### Community 86 - "Payment Proof Upload"
Cohesion: 0.27
Nodes (8): ApiPaymentProofUploadService, MockPaymentProofUploadService, PaymentProofUploadApi, PaymentProofUploadRequest, PaymentProofUploadResponse, readAsDataUrl(), PAYMENT_PROOF_UPLOAD_API, Injectable

### Community 97 - "Table Workspace & Pagination"
Cohesion: 0.25
Nodes (3): InternalPaginationComponent, InternalTableWorkspaceComponent, Component

### Community 98 - "Department Option Kinds"
Cohesion: 0.22
Nodes (3): FlatDepartmentWorkflowConfig, UnitDepartmentWorkflowConfig, RequestOptionKind

### Community 105 - "Config Routes"
Cohesion: 0.29
Nodes (7): configRow(), projectConfig(), CONFIG_FIELDS, { db }, express, router, workflow

### Community 107 - "Proposal Content Persistence"
Cohesion: 0.36
Nodes (11): applicantResubmit(), applyRequestScalarFields(), assertProposalOwner(), buildRequestChildRows(), clearRequestChildRows(), createProposal(), deleteDraft(), maxEventCategories() (+3 more)

### Community 123 - "Soft Delete Registry"
Cohesion: 0.26
Nodes (13): init(), registerAll(), archivedList(), checkDependencies(), findRow(), mountRoutes(), previewDeletion(), purge() (+5 more)

### Community 146 - "Event Catalog Routes"
Cohesion: 0.22
Nodes (7): makeCatalog(), { db, nextId }, { deriveUnitCode }, express, router, softDeleteService, workflow

### Community 149 - "Nav Page Seeding"
Cohesion: 0.48
Nodes (7): seedNavPages(), allActiveUnitCodes(), grant(), grantAnyUnit(), grantCafeteriaManager(), page(), unitScopedRoleCodesAtSeed()

### Community 15 - "Database Seeding"
Cohesion: 0.09
Nodes (32): backfillEventCatalog(), backfillMissingCatalogDefaults(), nextId(), resetCounters(), seedCafeteriaDomain(), seedCategoriesAndRequirements(), seedClubsDemo(), seedConfigValues() (+24 more)

### Community 155 - "Workflow E2E Test"
Cohesion: 0.67
Nodes (5): call(), check(), futureDate(), main(), proposalPayload()

### Community 21 - "Admin Routes & Role Eligibility"
Cohesion: 0.09
Nodes (23): projectGrant(), projectNavPage(), projectRole(), validateGrant(), eligibleRolesForUnit(), eligibleRolesForUnits(), flatRoleEligible(), flatRolesAvailable() (+15 more)

### Community 24 - "Published Events Backend"
Cohesion: 0.12
Nodes (19): findPublishedRequest(), mapRegistrationStatus(), projectRegistration(), isPublishedEvent(), projectPublishedEvent(), publishedEvents(), db, { db } (+11 more)

### Community 28 - "Auth Projection & Nav Tree"
Cohesion: 0.14
Nodes (21): projectUser(), cafeteriaCodeFor(), projectAuthUser(), isClubAdmin(), presidentOfClubIds(), navTreeFor(), buildChildren(), visible() (+13 more)

### Community 29 - "Proposal Projection & Routes"
Cohesion: 0.10
Nodes (24): canStillBeCancelled(), dbStatusToProposalStage(), departmentRequestsFor(), editableRowsFromAgenda(), editableRowsFromCoOwners(), editableRowsFromDiscussions(), editableRowsFromGuests(), editableRowsFromImportantPeople() (+16 more)

### Community 5 - "Logistics Availability"
Cohesion: 0.14
Nodes (16): allOptions(), projectOption(), committedWindowsFor(), computeAvailability(), fromMinutes(), nextAvailableAt(), toMinutes(), windowsOverlap() (+8 more)

### Community 56 - "Club Backend Routes"
Cohesion: 0.15
Nodes (14): clubCategoriesFor(), projectCategory(), projectClub(), projectJoinRequest(), projectUserSummary(), isEligibleForClub(), isPresidentOf(), { db, nextId } (+6 more)

### Community 57 - "Unit Role Migration Script"
Cohesion: 0.19
Nodes (14): departmentForUser(), deriveUnitCode(), ensureUnitUsersLink(), findOrCreateUnit(), migrate(), unitKindFor(), DEFAULT_DB_PATH, FMB_UNIT_CODE (+6 more)

### Community 7 - "Workflow State Machine"
Cohesion: 0.15
Nodes (30): approveDepartmentTask(), approveFmbSelection(), assignStaffToTask(), authorizeDepartmentTask(), checkAllDepartmentTasksResolved(), checkFmbTaskResolved(), claimSharedFmbSelection(), createFmbSelection() (+22 more)

### Community 70 - "Workflow Authorization"
Cohesion: 0.18
Nodes (19): hasRole(), isHeadOfUnit(), approveReviewerStage(), authorizeAction(), cancellationDeadlineDays(), cancelProposal(), createDepartmentTasks(), earliestEventDate() (+11 more)

### Community 81 - "Staff Task Backend Routes"
Cohesion: 0.23
Nodes (8): departmentTaskDetails(), mapTaskStatus(), projectDepartmentTask(), projectDepartmentTasks(), { db }, express, router, workflow

### Community 85 - "Server Bootstrap & Backfills"
Cohesion: 0.14
Nodes (15): backfillRemoveAssignmentsNavPage(), backfillResolveNavIcons(), backfillSplitSystemConfigNavPages(), saveDb(), sweep(), resolveSeedIcon(), runRetentionSweep(), app (+7 more)

### Community 6 - "NPM Dependencies"
Cohesion: 0.04
Nodes (47): dependencies, @angular/common, @angular/compiler, @angular/core, @angular/forms, @angular/platform-browser, @angular/router, rxjs (+39 more)

### Community 60 - "Schema Alignment Plan"
Cohesion: 0.05
Nodes (38): EMS Schema Alignment + Mock Backend Implementation Plan, Global Constraints, Phase 1: Source-of-Truth Corrections, Phase 2: Angular Frontend Refactor, Phase 2b: Extend Auth, Events, Saved Events, System Config, and Image Upload to REST, Phase 3: Express Mock Backend, Phase 4: Wire the Dev-Server Proxy and Verify End-to-End, Task 1.1: Correct `ems_database_schema.sql` — roles, F&B rename, water/campus-tour restructuring, new status columns (+30 more)

### Community 9 - "Angular Build Config"
Cohesion: 0.05
Nodes (44): build, serve, test, builder, configurations, defaultConfiguration, options, packageManager (+36 more)

### Community 104 - "Proposal Form Template"
Cohesion: 0.40
Nodes (5): event-proposal.html (6-step proposal form), Logistics quantity availability indicator, Required for Event requirements checklist (step 3), Live Review Summary / proposal preview, app-step-indicator component usage

### Community 106 - "Header & View Templates"
Cohesion: 0.33
Nodes (6): app-cta-link (header usage), Site Header Template, Calendar Month/Week/Agenda View Modes, Explore Events Public/Internal Variant Pattern, My Events publicLayout Toggle, External User Restricted Navigation

### Community 111 - "Express Backend Design"
Cohesion: 0.40
Nodes (5): server/app.js (Express app), server/db.js (aggregated seed db), server/index.js (http server bootstrap), Node/Express Mock Backend Server, In-memory only, no artificial latency

### Community 112 - "APU Logo Assets"
Cohesion: 0.40
Nodes (5): APU Full Logo (globe + wordmark), APU Logo (globe icon only), APU Logo with Wordmark (dark, PNG), APU Logo with Wordmark (dark, WebP), APU Footer Logo (globe + red-dot wordmark)

### Community 113 - "APU Wordmark Assets"
Cohesion: 0.50
Nodes (5): APU Logo Text Black (current, no globe icon), APU Logo Text with Globe Icon (legacy/old version), APU Logo Text Black (legacy/old version, low contrast render), AI-Generated APU Logo Text with Globe Icon (ChatGPT image asset), APU Logo with Globe Icon (JPEG asset copy)

### Community 117 - "Role Label Derivation Notes"
Cohesion: 0.50
Nodes (4): admin.routes.js projectUser() derivation, auth.routes.js login response derivation, role-labels.js unitRoleLabel helper, role-navigation.ts re-keying

### Community 120 - "Social Icons (Meta)"
Cohesion: 0.67
Nodes (3): Facebook Social Icon, Instagram Social Icon, LinkedIn Social Icon

### Community 121 - "Social Icons (Video)"
Cohesion: 0.67
Nodes (3): TikTok Social Icon, X (Twitter) Social Icon, YouTube Social Icon

### Community 122 - "Project README"
Cohesion: 0.67
Nodes (3): Angular CLI, Vitest test runner, FypUi README

### Community 125 - "Login Page Template"
Cohesion: 0.67
Nodes (3): login.html (Login page template), Development demo users picker, app-guest-registration-modal component usage

### Community 154 - "Admin Page Design Notes"
Cohesion: 0.33
Nodes (6): admin-directory.html (Users/Units admin page), app-delete-confirm-dialog usage, Deleted tab (archived users/units), derivedUnitCode() read-only unit code field, Soft-delete with 7-day auto-purge, Unit Code auto-derived read-only field

### Community 156 - "Option Management Templates"
Cohesion: 0.33
Nodes (6): app-image-upload-field Component, app-option-card-grid Component, app-option-item-details-modal Component, app-searchable-dropdown Component, app-status-toggle Component, Request Option Management Template

### Community 52 - "Landing Page Templates"
Cohesion: 0.23
Nodes (15): app-cta-link Component, app-event-card Component, app-event-details-modal Component, app-expandable-search Component, app-filter-button Component, app-site-footer Component, app-site-header Component, Campus Life Section Template (+7 more)

### Community 68 - "RBAC Seed Role Catalog"
Cohesion: 0.33
Nodes (6): isSchoolUnit(code) backend helper, 9 seed role catalog (protected), RBAC Redesign: Users/Units/Roles/Page Visibility Design, One head per unit constraint, Protected vs custom role distinction, School detection by substring match

### Community 69 - "Admin Modal Templates"
Cohesion: 0.22
Nodes (10): Club Category Manager Modal Template, app-delete-confirm-dialog Component, app-feedback-banner Component, app-form-field Component, app-form-modal Component, Hub Club Requests Template, Roles Page Template, Unit-Scoped Role Concept (+2 more)

### Community 71 - "Backend Design Principles"
Cohesion: 0.29
Nodes (7): EMS Schema Alignment + Mock Backend Design, Backend owns the workflow (design principle), Campus Tour trimmed to Starting Point only, F&B role merge (FmbReviewer + FmbManager -> fmb), HOS/HOD self-review skip rule, Mineral Water merged into F&B task, F&B job merge into head-of-department

### Community 72 - "Workflow State Machine Notes"
Cohesion: 0.40
Nodes (5): workflow.service.js (state machine implementation), Corrected Workflow State Machine (section 3), Cafeteria Staff shared inbox mechanism, department_review parallel independent tasks, workflow.service.js hasRole update

### Community 80 - "RBAC Table Design"
Cohesion: 0.25
Nodes (8): nav_page_roles table, nav_page table, role table, unit table, user_unit_roles table, users table (identity fields only), page-visibility.html (Pages/Permissions/Deleted admin UI), Page Visibility / Nav Builder

### Community 89 - "RBAC Design Notes"
Cohesion: 0.20
Nodes (10): nav-tree.service.js, role-eligibility.service.js, user-access.service.js, app.html (root shell template), app-ai-assistant component usage, app-toast-host component usage, internal-layout.html (app shell with sidebar/nav), Mobile navigation panel (+2 more)

### Community 90 - "Unit Role Migration Notes"
Cohesion: 0.29
Nodes (8): migrate-unit-level-roles.js migration script, Unit + Level RBAC Migration Prompt, Fully data-driven RBAC rationale, applicant role deletion rationale, generic staff role deletion rationale, users.role generic level marker compatibility field, School unit-kind warning note, Unit + Level identity model

### Community 93 - "Data Page Templates"
Cohesion: 0.29
Nodes (8): app-internal-data-page Component, app-internal-page-state Component, app-internal-data-table Component, Hub Proposals Template, Hub Requests Template, Records Hub Tabs Template, Staff Tasks Page Template, Records Hub Conditional Tab Visibility (tasks/requests/club-requests)

### Community 94 - "Workspace Templates"
Cohesion: 0.29
Nodes (8): app-internal-table-workspace Component, app-internal-pagination Component, app-step-indicator Component, app-user-avatar Component, Profile Page Template, Shared Library Catalog Page Template, Shared Component Library Live Showcase Pattern, Content-Projection Slot Composition Pattern (workspaceHeader/Controls/Table/Mobile)

### Community 95 - "Proposal Review Templates"
Cohesion: 0.22
Nodes (10): app-loading-state Component, app-proposal-department-view Component, app-proposal-reviewer-view Component, app-proposal-field Component, app-proposal-kpi-bar Component, app-proposal-section Component, app-proposal-table Component, Proposal Review Page Template (+2 more)

## Ambiguous Edges - Review These
- `Fully data-driven RBAC rationale` → `Unit + Level identity model`  [AMBIGUOUS]
  docs/system-logic/rbac-unit-level-migration-prompt.md · relation: conceptually_related_to
- `app-internal-table-workspace Component` → `Shared Library Catalog Page Template`  [AMBIGUOUS]
  src/app/features/shared-library/shared-library.html · relation: references

## Knowledge Gaps
- **427 isolated node(s):** `ChatMessage`, `IdleGesture`, `OrbPhase`, `SuggestionCard`, `AiAwarenessEvent` (+422 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **63 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Fully data-driven RBAC rationale` and `Unit + Level identity model`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `app-internal-table-workspace Component` and `Shared Library Catalog Page Template`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `EventProposalComponent` connect `Event Proposal Form` to `Missing Field Navigation`, `Logistics Quantity Checks`, `Proposal Step Navigation`, `Editable Proposal Tables`, `Request Option Kinds`, `Logistics Availability Models`, `Proposal Form Field Rules`, `Proposal Row Editors`, `Proposal Submit Actions`, `Shared Form Controls`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `apiErrorMessage()` connect `Review Action Confirmations` to `List View Modes & Records`, `Request Option Management`, `Staff Task Model & API`, `Users & Units Admin`, `Page Visibility Admin`, `Event Catalog Admin`, `Roles Admin Page`, `Deleted Items Admin`, `Proposal Submit Actions`, `Logistics Availability Models`, `Policies Config Tab`, `Proposal Stage Vocabulary`, `Cafeteria Directory`, `Admin Page State & Tabs`, `Option Cards & Image Upload`, `Department Review View`, `Cafeteria Staff Requests`, `Drafts & Notifications Page`, `Shared Form Controls`, `Page Visibility Grants`, `Cafeteria My Staff`, `Pending Registrations Tab`, `Page Visibility Restore`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `ProposalReviewRecord` connect `Proposal Workflow Contract` to `Department Routing Config`, `List View Modes & Records`, `Event Proposal Form`, `Auth Test Fixtures`, `Published Event Models`, `Proposal Workflow HTTP Client`, `Proposal Workflow Service`, `Proposal Visibility Rules`, `Event Image Upload`, `Editable Proposal Tables`, `Logistics Availability Models`, `Proposal Stage Vocabulary`, `Drafts & Notifications Page`, `Review Action Confirmations`, `Proposal Mock Fixtures`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `ChatMessage`, `IdleGesture`, `OrbPhase` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & AI Assistant` be split into smaller, more focused modules?**
  _Cohesion score 0.05030181086519115 - nodes in this community are weakly interconnected._