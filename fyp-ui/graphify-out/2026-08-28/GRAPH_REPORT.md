# Graph Report - fyp-ui  (2026-08-27)

## Corpus Check
- 243 files · ~547,191 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3281 nodes · 7246 edges · 199 communities (121 shown, 78 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 60 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a19c8f49`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- auth.interceptor.ts
- landing-page.ts
- request-option-management.ts
- ApiProposalWorkflowRepository
- EventProposalComponent
- CafeteriaStaffTasksComponent
- dependencies
- StaffTasksComponent
- ExploreEventsComponent
- Angular Build Config
- PublishedEventService
- role-access.ts
- RequestOptionManagementComponent
- staff-task.repository.ts
- EventCalendarComponent
- InternalDataRecord
- Users & Units Admin
- HappeningSoonComponent
- PageVisibilityComponent
- EventCatalogSectionComponent
- RolesComponent
- ai-assistant.ts
- event-proposal.ts
- EditableTableColumn
- row-assignment.repository.ts
- AdminDirectoryService
- ClubCategoryManagementComponent
- proposal-department-view.ts
- ProposalReviewRecord
- event-calendar.ts
- CafeteriaManageComponent
- proposal-review.models.ts
- request-option.service.ts
- InternalLayoutComponent
- ClubManagementComponent
- external-registration.service.ts
- AdminUnitRecord
- auth.test-fixtures.ts
- apiErrorMessage
- components/explore-events/explore-events.ts
- dashboard.models.ts
- How It Works Timeline
- proposal-visibility.ts
- ProposalDepartmentViewComponent
- CafeteriaStaffAssignmentsComponent
- event-image-upload.service.ts
- AiAssistantComponent
- SharedLibraryComponent
- RequestOption
- ApiAdminDirectoryRepository
- ClubService
- request-option.models.ts
- Explore Events Component Template
- club-hub.ts
- viz.ts
- GuestRegistrationModalComponent
- DepartmentResubmitComponent
- DepartmentRequestKind
- chart-panel.ts
- HubClubRequestsComponent
- Schema Alignment Plan
- RecordsPageComponent
- ProposalReviewerViewComponent
- department-resubmit.ts
- department-workflow.config.ts
- proposal-workflow.repository.ts
- HubPresidentChangeRequestsComponent
- RBAC Seed Role Catalog
- charts.spec.ts
- staff-tasks.ts
- Backend Design Principles
- Workflow State Machine Notes
- environment.ts
- HubHistoryClubsComponent
- login.ts
- Club Discover Page
- HubProposalsComponent
- EventDetailsModalComponent
- formatValue
- RBAC Table Design
- HubHistoryEventsComponent
- AdminNavPageRecord
- admin-directory.models.ts
- DeletionPreview
- ClubRosterModalComponent
- payment-proof-upload.service.ts
- EditableRow
- RBAC Design Notes
- Unit Role Migration Notes
- CafeteriaMyStaffComponent
- SiteHeaderComponent
- app-internal-data-page Component
- Shared Library Catalog Page Template
- Proposal Review Templates
- .navigateToTableError
- AiConversationStore
- RequestOptionKind
- AuthUser
- MyEventsTabComponent
- HubMyClubsComponent
- Permission Grant Labels
- HubRegistrationsComponent
- Proposal Form Template
- HubOngoingClubsComponent
- Header & View Templates
- AiAccessLogComponent
- Club Page Templates
- CafeteriaMenuOversightComponent
- ProposalReviewPageComponent
- Express Backend Design
- APU Logo Assets
- APU Wordmark Assets
- Editable Data Table
- Role Label Derivation Notes
- Admin Directory Actions
- Social Icons (Meta)
- Social Icons (Video)
- Project README
- .playGesture
- CafeteriaStaffRequestsHistoryComponent
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
- CameraCaptureComponent
- HeroComponent
- auth.service.ts
- HubRequestsComponent
- PoliciesTabComponent
- Admin Page Design Notes
- auth.models.ts
- Request Option Management Template
- ForgotPasswordModalComponent
- Club Category Picker
- department-request-columns.ts
- DeadlineReminderService
- Nav Page Purge Actions
- Project Instructions
- Production Environment
- How It Works Template
- Placeholder Page Template
- happening-soon.ts
- EventImageUploadComponent
- CafeteriaService
- event-catalog.service.ts
- event-engagement.models.ts
- request-option.service.spec.ts
- EventCatalogRepositoryImpl
- policies-tab.ts
- EventCatalogEntry
- EventCatalogRepository
- cafeteria.service.ts
- AdminUserAssignment
- PresidentChangeRequestModalComponent
- StepIndicatorComponent
- LogoutComponent
- NavEntryType
- ResetPasswordComponent
- AiOrbAwarenessService
- TimelineChartComponent
- DashboardService
- meter.ts
- .send
- BarChartComponent
- proposal-table.ts
- StatTileComponent
- ReviewerCommentsDrawerComponent
- CharacterCounterComponent
- ai-assistant-page.ts

## God Nodes (most connected - your core abstractions)
1. `EventProposalComponent` - 144 edges
2. `apiErrorMessage()` - 86 edges
3. `ProposalReviewRecord` - 83 edges
4. `PageVisibilityComponent` - 72 edges
5. `AdminDirectoryComponent` - 66 edges
6. `AuthService` - 61 edges
7. `InternalRowActionEvent` - 61 edges
8. `RequestOptionManagementComponent` - 53 edges
9. `AiAssistantComponent` - 53 edges
10. `ClubService` - 51 edges

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
- **Campus Event Photo Gallery (explore-events cards)** — public_assets_events_campus_after_dark, public_assets_events_career_connect_fair, public_assets_events_community_green_day, public_assets_events_cultural_night, public_assets_events_esports_showdown, public_assets_events_startup_pitch_night, public_assets_events_tech_expo, public_assets_events_wellness_run [INFERRED 0.85]
- **F&B role identity unification across three design iterations** — docs_superpowers_specs_2026_08_10_ems_schema_alignment_and_mock_backend_design_fmb_role_merge, docs_superpowers_specs_2026_08_13_rbac_role_unit_redesign_design_fmb_job_merge_rationale, docs_system_logic_rbac_unit_level_migration_prompt_unit_level_model [INFERRED 0.85]
- **University Recognition/Award Badges (footer)** — public_assets_media_footer_award_life_at_work, public_assets_media_footer_award_premier_digital_tech, public_assets_media_footer_award_qs_five_stars, public_assets_media_footer_award_qs_world_ranking, public_assets_media_footer_award_talentbank_employability [INFERRED 0.85]
- **Social Media Links (footer)** — public_assets_media_footer_social_facebook, public_assets_media_footer_social_instagram, public_assets_media_footer_social_linkedin [INFERRED 0.85]
- **Footer Social Media Icon Set** — public_assets_media_footer_social_tiktok, public_assets_media_footer_social_x, public_assets_media_footer_social_youtube [INFERRED 0.85]
- **Records Hub Tab Pages Sharing app-internal-data-page Shell** — src_app_features_internal_pages_records_hub_hub_proposals_hub_proposals_html, src_app_features_internal_pages_records_hub_hub_requests_hub_requests_html, src_app_features_internal_pages_records_hub_hub_club_requests_hub_club_requests_html, shared_components_internal_data_page_internal_data_page_html, src_app_features_internal_pages_records_hub_records_hub_html [INFERRED 0.85]

## Communities (199 total, 78 thin omitted)

### Community 0 - "auth.interceptor.ts"
Cohesion: 0.07
Nodes (18): App, appConfig, routes, Component, ANONYMOUS_PATHS, authInterceptor(), isAnonymous(), isApiRequest() (+10 more)

### Community 1 - "landing-page.ts"
Cohesion: 0.11
Nodes (16): CampusLifeComponent, CampusLifePillar, Component, LandingPageComponent, Component, MyEventsComponent, Component, CtaLinkArrow (+8 more)

### Community 2 - "request-option-management.ts"
Cohesion: 0.07
Nodes (42): ViewMode, Requester, ViewMode, DecidedByFilter, Outcome, RegistrationHistoryEntry, Requester, ViewMode (+34 more)

### Community 3 - "ApiProposalWorkflowRepository"
Cohesion: 0.11
Nodes (3): ApiProposalWorkflowRepository, fmbOptionRowId(), Injectable

### Community 5 - "CafeteriaStaffTasksComponent"
Cohesion: 0.07
Nodes (13): CafeteriaOrder, CafeteriaOrderQuery, CafeteriaOrderSortKey, CafeteriaOrderStatus, Page, SortOrder, CafeteriaOrderService, RawCafeteriaOrder (+5 more)

### Community 6 - "dependencies"
Cohesion: 0.05
Nodes (43): @angular/build, @angular/common, @angular/compiler, @angular/compiler-cli, @angular/core, @angular/forms, @angular/platform-browser, @angular/router (+35 more)

### Community 7 - "StaffTasksComponent"
Cohesion: 0.06
Nodes (9): requiresSameDayStart(), StaffTasksComponent, Component, HostListener, CalendarCell, TaskCalendarComponent, TaskCalendarMode, TaskDateSelection (+1 more)

### Community 8 - "ExploreEventsComponent"
Cohesion: 0.09
Nodes (5): InternalExploreEventsComponent, Component, ExploreEventsComponent, Component, HostListener

### Community 9 - "Angular Build Config"
Cohesion: 0.05
Nodes (44): build, serve, test, builder, configurations, defaultConfiguration, options, packageManager (+36 more)

### Community 10 - "PublishedEventService"
Cohesion: 0.08
Nodes (8): RegisteredEventsResponse, EventRegistration, PendingEventRegistration, PublishedEvent, PublishedEventService, Injectable, CreatedByMeComponent, Component

### Community 11 - "role-access.ts"
Cohesion: 0.11
Nodes (21): authGuard(), defaultRoleRouteGuard(), externalUserGuard(), loginGuard(), publicLandingGuard(), recordsHubDefaultTabGuard(), roleGuard(), hasAnyRole() (+13 more)

### Community 12 - "RequestOptionManagementComponent"
Cohesion: 0.06
Nodes (3): RequestOptionManagementComponent, restoreLabelFor(), Component

### Community 13 - "staff-task.repository.ts"
Cohesion: 0.19
Nodes (10): StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus, ApiStaffTaskRepository, STAFF_TASK_REPOSITORY, Injectable (+2 more)

### Community 14 - "EventCalendarComponent"
Cohesion: 0.08
Nodes (3): EventCalendarComponent, Component, HostListener

### Community 15 - "InternalDataRecord"
Cohesion: 0.09
Nodes (24): ProposalSortKey, SortOrder, ACTION_LABELS, ACTION_TONES, BUCKET_COPY, BUCKET_COPY, ORDER_STATUS_LABEL, PROGRESS_STATUS_LABEL (+16 more)

### Community 20 - "RolesComponent"
Cohesion: 0.08
Nodes (4): deriveRoleCode(), restoreLabelFor(), RolesComponent, Component

### Community 21 - "ai-assistant.ts"
Cohesion: 0.11
Nodes (22): AiAssistantAnswer, AiAssistantClub, AiAssistantHistoryTurn, AiAssistantNavigation, AiAssistantProposal, AiAssistantRegistrant, AiAssistantRegistrantsTable, AiAssistantService (+14 more)

### Community 22 - "event-proposal.ts"
Cohesion: 0.11
Nodes (17): LogisticsAvailability, LogisticsAvailabilityService, Injectable, InternalUserDirectoryService, Injectable, option(), options(), ProposalReviewItem (+9 more)

### Community 23 - "EditableTableColumn"
Cohesion: 0.12
Nodes (3): RequestDefinition, EditableTableColumn, FormControlType

### Community 24 - "row-assignment.repository.ts"
Cohesion: 0.15
Nodes (14): AssignableStaff, MyRowAssignment, MyRowAssignmentQuery, MyRowAssignmentSortKey, Page, RowAssignment, RowAssignmentsForTask, RowAssignmentStatus (+6 more)

### Community 27 - "proposal-department-view.ts"
Cohesion: 0.10
Nodes (26): maxAssigneesPerRow(), ConversationMessage, ConversationSenderSide, allCommentEntries(), DEPARTMENT_LABELS, DepartmentConfirmation, DepartmentTaskStatus, initialsFor() (+18 more)

### Community 28 - "ProposalReviewRecord"
Cohesion: 0.09
Nodes (4): ProposalReviewRecord, ProposalWorkflowRepository, ProposalWorkflowService, Injectable

### Community 29 - "event-calendar.ts"
Cohesion: 0.10
Nodes (14): ProposalEventSchedule, AgendaDay, CalendarDay, CalendarEvent, CalendarView, isoDate(), MOCK_EVENT_FIXTURES, MOCK_PUBLISHED_EVENTS (+6 more)

### Community 30 - "CafeteriaManageComponent"
Cohesion: 0.09
Nodes (3): CafeteriaManageComponent, restoreLabelFor(), Component

### Community 31 - "proposal-review.models.ts"
Cohesion: 0.14
Nodes (18): RegistrationMode, AGENDA, coOwnersFor(), DISCUSSIONS, GUESTS, IMPORTANT_PEOPLE, organizersFor(), proposal() (+10 more)

### Community 32 - "request-option.service.ts"
Cohesion: 0.14
Nodes (11): mapRequestOptionResponse(), mapRequestOptionWrite(), RequestOptionDto, RequestOptionWriteDto, ArchivedRequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository (+3 more)

### Community 33 - "InternalLayoutComponent"
Cohesion: 0.13
Nodes (3): InternalLayoutComponent, Component, HostListener

### Community 35 - "external-registration.service.ts"
Cohesion: 0.13
Nodes (11): ExternalRegistrationService, GuestRegistrationFlowService, StartRegistrationResponse, Injectable, EmailStatusResponse, ExternalRegistrationApi, ExternalUserRegistrationRequest, ExternalUserRegistrationResponse (+3 more)

### Community 37 - "auth.test-fixtures.ts"
Cohesion: 0.12
Nodes (25): SEED_UNITS, SEED_USERS, TEST_CAFETERIA_MANAGER, TEST_CFO, TEST_EXTERNAL_USER, TEST_FMB_HEAD, TEST_HEAD_OF_SCHOOL, TEST_LOGISTICS_STAFF (+17 more)

### Community 38 - "apiErrorMessage"
Cohesion: 0.09
Nodes (44): AssignableCafeteriaUser, CafeteriaStaffRoleCode, AdminEntity, AdminTab, AssignmentRow, UserAssignmentGroup, CafeteriaManageTab, ROLE_CODE (+36 more)

### Community 39 - "components/explore-events/explore-events.ts"
Cohesion: 0.13
Nodes (15): EVENT_FIELD_MAPPING, EventSearchParams, EventSearchResponse, EventVisibility, PaymentStatus, RegistrationResult, VISIBLE_STATUSES, AppliedFilterChip (+7 more)

### Community 40 - "dashboard.models.ts"
Cohesion: 0.06
Nodes (28): AxisSpec, ChartKind, DashboardMeta, DashboardPeriod, DashboardProfile, DashboardWidget, Delta, Drill (+20 more)

### Community 41 - "How It Works Timeline"
Cohesion: 0.18
Nodes (8): HowItWorksComponent, ProcessPathMarker, ProcessPathPoint, ProcessPathPosition, ProcessStep, Component, HostListener, ViewChild

### Community 42 - "proposal-visibility.ts"
Cohesion: 0.21
Nodes (23): departmentFor(), hasRole(), isExternalUser(), requestKindsForRole(), departmentsForRole(), departmentAwaitingApplicant(), headOfSchoolUnitCode(), isApplicantLike() (+15 more)

### Community 43 - "ProposalDepartmentViewComponent"
Cohesion: 0.07
Nodes (3): FmbSelection, ProposalDepartmentViewComponent, Component

### Community 45 - "event-image-upload.service.ts"
Cohesion: 0.23
Nodes (11): ApiEventImageUploadService, EVENT_IMAGE_UPLOAD_API, EventImageUploadApi, EventImageUploadRequest, EventImageUploadResponse, MockEventImageUploadService, readAsDataUrl(), Injectable (+3 more)

### Community 46 - "AiAssistantComponent"
Cohesion: 0.09
Nodes (4): AiAssistantComponent, isAssistantUrl(), Component, HostListener

### Community 47 - "SharedLibraryComponent"
Cohesion: 0.12
Nodes (4): SharedLibraryComponent, Component, StepStatus, WizardStep

### Community 48 - "RequestOption"
Cohesion: 0.29
Nodes (3): RequestOption, RequestOptionService, Injectable

### Community 49 - "ApiAdminDirectoryRepository"
Cohesion: 0.11
Nodes (5): AdminRoleRecord, AdminUserRecord, ApiAdminDirectoryRepository, Injectable, AssignmentDraftRow

### Community 50 - "ClubService"
Cohesion: 0.07
Nodes (20): ClubCategoryPage, ClubCategoryRecord, ClubDraft, ClubJoinRequestRecord, ClubJoinRequestStatus, ClubMemberRecord, ClubMyStatus, ClubPage (+12 more)

### Community 51 - "request-option.models.ts"
Cohesion: 0.19
Nodes (14): CampusTourStartOption, CampusTourTypeOption, DietaryInformationOption, FoodRequestOption, FundingMainOption, FundingSubOption, LogisticsRequestOption, MediaRequestOption (+6 more)

### Community 52 - "Explore Events Component Template"
Cohesion: 0.21
Nodes (16): app-cta-link Component, app-event-card Component, app-event-details-modal Component, app-expandable-search Component, app-filter-button Component, app-internal-page-state Component, app-site-footer Component, app-site-header Component (+8 more)

### Community 54 - "viz.ts"
Cohesion: 0.12
Nodes (25): Annotation, Axes, Series, areaPath(), barPath(), categoriesOf(), columnPath(), CURRENCY (+17 more)

### Community 56 - "DepartmentResubmitComponent"
Cohesion: 0.11
Nodes (4): optionKindForDepartmentField(), resolveDepartmentRowLabels(), DepartmentResubmitComponent, Component

### Community 57 - "DepartmentRequestKind"
Cohesion: 0.12
Nodes (4): DepartmentRequestKind, RowAssignmentRepository, ApiRowAssignmentRepository, Injectable

### Community 58 - "chart-panel.ts"
Cohesion: 0.09
Nodes (15): Directive, Point, AlertListComponent, Component, ChartPanelComponent, Component, ColumnChartComponent, Component (+7 more)

### Community 60 - "Schema Alignment Plan"
Cohesion: 0.05
Nodes (38): EMS Schema Alignment + Mock Backend Implementation Plan, Global Constraints, Phase 1: Source-of-Truth Corrections, Phase 2: Angular Frontend Refactor, Phase 2b: Extend Auth, Events, Saved Events, System Config, and Image Upload to REST, Phase 3: Express Mock Backend, Phase 4: Wire the Dev-Server Proxy and Verify End-to-End, Task 1.1: Correct `ems_database_schema.sql` — roles, F&B rename, water/campus-tour restructuring, new status columns (+30 more)

### Community 63 - "department-resubmit.ts"
Cohesion: 0.14
Nodes (7): ManagerField, EditableColumnType, SelectOption, StaffOption, SearchableDropdownComponent, Component, HostListener

### Community 64 - "department-workflow.config.ts"
Cohesion: 0.14
Nodes (16): assignmentRequiredForManager(), FLAT_DEPARTMENT_WORKFLOWS, isFlatRoleCode(), MAX_ASSIGNEES_PER_ROW, optionKindsForManager(), requestKindsForManager(), SAME_DAY_START_ONLY, staffUnitCodeForManager() (+8 more)

### Community 65 - "proposal-workflow.repository.ts"
Cohesion: 0.13
Nodes (12): ProposalConversation, DepartmentRequestBucket, DepartmentRequestListQuery, DepartmentRequestOrder, DepartmentRequestSortKey, FmbSelectionDraft, FmbSelectionEdit, Page (+4 more)

### Community 67 - "HubPresidentChangeRequestsComponent"
Cohesion: 0.14
Nodes (3): PresidentChangeRequestRecord, HubPresidentChangeRequestsComponent, Component

### Community 68 - "RBAC Seed Role Catalog"
Cohesion: 0.33
Nodes (6): RBAC Redesign: Users/Units/Roles/Page Visibility Design, isSchoolUnit(code) backend helper, One head per unit constraint, Protected vs custom role distinction, 9 seed role catalog (protected), School detection by substring match

### Community 69 - "charts.spec.ts"
Cohesion: 0.12
Nodes (12): TableView, ChartFrameComponent, Component, FrameHost, InsightHost, PanelHost, TableHost, TileHost (+4 more)

### Community 70 - "staff-tasks.ts"
Cohesion: 0.24
Nodes (7): COMMON_END, DEFAULT_PRESENTATION, PageMode, ROLE_PRESENTATION, RolePresentation, InternalTableColumn, InternalDataTableComponent

### Community 71 - "Backend Design Principles"
Cohesion: 0.29
Nodes (7): EMS Schema Alignment + Mock Backend Design, Backend owns the workflow (design principle), Campus Tour trimmed to Starting Point only, F&B role merge (FmbReviewer + FmbManager -> fmb), HOS/HOD self-review skip rule, Mineral Water merged into F&B task, F&B job merge into head-of-department

### Community 72 - "Workflow State Machine Notes"
Cohesion: 0.40
Nodes (5): Cafeteria Staff shared inbox mechanism, department_review parallel independent tasks, workflow.service.js (state machine implementation), Corrected Workflow State Machine (section 3), workflow.service.js hasRole update

### Community 73 - "environment.ts"
Cohesion: 0.13
Nodes (11): AiAccessDenial, AiAccessDenialPage, AiAccessLogService, Injectable, PurgeSweepEntityResult, PurgeSweepResult, AuthUserRole, DevUsersService (+3 more)

### Community 75 - "login.ts"
Cohesion: 0.14
Nodes (6): DevUser, roleCanUseSavedEvents(), DemoUserGroup, LoginComponent, Component, ViewChild

### Community 77 - "HubProposalsComponent"
Cohesion: 0.16
Nodes (3): departmentsAwaitingApplicant(), HubProposalsComponent, Component

### Community 79 - "formatValue"
Cohesion: 0.12
Nodes (9): ValueFormat, FunnelComponent, FunnelStage, Component, HeatCell, HeatmapComponent, Component, formatValue() (+1 more)

### Community 80 - "RBAC Table Design"
Cohesion: 0.25
Nodes (8): Page Visibility / Nav Builder, nav_page_roles table, nav_page table, role table, unit table, user_unit_roles table, users table (identity fields only), page-visibility.html (Pages/Permissions/Deleted admin UI)

### Community 83 - "admin-directory.models.ts"
Cohesion: 0.24
Nodes (8): AdminDirectoryRepository, AdminNavPageDraft, AdminNavPageGrant, AdminNavPageGrantDraft, AdminRoleDraft, AdminUnitDraft, AdminUserDraft, ADMIN_DIRECTORY_REPOSITORY

### Community 86 - "payment-proof-upload.service.ts"
Cohesion: 0.27
Nodes (8): ApiPaymentProofUploadService, MockPaymentProofUploadService, PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi, PaymentProofUploadRequest, PaymentProofUploadResponse, readAsDataUrl(), Injectable

### Community 87 - "EditableRow"
Cohesion: 0.13
Nodes (3): EditableRow, ProposalTableComponent, Component

### Community 89 - "RBAC Design Notes"
Cohesion: 0.20
Nodes (10): nav-tree.service.js, role-eligibility.service.js, role-navigation.ts navTreeFor replacement, user-access.service.js, app.html (root shell template), app-ai-assistant component usage, app-toast-host component usage, internal-layout.html (app shell with sidebar/nav) (+2 more)

### Community 90 - "Unit Role Migration Notes"
Cohesion: 0.29
Nodes (8): Fully data-driven RBAC rationale, Unit + Level RBAC Migration Prompt, applicant role deletion rationale, generic staff role deletion rationale, migrate-unit-level-roles.js migration script, users.role generic level marker compatibility field, School unit-kind warning note, Unit + Level identity model

### Community 92 - "SiteHeaderComponent"
Cohesion: 0.18
Nodes (4): SiteHeaderComponent, Component, HostListener, ViewChild

### Community 93 - "app-internal-data-page Component"
Cohesion: 0.33
Nodes (7): app-internal-data-page Component, app-internal-data-table Component, Hub Proposals Template, Hub Requests Template, Records Hub Tabs Template, Records Hub Conditional Tab Visibility (tasks/requests/club-requests), Staff Tasks Page Template

### Community 94 - "Shared Library Catalog Page Template"
Cohesion: 0.20
Nodes (12): app-feedback-banner Component, app-form-field Component, app-form-modal Component, app-internal-table-workspace Component, app-internal-pagination Component, app-step-indicator Component, app-user-avatar Component, Profile Page Template (+4 more)

### Community 95 - "Proposal Review Templates"
Cohesion: 0.22
Nodes (10): app-loading-state Component, app-proposal-department-view Component, app-proposal-reviewer-view Component, Proposal Reviewer Workflow Actions (Approve/Resubmit/Reject/Cancel), app-proposal-field Component, app-proposal-kpi-bar Component, app-proposal-section Component, app-proposal-table Component (+2 more)

### Community 97 - "AiConversationStore"
Cohesion: 0.22
Nodes (3): AiConversationStore, newId(), Injectable

### Community 98 - "RequestOptionKind"
Cohesion: 0.22
Nodes (3): FlatDepartmentWorkflowConfig, UnitDepartmentWorkflowConfig, RequestOptionKind

### Community 99 - "AuthUser"
Cohesion: 0.15
Nodes (9): AuthUser, LoginResponse, PersistedSession, VerifyRegistrationResponse, AuthTokens, PersistedTokens, APPLICANT_USER, loginViaMock() (+1 more)

### Community 101 - "HubMyClubsComponent"
Cohesion: 0.11
Nodes (3): HubMyClubsComponent, Component, HostListener

### Community 104 - "Proposal Form Template"
Cohesion: 0.40
Nodes (5): event-proposal.html (6-step proposal form), Logistics quantity availability indicator, Required for Event requirements checklist (step 3), Live Review Summary / proposal preview, app-step-indicator component usage

### Community 106 - "Header & View Templates"
Cohesion: 0.33
Nodes (6): app-cta-link (header usage), Site Header Template, Calendar Month/Week/Agenda View Modes, Explore Events Public/Internal Variant Pattern, My Events publicLayout Toggle, External User Restricted Navigation

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

### Community 125 - "Login Page Template"
Cohesion: 0.67
Nodes (3): login.html (Login page template), Development demo users picker, app-guest-registration-modal component usage

### Community 148 - "HeroComponent"
Cohesion: 0.24
Nodes (4): HeroComponent, MockIntersectionObserver, Component, ViewChild

### Community 149 - "auth.service.ts"
Cohesion: 0.06
Nodes (22): dropdownSettingRoutes, placeholderPage(), AuthService, ChangePasswordResult, LoginResult, MessageResponse, PasswordResetConfirmResult, Injectable (+14 more)

### Community 152 - "HubRequestsComponent"
Cohesion: 0.15
Nodes (4): ProposalDepartmentRequest, DepartmentRequestListItem, HubRequestsComponent, Component

### Community 153 - "PoliciesTabComponent"
Cohesion: 0.22
Nodes (3): DashboardThreshold, PoliciesTabComponent, Component

### Community 154 - "Admin Page Design Notes"
Cohesion: 0.33
Nodes (6): Soft-delete with 7-day auto-purge, Unit Code auto-derived read-only field, admin-directory.html (Users/Units admin page), app-delete-confirm-dialog usage, Deleted tab (archived users/units), derivedUnitCode() read-only unit code field

### Community 155 - "auth.models.ts"
Cohesion: 0.14
Nodes (16): PurgeSweepService, Injectable, AuthNavigationItem, AuthNavigationSection, AuthNavNode, RoleNavigation, RoleNavigationEntry, UserAccountType (+8 more)

### Community 156 - "Request Option Management Template"
Cohesion: 0.22
Nodes (10): app-delete-confirm-dialog Component, app-image-upload-field Component, app-option-card-grid Component, app-option-item-details-modal Component, app-searchable-dropdown Component, app-status-toggle Component, Request Option Management Template, Soft-Delete / Restore Pattern for Managed Options (+2 more)

### Community 158 - "ForgotPasswordModalComponent"
Cohesion: 0.17
Nodes (5): ProfileComponent, Component, ViewChild, ForgotPasswordModalComponent, Component

### Community 160 - "department-request-columns.ts"
Cohesion: 0.53
Nodes (5): buildDepartmentRequestDefinitions(), DepartmentRequestDefinition, fillDanglingHalves(), selectOptionOf(), selectOptionsOf()

### Community 161 - "DeadlineReminderService"
Cohesion: 0.40
Nodes (3): DeadlineReminderService, ReminderTask, Injectable

### Community 169 - "happening-soon.ts"
Cohesion: 0.14
Nodes (12): EventCard, EventDate, ExpandingCard, QueueDirection, inDays(), MOCK_EVENT_FIXTURES, MOCK_PUBLISHED_EVENTS, TransitionPhase (+4 more)

### Community 171 - "CafeteriaService"
Cohesion: 0.19
Nodes (5): Cafeteria, CafeteriaAssignment, CafeteriaDraft, CafeteriaService, Injectable

### Community 172 - "event-catalog.service.ts"
Cohesion: 0.17
Nodes (10): ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogResource, EventCategoryService, EventFormatService, Injectable, CategoriesTabComponent, Component (+2 more)

### Community 173 - "event-engagement.models.ts"
Cohesion: 0.10
Nodes (13): EventRegistrationApi, NotificationPreference, RegisteredEventEntry, SavedEventMutationResponse, SavedEventRecord, SavedEventsApi, SavedEventsResponse, EventFavouriteService (+5 more)

### Community 174 - "request-option.service.spec.ts"
Cohesion: 0.20
Nodes (9): avManager, cafeteriaManagerUser, cfoUser, DROPDOWN_PAGES_BY_UNIT, fmbManager, logisticsManager, SEED_OPTIONS, studentServicesManager (+1 more)

### Community 176 - "policies-tab.ts"
Cohesion: 0.28
Nodes (7): DASHBOARD_THRESHOLD_GROUPS, SystemConfig, SystemConfigDraft, ThresholdGroup, DEFAULT_CONFIG, SystemConfigService, Injectable

### Community 179 - "cafeteria.service.ts"
Cohesion: 0.24
Nodes (9): CafeteriaStaffAuditAction, CafeteriaStaffAuditActorRole, CafeteriaStaffAuditEntry, CafeteriaStaffAuditQuery, CafeteriaStaffAuditSortKey, Page, SortOrder, CafeteriaAssignmentDraft (+1 more)

### Community 186 - "AiOrbAwarenessService"
Cohesion: 0.40
Nodes (3): AiAwarenessEvent, AiOrbAwarenessService, Injectable

### Community 187 - "TimelineChartComponent"
Cohesion: 0.14
Nodes (6): TimelineBar, TimelineChartComponent, TimelineLane, Component, formatClock(), minutesOfDay()

### Community 188 - "DashboardService"
Cohesion: 0.29
Nodes (3): DashboardDocument, DashboardService, Injectable

### Community 190 - "meter.ts"
Cohesion: 0.29
Nodes (6): VizStatus, MeterComponent, MeterSpec, Component, STATUS_ICON, statusColor()

### Community 194 - "proposal-table.ts"
Cohesion: 0.40
Nodes (3): ProposalTableColumn, RowCounterComponent, Component

## Ambiguous Edges - Review These
- `Fully data-driven RBAC rationale` → `Unit + Level identity model`  [AMBIGUOUS]
  docs/system-logic/rbac-unit-level-migration-prompt.md · relation: conceptually_related_to
- `app-internal-table-workspace Component` → `Shared Library Catalog Page Template`  [AMBIGUOUS]
  src/app/features/shared-library/shared-library.html · relation: references

## Knowledge Gaps
- **361 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+356 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **78 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Fully data-driven RBAC rationale` and `Unit + Level identity model`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `app-internal-table-workspace Component` and `Shared Library Catalog Page Template`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `apiErrorMessage()` connect `apiErrorMessage` to `request-option-management.ts`, `CafeteriaStaffTasksComponent`, `StaffTasksComponent`, `RequestOptionManagementComponent`, `InternalDataRecord`, `Users & Units Admin`, `PageVisibilityComponent`, `EventCatalogSectionComponent`, `RolesComponent`, `auth.service.ts`, `Deleted Items Admin`, `event-proposal.ts`, `Proposal Submit Actions`, `PoliciesTabComponent`, `ClubCategoryManagementComponent`, `auth.models.ts`, `proposal-department-view.ts`, `CafeteriaManageComponent`, `InternalLayoutComponent`, `ClubManagementComponent`, `ProposalDepartmentViewComponent`, `CafeteriaStaffAssignmentsComponent`, `policies-tab.ts`, `ClubService`, `PresidentChangeRequestModalComponent`, `DepartmentResubmitComponent`, `RecordsPageComponent`, `ProposalReviewerViewComponent`, `department-resubmit.ts`, `HubPresidentChangeRequestsComponent`, `staff-tasks.ts`, `ClubRosterModalComponent`, `Page Visibility Grants`, `CafeteriaMyStaffComponent`, `HubRegistrationsComponent`, `AiAccessLogComponent`, `Page Visibility Restore`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `EventProposalComponent` connect `EventProposalComponent` to `.navigateToTableError`, `.logisticsExceedsRemaining`, `proposal-table.ts`, `department-resubmit.ts`, `request-option.models.ts`, `EditableTableColumn`, `EditableRow`, `Proposal Submit Actions`, `event-proposal.ts`, `DepartmentResubmitComponent`, `.saveTableRow`, `.row`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `AuthService` connect `auth.service.ts` to `auth.interceptor.ts`, `landing-page.ts`, `request-option-management.ts`, `role-access.ts`, `InternalDataRecord`, `ai-assistant.ts`, `event-proposal.ts`, `proposal-department-view.ts`, `auth.models.ts`, `external-registration.service.ts`, `auth.test-fixtures.ts`, `apiErrorMessage`, `components/explore-events/explore-events.ts`, `proposal-visibility.ts`, `event-engagement.models.ts`, `ClubService`, `department-resubmit.ts`, `login.ts`, `admin-directory.models.ts`, `AuthUser`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _361 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `auth.interceptor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06829268292682927 - nodes in this community are weakly interconnected._