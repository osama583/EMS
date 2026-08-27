# Graph Report - fyp-ui  (2026-08-26)

## Corpus Check
- 222 files · ~537,296 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3061 nodes · 6766 edges · 188 communities (115 shown, 73 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 60 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f99120eb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- auth.interceptor.ts
- SiteHeaderComponent
- internal-data-page.ts
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
- internal-data-page.models.ts
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
- proposal-review.mock-data.ts
- request-option.service.ts
- InternalLayoutComponent
- ClubManagementComponent
- external-registration.service.ts
- AdminUnitRecord
- auth.test-fixtures.ts
- apiErrorMessage
- published-event.models.ts
- request-option-management.ts
- How It Works Timeline
- proposal-visibility.ts
- ProposalDepartmentViewComponent
- CafeteriaStaffAssignmentsComponent
- event-details-modal.ts
- AiAssistantComponent
- SharedLibraryComponent
- RequestOption
- ApiAdminDirectoryRepository
- ClubService
- request-option.models.ts
- Explore Events Component Template
- club-hub.ts
- components/explore-events/explore-events.ts
- GuestRegistrationModalComponent
- DepartmentResubmitComponent
- DepartmentRequestKind
- club.service.ts
- HubClubRequestsComponent
- Schema Alignment Plan
- RecordsPageComponent
- ProposalReviewerViewComponent
- SelectOption
- department-workflow.config.ts
- ProposalWorkflowService
- HubPresidentChangeRequestsComponent
- RBAC Seed Role Catalog
- page-visibility.ts
- InternalTableColumn
- Backend Design Principles
- Workflow State Machine Notes
- environment.ts
- HubHistoryClubsComponent
- LoginComponent
- Club Discover Page
- HubProposalsComponent
- EventDetailsModalComponent
- FormModalComponent
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
- .closePanel
- app-internal-data-page Component
- Shared Library Catalog Page Template
- Proposal Review Templates
- .navigateToTableError
- AiConversationStore
- RequestOptionKind
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
- proposal-review-page.spec.ts
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
- ai-access-log.service.ts
- auth.service.ts
- hub-proposals.ts
- Policies Config Tab
- Admin Page Design Notes
- purge-sweep.service.ts
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
- EventImageUploadComponent
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
- PresidentChangeRequestModalComponent
- internal-user-directory.service.ts
- LogoutComponent
- NavEntryType
- ResetPasswordComponent
- AiOrbAwarenessService
- OptionPickerItem

## God Nodes (most connected - your core abstractions)
1. `EventProposalComponent` - 144 edges
2. `apiErrorMessage()` - 86 edges
3. `ProposalReviewRecord` - 83 edges
4. `PageVisibilityComponent` - 72 edges
5. `AdminDirectoryComponent` - 66 edges
6. `AuthService` - 61 edges
7. `InternalRowActionEvent` - 61 edges
8. `RequestOptionManagementComponent` - 53 edges
9. `ClubService` - 51 edges
10. `AiAssistantComponent` - 51 edges

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

## Communities (188 total, 73 thin omitted)

### Community 0 - "auth.interceptor.ts"
Cohesion: 0.06
Nodes (20): App, appConfig, routes, Component, ANONYMOUS_PATHS, authInterceptor(), isAnonymous(), isApiRequest() (+12 more)

### Community 1 - "SiteHeaderComponent"
Cohesion: 0.06
Nodes (24): CampusLifeComponent, CampusLifePillar, Component, HeroComponent, MockIntersectionObserver, Component, ViewChild, LandingPageComponent (+16 more)

### Community 2 - "internal-data-page.ts"
Cohesion: 0.10
Nodes (29): ViewMode, ViewMode, Requester, ViewMode, DecidedByFilter, Outcome, RegistrationHistoryEntry, Requester (+21 more)

### Community 3 - "ApiProposalWorkflowRepository"
Cohesion: 0.10
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
Cohesion: 0.10
Nodes (4): EventSearchParams, ExploreEventsComponent, Component, HostListener

### Community 9 - "Angular Build Config"
Cohesion: 0.05
Nodes (44): build, serve, test, builder, configurations, defaultConfiguration, options, packageManager (+36 more)

### Community 10 - "PublishedEventService"
Cohesion: 0.08
Nodes (9): RegisteredEventsResponse, SavedEventsResponse, EventRegistration, PendingEventRegistration, PublishedEvent, PublishedEventService, Injectable, CreatedByMeComponent (+1 more)

### Community 11 - "role-access.ts"
Cohesion: 0.07
Nodes (37): authGuard(), defaultRoleRouteGuard(), externalUserGuard(), loginGuard(), publicLandingGuard(), recordsHubDefaultTabGuard(), roleGuard(), AuthNavigationItem (+29 more)

### Community 13 - "staff-task.repository.ts"
Cohesion: 0.19
Nodes (10): StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus, ApiStaffTaskRepository, STAFF_TASK_REPOSITORY, Injectable (+2 more)

### Community 14 - "EventCalendarComponent"
Cohesion: 0.08
Nodes (3): EventCalendarComponent, Component, HostListener

### Community 15 - "internal-data-page.models.ts"
Cohesion: 0.09
Nodes (24): SortOrder, ACTION_LABELS, ACTION_TONES, PCR_REJECTION_COMMENT_MIN_LENGTH, STATUS_LABELS, STATUS_TONES, BUCKET_COPY, ORDER_STATUS_LABEL (+16 more)

### Community 17 - "HappeningSoonComponent"
Cohesion: 0.11
Nodes (3): ProposalEventSchedule, HappeningSoonComponent, Component

### Community 20 - "RolesComponent"
Cohesion: 0.08
Nodes (4): deriveRoleCode(), restoreLabelFor(), RolesComponent, Component

### Community 21 - "ai-assistant.ts"
Cohesion: 0.11
Nodes (20): AiAssistantAnswer, AiAssistantClub, AiAssistantHistoryTurn, AiAssistantProposal, AiAssistantRegistrant, AiAssistantRegistrantsTable, AiAssistantService, AiAssistantSource (+12 more)

### Community 22 - "event-proposal.ts"
Cohesion: 0.10
Nodes (17): LogisticsAvailability, LogisticsAvailabilityService, Injectable, option(), options(), ProposalReviewItem, ProposalReviewSection, ProposalStep (+9 more)

### Community 23 - "EditableTableColumn"
Cohesion: 0.11
Nodes (3): RequestDefinition, EditableTableColumn, FormControlType

### Community 24 - "row-assignment.repository.ts"
Cohesion: 0.16
Nodes (14): AssignableStaff, MyRowAssignment, MyRowAssignmentQuery, MyRowAssignmentSortKey, Page, RowAssignment, RowAssignmentsForTask, RowAssignmentStatus (+6 more)

### Community 27 - "proposal-department-view.ts"
Cohesion: 0.07
Nodes (32): maxAssigneesPerRow(), ConversationMessage, ConversationSenderSide, ProposalConversation, allCommentEntries(), DepartmentConfirmation, DepartmentTaskStatus, initialsFor() (+24 more)

### Community 29 - "event-calendar.ts"
Cohesion: 0.09
Nodes (13): AgendaDay, CalendarDay, CalendarEvent, CalendarView, isoDate(), MOCK_EVENT_FIXTURES, MOCK_PUBLISHED_EVENTS, ExpandableSearchComponent (+5 more)

### Community 30 - "CafeteriaManageComponent"
Cohesion: 0.09
Nodes (3): CafeteriaManageComponent, restoreLabelFor(), Component

### Community 31 - "proposal-review.mock-data.ts"
Cohesion: 0.17
Nodes (15): AGENDA, coOwnersFor(), DISCUSSIONS, GUESTS, IMPORTANT_PEOPLE, organizersFor(), proposal(), proposalForTitle() (+7 more)

### Community 32 - "request-option.service.ts"
Cohesion: 0.14
Nodes (11): mapRequestOptionResponse(), mapRequestOptionWrite(), RequestOptionDto, RequestOptionWriteDto, ArchivedRequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository (+3 more)

### Community 33 - "InternalLayoutComponent"
Cohesion: 0.14
Nodes (3): InternalLayoutComponent, Component, HostListener

### Community 35 - "external-registration.service.ts"
Cohesion: 0.13
Nodes (16): ExternalRegistrationService, StartRegistrationResponse, Injectable, VerifyRegistrationResponse, EmailStatusResponse, EventRegistrationApi, ExternalRegistrationApi, ExternalUserRegistrationRequest (+8 more)

### Community 37 - "auth.test-fixtures.ts"
Cohesion: 0.14
Nodes (23): SEED_UNITS, SEED_USERS, AuthNavNode, TEST_CAFETERIA_MANAGER, TEST_CFO, TEST_EXTERNAL_USER, TEST_FMB_HEAD, TEST_HEAD_OF_SCHOOL (+15 more)

### Community 38 - "apiErrorMessage"
Cohesion: 0.13
Nodes (37): AdminEntity, AdminTab, AssignmentRow, UserAssignmentGroup, CafeteriaManageTab, ROLE_CODE, ROLE_OPTIONS, COLUMNS (+29 more)

### Community 39 - "published-event.models.ts"
Cohesion: 0.11
Nodes (17): EVENT_FIELD_MAPPING, EventSearchResponse, EventVisibility, PaymentStatus, RegistrationMode, RegistrationResult, VISIBLE_STATUSES, EventCard (+9 more)

### Community 40 - "request-option-management.ts"
Cohesion: 0.21
Nodes (9): CAFETERIA_OPTION_KINDS, KIND_LABELS, restoreLabelFor(), OptionCardMetaField, OptionCardViewModel, OptionCardGridComponent, Component, OptionItemDetailsModalComponent (+1 more)

### Community 41 - "How It Works Timeline"
Cohesion: 0.18
Nodes (8): HowItWorksComponent, ProcessPathMarker, ProcessPathPoint, ProcessPathPosition, ProcessStep, Component, HostListener, ViewChild

### Community 42 - "proposal-visibility.ts"
Cohesion: 0.21
Nodes (23): departmentFor(), hasRole(), isExternalUser(), requestKindsForRole(), departmentsForRole(), isReviewerStage(), departmentAwaitingApplicant(), headOfSchoolUnitCode() (+15 more)

### Community 43 - "ProposalDepartmentViewComponent"
Cohesion: 0.08
Nodes (3): FmbSelection, ProposalDepartmentViewComponent, Component

### Community 45 - "event-details-modal.ts"
Cohesion: 0.22
Nodes (11): ApiEventImageUploadService, EVENT_IMAGE_UPLOAD_API, EventImageUploadApi, EventImageUploadRequest, EventImageUploadResponse, MockEventImageUploadService, readAsDataUrl(), Injectable (+3 more)

### Community 46 - "AiAssistantComponent"
Cohesion: 0.10
Nodes (4): AiAssistantComponent, newMessageId(), segmentMessageText(), Component

### Community 47 - "SharedLibraryComponent"
Cohesion: 0.09
Nodes (6): SharedLibraryComponent, Component, StepIndicatorComponent, StepStatus, Component, WizardStep

### Community 48 - "RequestOption"
Cohesion: 0.24
Nodes (3): RequestOption, RequestOptionService, Injectable

### Community 49 - "ApiAdminDirectoryRepository"
Cohesion: 0.11
Nodes (5): AdminRoleRecord, AdminUserRecord, ApiAdminDirectoryRepository, Injectable, AssignmentDraftRow

### Community 50 - "ClubService"
Cohesion: 0.13
Nodes (5): ClubCategoryRecord, ClubDraft, ClubRecord, ClubService, Injectable

### Community 51 - "request-option.models.ts"
Cohesion: 0.27
Nodes (13): CampusTourStartOption, CampusTourTypeOption, DietaryInformationOption, FoodRequestOption, FundingMainOption, FundingSubOption, LogisticsRequestOption, MediaRequestOption (+5 more)

### Community 52 - "Explore Events Component Template"
Cohesion: 0.21
Nodes (16): app-cta-link Component, app-event-card Component, app-event-details-modal Component, app-expandable-search Component, app-filter-button Component, app-internal-page-state Component, app-site-footer Component, app-site-header Component (+8 more)

### Community 54 - "components/explore-events/explore-events.ts"
Cohesion: 0.09
Nodes (13): GuestRegistrationFlowService, EventFavouriteService, Injectable, InternalExploreEventsComponent, Component, AppliedFilterChip, FilterGroup, FilterKey (+5 more)

### Community 56 - "DepartmentResubmitComponent"
Cohesion: 0.11
Nodes (4): optionKindForDepartmentField(), resolveDepartmentRowLabels(), DepartmentResubmitComponent, Component

### Community 57 - "DepartmentRequestKind"
Cohesion: 0.12
Nodes (4): DepartmentRequestKind, RowAssignmentRepository, RowAssignmentService, Injectable

### Community 58 - "club.service.ts"
Cohesion: 0.18
Nodes (10): ClubCategoryPage, ClubJoinRequestStatus, ClubMyStatus, ClubPage, ClubSortKey, ClubUserSummary, PresidentChangeRequestPage, PresidentChangeRequestQuery (+2 more)

### Community 59 - "HubClubRequestsComponent"
Cohesion: 0.10
Nodes (4): ClubJoinRequestRecord, HubClubRequestsComponent, Component, RequestHistoryEntry

### Community 60 - "Schema Alignment Plan"
Cohesion: 0.05
Nodes (38): EMS Schema Alignment + Mock Backend Implementation Plan, Global Constraints, Phase 1: Source-of-Truth Corrections, Phase 2: Angular Frontend Refactor, Phase 2b: Extend Auth, Events, Saved Events, System Config, and Image Upload to REST, Phase 3: Express Mock Backend, Phase 4: Wire the Dev-Server Proxy and Verify End-to-End, Task 1.1: Correct `ems_database_schema.sql` — roles, F&B rename, water/campus-tour restructuring, new status columns (+30 more)

### Community 63 - "SelectOption"
Cohesion: 0.12
Nodes (9): ManagerField, CLUB_CATEGORY_MAX, CLUB_CATEGORY_MIN, EditableColumnType, SelectOption, StaffOption, SearchableDropdownComponent, Component (+1 more)

### Community 64 - "department-workflow.config.ts"
Cohesion: 0.13
Nodes (15): assignmentRequiredForManager(), FLAT_DEPARTMENT_WORKFLOWS, isFlatRoleCode(), MAX_ASSIGNEES_PER_ROW, requestKindsForManager(), SAME_DAY_START_ONLY, staffUnitCodeForManager(), UNIT_DEPARTMENT_WORKFLOWS (+7 more)

### Community 65 - "ProposalWorkflowService"
Cohesion: 0.11
Nodes (3): ProposalBucket, ProposalWorkflowService, Injectable

### Community 67 - "HubPresidentChangeRequestsComponent"
Cohesion: 0.14
Nodes (3): PresidentChangeRequestRecord, HubPresidentChangeRequestsComponent, Component

### Community 68 - "RBAC Seed Role Catalog"
Cohesion: 0.33
Nodes (6): RBAC Redesign: Users/Units/Roles/Page Visibility Design, isSchoolUnit(code) backend helper, One head per unit constraint, Protected vs custom role distinction, 9 seed role catalog (protected), School detection by substring match

### Community 69 - "page-visibility.ts"
Cohesion: 0.14
Nodes (10): CAFETERIA_ROLE_CODES, EMPTY_DRAFT, GRANT_TYPE_OPTIONS, PageVisibilityTab, ImageUploadFieldComponent, Component, ViewChild, PopoverComponent (+2 more)

### Community 70 - "InternalTableColumn"
Cohesion: 0.20
Nodes (6): RolePresentation, InternalRowAction, InternalTableColumn, InternalDataTableComponent, InternalMobileRecordListComponent, HostListener

### Community 71 - "Backend Design Principles"
Cohesion: 0.29
Nodes (7): EMS Schema Alignment + Mock Backend Design, Backend owns the workflow (design principle), Campus Tour trimmed to Starting Point only, F&B role merge (FmbReviewer + FmbManager -> fmb), HOS/HOD self-review skip rule, Mineral Water merged into F&B task, F&B job merge into head-of-department

### Community 72 - "Workflow State Machine Notes"
Cohesion: 0.40
Nodes (5): Cafeteria Staff shared inbox mechanism, department_review parallel independent tasks, workflow.service.js (state machine implementation), Corrected Workflow State Machine (section 3), workflow.service.js hasRole update

### Community 73 - "environment.ts"
Cohesion: 0.16
Nodes (9): DevUser, DevUsersService, Injectable, APPLICANT_USER, loginViaMock(), sessionEnvelope(), DemoUserGroup, CATALOG_SEED (+1 more)

### Community 75 - "LoginComponent"
Cohesion: 0.18
Nodes (3): LoginComponent, Component, ViewChild

### Community 77 - "HubProposalsComponent"
Cohesion: 0.16
Nodes (3): departmentsAwaitingApplicant(), HubProposalsComponent, Component

### Community 79 - "FormModalComponent"
Cohesion: 0.23
Nodes (3): FormModalComponent, Component, HostListener

### Community 80 - "RBAC Table Design"
Cohesion: 0.25
Nodes (8): Page Visibility / Nav Builder, nav_page_roles table, nav_page table, role table, unit table, user_unit_roles table, users table (identity fields only), page-visibility.html (Pages/Permissions/Deleted admin UI)

### Community 83 - "admin-directory.models.ts"
Cohesion: 0.28
Nodes (7): AdminDirectoryRepository, AdminNavPageGrant, AdminNavPageGrantDraft, AdminRoleDraft, AdminUnitDraft, AdminUserDraft, ADMIN_DIRECTORY_REPOSITORY

### Community 85 - "ClubRosterModalComponent"
Cohesion: 0.24
Nodes (3): ClubMemberRecord, ClubRosterModalComponent, Component

### Community 86 - "payment-proof-upload.service.ts"
Cohesion: 0.27
Nodes (8): ApiPaymentProofUploadService, MockPaymentProofUploadService, PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi, PaymentProofUploadRequest, PaymentProofUploadResponse, readAsDataUrl(), Injectable

### Community 89 - "RBAC Design Notes"
Cohesion: 0.20
Nodes (10): nav-tree.service.js, role-eligibility.service.js, role-navigation.ts navTreeFor replacement, user-access.service.js, app.html (root shell template), app-ai-assistant component usage, app-toast-host component usage, internal-layout.html (app shell with sidebar/nav) (+2 more)

### Community 90 - "Unit Role Migration Notes"
Cohesion: 0.29
Nodes (8): Fully data-driven RBAC rationale, Unit + Level RBAC Migration Prompt, applicant role deletion rationale, generic staff role deletion rationale, migrate-unit-level-roles.js migration script, users.role generic level marker compatibility field, School unit-kind warning note, Unit + Level identity model

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
Cohesion: 0.38
Nodes (3): FlatDepartmentWorkflowConfig, UnitDepartmentWorkflowConfig, RequestOptionKind

### Community 101 - "HubMyClubsComponent"
Cohesion: 0.11
Nodes (3): HubMyClubsComponent, Component, HostListener

### Community 104 - "Proposal Form Template"
Cohesion: 0.40
Nodes (5): event-proposal.html (6-step proposal form), Logistics quantity availability indicator, Required for Event requirements checklist (step 3), Live Review Summary / proposal preview, app-step-indicator component usage

### Community 106 - "Header & View Templates"
Cohesion: 0.33
Nodes (6): app-cta-link (header usage), Site Header Template, Calendar Month/Week/Agenda View Modes, Explore Events Public/Internal Variant Pattern, My Events publicLayout Toggle, External User Restricted Navigation

### Community 110 - "proposal-review-page.spec.ts"
Cohesion: 0.18
Nodes (5): PROPOSAL_REVIEW_RECORDS, ProposalReviewPageComponent, activatedRouteStub(), configureWithRoute(), Component

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

### Community 148 - "ai-access-log.service.ts"
Cohesion: 0.29
Nodes (4): AiAccessDenial, AiAccessDenialPage, AiAccessLogService, Injectable

### Community 149 - "auth.service.ts"
Cohesion: 0.06
Nodes (22): dropdownSettingRoutes, placeholderPage(), AuthService, ChangePasswordResult, LoginResult, MessageResponse, PasswordResetConfirmResult, Injectable (+14 more)

### Community 152 - "hub-proposals.ts"
Cohesion: 0.09
Nodes (15): ProposalDepartmentRequest, DEPARTMENT_LABELS, DepartmentRequestBucket, DepartmentRequestListItem, DepartmentRequestListQuery, DepartmentRequestOrder, DepartmentRequestSortKey, FmbSelectionEdit (+7 more)

### Community 154 - "Admin Page Design Notes"
Cohesion: 0.33
Nodes (6): Soft-delete with 7-day auto-purge, Unit Code auto-derived read-only field, admin-directory.html (Users/Units admin page), app-delete-confirm-dialog usage, Deleted tab (archived users/units), derivedUnitCode() read-only unit code field

### Community 155 - "purge-sweep.service.ts"
Cohesion: 0.33
Nodes (4): PurgeSweepEntityResult, PurgeSweepResult, PurgeSweepService, Injectable

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

### Community 171 - "CafeteriaService"
Cohesion: 0.20
Nodes (4): Cafeteria, CafeteriaAssignment, CafeteriaService, Injectable

### Community 172 - "event-catalog.service.ts"
Cohesion: 0.17
Nodes (10): ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogResource, EventCategoryService, EventFormatService, Injectable, CategoriesTabComponent, Component (+2 more)

### Community 173 - "SavedEventsService"
Cohesion: 0.19
Nodes (5): NotificationPreference, SavedEventMutationResponse, SavedEventsApi, SavedEventsService, Injectable

### Community 174 - "request-option.service.spec.ts"
Cohesion: 0.15
Nodes (14): flattenRoutes(), roleCanAccess(), optionKindsForManager(), canManageRequestOptions(), managerOptionKinds(), avManager, cafeteriaManagerUser, cfoUser (+6 more)

### Community 176 - "system-config.service.ts"
Cohesion: 0.31
Nodes (5): SystemConfig, SystemConfigDraft, DEFAULT_CONFIG, SystemConfigService, Injectable

### Community 179 - "cafeteria.service.ts"
Cohesion: 0.17
Nodes (12): CafeteriaStaffAuditAction, CafeteriaStaffAuditActorRole, CafeteriaStaffAuditEntry, CafeteriaStaffAuditQuery, CafeteriaStaffAuditSortKey, Page, SortOrder, AssignableCafeteriaUser (+4 more)

### Community 182 - "internal-user-directory.service.ts"
Cohesion: 0.50
Nodes (4): AuthUserRole, InternalDirectoryUser, InternalUserDirectoryService, Injectable

### Community 186 - "AiOrbAwarenessService"
Cohesion: 0.40
Nodes (3): AiAwarenessEvent, AiOrbAwarenessService, Injectable

## Ambiguous Edges - Review These
- `Fully data-driven RBAC rationale` → `Unit + Level identity model`  [AMBIGUOUS]
  docs/system-logic/rbac-unit-level-migration-prompt.md · relation: conceptually_related_to
- `app-internal-table-workspace Component` → `Shared Library Catalog Page Template`  [AMBIGUOUS]
  src/app/features/shared-library/shared-library.html · relation: references

## Knowledge Gaps
- **339 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+334 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **73 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Fully data-driven RBAC rationale` and `Unit + Level identity model`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `app-internal-table-workspace Component` and `Shared Library Catalog Page Template`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `EventProposalComponent` connect `EventProposalComponent` to `.navigateToTableError`, `.logisticsExceedsRemaining`, `Proposal Step Navigation`, `proposal-department-view.ts`, `environment.ts`, `EditableTableColumn`, `event-proposal.ts`, `Proposal Submit Actions`, `EditableRow`, `DepartmentResubmitComponent`, `OptionPickerItem`, `SelectOption`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `apiErrorMessage()` connect `apiErrorMessage` to `CafeteriaStaffTasksComponent`, `StaffTasksComponent`, `role-access.ts`, `RequestOptionManagementComponent`, `internal-data-page.models.ts`, `Users & Units Admin`, `PageVisibilityComponent`, `EventCatalogSectionComponent`, `RolesComponent`, `auth.service.ts`, `Deleted Items Admin`, `event-proposal.ts`, `Proposal Submit Actions`, `Policies Config Tab`, `ClubCategoryManagementComponent`, `proposal-department-view.ts`, `CafeteriaManageComponent`, `InternalLayoutComponent`, `ClubManagementComponent`, `request-option-management.ts`, `ProposalDepartmentViewComponent`, `CafeteriaStaffAssignmentsComponent`, `PresidentChangeRequestModalComponent`, `DepartmentResubmitComponent`, `RecordsPageComponent`, `ProposalReviewerViewComponent`, `SelectOption`, `HubPresidentChangeRequestsComponent`, `page-visibility.ts`, `ClubRosterModalComponent`, `Page Visibility Grants`, `CafeteriaMyStaffComponent`, `HubRegistrationsComponent`, `AiAccessLogComponent`, `Page Visibility Restore`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `InternalRowActionEvent` connect `apiErrorMessage` to `internal-data-page.ts`, `CafeteriaStaffTasksComponent`, `StaffTasksComponent`, `RequestOptionManagementComponent`, `internal-data-page.models.ts`, `EventCatalogSectionComponent`, `RolesComponent`, `auth.service.ts`, `hub-proposals.ts`, `ClubCategoryManagementComponent`, `CafeteriaManageComponent`, `ClubManagementComponent`, `Assignment Row Actions`, `Nav Page Purge Actions`, `request-option-management.ts`, `CafeteriaStaffAssignmentsComponent`, `SharedLibraryComponent`, `HubClubRequestsComponent`, `RecordsPageComponent`, `HubPresidentChangeRequestsComponent`, `page-visibility.ts`, `HubHistoryClubsComponent`, `Club Discover Page`, `HubProposalsComponent`, `HubHistoryEventsComponent`, `Page Visibility Grants`, `CafeteriaMyStaffComponent`, `HubMyClubsComponent`, `HubRegistrationsComponent`, `HubOngoingClubsComponent`, `Admin Directory Actions`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _339 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `auth.interceptor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06448202959830866 - nodes in this community are weakly interconnected._