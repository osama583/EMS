# Graph Report - fyp-ui  (2026-08-18)

## Corpus Check
- 217 files · ~533,980 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2838 nodes · 6090 edges · 185 communities (116 shown, 69 thin omitted)
- Extraction: 97% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 151 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `997fcd25`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- App Shell & AI Assistant
- SiteHeaderComponent
- shared-library.ts
- ProposalReviewRecord
- EventProposalComponent
- Logistics Availability
- NPM Dependencies
- Workflow State Machine
- Explore Events Page
- Angular Build Config
- PublishedEventService
- auth.models.ts
- RequestOptionManagementComponent
- StaffTasksComponent
- EventCalendarComponent
- db.js
- Users & Units Admin
- Happening Soon Carousel
- PageVisibilityComponent
- EventCatalogSectionComponent
- Roles Admin Page
- Admin Routes & Role Eligibility
- event-proposal.ts
- EditableTableColumn
- Published Events Backend
- AdminDirectoryService
- SharedLibraryComponent
- proposal-department-view.ts
- auth.routes.js
- proposal-projection.service.js
- CafeteriaManageComponent
- proposal-review.mock-data.ts
- request-option.repository.ts
- Internal Layout Shell
- Club Management Page
- event-engagement.models.ts
- ApiAdminDirectoryRepository
- auth.test-fixtures.ts
- page-visibility.ts
- proposal-review.models.ts
- request-option-management.ts
- How It Works Timeline
- proposal-visibility.ts
- Department Review View
- CafeteriaStaffAssignmentsComponent
- Event Image Upload
- EditableRow
- StepIndicatorComponent
- RequestOption
- AdminRoleRecord
- ClubService
- request-option.models.ts
- Landing Page Templates
- app.routes.ts
- components/explore-events/explore-events.ts
- Guest Registration Modal
- Club Backend Routes
- Unit Role Migration Script
- role-access.ts
- Club Join Request Inbox
- Schema Alignment Plan
- RecordsPageComponent
- apiErrorMessage
- SearchableDropdownComponent
- department-workflow.config.ts
- cafeterias.routes.js
- ClubCategoryManagerComponent
- RBAC Seed Role Catalog
- Admin Modal Templates
- user-access.service.js
- Backend Design Principles
- Workflow State Machine Notes
- auth.service.ts
- happening-soon.ts
- LoginComponent
- Club Discover Page
- Proposals Hub Tab
- Event Details Modal
- FormModalComponent
- RBAC Table Design
- Staff Task Backend Routes
- AdminNavPageRecord
- admin-directory.models.ts
- DeletionPreview
- saveDb
- Payment Proof Upload
- RBAC Design Notes
- Unit Role Migration Notes
- Cafeteria My Staff
- Club Request History Tab
- Data Page Templates
- Workspace Templates
- Proposal Review Templates
- .navigateToTableError
- Table Workspace & Pagination
- Department Option Kinds
- My Events Tab
- My Clubs Tab
- Permission Grant Labels
- HubRegistrationsComponent
- Proposal Form Template
- Config Routes
- Header & View Templates
- Proposal Content Persistence
- Club Page Templates
- Cafeteria Menu Oversight
- Proposal Review Page
- Express Backend Design
- APU Logo Assets
- APU Wordmark Assets
- Editable Data Table
- Role Label Derivation Notes
- Admin Directory Actions
- Social Icons (Meta)
- Social Icons (Video)
- Project README
- Soft Delete Registry
- Pending Clubs Tab
- Login Page Template
- HTML Bootstrap
- Auth Model Redesign Notes
- Evening Event Photos
- Tech Event Photos
- QS Ranking Badges
- Hero Video Stills
- Internal Explore Wrapper
- Page Code Derivation
- SVG Icon Upload
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
- event-catalog.routes.js
- Cafeteria Staff History
- FormFieldComponent
- Requests Hub Tab
- Policies Config Tab
- Admin Page Design Notes
- Workflow E2E Test
- Option Management Templates
- Profile & Avatar
- Club Category Picker
- AuthService
- Character Counter
- Nav Page Purge Actions
- Project Instructions
- Production Environment
- How It Works Template
- Placeholder Page Template
- HeroComponent
- CafeteriaStaffRequest
- CafeteriaService
- event-catalog.service.ts
- SavedEventsService
- request-option.service.spec.ts
- EventCatalogRepositoryImpl
- system-config.service.ts
- EventCatalogEntry
- EventCatalogRepository
- cafeteria.service.ts
- AdminUserAssignment
- CafeteriaAssignment
- uploads.routes.js
- logout.ts
- NavEntryType

## God Nodes (most connected - your core abstractions)
1. `EventProposalComponent` - 143 edges
2. `ProposalReviewRecord` - 73 edges
3. `PageVisibilityComponent` - 72 edges
4. `AdminDirectoryComponent` - 66 edges
5. `apiErrorMessage()` - 60 edges
6. `AuthService` - 51 edges
7. `AdminDirectoryService` - 49 edges
8. `RequestOptionManagementComponent` - 49 edges
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

## Hyperedges (group relationships)
- **Landing Page Section Composition** — src_app_features_landing_landing_page_html, src_app_features_landing_components_hero_hero_html, src_app_features_landing_components_campus_life_campus_life_html, src_app_features_landing_components_happening_soon_happening_soon_html, src_app_features_landing_components_explore_events_explore_events_html, src_app_features_landing_components_event_calendar_event_calendar_html [EXTRACTED 1.00]
- **RBAC core data model (users, units, roles, assignments)** — docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_users_table, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_unit_table, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_role_table, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_user_unit_roles_table [EXTRACTED 1.00]
- **APU Logo-with-Globe-Icon Asset Variants** — public_assets_media_old_apu_logo_text_old, src_assit_logo, src_assit_chatgpt_image_jul_31_2026_07_20_29_pm [INFERRED 0.80]
- **Soft-Delete-With-Restore UI Pattern Across Admin Management Pages** — src_app_features_internal_pages_request_option_management_request_option_management_softdelete_concept, src_app_shared_components_club_category_manager_club_category_manager_soft_delete_concept, src_app_features_internal_pages_request_option_management_request_option_management_html, shared_components_club_category_manager_club_category_manager_html, src_app_features_internal_pages_roles_roles_html [INFERRED 0.80]
- **Campus Event Photo Gallery (explore-events cards)** — public_assets_events_campus_after_dark, public_assets_events_career_connect_fair, public_assets_events_community_green_day, public_assets_events_cultural_night, public_assets_events_esports_showdown, public_assets_events_startup_pitch_night, public_assets_events_tech_expo, public_assets_events_wellness_run [INFERRED 0.85]
- **F&B role identity unification across three design iterations** — docs_superpowers_specs_2026_08_10_ems_schema_alignment_and_mock_backend_design_fmb_role_merge, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_fmb_job_merge_rationale, docs_system_logic_rbac_unit_level_migration_prompt_unit_level_model [INFERRED 0.85]
- **University Recognition/Award Badges (footer)** — public_assets_media_footer_award_life_at_work, public_assets_media_footer_award_premier_digital_tech, public_assets_media_footer_award_qs_five_stars, public_assets_media_footer_award_qs_world_ranking, public_assets_media_footer_award_talentbank_employability [INFERRED 0.85]
- **Social Media Links (footer)** — public_assets_media_footer_social_facebook, public_assets_media_footer_social_instagram, public_assets_media_footer_social_linkedin [INFERRED 0.85]
- **Footer Social Media Icon Set** — public_assets_media_footer_social_tiktok, public_assets_media_footer_social_x, public_assets_media_footer_social_youtube [INFERRED 0.85]
- **Records Hub Tab Pages Sharing app-internal-data-page Shell** — src_app_features_internal_pages_records_hub_hub_proposals_hub_proposals_html, src_app_features_internal_pages_records_hub_hub_requests_hub_requests_html, src_app_features_internal_pages_records_hub_hub_club_requests_hub_club_requests_html, shared_components_internal_data_page_internal_data_page_html, src_app_features_internal_pages_records_hub_records_hub_html [INFERRED 0.85]

## Communities (185 total, 69 thin omitted)

### Community 0 - "App Shell & AI Assistant"
Cohesion: 0.05
Nodes (26): App, appConfig, routes, Component, AiAssistantComponent, ChatMessage, createGreeting(), IdleGesture (+18 more)

### Community 1 - "SiteHeaderComponent"
Cohesion: 0.10
Nodes (12): MyEventsComponent, Component, FooterAward, FooterLink, FooterLinkGroup, SiteFooterComponent, SocialLink, Component (+4 more)

### Community 2 - "shared-library.ts"
Cohesion: 0.10
Nodes (46): ACTION_LABELS, STATUS_LABEL, STATUS_TONE, ViewMode, ViewMode, ViewMode, ViewMode, BUCKET_COPY (+38 more)

### Community 3 - "ProposalReviewRecord"
Cohesion: 0.06
Nodes (10): DepartmentRequestKind, ProposalReviewRecord, ApiProposalWorkflowRepository, FmbSelectionDraft, FmbSelectionEdit, PROPOSAL_WORKFLOW_REPOSITORY, ProposalWorkflowRepository, Injectable (+2 more)

### Community 5 - "Logistics Availability"
Cohesion: 0.14
Nodes (16): allOptions(), { computeAvailability }, { db, nextId }, express, KIND_TO_PK, KIND_TO_TABLE, projectOption(), router (+8 more)

### Community 6 - "NPM Dependencies"
Cohesion: 0.04
Nodes (47): @angular/build, @angular/common, @angular/compiler, @angular/compiler-cli, @angular/core, @angular/forms, @angular/platform-browser, @angular/router (+39 more)

### Community 7 - "Workflow State Machine"
Cohesion: 0.15
Nodes (30): approveDepartmentTask(), approveFmbSelection(), assignStaffToTask(), authorizeDepartmentTask(), checkAllDepartmentTasksResolved(), checkFmbTaskResolved(), claimSharedFmbSelection(), createFmbSelection() (+22 more)

### Community 8 - "Explore Events Page"
Cohesion: 0.08
Nodes (4): ProposalEventSchedule, ExploreEventsComponent, Component, HostListener

### Community 9 - "Angular Build Config"
Cohesion: 0.05
Nodes (44): build, serve, test, builder, configurations, defaultConfiguration, options, packageManager (+36 more)

### Community 10 - "PublishedEventService"
Cohesion: 0.15
Nodes (7): EventRegistrationApi, RegisteredEventsResponse, EventRegistration, PendingEventRegistration, RegistrationResult, PublishedEventService, Injectable

### Community 11 - "auth.models.ts"
Cohesion: 0.16
Nodes (15): AuthNavigationItem, AuthNavigationSection, AuthNavNode, AuthUserRole, RoleNavigation, RoleNavigationEntry, UserAccountType, TestUserOptions (+7 more)

### Community 13 - "StaffTasksComponent"
Cohesion: 0.10
Nodes (12): StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus, ApiStaffTaskRepository, STAFF_TASK_REPOSITORY, Injectable (+4 more)

### Community 14 - "EventCalendarComponent"
Cohesion: 0.09
Nodes (3): EventCalendarComponent, Component, HostListener

### Community 15 - "db.js"
Cohesion: 0.09
Nodes (35): backfillResolveNavIcons(), backfillSplitSystemConfigNavPages(), counters, DATA_DIR, DB_FILE, { deriveUnitCode, deriveCafeteriaUnitCode, isCafeteriaUnitCode }, fs, nextId() (+27 more)

### Community 20 - "Roles Admin Page"
Cohesion: 0.08
Nodes (4): deriveRoleCode(), restoreLabelFor(), RolesComponent, Component

### Community 21 - "Admin Routes & Role Eligibility"
Cohesion: 0.09
Nodes (23): { db, nextId }, { deriveUnitCode, deriveRoleCode }, { eligibleRolesForUnit, eligibleRolesForUnits, flatRolesAvailable, isProtectedRole, isFlatRole, unitsForRole, HEAD_ROLE_CODES }, express, { isClubAdmin, presidentOfClubIds }, projectGrant(), projectNavPage(), projectRole() (+15 more)

### Community 22 - "event-proposal.ts"
Cohesion: 0.08
Nodes (18): allCommentEntries(), LogisticsAvailability, LogisticsCommittedWindow, LogisticsAvailabilityService, Injectable, option(), options(), ProposalReviewItem (+10 more)

### Community 24 - "Published Events Backend"
Cohesion: 0.12
Nodes (19): db, { db }, DEFAULT_PREFERENCES, express, { isPublishedEvent, projectPublishedEvent }, router, { db, nextId }, express (+11 more)

### Community 26 - "SharedLibraryComponent"
Cohesion: 0.15
Nodes (3): SharedLibraryComponent, Component, StepStatus

### Community 27 - "proposal-department-view.ts"
Cohesion: 0.10
Nodes (21): DEPARTMENT_LABELS, DepartmentConfirmation, DepartmentTaskStatus, isReviewerStage(), ProposalStage, ProposalWorkflowState, reviewerCommentEntry, ROLE_LABELS (+13 more)

### Community 28 - "auth.routes.js"
Cohesion: 0.15
Nodes (21): projectUser(), cafeteriaCodeFor(), { db, nextId }, express, { isClubAdmin, presidentOfClubIds }, { navTreeFor }, projectAuthUser(), { rolesFor, roleLabel, departmentFor } (+13 more)

### Community 29 - "proposal-projection.service.js"
Cohesion: 0.10
Nodes (25): { db }, express, { projectProposal }, router, workflow, canStillBeCancelled(), { db }, DB_STATUS_TO_PROPOSAL_STAGE (+17 more)

### Community 30 - "CafeteriaManageComponent"
Cohesion: 0.09
Nodes (3): CafeteriaManageComponent, restoreLabelFor(), Component

### Community 31 - "proposal-review.mock-data.ts"
Cohesion: 0.15
Nodes (17): AGENDA, coOwnersFor(), DISCUSSIONS, GUESTS, IMPORTANT_PEOPLE, organizersFor(), proposal(), proposalForTitle() (+9 more)

### Community 32 - "request-option.repository.ts"
Cohesion: 0.14
Nodes (11): mapRequestOptionResponse(), mapRequestOptionWrite(), RequestOptionDto, RequestOptionWriteDto, ArchivedRequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository (+3 more)

### Community 33 - "Internal Layout Shell"
Cohesion: 0.14
Nodes (3): InternalLayoutComponent, Component, HostListener

### Community 35 - "event-engagement.models.ts"
Cohesion: 0.17
Nodes (9): ExternalRegistrationService, GuestRegistrationFlowService, PendingChallenge, Injectable, ExternalRegistrationApi, ExternalUserRegistrationRequest, ExternalUserRegistrationResponse, VerifyExternalOtpRequest (+1 more)

### Community 36 - "ApiAdminDirectoryRepository"
Cohesion: 0.12
Nodes (5): AdminUnitRecord, AdminUserRecord, Archived, ApiAdminDirectoryRepository, Injectable

### Community 37 - "auth.test-fixtures.ts"
Cohesion: 0.16
Nodes (19): SEED_UNITS, SEED_USERS, TEST_CAFETERIA_MANAGER, TEST_CFO, TEST_EXTERNAL_USER, TEST_FMB_HEAD, TEST_HEAD_OF_SCHOOL, TEST_LOGISTICS_STAFF (+11 more)

### Community 38 - "page-visibility.ts"
Cohesion: 0.08
Nodes (36): AdminEntity, AdminTab, AssignmentRow, UserAssignmentGroup, CafeteriaManageTab, REQUEST_ACTION_LABELS, ROLE_OPTIONS, EMPTY_DRAFT (+28 more)

### Community 39 - "proposal-review.models.ts"
Cohesion: 0.12
Nodes (16): RegisteredEventEntry, SavedEventRecord, EVENT_FIELD_MAPPING, EventVisibility, PaymentStatus, PublishedEvent, RegistrationMode, RegistrationStatus (+8 more)

### Community 40 - "request-option-management.ts"
Cohesion: 0.13
Nodes (14): ViewMode, CAFETERIA_OPTION_KINDS, KIND_LABELS, ManagerField, restoreLabelFor(), ImageUploadFieldComponent, Component, ViewChild (+6 more)

### Community 41 - "How It Works Timeline"
Cohesion: 0.18
Nodes (8): HowItWorksComponent, ProcessPathMarker, ProcessPathPoint, ProcessPathPosition, ProcessStep, Component, HostListener, ViewChild

### Community 42 - "proposal-visibility.ts"
Cohesion: 0.18
Nodes (24): departmentFor(), hasRole(), isExternalUser(), isSystemAdmin(), requestKindsForManager(), departmentsForRole(), departmentAwaitingApplicant(), headOfSchoolUnitCode() (+16 more)

### Community 43 - "Department Review View"
Cohesion: 0.10
Nodes (3): FmbSelection, ProposalDepartmentViewComponent, Component

### Community 45 - "Event Image Upload"
Cohesion: 0.16
Nodes (11): ApiEventImageUploadService, EVENT_IMAGE_UPLOAD_API, EventImageUploadApi, EventImageUploadRequest, EventImageUploadResponse, MockEventImageUploadService, readAsDataUrl(), Injectable (+3 more)

### Community 46 - "EditableRow"
Cohesion: 0.15
Nodes (5): EditableRow, ProposalTableComponent, Component, RowCounterComponent, Component

### Community 47 - "StepIndicatorComponent"
Cohesion: 0.20
Nodes (3): StepIndicatorComponent, Component, WizardStep

### Community 48 - "RequestOption"
Cohesion: 0.29
Nodes (3): RequestOption, RequestOptionService, Injectable

### Community 49 - "AdminRoleRecord"
Cohesion: 0.15
Nodes (3): AdminRoleDraft, AdminRoleRecord, AssignmentDraftRow

### Community 50 - "ClubService"
Cohesion: 0.11
Nodes (10): ClubCategoryRecord, ClubDraft, ClubJoinRequestRecord, ClubJoinRequestStatus, ClubMemberRecord, ClubMyStatus, ClubRecord, ClubUserSummary (+2 more)

### Community 51 - "request-option.models.ts"
Cohesion: 0.27
Nodes (13): CampusTourStartOption, CampusTourTypeOption, DietaryInformationOption, FoodRequestOption, FundingMainOption, FundingSubOption, LogisticsRequestOption, MediaRequestOption (+5 more)

### Community 52 - "Landing Page Templates"
Cohesion: 0.23
Nodes (15): app-cta-link Component, app-event-card Component, app-event-details-modal Component, app-expandable-search Component, app-filter-button Component, app-site-footer Component, app-site-header Component, Campus Life Section Template (+7 more)

### Community 53 - "app.routes.ts"
Cohesion: 0.15
Nodes (14): dropdownSettingRoutes, placeholderPage(), authGuard(), defaultRoleRouteGuard(), externalUserGuard(), loginGuard(), publicLandingGuard(), roleGuard() (+6 more)

### Community 54 - "components/explore-events/explore-events.ts"
Cohesion: 0.06
Nodes (22): EventFavouriteService, Injectable, isEventVisibleTo(), InternalExploreEventsComponent, Component, AgendaDay, CalendarDay, CalendarEvent (+14 more)

### Community 56 - "Club Backend Routes"
Cohesion: 0.15
Nodes (14): clubCategoriesFor(), { db, nextId }, express, { isClubAdmin, presidentOfClubIds, isPresidentOf, isEligibleForClub }, projectCategory(), projectClub(), projectJoinRequest(), projectUserSummary() (+6 more)

### Community 57 - "Unit Role Migration Script"
Cohesion: 0.19
Nodes (14): DEFAULT_DB_PATH, departmentForUser(), deriveUnitCode(), ensureUnitUsersLink(), findOrCreateUnit(), FMB_UNIT_CODE, fs, MANAGER_STAFF_ROLES (+6 more)

### Community 58 - "role-access.ts"
Cohesion: 0.18
Nodes (13): hasAnyRole(), HEAD_ROLE_CODES, isClubPresident(), isHeadOfAnyUnit(), isSchoolStudentOrLecturer(), isStaffLike(), STAFF_LIKE_ROLE_CODES, unitCodesFor() (+5 more)

### Community 60 - "Schema Alignment Plan"
Cohesion: 0.05
Nodes (38): EMS Schema Alignment + Mock Backend Implementation Plan, Global Constraints, Phase 1: Source-of-Truth Corrections, Phase 2: Angular Frontend Refactor, Phase 2b: Extend Auth, Events, Saved Events, System Config, and Image Upload to REST, Phase 3: Express Mock Backend, Phase 4: Wire the Dev-Server Proxy and Verify End-to-End, Task 1.1: Correct `ems_database_schema.sql` — roles, F&B rename, water/campus-tour restructuring, new status columns (+30 more)

### Community 62 - "apiErrorMessage"
Cohesion: 0.13
Nodes (3): ProposalReviewerViewComponent, Component, apiErrorMessage()

### Community 63 - "SearchableDropdownComponent"
Cohesion: 0.18
Nodes (3): SearchableDropdownComponent, Component, HostListener

### Community 64 - "department-workflow.config.ts"
Cohesion: 0.17
Nodes (12): FLAT_DEPARTMENT_WORKFLOWS, isFlatRoleCode(), optionKindsForManager(), staffUnitCodeForManager(), UNIT_DEPARTMENT_WORKFLOWS, workflowForManager(), WorkflowIdentity, canManageRequestOptions() (+4 more)

### Community 65 - "cafeterias.routes.js"
Cohesion: 0.13
Nodes (13): CAFETERIA_ROLE_CODES, cafeteriaUnits(), createAssignment(), { db, nextId }, { deriveCafeteriaUnitCode, isCafeteriaUnitCode }, express, findExistingManager(), { rolesFor } (+5 more)

### Community 68 - "RBAC Seed Role Catalog"
Cohesion: 0.33
Nodes (6): RBAC Redesign: Users/Units/Roles/Page Visibility Design, isSchoolUnit(code) backend helper, One head per unit constraint, Protected vs custom role distinction, 9 seed role catalog (protected), School detection by substring match

### Community 69 - "Admin Modal Templates"
Cohesion: 0.22
Nodes (10): Club Category Manager Modal Template, app-delete-confirm-dialog Component, app-feedback-banner Component, app-form-field Component, app-form-modal Component, Hub Club Requests Template, Soft-Delete / Restore Pattern for Managed Options, Roles Page Template (+2 more)

### Community 70 - "user-access.service.js"
Cohesion: 0.16
Nodes (19): hasRole(), isHeadOfUnit(), approveReviewerStage(), authorizeAction(), cancellationDeadlineDays(), cancelProposal(), createDepartmentTasks(), earliestEventDate() (+11 more)

### Community 71 - "Backend Design Principles"
Cohesion: 0.29
Nodes (7): EMS Schema Alignment + Mock Backend Design, Backend owns the workflow (design principle), Campus Tour trimmed to Starting Point only, F&B role merge (FmbReviewer + FmbManager -> fmb), HOS/HOD self-review skip rule, Mineral Water merged into F&B task, F&B job merge into head-of-department

### Community 72 - "Workflow State Machine Notes"
Cohesion: 0.40
Nodes (5): Cafeteria Staff shared inbox mechanism, department_review parallel independent tasks, workflow.service.js (state machine implementation), Corrected Workflow State Machine (section 3), workflow.service.js hasRole update

### Community 73 - "auth.service.ts"
Cohesion: 0.18
Nodes (10): LoginResult, APPLICANT_USER, PROPOSAL_REVIEW_RECORDS, CATALOG_SEED, activatedRouteStub(), configureWithRoute(), isoDate(), MOCK_EVENT_FIXTURES (+2 more)

### Community 74 - "happening-soon.ts"
Cohesion: 0.13
Nodes (14): CampusLifeComponent, CampusLifePillar, Component, EventCard, EventDate, ExpandingCard, QueueDirection, TransitionPhase (+6 more)

### Community 79 - "FormModalComponent"
Cohesion: 0.14
Nodes (8): COMMON_END, PageMode, ROLE_PRESENTATION, RolePresentation, FormModalComponent, Component, HostListener, InternalTableColumn

### Community 80 - "RBAC Table Design"
Cohesion: 0.25
Nodes (8): Page Visibility / Nav Builder, nav_page_roles table, nav_page table, role table, unit table, user_unit_roles table, users table (identity fields only), page-visibility.html (Pages/Permissions/Deleted admin UI)

### Community 81 - "Staff Task Backend Routes"
Cohesion: 0.23
Nodes (8): { db }, departmentTaskDetails(), express, mapTaskStatus(), projectDepartmentTask(), projectDepartmentTasks(), router, workflow

### Community 83 - "admin-directory.models.ts"
Cohesion: 0.24
Nodes (7): AdminDirectoryRepository, AdminNavPageDraft, AdminNavPageGrant, AdminNavPageGrantDraft, AdminUnitDraft, AdminUserDraft, ADMIN_DIRECTORY_REPOSITORY

### Community 85 - "saveDb"
Cohesion: 0.18
Nodes (12): app, cors, express, { saveDb }, backfillRemoveAssignmentsNavPage(), backfillWaterNormalRequirement(), saveDb(), app (+4 more)

### Community 86 - "Payment Proof Upload"
Cohesion: 0.27
Nodes (8): ApiPaymentProofUploadService, MockPaymentProofUploadService, PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi, PaymentProofUploadRequest, PaymentProofUploadResponse, readAsDataUrl(), Injectable

### Community 89 - "RBAC Design Notes"
Cohesion: 0.20
Nodes (10): nav-tree.service.js, role-eligibility.service.js, role-navigation.ts navTreeFor replacement, user-access.service.js, app.html (root shell template), app-ai-assistant component usage, app-toast-host component usage, internal-layout.html (app shell with sidebar/nav) (+2 more)

### Community 90 - "Unit Role Migration Notes"
Cohesion: 0.29
Nodes (8): Fully data-driven RBAC rationale, Unit + Level RBAC Migration Prompt, applicant role deletion rationale, generic staff role deletion rationale, migrate-unit-level-roles.js migration script, users.role generic level marker compatibility field, School unit-kind warning note, Unit + Level identity model

### Community 93 - "Data Page Templates"
Cohesion: 0.29
Nodes (8): app-internal-data-page Component, app-internal-page-state Component, app-internal-data-table Component, Hub Proposals Template, Hub Requests Template, Records Hub Tabs Template, Records Hub Conditional Tab Visibility (tasks/requests/club-requests), Staff Tasks Page Template

### Community 94 - "Workspace Templates"
Cohesion: 0.29
Nodes (8): app-internal-table-workspace Component, app-internal-pagination Component, app-step-indicator Component, app-user-avatar Component, Profile Page Template, Shared Component Library Live Showcase Pattern, Shared Library Catalog Page Template, Content-Projection Slot Composition Pattern (workspaceHeader/Controls/Table/Mobile)

### Community 95 - "Proposal Review Templates"
Cohesion: 0.22
Nodes (10): app-loading-state Component, app-proposal-department-view Component, app-proposal-reviewer-view Component, Proposal Reviewer Workflow Actions (Approve/Resubmit/Reject/Cancel), app-proposal-field Component, app-proposal-kpi-bar Component, app-proposal-section Component, app-proposal-table Component (+2 more)

### Community 97 - "Table Workspace & Pagination"
Cohesion: 0.25
Nodes (3): InternalPaginationComponent, InternalTableWorkspaceComponent, Component

### Community 98 - "Department Option Kinds"
Cohesion: 0.22
Nodes (3): FlatDepartmentWorkflowConfig, UnitDepartmentWorkflowConfig, RequestOptionKind

### Community 104 - "Proposal Form Template"
Cohesion: 0.40
Nodes (5): event-proposal.html (6-step proposal form), Logistics quantity availability indicator, Required for Event requirements checklist (step 3), Live Review Summary / proposal preview, app-step-indicator component usage

### Community 105 - "Config Routes"
Cohesion: 0.29
Nodes (7): CONFIG_FIELDS, configRow(), { db }, express, projectConfig(), router, workflow

### Community 106 - "Header & View Templates"
Cohesion: 0.33
Nodes (6): app-cta-link (header usage), Site Header Template, Calendar Month/Week/Agenda View Modes, Explore Events Public/Internal Variant Pattern, My Events publicLayout Toggle, External User Restricted Navigation

### Community 107 - "Proposal Content Persistence"
Cohesion: 0.36
Nodes (11): applicantResubmit(), applyRequestScalarFields(), assertProposalOwner(), buildRequestChildRows(), clearRequestChildRows(), createProposal(), deleteDraft(), maxEventCategories() (+3 more)

### Community 111 - "Express Backend Design"
Cohesion: 0.40
Nodes (5): server/app.js (Express app), server/db.js (aggregated seed db), In-memory only, no artificial latency, server/index.js (http server bootstrap), Node/Express Mock Backend Server

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
Nodes (3): FypUi README, Angular CLI, Vitest test runner

### Community 123 - "Soft Delete Registry"
Cohesion: 0.26
Nodes (13): init(), registerAll(), archivedList(), checkDependencies(), findRow(), mountRoutes(), previewDeletion(), purge() (+5 more)

### Community 125 - "Login Page Template"
Cohesion: 0.67
Nodes (3): login.html (Login page template), Development demo users picker, app-guest-registration-modal component usage

### Community 146 - "event-catalog.routes.js"
Cohesion: 0.15
Nodes (13): backfillEventCatalog(), backfillMissingCatalogDefaults(), seedCafeteriaDomain(), { db, nextId }, { deriveUnitCode }, express, makeCatalog(), router (+5 more)

### Community 149 - "FormFieldComponent"
Cohesion: 0.13
Nodes (7): REJECTION_COMMENT_MIN_LENGTH, FormFieldComponent, Component, LoadingStateComponent, Component, ProposalCommentDialogComponent, Component

### Community 154 - "Admin Page Design Notes"
Cohesion: 0.33
Nodes (6): Soft-delete with 7-day auto-purge, Unit Code auto-derived read-only field, admin-directory.html (Users/Units admin page), app-delete-confirm-dialog usage, Deleted tab (archived users/units), derivedUnitCode() read-only unit code field

### Community 155 - "Workflow E2E Test"
Cohesion: 0.67
Nodes (5): call(), check(), futureDate(), main(), proposalPayload()

### Community 156 - "Option Management Templates"
Cohesion: 0.33
Nodes (6): app-image-upload-field Component, app-option-card-grid Component, app-option-item-details-modal Component, app-searchable-dropdown Component, app-status-toggle Component, Request Option Management Template

### Community 158 - "Profile & Avatar"
Cohesion: 0.40
Nodes (4): ProfileComponent, Component, Component, UserAvatarComponent

### Community 160 - "AuthService"
Cohesion: 0.19
Nodes (8): AuthUser, DemoAuthUser, AuthService, PersistedSession, Injectable, loginViaMock(), DEMO_GROUP_ORDER, DemoUserGroup

### Community 169 - "HeroComponent"
Cohesion: 0.24
Nodes (4): HeroComponent, MockIntersectionObserver, Component, ViewChild

### Community 170 - "CafeteriaStaffRequest"
Cohesion: 0.22
Nodes (6): CafeteriaStaffRequest, CafeteriaStaffRequestAction, CafeteriaStaffRequestDraft, CafeteriaStaffRequestStatus, CafeteriaStaffRequestService, Injectable

### Community 171 - "CafeteriaService"
Cohesion: 0.28
Nodes (3): Cafeteria, CafeteriaService, Injectable

### Community 172 - "event-catalog.service.ts"
Cohesion: 0.21
Nodes (8): ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogResource, EventCategoryService, EventFormatService, Injectable, FormatsTabComponent, Component

### Community 173 - "SavedEventsService"
Cohesion: 0.17
Nodes (6): NotificationPreference, SavedEventMutationResponse, SavedEventsApi, SavedEventsResponse, SavedEventsService, Injectable

### Community 174 - "request-option.service.spec.ts"
Cohesion: 0.15
Nodes (11): flattenRoutes(), roleCanAccess(), avManager, cafeteriaManagerUser, cfoUser, DROPDOWN_PAGES_BY_UNIT, fmbManager, logisticsManager (+3 more)

### Community 176 - "system-config.service.ts"
Cohesion: 0.31
Nodes (5): SystemConfig, SystemConfigDraft, DEFAULT_CONFIG, SystemConfigService, Injectable

### Community 179 - "cafeteria.service.ts"
Cohesion: 0.43
Nodes (4): AssignableCafeteriaUser, CafeteriaAssignmentDraft, CafeteriaDraft, CafeteriaStaffRoleCode

### Community 182 - "uploads.routes.js"
Cohesion: 0.50
Nodes (3): express, { nextId }, router

## Ambiguous Edges - Review These
- `Fully data-driven RBAC rationale` → `Unit + Level identity model`  [AMBIGUOUS]
  docs/system-logic/rbac-unit-level-migration-prompt.md · relation: conceptually_related_to
- `app-internal-table-workspace Component` → `Shared Library Catalog Page Template`  [AMBIGUOUS]
  src/app/features/shared-library/shared-library.html · relation: references

## Knowledge Gaps
- **427 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+422 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **69 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Fully data-driven RBAC rationale` and `Unit + Level identity model`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `app-internal-table-workspace Component` and `Shared Library Catalog Page Template`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `EventProposalComponent` connect `EventProposalComponent` to `.navigateToTableError`, `.logisticsExceedsRemaining`, `Proposal Step Navigation`, `page-visibility.ts`, `auth.service.ts`, `EditableRow`, `EditableTableColumn`, `event-proposal.ts`, `Proposal Submit Actions`, `.row`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `ProposalReviewRecord` connect `ProposalReviewRecord` to `shared-library.ts`, `auth.test-fixtures.ts`, `proposal-review.models.ts`, `proposal-visibility.ts`, `Event Image Upload`, `EditableRow`, `event-proposal.ts`, `proposal-department-view.ts`, `RecordsPageComponent`, `proposal-review.mock-data.ts`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `AuthService` connect `AuthService` to `shared-library.ts`, `auth.models.ts`, `FormFieldComponent`, `event-proposal.ts`, `proposal-department-view.ts`, `Profile & Avatar`, `event-engagement.models.ts`, `auth.test-fixtures.ts`, `page-visibility.ts`, `proposal-review.models.ts`, `request-option-management.ts`, `proposal-visibility.ts`, `request-option.service.spec.ts`, `app.routes.ts`, `components/explore-events/explore-events.ts`, `logout.ts`, `role-access.ts`, `auth.service.ts`, `happening-soon.ts`, `FormModalComponent`, `admin-directory.models.ts`, `Payment Proof Upload`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App Shell & AI Assistant` be split into smaller, more focused modules?**
  _Cohesion score 0.05030181086519115 - nodes in this community are weakly interconnected._