# Graph Report - fyp-ui  (2026-08-14)

## Corpus Check
- Large corpus: 273 files · ~502,474 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 2388 nodes · 4934 edges · 146 communities (96 shown, 50 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 142 edges (avg confidence: 0.63)
- Token cost: 0 input · 368,105 output

## Community Hubs (Navigation)
- Angular App Shell & Routing
- Landing Page Components
- Records Hub View Modes & Buckets
- Proposal Review Repository
- Event Proposal Form Logic
- Express App Bootstrap
- Angular Framework Dependencies
- Workflow Service Role Checks
- Internal Explore Events
- Angular CLI Build Config
- Event Registration API Models
- Auth Navigation Models
- Request Option Management Component
- Staff Task Assignment
- Event Calendar Component
- In-Memory DB Core (db.js)
- Admin Directory Component
- Happening Soon Component
- Page Visibility Component
- System Config Component
- Roles Admin Component
- Admin Routes (nav pages)
- Logistics Availability Service
- Request Field Helpers
- Cafeteria & Engagement Routes
- Admin Directory Service (API)
- Profile & Shared Library Pages
- Proposal Status/Stage Models
- Auth Routes & Club Access Helpers
- Proposal Workflow Routes
- Club Models
- Proposal Review Mock Data
- Request Option Mapper
- Internal Layout Component
- Club Management Component
- External/Guest Registration Service
- Admin Directory Models
- Auth Service (session)
- App Routes & Placeholder Pages
- Mock Demo Users
- Cafeteria Models & Service
- How It Works Component
- Proposal Visibility & Role Helpers
- Proposal Department View Component
- Event Favourite Service
- Event Image Upload Service
- Logistics Table Row Helpers
- Step Indicator Component
- Request Option Service
- Admin Role Directory API
- Club Service (API)
- Request Option Models (dropdown kinds)
- Shared UI Component Library
- Auth Route Guards
- Expandable Search Component
- Guest Registration Modal
- Clubs Routes (backend)
- Unit-Level RBAC Migration Script
- Role Access Helpers
- Club Join Request Flow
- Page Visibility Draft & Icon Upload
- Records Page Component
- Proposal Reviewer View Component
- Searchable Dropdown Component
- Department Workflow Config
- Event Calendar Models
- Club Category Manager Component
- F&B Role Merge RBAC Rationale
- Club/Modal Shared UI Components
- Form Field Component
- EMS Schema Alignment Design Doc
- Approval Workflow State Machine
- Club Category Records API
- Saved Events & Notifications
- Login Component
- Club Discover Component
- Hub Proposals Component
- Event Details Modal
- Form Modal Component
- Nav/Page Visibility DB Tables
- Staff Tasks Routes (backend)
- Admin Nav Page Models
- Admin Unit Models
- Admin Deletion Checks
- System Config Models & Service
- Payment Proof Upload Service
- Nav Tree & Role Eligibility Services
- Unit+Level RBAC Migration Rationale
- Cafeteria Menu Viewer Component
- Club Pending Component
- Records Hub Templates
- Internal Table Workspace UI
- Proposal Reviewer UI Components
- Event Proposal Table Row Editing
- Internal Pagination & Table Workspace
- Request Option Kind Config
- My Events Tab Component
- EMS Database Schema (51 tables)
- Nav Page Grant Type Helpers
- Club My Component
- 6-Step Proposal Form Concept
- Config Routes (backend)
- Explore/My Events Public Variant Pattern
- Nav Page Grant Models
- Club Page Templates
- Proposal Table Column Config
- Proposal Review Page Component
- Mock Backend Server Overview
- APU Logo Variants (globe + wordmark)
- APU Logo Text Variants (legacy/current)
- Proposal Reviewer & System Config Policies
- Role Label Derivation Across Layers
- Logistics Option Picker Helpers
- Social Icons (Facebook/Instagram/LinkedIn)
- Social Icons (TikTok/X/YouTube)
- Project Tooling (README/CLI/Vitest)
- Admin Deletion Registry
- Nav Entry Type & Page Draft
- Login Page Template & Demo Picker
- App Bootstrap (index.html/app-root)
- AuthUser Roles Redesign Note
- Event Photos (Campus After Dark/Esports)
- Event Photos (Startup Pitch/Tech Expo)
- QS Ranking Badges
- Hero Video Start Image (legacy/current)
- Explore Events Internal Wrapper
- Page Code Derivation Helpers
- Icon File Upload Helpers
- Career Connect Fair Event Photo
- Community Green Day Event Photo
- Cultural Night Event Photo
- Wellness Run Event Photo
- Life at Work Award Badge
- Premier Digital Tech Award Badge
- TalentBank Employability Badge
- AI Assistant Chat Widget
- Option Picker Grid Component
- Site Footer Template

## God Nodes (most connected - your core abstractions)
1. `EventProposalComponent` - 129 edges
2. `PageVisibilityComponent` - 66 edges
3. `ProposalReviewRecord` - 62 edges
4. `RequestOptionManagementComponent` - 47 edges
5. `AuthService` - 45 edges
6. `ApiAdminDirectoryRepository` - 44 edges
7. `ExploreEventsComponent` - 44 edges
8. `AdminDirectoryService` - 43 edges
9. `EventCalendarComponent` - 38 edges
10. `HappeningSoonComponent` - 36 edges

## Surprising Connections (you probably didn't know these)
- `APU Logo Text with Globe Icon (legacy/old version)` --semantically_similar_to--> `AI-Generated APU Logo Text with Globe Icon (ChatGPT image asset)`  [INFERRED] [semantically similar]
  public/assets/media/old/apu-logo-text-old.png → src/assit/ChatGPT Image Jul 31, 2026, 07_20_29 PM.png
- `APU Logo Text with Globe Icon (legacy/old version)` --semantically_similar_to--> `APU Logo with Globe Icon (JPEG asset copy)`  [INFERRED] [semantically similar]
  public/assets/media/old/apu-logo-text-old.png → src/assit/logo.jpg
- `6-step applicant proposal form` --conceptually_related_to--> `event-proposal.html (6-step proposal form)`  [INFERRED]
  docs/system-logic/system.md → src/app/features/internal/pages/event-proposal/event-proposal.html
- `app-delete-confirm-dialog usage` --conceptually_related_to--> `Soft-delete with 7-day auto-purge`  [INFERRED]
  src/app/features/internal/pages/admin-directory/admin-directory.html → docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-design.md
- `page-visibility.html (Pages/Permissions/Deleted admin UI)` --conceptually_related_to--> `Page Visibility / Nav Builder`  [INFERRED]
  src/app/features/internal/pages/page-visibility/page-visibility.html → docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **F&B role identity unification across three design iterations** — docs_superpowers_specs_2026_08_10_ems_schema_alignment_and_mock_backend_design_fmb_role_merge, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_fmb_job_merge_rationale, docs_system_logic_rbac_unit_level_migration_prompt_unit_level_model [INFERRED 0.85]
- **RBAC core data model (users, units, roles, assignments)** — docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_users_table, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_unit_table, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_role_table, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_user_unit_roles_table [EXTRACTED 1.00]
- **Sequential single-actor review stages (HOS/HOD, F&B, CFO)** — docs_superpowers_specs_2026_08_10_ems_schema_alignment_and_mock_backend_design_hoshod_self_review_skip, docs_superpowers_specs_2026_08_10_ems_schema_alignment_and_mock_backend_design_workflow_state_machine, docs_system_logic_system_approval_workflow [INFERRED 0.85]
- **Records Hub Tab Pages Sharing app-internal-data-page Shell** — src_app_features_internal_pages_records_hub_hub_proposals_hub_proposals_html, src_app_features_internal_pages_records_hub_hub_requests_hub_requests_html, src_app_features_internal_pages_records_hub_hub_club_requests_hub_club_requests_html, shared_components_internal_data_page_internal_data_page_html, src_app_features_internal_pages_records_hub_records_hub_html [INFERRED 0.85]
- **Landing Page Section Composition** — src_app_features_landing_landing_page_html, src_app_features_landing_components_hero_hero_html, src_app_features_landing_components_campus_life_campus_life_html, src_app_features_landing_components_happening_soon_happening_soon_html, src_app_features_landing_components_explore_events_explore_events_html, src_app_features_landing_components_event_calendar_event_calendar_html [EXTRACTED 1.00]
- **Soft-Delete-With-Restore UI Pattern Across Admin Management Pages** — src_app_features_internal_pages_request_option_management_request_option_management_softdelete_concept, src_app_shared_components_club_category_manager_club_category_manager_soft_delete_concept, src_app_features_internal_pages_request_option_management_request_option_management_html, shared_components_club_category_manager_club_category_manager_html, src_app_features_internal_pages_roles_roles_html [INFERRED 0.80]
- **Campus Event Photo Gallery (explore-events cards)** — public_assets_events_campus_after_dark, public_assets_events_career_connect_fair, public_assets_events_community_green_day, public_assets_events_cultural_night, public_assets_events_esports_showdown, public_assets_events_startup_pitch_night, public_assets_events_tech_expo, public_assets_events_wellness_run [INFERRED 0.85]
- **University Recognition/Award Badges (footer)** — public_assets_media_footer_award_life_at_work, public_assets_media_footer_award_premier_digital_tech, public_assets_media_footer_award_qs_five_stars, public_assets_media_footer_award_qs_world_ranking, public_assets_media_footer_award_talentbank_employability [INFERRED 0.85]
- **Social Media Links (footer)** — public_assets_media_footer_social_facebook, public_assets_media_footer_social_instagram, public_assets_media_footer_social_linkedin [INFERRED 0.85]
- **Footer Social Media Icon Set** — public_assets_media_footer_social_tiktok, public_assets_media_footer_social_x, public_assets_media_footer_social_youtube [INFERRED 0.85]
- **APU Logo-with-Globe-Icon Asset Variants** — public_assets_media_old_apu_logo_text_old, src_assit_logo, src_assit_chatgpt_image_jul_31_2026_07_20_29_pm [INFERRED 0.80]

## Communities (146 total, 50 thin omitted)

### Community 0 - "Angular App Shell & Routing"
Cohesion: 0.05
Nodes (28): App, appConfig, routes, Component, AiAssistantComponent, ChatMessage, createGreeting(), IdleGesture (+20 more)

### Community 1 - "Landing Page Components"
Cohesion: 0.06
Nodes (24): CampusLifeComponent, CampusLifePillar, Component, HeroComponent, MockIntersectionObserver, Component, ViewChild, LandingPageComponent (+16 more)

### Community 2 - "Records Hub View Modes & Buckets"
Cohesion: 0.09
Nodes (44): ViewMode, ViewMode, BUCKET_COPY, ALL_REQUESTS, BUCKET_COPY, HubRequestsComponent, ONGOING_STATUSES, Component (+36 more)

### Community 3 - "Proposal Review Repository"
Cohesion: 0.07
Nodes (10): DepartmentRequestKind, ProposalReviewRecord, ApiProposalWorkflowRepository, PROPOSAL_WORKFLOW_REPOSITORY, ProposalWorkflowRepository, Injectable, ProposalWorkflowService, Injectable (+2 more)

### Community 5 - "Express App Bootstrap"
Cohesion: 0.07
Nodes (38): app, cors, express, { saveDb }, saveDb(), app, { runRetentionSweep }, { saveDb } (+30 more)

### Community 6 - "Angular Framework Dependencies"
Cohesion: 0.04
Nodes (46): @angular/build, @angular/common, @angular/compiler, @angular/compiler-cli, @angular/core, @angular/forms, @angular/platform-browser, @angular/router (+38 more)

### Community 7 - "Workflow Service Role Checks"
Cohesion: 0.12
Nodes (43): hasRole(), isHeadOfUnit(), APPLICANT_RESUBMIT_ALLOWED_FIELDS, applicantResubmit(), applyRequestScalarFields(), approveDepartmentTask(), approveFmbSelection(), approveReviewerStage() (+35 more)

### Community 8 - "Internal Explore Events"
Cohesion: 0.07
Nodes (7): ProposalEventSchedule, InternalExploreEventsComponent, Component, ExploreEventsComponent, Component, HostListener, ViewChild

### Community 9 - "Angular CLI Build Config"
Cohesion: 0.05
Nodes (44): build, serve, test, builder, configurations, defaultConfiguration, options, packageManager (+36 more)

### Community 10 - "Event Registration API Models"
Cohesion: 0.10
Nodes (23): EventRegistrationApi, RegisteredEventEntry, RegisteredEventsResponse, SavedEventRecord, SavedEventsApi, SavedEventsResponse, EVENT_FIELD_MAPPING, EventRegistration (+15 more)

### Community 11 - "Auth Navigation Models"
Cohesion: 0.08
Nodes (33): AuthNavigationItem, AuthNavigationSection, AuthNavNode, RoleNavigation, UserAccountType, LoginResult, isSchoolStudentOrLecturer(), clubCanAccess() (+25 more)

### Community 13 - "Staff Task Assignment"
Cohesion: 0.10
Nodes (12): StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus, ApiStaffTaskRepository, STAFF_TASK_REPOSITORY, Injectable (+4 more)

### Community 14 - "Event Calendar Component"
Cohesion: 0.08
Nodes (4): EventCalendarComponent, Component, HostListener, ViewChild

### Community 15 - "In-Memory DB Core (db.js)"
Cohesion: 0.09
Nodes (31): counters, DATA_DIR, DB_FILE, { deriveUnitCode }, fs, nextId(), path, { PROTECTED_ROLES } (+23 more)

### Community 20 - "Roles Admin Component"
Cohesion: 0.10
Nodes (3): deriveRoleCode(), RolesComponent, Component

### Community 21 - "Admin Routes (nav pages)"
Cohesion: 0.09
Nodes (22): { db, nextId }, { deriveUnitCode }, { eligibleRolesForUnit, eligibleRolesForUnits, flatRolesAvailable, isProtectedRole, HEAD_ROLE_CODES }, express, { isClubAdmin, presidentOfClubIds }, projectGrant(), projectNavPage(), { rolesFor, roleLabel, departmentFor, primaryRoleLabelFor } (+14 more)

### Community 22 - "Logistics Availability Service"
Cohesion: 0.14
Nodes (18): LogisticsAvailability, LogisticsCommittedWindow, LogisticsAvailabilityService, Injectable, option(), options(), ProposalReviewItem, ProposalReviewSection (+10 more)

### Community 23 - "Request Field Helpers"
Cohesion: 0.09
Nodes (5): RequestDefinition, DataTableComponent, Component, EditableTableColumn, FormControlType

### Community 24 - "Cafeteria & Engagement Routes"
Cohesion: 0.11
Nodes (22): db, { db }, express, router, { db }, DEFAULT_PREFERENCES, express, { isPublishedEvent, projectPublishedEvent } (+14 more)

### Community 26 - "Profile & Shared Library Pages"
Cohesion: 0.09
Nodes (12): ProfileComponent, Component, LibraryCategory, LibraryEntry, SharedLibraryComponent, Component, CharacterCounterComponent, Component (+4 more)

### Community 27 - "Proposal Status/Stage Models"
Cohesion: 0.12
Nodes (17): DepartmentConfirmation, isReviewerStage(), ProposalStage, stageLabel(), ReviewerComment, ProposalFieldComponent, Component, ProposalKpiBarComponent (+9 more)

### Community 28 - "Auth Routes & Club Access Helpers"
Cohesion: 0.16
Nodes (19): projectUser(), cafeteriaIdFor(), { db, nextId }, express, { isClubAdmin, presidentOfClubIds }, { navTreeFor }, projectAuthUser(), { rolesFor, hasRole, roleLabel, departmentFor } (+11 more)

### Community 29 - "Proposal Workflow Routes"
Cohesion: 0.12
Nodes (21): { db }, express, { projectProposal }, NOTE: this endpoint's Angular caller (proposal-department-view.ts's resubmit())…, router, workflow, { db }, DB_STATUS_TO_PROPOSAL_STAGE (+13 more)

### Community 30 - "Club Models"
Cohesion: 0.17
Nodes (14): ClubDraft, ClubJoinRequestStatus, ClubMemberRecord, ClubMyStatus, ClubUserSummary, AdminEntity, AdminTab, ViewMode (+6 more)

### Community 31 - "Proposal Review Mock Data"
Cohesion: 0.11
Nodes (20): EventVisibility, RegistrationMode, AGENDA, coOwnersFor(), DISCUSSIONS, GUESTS, IMPORTANT_PEOPLE, organizersFor() (+12 more)

### Community 32 - "Request Option Mapper"
Cohesion: 0.14
Nodes (11): mapRequestOptionResponse(), mapRequestOptionWrite(), RequestOptionDto, RequestOptionWriteDto, ArchivedRequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository (+3 more)

### Community 33 - "Internal Layout Component"
Cohesion: 0.14
Nodes (3): InternalLayoutComponent, Component, HostListener

### Community 35 - "External/Guest Registration Service"
Cohesion: 0.14
Nodes (11): ExternalRegistrationService, GuestRegistrationFlowService, PendingChallenge, Injectable, ExternalRegistrationApi, ExternalUserRegistrationRequest, ExternalUserRegistrationResponse, VerifyExternalOtpRequest (+3 more)

### Community 36 - "Admin Directory Models"
Cohesion: 0.15
Nodes (7): AdminDirectoryRepository, AdminUserDraft, AdminUserRecord, ADMIN_DIRECTORY_REPOSITORY, SEED_UNITS, SEED_USERS, AuthUserRole

### Community 37 - "Auth Service (session)"
Cohesion: 0.13
Nodes (11): AuthUser, AuthService, PersistedSession, Injectable, loginViaMock(), PROPOSAL_REVIEW_RECORDS, LogoutComponent, Component (+3 more)

### Community 38 - "App Routes & Placeholder Pages"
Cohesion: 0.16
Nodes (11): dropdownSettingRoutes, placeholderPage(), InternalPlaceholderComponent, Component, ConfirmDialogComponent, Component, FeedbackBannerComponent, Component (+3 more)

### Community 39 - "Mock Demo Users"
Cohesion: 0.14
Nodes (15): account(), AssignmentSpec, buildRoles(), labelFor(), MOCK_AUTH_USERS, MockAuthRecord, primaryLabelAndDept(), ROLE_NAMES (+7 more)

### Community 40 - "Cafeteria Models & Service"
Cohesion: 0.18
Nodes (11): Cafeteria, CafeteriaService, Injectable, CAFETERIA_OPTION_KINDS, KIND_LABELS, OptionCardMetaField, OptionCardViewModel, OptionCardGridComponent (+3 more)

### Community 41 - "How It Works Component"
Cohesion: 0.18
Nodes (8): HowItWorksComponent, ProcessPathMarker, ProcessPathPoint, ProcessPathPosition, ProcessStep, Component, HostListener, ViewChild

### Community 42 - "Proposal Visibility & Role Helpers"
Cohesion: 0.24
Nodes (18): departmentFor(), hasRole(), isExternalUser(), requestKindsForRole(), departmentsForRole(), headOfSchoolUnitCode(), isApplicantLike(), proposalSectionForUser() (+10 more)

### Community 43 - "Proposal Department View Component"
Cohesion: 0.14
Nodes (3): FmbSelection, ProposalDepartmentViewComponent, Component

### Community 44 - "Event Favourite Service"
Cohesion: 0.11
Nodes (13): EventFavouriteService, Injectable, AppliedFilterChip, ExploreEvent, ExploreEventDate, FilterGroup, FilterKey, FilterSelection (+5 more)

### Community 45 - "Event Image Upload Service"
Cohesion: 0.16
Nodes (11): ApiEventImageUploadService, EVENT_IMAGE_UPLOAD_API, EventImageUploadApi, EventImageUploadRequest, EventImageUploadResponse, MockEventImageUploadService, readAsDataUrl(), Injectable (+3 more)

### Community 46 - "Logistics Table Row Helpers"
Cohesion: 0.17
Nodes (3): EditableRow, ProposalTableComponent, Component

### Community 47 - "Step Indicator Component"
Cohesion: 0.20
Nodes (3): StepIndicatorComponent, Component, WizardStep

### Community 48 - "Request Option Service"
Cohesion: 0.24
Nodes (3): RequestOption, RequestOptionService, Injectable

### Community 49 - "Admin Role Directory API"
Cohesion: 0.17
Nodes (4): AdminRoleDraft, AdminRoleRecord, ApiAdminDirectoryRepository, Injectable

### Community 50 - "Club Service (API)"
Cohesion: 0.16
Nodes (4): ClubAdminRecord, ClubRecord, ClubService, Injectable

### Community 51 - "Request Option Models (dropdown kinds)"
Cohesion: 0.21
Nodes (14): CampusTourStartOption, CampusTourTypeOption, DietaryInformationOption, FoodRequestOption, FundingMainOption, FundingSubOption, LogisticsRequestOption, MediaRequestOption (+6 more)

### Community 52 - "Shared UI Component Library"
Cohesion: 0.21
Nodes (16): app-cta-link Component, app-event-card Component, app-event-details-modal Component, app-expandable-search Component, app-filter-button Component, app-internal-page-state Component, app-site-footer Component, app-site-header Component (+8 more)

### Community 53 - "Auth Route Guards"
Cohesion: 0.18
Nodes (14): authGuard(), cafeteriaMenuViewerGuard(), defaultRoleRouteGuard(), externalUserGuard(), loginGuard(), publicLandingGuard(), requestOptionManagerGuard(), roleGuard() (+6 more)

### Community 54 - "Expandable Search Component"
Cohesion: 0.13
Nodes (6): ExpandableSearchComponent, Component, HostListener, ViewChild, OptionPickerGridComponent, Component

### Community 56 - "Clubs Routes (backend)"
Cohesion: 0.18
Nodes (13): { db, nextId }, express, { isClubAdmin, presidentOfClubIds, isPresidentOf, isEligibleForClub }, projectCategory(), projectClub(), projectJoinRequest(), projectUserSummary(), router (+5 more)

### Community 57 - "Unit-Level RBAC Migration Script"
Cohesion: 0.19
Nodes (14): DEFAULT_DB_PATH, departmentForUser(), deriveUnitCode(), ensureUnitUsersLink(), findOrCreateUnit(), FMB_UNIT_CODE, fs, MANAGER_STAFF_ROLES (+6 more)

### Community 58 - "Role Access Helpers"
Cohesion: 0.20
Nodes (12): hasAnyRole(), HEAD_ROLE_CODES, isClubPresident(), isHeadOfAnyUnit(), isStaffLike(), roleCanUseSavedEvents(), STAFF_LIKE_ROLE_CODES, unitCodesFor() (+4 more)

### Community 59 - "Club Join Request Flow"
Cohesion: 0.15
Nodes (3): ClubJoinRequestRecord, HubClubRequestsComponent, Component

### Community 60 - "Page Visibility Draft & Icon Upload"
Cohesion: 0.15
Nodes (9): EMPTY_DRAFT, GRANT_TYPE_OPTIONS, PageVisibilityTab, ImageUploadFieldComponent, Component, ViewChild, PopoverComponent, Component (+1 more)

### Community 63 - "Searchable Dropdown Component"
Cohesion: 0.20
Nodes (3): SearchableDropdownComponent, Component, HostListener

### Community 64 - "Department Workflow Config"
Cohesion: 0.20
Nodes (9): FLAT_DEPARTMENT_WORKFLOWS, isFlatRoleCode(), requestKindsForManager(), staffUnitCodeForManager(), UNIT_DEPARTMENT_WORKFLOWS, workflowForManager(), RoutingMatrixComponent, RoutingMatrixRow (+1 more)

### Community 65 - "Event Calendar Models"
Cohesion: 0.16
Nodes (11): EventCategory, AgendaDay, CalendarDay, CalendarEvent, CalendarView, CATEGORY_CLASS_BY_NAME, isoDate(), MOCK_EVENT_FIXTURES (+3 more)

### Community 68 - "F&B Role Merge RBAC Rationale"
Cohesion: 0.15
Nodes (13): F&B role merge (FmbReviewer + FmbManager -> fmb), RBAC Redesign: Users/Units/Roles/Page Visibility Design, Fully data-driven RBAC rationale, F&B job merge into head-of-department, isSchoolUnit(code) backend helper, One head per unit constraint, Protected vs custom role distinction, 9 seed role catalog (protected) (+5 more)

### Community 69 - "Club/Modal Shared UI Components"
Cohesion: 0.18
Nodes (13): Club Category Manager Modal Template, app-delete-confirm-dialog Component, app-form-modal Component, app-image-upload-field Component, app-option-card-grid Component, app-option-item-details-modal Component, app-searchable-dropdown Component, app-status-toggle Component (+5 more)

### Community 70 - "Form Field Component"
Cohesion: 0.18
Nodes (4): FormFieldComponent, Component, ProposalCommentDialogComponent, Component

### Community 71 - "EMS Schema Alignment Design Doc"
Cohesion: 0.20
Nodes (12): EMS Schema Alignment + Mock Backend Design, Backend owns the workflow (design principle), Campus Tour trimmed to Starting Point only, HOS/HOD self-review skip rule, Mineral Water merged into F&B task, APU EMS Source of Truth (system.md), Design Principle: backend owns the workflow, config table (HIGH_PAX_THRESHOLD, CANCELLATION_DEADLINE_DAYS, MAX_EVENT_CATEGORIES) (+4 more)

### Community 72 - "Approval Workflow State Machine"
Cohesion: 0.17
Nodes (11): Cafeteria Staff shared inbox mechanism, department_review parallel independent tasks, workflow.service.js (state machine implementation), Corrected Workflow State Machine (section 3), workflow.service.js hasRole update, Approval Workflow (system.md section 4), fmb_options table, request_fmb_selection table (+3 more)

### Community 74 - "Saved Events & Notifications"
Cohesion: 0.23
Nodes (4): NotificationPreference, SavedEventMutationResponse, SavedEventsService, Injectable

### Community 79 - "Form Modal Component"
Cohesion: 0.23
Nodes (3): FormModalComponent, Component, HostListener

### Community 80 - "Nav/Page Visibility DB Tables"
Cohesion: 0.20
Nodes (11): Page Visibility / Nav Builder, nav_page_roles table, nav_page table, role table, unit table, user_unit_roles table, users table (identity fields only), internal-placeholder.html (generic placeholder page) (+3 more)

### Community 81 - "Staff Tasks Routes (backend)"
Cohesion: 0.22
Nodes (7): { db }, departmentTaskDetails(), express, mapTaskStatus(), projectDepartmentTask(), router, workflow

### Community 82 - "Admin Nav Page Models"
Cohesion: 0.24
Nodes (3): AdminNavPageDraft, AdminNavPageRecord, Archived

### Community 85 - "System Config Models & Service"
Cohesion: 0.27
Nodes (6): SystemConfig, SystemConfigDraft, DEFAULT_CONFIG, SystemConfigService, Injectable, EVENT_CATEGORY_OPTIONS

### Community 86 - "Payment Proof Upload Service"
Cohesion: 0.27
Nodes (8): ApiPaymentProofUploadService, MockPaymentProofUploadService, PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi, PaymentProofUploadRequest, PaymentProofUploadResponse, readAsDataUrl(), Injectable

### Community 89 - "Nav Tree & Role Eligibility Services"
Cohesion: 0.20
Nodes (10): nav-tree.service.js, role-eligibility.service.js, role-navigation.ts navTreeFor replacement, user-access.service.js, app.html (root shell template), app-ai-assistant component usage, app-toast-host component usage, internal-layout.html (app shell with sidebar/nav) (+2 more)

### Community 90 - "Unit+Level RBAC Migration Rationale"
Cohesion: 0.22
Nodes (10): Unit + Level RBAC Migration Prompt, applicant role deletion rationale, generic staff role deletion rationale, migrate-unit-level-roles.js migration script, users.role generic level marker compatibility field, School unit-kind warning note, Unit Code auto-derived read-only field, admin-directory.html (Users/Units admin page) (+2 more)

### Community 93 - "Records Hub Templates"
Cohesion: 0.25
Nodes (9): app-feedback-banner Component, app-form-field Component, app-internal-data-page Component, Hub Club Requests Template, Hub Proposals Template, Hub Requests Template, Records Hub Tabs Template, Records Hub Conditional Tab Visibility (tasks/requests/club-requests) (+1 more)

### Community 94 - "Internal Table Workspace UI"
Cohesion: 0.25
Nodes (9): app-internal-table-workspace Component, app-internal-pagination Component, app-step-indicator Component, app-user-avatar Component, app-internal-data-table Component, Profile Page Template, Shared Component Library Live Showcase Pattern, Shared Library Catalog Page Template (+1 more)

### Community 95 - "Proposal Reviewer UI Components"
Cohesion: 0.25
Nodes (9): app-loading-state Component, app-proposal-department-view Component, app-proposal-reviewer-view Component, app-proposal-field Component, app-proposal-kpi-bar Component, app-proposal-section Component, app-proposal-table Component, Proposal Review Page Template (+1 more)

### Community 97 - "Internal Pagination & Table Workspace"
Cohesion: 0.25
Nodes (3): InternalPaginationComponent, InternalTableWorkspaceComponent, Component

### Community 98 - "Request Option Kind Config"
Cohesion: 0.32
Nodes (3): FlatDepartmentWorkflowConfig, UnitDepartmentWorkflowConfig, RequestOptionKind

### Community 101 - "EMS Database Schema (51 tables)"
Cohesion: 0.33
Nodes (7): EMS Database (51 tables), request table, request_task table, unit table, unit_users table, users table, workflow_history table

### Community 104 - "6-Step Proposal Form Concept"
Cohesion: 0.33
Nodes (6): 6-step applicant proposal form, event-proposal.html (6-step proposal form), Logistics quantity availability indicator, Required for Event requirements checklist (step 3), Live Review Summary / proposal preview, app-step-indicator component usage

### Community 105 - "Config Routes (backend)"
Cohesion: 0.33
Nodes (4): { db }, express, router, workflow

### Community 106 - "Explore/My Events Public Variant Pattern"
Cohesion: 0.33
Nodes (6): app-cta-link (header usage), Site Header Template, Calendar Month/Week/Agenda View Modes, Explore Events Public/Internal Variant Pattern, My Events publicLayout Toggle, External User Restricted Navigation

### Community 109 - "Proposal Table Column Config"
Cohesion: 0.40
Nodes (3): ProposalTableColumn, RowCounterComponent, Component

### Community 111 - "Mock Backend Server Overview"
Cohesion: 0.40
Nodes (5): server/app.js (Express app), server/db.js (aggregated seed db), In-memory only, no artificial latency, server/index.js (http server bootstrap), Node/Express Mock Backend Server

### Community 112 - "APU Logo Variants (globe + wordmark)"
Cohesion: 0.40
Nodes (5): APU Full Logo (globe + wordmark), APU Logo (globe icon only), APU Logo with Wordmark (dark, PNG), APU Logo with Wordmark (dark, WebP), APU Footer Logo (globe + red-dot wordmark)

### Community 113 - "APU Logo Text Variants (legacy/current)"
Cohesion: 0.50
Nodes (5): APU Logo Text Black (current, no globe icon), APU Logo Text with Globe Icon (legacy/old version), APU Logo Text Black (legacy/old version, low contrast render), AI-Generated APU Logo Text with Globe Icon (ChatGPT image asset), APU Logo with Globe Icon (JPEG asset copy)

### Community 114 - "Proposal Reviewer & System Config Policies"
Cohesion: 0.40
Nodes (5): app-confirm-dialog Component, Proposal Reviewer Workflow Actions (Approve/Resubmit/Reject/Cancel), Application Cancellation Deadline Policy, System Config Page Template, High Pax Threshold Policy

### Community 117 - "Role Label Derivation Across Layers"
Cohesion: 0.50
Nodes (4): admin.routes.js projectUser() derivation, auth.routes.js login response derivation, role-labels.js unitRoleLabel helper, role-navigation.ts re-keying

### Community 120 - "Social Icons (Facebook/Instagram/LinkedIn)"
Cohesion: 0.67
Nodes (3): Facebook Social Icon, Instagram Social Icon, LinkedIn Social Icon

### Community 121 - "Social Icons (TikTok/X/YouTube)"
Cohesion: 0.67
Nodes (3): TikTok Social Icon, X (Twitter) Social Icon, YouTube Social Icon

### Community 122 - "Project Tooling (README/CLI/Vitest)"
Cohesion: 0.67
Nodes (3): FypUi README, Angular CLI, Vitest test runner

### Community 125 - "Login Page Template & Demo Picker"
Cohesion: 0.67
Nodes (3): login.html (Login page template), Development demo users picker, app-guest-registration-modal component usage

## Ambiguous Edges - Review These
- `Fully data-driven RBAC rationale` → `Unit + Level identity model`  [AMBIGUOUS]
  docs/system-logic/rbac-unit-level-migration-prompt.md · relation: conceptually_related_to
- `Shared Library Catalog Page Template` → `app-internal-table-workspace Component`  [AMBIGUOUS]
  src/app/features/shared-library/shared-library.html · relation: references

## Knowledge Gaps
- **373 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+368 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **50 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Fully data-driven RBAC rationale` and `Unit + Level identity model`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Shared Library Catalog Page Template` and `app-internal-table-workspace Component`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `EventProposalComponent` connect `Event Proposal Form Logic` to `Event Proposal Table Row Editing`, `Logistics Row Validation`, `Event Proposal Step Navigation`, `Proposal Table Column Config`, `Logistics Table Row Helpers`, `Request Option Models (dropdown kinds)`, `Request Field Helpers`, `Logistics Availability Service`, `Event Proposal Table Modals`, `Logistics Option Picker Helpers`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `AuthService` connect `Auth Service (session)` to `Event Calendar Models`, `Records Hub View Modes & Buckets`, `External/Guest Registration Service`, `Admin Directory Models`, `Role Access Helpers`, `App Routes & Placeholder Pages`, `Mock Demo Users`, `Cafeteria Models & Service`, `Landing Page Components`, `Event Registration API Models`, `Auth Navigation Models`, `Event Favourite Service`, `Proposal Visibility & Role Helpers`, `Auth Route Guards`, `Logistics Availability Service`, `Profile & Shared Library Pages`, `Proposal Status/Stage Models`, `Club Models`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `ExploreEventsComponent` connect `Internal Explore Events` to `Landing Page Components`, `Event Favourite Service`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _373 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Angular App Shell & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.05060882800608828 - nodes in this community are weakly interconnected._