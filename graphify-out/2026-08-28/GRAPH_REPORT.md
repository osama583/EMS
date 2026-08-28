# Graph Report - FYP - UI  (2026-08-27)

## Corpus Check
- 360 files · ~742,823 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5082 nodes · 12302 edges · 221 communities (171 shown, 50 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 190 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c55cfd47`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin.py
- FormModalComponent
- AuthService
- events.py
- ask
- apiErrorMessage
- clubs.py
- BadRequest
- WorkflowError
- event-proposal.ts
- ClubService
- transaction
- ProposalReviewRecord
- require_internal
- AdminDirectoryComponent
- shared-library.ts
- test_workflow_e2e.py
- options.py
- CafeteriaService
- EventProposalComponent
- services/proposals.py
- query
- EventCatalogSectionComponent
- ApiAdminDirectoryRepository
- db.py
- fyp-ui
- DepartmentRequestKind
- dependencies
- app/__init__.py
- cafeteria_retrieval.py
- notifications.py
- AdminDirectoryService
- ProposalDepartmentViewComponent
- ClubCategoryManagementComponent
- RequestOptionManagementComponent
- RolesComponent
- catalog.py
- Phase 2: Angular Frontend Refactor
- EventCalendarComponent
- ClubManagementComponent
- PageVisibilityComponent
- environment.ts
- CafeteriaManageComponent
- CafeteriaStaffAssignmentsComponent
- identity.py
- fetch_all
- HappeningSoonComponent
- SiteHeaderComponent
- seed/run.py
- test_api_e2e.py
- seed_events.py
- sync.py
- HeroComponent
- fetch_one
- logging_setup.py
- ExploreEventsComponent
- ai-assistant.ts
- LoginComponent
- EditableTableColumn
- HubRequestsComponent
- TokenStore
- CafeteriaMyStaffComponent
- StaffTasksComponent
- DeletionPreview
- Implementation Prompt: Unit + Level RBAC Migration
- InternalLayoutComponent
- CafeteriaStaffTasksComponent
- hub-proposals.ts
- AiAssistantComponent
- HubMyClubsComponent
- request-option.repository.ts
- staff-task.repository.ts
- ForgotPasswordModalComponent
- proposal_retrieval.py
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- 4. Analytics & visualisation
- event-image-upload.service.ts
- HowItWorksComponent
- landing-page.ts
- Head of Department — A/V Services
- Proposal list pages: server-side bucketing, pagination, sorting
- 4. Angular Frontend Changes
- RequestOption
- DepartmentResubmitComponent
- GuestRegistrationModalComponent
- Dashboard architecture
- api/__init__.py
- 2. Query-parameter contract
- HubPresidentChangeRequestsComponent
- HubClubRequestsComponent
- HubRegistrationsComponent
- RecordsPageComponent
- ProposalReviewerViewComponent
- SearchableDropdownComponent
- Wireframes, responsive behaviour, and mobile
- RBAC Redesign: Users / Units / Roles / Page Visibility
- auth.interceptor.ts
- event-catalog.service.ts
- StepIndicatorComponent
- query_router.py
- MyEventsTabComponent
- components/explore-events/explore-events.ts
- 4. The rules
- Implementation roadmap
- InternalPaginationComponent
- proposal-review.mock-data.ts
- test_catalog_routes.py
- test_role_capabilities.py
- AdminRoleRecord
- HubHistoryClubsComponent
- HubHistoryEventsComponent
- EventDetailsModalComponent
- config.py
- AiConversationStore
- auth.service.ts
- request-option.models.ts
- EditableRow
- purge-sweep.service.ts
- EventCatalogRepositoryImpl
- .playGesture
- event-calendar.ts
- 1. Proposal / Event-Approval Workflow
- 1. Proposal / Event-Approval Workflow
- ToastService
- CafeteriaMenuOversightComponent
- .navigateToTableError
- gemini.py
- ClubDiscoverComponent
- Database
- The Proposal Workflow
- Family B — SLA & latency (M10–M19)
- Family D — Capacity & utilisation (M30–M39)
- Email Templates
- Login Demo-User Picker Implementation Plan
- payment-proof-upload.service.ts
- AiAccessLogComponent
- subject_scope.py
- internal-placeholder.ts
- APU EMS — Flask API
- Role hierarchy, data access, and access-control rules
- Family F — Cost & finance (M50–M58)
- Family H — Risk & anomaly (M70–M78)
- Email Notification Map
- Global Constraints
- EventCatalogEntry
- system-config.service.ts
- EventCatalogRepository
- admin-directory.models.ts
- TaskCalendarComponent
- Security
- Family A — Flow & throughput (M01–M08)
- Family C — Quality & rework (M20–M27)
- Family E — Demand & forecast (M40–M47)
- Family G — People & productivity (M60–M67)
- Login demo-user picker (searchable, click-to-autofill)
- test_admin_routes.py
- CameraCaptureComponent
- 2. Auth & Accounts
- 3. Clubs
- FypUi
- HubOngoingClubsComponent
- API Design
- Decisions worth explaining
- `/app/dashboard` — Role-Based Analytics Design
- .grantSummaryItems
- errors.py
- RequestOptionKind
- 3. Clubs
- staff-tasks.ts
- cafeteria.service.ts
- hero.ts
- AdminUserAssignment
- NavEntryType
- AiOrbAwarenessService
- 4. Published Events
- ResetPasswordComponent
- club-hub.ts
- APU Event Management System
- API Documentation
- ImageUploadFieldComponent
- .clearMessages
- .handleDeletedAction
- ai-assistant-page.ts
- PopoverComponent
- Metric catalog — the semantic layer
- CLAUDE.md
- derivePageCode
- environment.production.ts
- happening-soon.spec.ts
- topic_access.py
- .onIconFile
- DeadlineReminderService
- department-workflow.config.ts
- OptionPickerItem

## God Nodes (most connected - your core abstractions)
1. `transaction()` - 172 edges
2. `fetch_one()` - 154 edges
3. `current_principal()` - 152 edges
4. `cur()` - 147 edges
5. `EventProposalComponent` - 144 edges
6. `query()` - 140 edges
7. `NotFound` - 108 edges
8. `require_internal()` - 104 edges
9. `ask()` - 91 edges
10. `apiErrorMessage()` - 86 edges

## Surprising Connections (you probably didn't know these)
- `own_event_registrants()` --indirect_call--> `cur()`  [INFERRED]
  backend/app/ai/retrieval.py → backend/tests/test_workflow_e2e.py
- `create_user()` --indirect_call--> `cur()`  [INFERRED]
  backend/app/api/admin.py → backend/tests/test_workflow_e2e.py
- `_apply_user_update()` --indirect_call--> `cur()`  [INFERRED]
  backend/app/api/admin.py → backend/tests/test_workflow_e2e.py
- `user_deletion_check()` --indirect_call--> `cur()`  [INFERRED]
  backend/app/api/admin.py → backend/tests/test_workflow_e2e.py
- `delete_user()` --indirect_call--> `cur()`  [INFERRED]
  backend/app/api/admin.py → backend/tests/test_workflow_e2e.py

## Import Cycles
- None detected.

## Communities (221 total, 50 thin omitted)

### Community 0 - "admin.py"
Cohesion: 0.06
Nodes (95): add_grant(), _apply_nav_page_update(), _apply_role_update(), _apply_unit_update(), _apply_user_update(), _assert_email_free(), _assert_grant_is_legal(), create_assignment() (+87 more)

### Community 1 - "FormModalComponent"
Cohesion: 0.23
Nodes (3): FormModalComponent, Component, HostListener

### Community 2 - "AuthService"
Cohesion: 0.15
Nodes (5): AuthService, Injectable, LogoutComponent, Component, Stage

### Community 3 - "events.py"
Cohesion: 0.08
Nodes (55): calendar_events(), cancel_registration(), decided_registrations(), _decorate(), _event_select(), get_event(), get_reminders(), _guest_user_id() (+47 more)

### Community 4 - "ask"
Cohesion: 0.08
Nodes (42): ai_denials_document(), person_lookup_document(), Every role that actually exists in the `role` table - the live data behind…, Every operational unit/department - the live data behind /app/units, a System-…, CONTEXT block for an admin_settings question naming ONE specific person by…, Has the AI ASSISTANT ITSELF refused to answer any question, and why - the live…, roles_document(), units_document() (+34 more)

### Community 5 - "apiErrorMessage"
Cohesion: 0.07
Nodes (83): dropdownSettingRoutes, PresidentChangeRequestSortKey, AdminEntity, AdminTab, AssignmentRow, UserAssignmentGroup, CafeteriaManageTab, ROLE_CODE (+75 more)

### Community 6 - "clubs.py"
Cohesion: 0.06
Nodes (68): reindex_club_async(), remove_club_async(), _apply_club_update(), approve_join_request(), approve_president_change(), _assert_club_admin(), _category_blockers(), category_deletion_check() (+60 more)

### Community 7 - "BadRequest"
Cohesion: 0.09
Nodes (50): change_own_password(), confirm_password_reset(), _dev_user_rows(), dev_users(), _generate_otp(), internal_users(), _json_body(), login() (+42 more)

### Community 8 - "WorkflowError"
Cohesion: 0.07
Nodes (67): Fire-and-forget re-index, off the request thread that just committed the…, reindex_event_async(), on_commit(), Registers a zero-arg callback to run after the enclosing transaction() commits…, A business-rule violation in the proposal state machine. Defaults to 409: the…, WorkflowError, authorize_department_task(), is_cafeteria_manager_of() (+59 more)

### Community 9 - "event-proposal.ts"
Cohesion: 0.04
Nodes (61): AuthUserRole, buildDepartmentRequestDefinitions(), DepartmentRequestDefinition, fillDanglingHalves(), optionKindForDepartmentField(), resolveDepartmentRowLabels(), selectOptionOf(), selectOptionsOf() (+53 more)

### Community 10 - "ClubService"
Cohesion: 0.05
Nodes (27): ClubCategoryPage, ClubCategoryRecord, ClubDraft, ClubJoinRequestRecord, ClubJoinRequestStatus, ClubMemberRecord, ClubMyStatus, ClubPage (+19 more)

### Community 11 - "transaction"
Cohesion: 0.07
Nodes (73): create_catalogue_entry(), post, `code` is derived from the name server-side and immutable thereafter, so it…, restore_catalogue_entry(), update_catalogue_entry(), Only the club's own President may submit this, naming an eligible (student)…, request_president_change(), request_to_join() (+65 more)

### Community 12 - "ProposalReviewRecord"
Cohesion: 0.04
Nodes (21): ProposalDepartmentRequest, ProposalReviewRecord, ApiProposalWorkflowRepository, DepartmentRequestBucket, DepartmentRequestListItem, DepartmentRequestListQuery, DepartmentRequestOrder, DepartmentRequestSortKey (+13 more)

### Community 13 - "require_internal"
Cohesion: 0.06
Nodes (79): _actor_role(), _apply_cafeteria_update(), _apply_user_detail_changes(), _assert_assignable(), _assert_cafeteria_admin(), _assert_may_staff(), assignable_users(), _assignment_blockers() (+71 more)

### Community 15 - "shared-library.ts"
Cohesion: 0.06
Nodes (20): ArchivedRequestOption, ManagerField, PoliciesTabComponent, Component, LibraryCategory, LibraryEntry, SharedLibraryComponent, Component (+12 more)

### Community 16 - "test_workflow_e2e.py"
Cohesion: 0.06
Nodes (72): _issue(), issue_access_token(), issue_refresh_token(), JWT issue and verification. Two token types share one secret but are separated…, Wiring tests that need no database. They assert the security envelope:…, The `typ` claim is what stops a long-lived refresh token authenticating…, test_access_token_cannot_be_used_to_refresh(), test_refresh_token_cannot_be_used_as_an_access_token() (+64 more)

### Community 17 - "options.py"
Cohesion: 0.08
Nodes (55): reindex_menu_item_async(), _apply_update(), _assert_may_write(), _assert_required_present(), Catalogue, Collection, _columns(), create_option() (+47 more)

### Community 18 - "CafeteriaService"
Cohesion: 0.18
Nodes (5): Cafeteria, CafeteriaAssignment, CafeteriaDraft, CafeteriaService, Injectable

### Community 20 - "services/proposals.py"
Cohesion: 0.08
Nodes (50): _as_decimal(), _as_int(), clear_children(), create(), delete_draft(), _department_confirmations(), _event_image_asset(), _event_image_url() (+42 more)

### Community 21 - "query"
Cohesion: 0.08
Nodes (39): active_category_names(), admin_president_replacements(), club_category_stats(), eligible_clubs_for(), find_user_by_name_fuzzy(), inactive_clubs(), inbound_join_requests_from(), own_join_requests() (+31 more)

### Community 23 - "ApiAdminDirectoryRepository"
Cohesion: 0.10
Nodes (6): AdminNavPageRecord, AdminUnitRecord, AdminUserRecord, Archived, ApiAdminDirectoryRepository, Injectable

### Community 24 - "db.py"
Cohesion: 0.06
Nodes (59): Fire-and-forget removal — same freshness model as reindex_event_async()., remove_event_async(), PostgreSQL access: a threaded connection pool plus small query helpers. Every…, Principal, The authenticated actor, resolved from the database on every request. Roles…, assert_proposal_owner(), authorize_cancel(), authorize_stage_action() (+51 more)

### Community 25 - "fyp-ui"
Cohesion: 0.05
Nodes (44): build, serve, test, builder, configurations, defaultConfiguration, options, cli (+36 more)

### Community 26 - "DepartmentRequestKind"
Cohesion: 0.09
Nodes (19): DepartmentRequestKind, requiresSameDayStart(), AssignableStaff, MyRowAssignment, MyRowAssignmentQuery, MyRowAssignmentSortKey, Page, RowAssignment (+11 more)

### Community 27 - "dependencies"
Cohesion: 0.05
Nodes (43): @angular/build, @angular/cli, @angular/common, @angular/compiler, @angular/compiler-cli, @angular/core, @angular/forms, @angular/platform-browser (+35 more)

### Community 28 - "app/__init__.py"
Cohesion: 0.11
Nodes (26): close_ai_pool(), get_ai_connection(), init_ai_pool(), connection, Connection pool for the AI/vector-index Postgres — a second, separate database…, close_pool(), health_check(), Flask (+18 more)

### Community 29 - "cafeteria_retrieval.py"
Cohesion: 0.07
Nodes (41): cafeteria_by_name(), cafeteria_names_fuzzy(), _cafeteria_scope_clause(), cafeterias_managed_by(), halal_menu_items(), is_cafeteria_admin(), is_food_authority(), managed_cafeterias() (+33 more)

### Community 30 - "notifications.py"
Cohesion: 0.09
Nodes (47): Low-level SMTP send (e.g. Gmail). Nothing else in this codebase should import…, Send one email over SMTP. Returns True if the server accepted it. Never raises:…, send(), account_created_with_password(), cafeteria_order_awaiting_review(), cafeteria_staff_account_created(), department_task_awaiting_review(), department_task_sent_back() (+39 more)

### Community 32 - "ProposalDepartmentViewComponent"
Cohesion: 0.08
Nodes (3): FmbSelection, ProposalDepartmentViewComponent, Component

### Community 35 - "RolesComponent"
Cohesion: 0.08
Nodes (4): deriveRoleCode(), restoreLabelFor(), RolesComponent, Component

### Community 36 - "catalog.py"
Cohesion: 0.11
Nodes (28): _Catalogue, catalogue_deletion_check(), _config_payload(), _entry(), event_categories(), event_formats(), get_config(), list_catalogue() (+20 more)

### Community 37 - "Phase 2: Angular Frontend Refactor"
Cohesion: 0.05
Nodes (38): EMS Schema Alignment + Mock Backend Implementation Plan, Global Constraints, Phase 1: Source-of-Truth Corrections, Phase 2: Angular Frontend Refactor, Phase 2b: Extend Auth, Events, Saved Events, System Config, and Image Upload to REST, Phase 3: Express Mock Backend, Phase 4: Wire the Dev-Server Proxy and Verify End-to-End, Task 1.1: Correct `ems_database_schema.sql` — roles, F&B rename, water/campus-tour restructuring, new status columns (+30 more)

### Community 38 - "EventCalendarComponent"
Cohesion: 0.08
Nodes (3): EventCalendarComponent, Component, HostListener

### Community 41 - "environment.ts"
Cohesion: 0.05
Nodes (49): SEED_UNITS, SEED_USERS, AiAccessDenial, AiAccessDenialPage, AiAccessLogService, Injectable, AiAssistantAnswer, AiAssistantHistoryTurn (+41 more)

### Community 42 - "CafeteriaManageComponent"
Cohesion: 0.09
Nodes (3): CafeteriaManageComponent, restoreLabelFor(), Component

### Community 44 - "identity.py"
Cohesion: 0.09
Nodes (33): category_format_status_document(), config_document(), find_users_by_partial_name(), page_visibility_document(), System-Admin-only live facts: config thresholds, user/role headcounts, and…, Every active user and every role/unit they hold - the live data behind…, Every active user whose full name CONTAINS `name` (case-insensitive) - a first-…, Every nav page and which roles/units currently grant access to it - the live… (+25 more)

### Community 45 - "fetch_all"
Cohesion: 0.05
Nodes (81): _cafeteria_manager_order_rows(), cancel(), cancellation_window(), create_proposal(), _department_task_rows(), _flatten_requests_for_task(), _fmb_orders(), get_history() (+73 more)

### Community 46 - "HappeningSoonComponent"
Cohesion: 0.11
Nodes (3): ProposalEventSchedule, HappeningSoonComponent, Component

### Community 47 - "SiteHeaderComponent"
Cohesion: 0.17
Nodes (4): SiteHeaderComponent, Component, HostListener, ViewChild

### Community 48 - "seed/run.py"
Cohesion: 0.10
Nodes (28): Seed data definitions - system data only, no proposals or submissions.…, cafeteria_manager_grant(), grants_for(), nav_catalogue(), The sidebar catalogue and its permission grants. nav_page rows describe WHAT…, Split a role list into the grant rows that express it exactly. Returns…, Scoped to real cafeteria units only - never every unit, which would put a…, _icon() (+20 more)

### Community 49 - "test_api_e2e.py"
Cohesion: 0.12
Nodes (29): auth(), cleanup(), client(), payload(), fixture, HTTP-level tests: the API as a client actually uses it. These commit real rows,…, Picker data must not be fetched through the admin-only user API., The mock returned every proposal to everyone. An unrelated student must not see… (+21 more)

### Community 50 - "seed_events.py"
Cohesion: 0.15
Nodes (41): approve_all_department_tasks(), create_proposal(), days_out(), main(), make_payload(), placeholder_image(), principal_for(), Seed realistic event/proposal data by driving the real workflow state machine.… (+33 more)

### Community 51 - "sync.py"
Cohesion: 0.15
Nodes (22): ai_transaction(), cursor, One-off initial load: embeds every currently-published event into the AI…, run(), embed_text(), _club_to_document(), _menu_item_to_document(), Keeps event_embeddings (the AI database) up to date with `request` (the primary… (+14 more)

### Community 52 - "HeroComponent"
Cohesion: 0.32
Nodes (3): HeroComponent, Component, ViewChild

### Community 53 - "fetch_one"
Cohesion: 0.06
Nodes (68): clear_ai_access_denials(), delete_nav_page(), delete_role(), delete_unit(), purge_nav_page(), purge_role(), purge_unit(), purge_user() (+60 more)

### Community 54 - "logging_setup.py"
Cohesion: 0.17
Nodes (20): get_connection(), init_pool(), connection, configure_logging(), ConsoleFormatter, ContextFilter, _extras(), JsonFormatter (+12 more)

### Community 55 - "ExploreEventsComponent"
Cohesion: 0.09
Nodes (6): EventSearchParams, InternalExploreEventsComponent, Component, ExploreEventsComponent, Component, HostListener

### Community 56 - "ai-assistant.ts"
Cohesion: 0.11
Nodes (18): AiAssistantClub, AiAssistantProposal, AiAssistantRegistrantsTable, AiAssistantService, AiAssistantSource, Injectable, AiChatMessage, AiConversation (+10 more)

### Community 57 - "LoginComponent"
Cohesion: 0.18
Nodes (3): LoginComponent, Component, ViewChild

### Community 58 - "EditableTableColumn"
Cohesion: 0.10
Nodes (5): RequestDefinition, DataTableComponent, Component, EditableTableColumn, FormControlType

### Community 62 - "StaffTasksComponent"
Cohesion: 0.11
Nodes (3): StaffTasksComponent, Component, HostListener

### Community 64 - "Implementation Prompt: Unit + Level RBAC Migration"
Cohesion: 0.08
Nodes (25): Admin UI changes (System Admin pages), Backend changes, Explicitly out of scope for this change, F&B specifically, Final data model, Frontend changes, `fyp-ui/server/db.js`, `fyp-ui/server/routes/admin.routes.js` (+17 more)

### Community 65 - "InternalLayoutComponent"
Cohesion: 0.13
Nodes (3): InternalLayoutComponent, Component, HostListener

### Community 66 - "CafeteriaStaffTasksComponent"
Cohesion: 0.07
Nodes (13): CafeteriaOrder, CafeteriaOrderQuery, CafeteriaOrderSortKey, CafeteriaOrderStatus, Page, SortOrder, CafeteriaOrderService, RawCafeteriaOrder (+5 more)

### Community 67 - "hub-proposals.ts"
Cohesion: 0.06
Nodes (54): authGuard(), defaultRoleRouteGuard(), externalUserGuard(), loginGuard(), publicLandingGuard(), recordsHubDefaultTabGuard(), roleGuard(), departmentFor() (+46 more)

### Community 68 - "AiAssistantComponent"
Cohesion: 0.08
Nodes (5): AiAssistantComponent, isAssistantUrl(), newMessageId(), Component, HostListener

### Community 69 - "HubMyClubsComponent"
Cohesion: 0.11
Nodes (3): HubMyClubsComponent, Component, HostListener

### Community 70 - "request-option.repository.ts"
Cohesion: 0.17
Nodes (10): mapRequestOptionResponse(), mapRequestOptionWrite(), RequestOptionDto, RequestOptionWriteDto, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository, ApiRequestOptionRepository (+2 more)

### Community 71 - "staff-task.repository.ts"
Cohesion: 0.19
Nodes (10): StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus, ApiStaffTaskRepository, STAFF_TASK_REPOSITORY, Injectable (+2 more)

### Community 72 - "ForgotPasswordModalComponent"
Cohesion: 0.17
Nodes (5): ProfileComponent, Component, ViewChild, ForgotPasswordModalComponent, Component

### Community 73 - "proposal_retrieval.py"
Cohesion: 0.13
Nodes (20): asker_profile_document(), bucket_for_status(), own_proposals(), proposal_by_title(), proposal_cards(), proposal_detail(), proposal_detail_to_document(), proposal_history() (+12 more)

### Community 74 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of Department — Food & Beverage Services (+13 more)

### Community 75 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of Department — Logistics and Facilities (+13 more)

### Community 76 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of Department — Photography Services (+13 more)

### Community 77 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of Department — Student Services (+13 more)

### Community 78 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of Department — Transport Services (+13 more)

### Community 79 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of School — School of Computing (+13 more)

### Community 80 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of School — School of Business (+13 more)

### Community 81 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, CFO — Executive Dashboard (+13 more)

### Community 82 - "4. Analytics & visualisation"
Cohesion: 0.10
Nodes (21): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Cafeteria Manager — Operations Dashboard (+13 more)

### Community 83 - "event-image-upload.service.ts"
Cohesion: 0.16
Nodes (11): ApiEventImageUploadService, EVENT_IMAGE_UPLOAD_API, EventImageUploadApi, EventImageUploadRequest, EventImageUploadResponse, MockEventImageUploadService, readAsDataUrl(), Injectable (+3 more)

### Community 84 - "HowItWorksComponent"
Cohesion: 0.18
Nodes (8): HowItWorksComponent, ProcessPathMarker, ProcessPathPoint, ProcessPathPosition, ProcessStep, Component, HostListener, ViewChild

### Community 85 - "landing-page.ts"
Cohesion: 0.14
Nodes (13): CampusLifeComponent, CampusLifePillar, Component, LandingPageComponent, Component, MyEventsComponent, Component, FooterAward (+5 more)

### Community 86 - "Head of Department — A/V Services"
Cohesion: 0.10
Nodes (20): 1. Dashboard objective, 2. Data access scope, 3. KPIs, 4. Analytics & visualisation, 5. AI & decision-support insights, 6. Layout, 7. Navigation & drill-down, Head of Department — A/V Services (+12 more)

### Community 87 - "Proposal list pages: server-side bucketing, pagination, sorting"
Cohesion: 0.10
Nodes (18): A second pattern: "give me everyone" endpoints that were never actually scoped, Concrete rules that fell out of this, How to verify a fix in this codebase (the pattern that kept working), Proposal API: recurring bug patterns and how to work this codebase, The one root pattern behind almost every bug so far, The same bug, found a second time in the sibling picker, The same report also carried a caching bug, not a scoping bug, What NOT to do (+10 more)

### Community 88 - "4. Angular Frontend Changes"
Cohesion: 0.10
Nodes (19): 1. Purpose, 2. Source-of-Truth Corrections, 3. Corrected Workflow State Machine, 4. Angular Frontend Changes, 5. Mock Backend Server, 6. Out of Scope, Behavior, Component-level updates (+11 more)

### Community 89 - "RequestOption"
Cohesion: 0.20
Nodes (3): RequestOption, RequestOptionService, Injectable

### Community 92 - "Dashboard architecture"
Cohesion: 0.11
Nodes (19): 10. States, 11. Testing, 1. Shape of the thing, 2. API surface, 3. Role resolution, 4. Response contract, 5. Chart runtime, 6. Palette (+11 more)

### Community 94 - "api/__init__.py"
Cohesion: 0.16
Nodes (12): Blueprint registry. One module per resource family, all mounted under /api/v1., _looks_like_image(), get, limit, post, Image uploads. POST /uploads accept a base64 data URL, return a stable URL GET…, Serve a stored image. The key is matched against a strict pattern before…, Accept a base64 data URL and return {storageKey, url}. (+4 more)

### Community 96 - "2. Query-parameter contract"
Cohesion: 0.11
Nodes (18): 1. Principles, 2.1 What the API already accepts, 2.2 What the frontend already accepts, 2.3 The full parameter inventory, 2.4 Frontend work list, 2.5 Backend work list, 2. Query-parameter contract, 3. Complete drill map (+10 more)

### Community 97 - "HubPresidentChangeRequestsComponent"
Cohesion: 0.14
Nodes (3): PresidentChangeRequestRecord, HubPresidentChangeRequestsComponent, Component

### Community 102 - "SearchableDropdownComponent"
Cohesion: 0.18
Nodes (3): SearchableDropdownComponent, Component, HostListener

### Community 103 - "Wireframes, responsive behaviour, and mobile"
Cohesion: 0.12
Nodes (17): 1. Component anatomy, 2. The grid, 3. Breakpoints, 4.1 Per-role mobile priority, 4.2 Charts on a phone, 4.3 Offline and slow connections, 4. Mobile, 5. Accessibility (+9 more)

### Community 104 - "RBAC Redesign: Users / Units / Roles / Page Visibility"
Cohesion: 0.12
Nodes (16): Backend Services, Data Model, Deletion rules, Explicitly Out of Scope, Final Decisions (from conversation), Frontend, Known Uncertainty (flagged for user review), Migration of Seed Data (+8 more)

### Community 105 - "auth.interceptor.ts"
Cohesion: 0.18
Nodes (11): App, appConfig, routes, Component, ANONYMOUS_PATHS, authInterceptor(), isAnonymous(), isApiRequest() (+3 more)

### Community 106 - "event-catalog.service.ts"
Cohesion: 0.17
Nodes (10): ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogResource, EventCategoryService, EventFormatService, Injectable, CategoriesTabComponent, Component (+2 more)

### Community 107 - "StepIndicatorComponent"
Cohesion: 0.18
Nodes (4): StepIndicatorComponent, StepStatus, Component, WizardStep

### Community 108 - "query_router.py"
Cohesion: 0.19
Nodes (15): Best-effort role_code for a role NAMED in a question ('what can Club Admin…, resolve_role_name(), classify(), _fuzzy_classify(), how_to_topic(), _matched_weakly(), named_role(), needs_llm_verification() (+7 more)

### Community 110 - "components/explore-events/explore-events.ts"
Cohesion: 0.05
Nodes (35): EventRegistrationApi, RegisteredEventEntry, RegisteredEventsResponse, SavedEventRecord, EventFavouriteService, Injectable, EVENT_FIELD_MAPPING, EventRegistration (+27 more)

### Community 111 - "4. The rules"
Cohesion: 0.12
Nodes (16): 1. What "AI" means here, and what it does not, 2. Rule anatomy, 3. Severity and ranking, 4. The rules, 5. Role coverage, 6. Optional narration layer, 7. Feedback and suppression, AI & decision-support insight engine (+8 more)

### Community 112 - "Implementation roadmap"
Cohesion: 0.12
Nodes (16): Definition of done, File structure, Global constraints, Implementation roadmap, Out of scope, Phase 0 · Prerequisites, Phase 1 · Backend skeleton, Phase 2 · Metric layer (+8 more)

### Community 113 - "InternalPaginationComponent"
Cohesion: 0.25
Nodes (3): InternalPaginationComponent, InternalTableWorkspaceComponent, Component

### Community 114 - "proposal-review.mock-data.ts"
Cohesion: 0.17
Nodes (15): AGENDA, coOwnersFor(), DISCUSSIONS, GUESTS, IMPORTANT_PEOPLE, organizersFor(), proposal(), proposalForTitle() (+7 more)

### Community 115 - "test_catalog_routes.py"
Cohesion: 0.15
Nodes (13): client(), fixture, parametrize, Routing and guard tests for the event category/format catalogues. No database:…, Every operation event-catalog.repository.ts calls has a route. The bug this…, Category/format names are reference vocabulary, not private data - the Explore…, A missing token must never reach the handler - an unauthenticated 404 here…, /catalog/config and friends must not be swallowed by /catalog/<resource>.… (+5 more)

### Community 116 - "test_role_capabilities.py"
Cohesion: 0.15
Nodes (17): Static, hand-curated reference content for the AI assistant: what the SYSTEM…, Assembles ONE caller's real capabilities from every role they actually hold -…, self_capability_document(), parametrize, _ROLE_CAPABILITIES must never claim a capability a role does not actually have.…, A unit this role can legally be paired with, or None for a flat role. A unit-…, A typo'd or deleted page_code silently drops the line (has_page_access fails…, The real check: does this role reach the page each of its capability lines is… (+9 more)

### Community 121 - "config.py"
Cohesion: 0.07
Nodes (17): Applies app/ai/migrations/*.sql against AI_DATABASE_URL. Deliberately separate…, _bool(), Config, Configuration, loaded from the environment (never hardcoded). Every secret…, Only the literal "true" enables a flag; unset or anything else is off., rate_limit_key(), Shared extension instances, created here so they can be imported without…, Rate-limit per authenticated user where possible, else per client IP. Keying… (+9 more)

### Community 122 - "AiConversationStore"
Cohesion: 0.22
Nodes (3): AiConversationStore, newId(), Injectable

### Community 123 - "auth.service.ts"
Cohesion: 0.05
Nodes (45): AuthNavigationItem, AuthNavigationSection, AuthNavNode, AuthUser, RoleNavigation, RoleNavigationEntry, UserAccountType, ChangePasswordResult (+37 more)

### Community 124 - "request-option.models.ts"
Cohesion: 0.27
Nodes (13): CampusTourStartOption, CampusTourTypeOption, DietaryInformationOption, FoodRequestOption, FundingMainOption, FundingSubOption, LogisticsRequestOption, MediaRequestOption (+5 more)

### Community 126 - "purge-sweep.service.ts"
Cohesion: 0.33
Nodes (4): PurgeSweepEntityResult, PurgeSweepResult, PurgeSweepService, Injectable

### Community 129 - "event-calendar.ts"
Cohesion: 0.08
Nodes (15): AgendaDay, CalendarDay, CalendarEvent, CalendarView, isoDate(), MOCK_EVENT_FIXTURES, MOCK_PUBLISHED_EVENTS, ExpandableSearchComponent (+7 more)

### Community 130 - "1. Proposal / Event-Approval Workflow"
Cohesion: 0.17
Nodes (12): 1.10 F&B places cafeteria order → cafeteria manager(s), 1.11 Applicant cancels proposal → everyone holding an open task, 1.1 Proposal submitted → first-stage reviewer, 1.2 Reviewer approves → next reviewer, 1.3 Reviewer rejects → applicant, 1.4 Reviewer sends back → applicant, 1.5 Department task created → department head, 1.6 Department task sent back → applicant (+4 more)

### Community 131 - "1. Proposal / Event-Approval Workflow"
Cohesion: 0.17
Nodes (12): 1.10 F&B places cafeteria order → cafeteria manager(s), 1.11 Applicant cancels proposal → everyone holding an open task, 1.1 Proposal submitted → first-stage reviewer, 1.2 Reviewer approves → next reviewer, 1.3 Reviewer rejects → applicant, 1.4 Reviewer sends back → applicant, 1.5 Department task created → department head, 1.6 Department task sent back → applicant (+4 more)

### Community 132 - "ToastService"
Cohesion: 0.23
Nodes (7): Toast, ToastAction, ToastRequest, ToastTone, ToastService, Injectable, TONE_ICON

### Community 136 - "gemini.py"
Cohesion: 0.29
Nodes (9): classify_llm(), _classify_system_instruction(), generate_answer(), _get_client(), _get_groq_client(), Thin wrapper around the Gemini and Groq APIs for the three calls this feature…, Semantic classifier for query_router.classify() - called when the regex pass…, Client (+1 more)

### Community 138 - "Database"
Cohesion: 0.18
Nodes (11): Cafeterias are units, Co-owners are snapshots too, Connection pooling, Constraints worth knowing, Database, Documented deviations, Migrations, `nav_page_grants.grant_id` (migration 003) (+3 more)

### Community 139 - "The Proposal Workflow"
Cohesion: 0.18
Nodes (11): Audit trail, Cancellation, Configuration, Department review, F&B cafeteria orders, Overview, `resume_stage` — the send-back mechanism, Statuses (+3 more)

### Community 140 - "Family B — SLA & latency (M10–M19)"
Cohesion: 0.18
Nodes (11): Family B — SLA & latency (M10–M19), M10 · Decision latency, M11 · Fulfilment cycle time, M12 · Assignment lag, M13 · Execution time, M14 · Stage dwell time (proposal level), M15 · SLA compliance, M16 · Preparation runway (+3 more)

### Community 141 - "Family D — Capacity & utilisation (M30–M39)"
Cohesion: 0.18
Nodes (11): Family D — Capacity & utilisation (M30–M39), M30 · Stock commitment ratio, M31 · Concurrency load, M32 · Seat-fill efficiency — **Transport only**, M33 · Group-split requirement — **Student Services only**, M34 · Service-hour demand, M35 · Staff coverage ratio, M36 · Peak-day concentration (+3 more)

### Community 142 - "Email Templates"
Cohesion: 0.18
Nodes (9): 4.1 Registration submitted, pending approval → organiser + co-owners, 4.2 Registration confirmed → registrant, 4.3 Registration rejected → registrant, 4.4 Event starting soon → registered attendees, 4. Published Events, 5.1 Staff assignment created (new account, inline) → new staff member, 5. Cafeterias, Email Templates (+1 more)

### Community 143 - "Login Demo-User Picker Implementation Plan"
Cohesion: 0.18
Nodes (10): File Structure, Global Constraints, Login Demo-User Picker Implementation Plan, Self-Review Notes, Task 1: Backend config flags, Task 2: Backend `GET /auth/dev-users` endpoint, Task 3: Seed script points at the new flags, Task 4: Frontend `DevUsersService` (+2 more)

### Community 144 - "payment-proof-upload.service.ts"
Cohesion: 0.27
Nodes (8): ApiPaymentProofUploadService, MockPaymentProofUploadService, PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi, PaymentProofUploadRequest, PaymentProofUploadResponse, readAsDataUrl(), Injectable

### Community 147 - "subject_scope.py"
Cohesion: 0.22
Nodes (9): classes_to_drop(), denial_document(), other_person_in_question(), Whose data is this question about - the asker's own, or somebody else's?…, Who this question is about, if not the caller: a resolved person's name, or the…, Every class to remove for a privacy refusal - the self-scoped classes that…, CONTEXT line telling the model to refuse on PRIVACY grounds, not page access.…, The full name of a person OTHER than the caller that this question is about, or… (+1 more)

### Community 148 - "internal-placeholder.ts"
Cohesion: 0.50
Nodes (3): placeholderPage(), InternalPlaceholderComponent, Component

### Community 149 - "APU EMS — Flask API"
Cohesion: 0.20
Nodes (10): API documentation, APU EMS — Flask API, Conventions, Database, Filling `.env`, Layout, Run, Setup (+2 more)

### Community 150 - "Role hierarchy, data access, and access-control rules"
Cohesion: 0.20
Nodes (10): 1. Authority tiers, 2.1 Page visibility — `nav_page_grants`, 2.2 Row visibility — `_VISIBLE_SQL`, 2.3 Three consequences that shape this design, 2. How visibility is actually computed today, 3. Role-to-data access matrix, 4. Access-control rules, 5. Multi-role resolution (+2 more)

### Community 151 - "Family F — Cost & finance (M50–M58)"
Cohesion: 0.20
Nodes (10): Family F — Cost & finance (M50–M58), M50 · Committed food cost, M51 · Funding & purchase commitment, M52 · Budget category concentration, M53 · Event revenue exposure, M54 · Collection rate, M55 · Cost per pax, M56 · Gate coverage (+2 more)

### Community 152 - "Family H — Risk & anomaly (M70–M78)"
Cohesion: 0.20
Nodes (10): Family H — Risk & anomaly (M70–M78), M70 · At-risk tasks, M71 · Capacity breach forecast, M72 · Stalled items, M73 · Single-point-of-failure lanes, M74 · Cancellation-window exposure, M75 · Unpriced ordered items, M76 · Stale catalogue entries (+2 more)

### Community 153 - "Email Notification Map"
Cohesion: 0.20
Nodes (10): 2.1 Guest self-registers → new user (⚠️ requires new OTP flow), 2.2 Admin creates account with a set password → new user, 2.3 Cafeteria manager/admin creates staff account inline → new staff member, 2.4 Password reset requested / completed (⚠️ requires new reset flow — you're building the page + email together), 2.5 Admin changes a user's email → old address (⚠️ requires new masking helper), 2. Auth & Accounts, 5.1 Staff assignment created (new account, inline) → new staff member, 5. Cafeterias (+2 more)

### Community 154 - "Global Constraints"
Cohesion: 0.20
Nodes (9): A/V Services HOD Dashboard Implementation Plan, Global Constraints, Task 1: Backend — dashboard blueprint skeleton with role resolution, Task 2: Backend — hero + KPI metrics for hod_av, Task 3: Backend — chart panels (collision timeline, decision-latency trend, catalogue health), Task 4: Frontend — dashboard service, models, and route wiring, Task 5: Frontend — chart primitives (stat-tile, donut-chart, column-chart, timeline-chart), Task 6: Frontend — DashboardComponent page, responsive layout, and route swap (+1 more)

### Community 156 - "system-config.service.ts"
Cohesion: 0.31
Nodes (5): SystemConfig, SystemConfigDraft, DEFAULT_CONFIG, SystemConfigService, Injectable

### Community 158 - "admin-directory.models.ts"
Cohesion: 0.24
Nodes (8): AdminDirectoryRepository, AdminNavPageDraft, AdminNavPageGrant, AdminNavPageGrantDraft, AdminRoleDraft, AdminUnitDraft, AdminUserDraft, ADMIN_DIRECTORY_REPOSITORY

### Community 160 - "Security"
Cohesion: 0.22
Nodes (9): Auditing, Authentication, Authorisation, Data exposure, Injection, Known gaps, Rate limiting, Security (+1 more)

### Community 161 - "Family A — Flow & throughput (M01–M08)"
Cohesion: 0.22
Nodes (9): Family A — Flow & throughput (M01–M08), M01 · Intake volume, M02 · Clearance rate, M03 · Open backlog, M04 · Backlog age profile, M05 · Throughput, M06 · Work-in-progress, M07 · Stage transit volume (+1 more)

### Community 162 - "Family C — Quality & rework (M20–M27)"
Cohesion: 0.22
Nodes (9): Family C — Quality & rework (M20–M27), M20 · Send-back rate, M21 · Rework loops per proposal, M22 · Rejection rate, M23 · Cancellation rate, M24 · Send-back comment depth, M25 · Order push-back rate (F&B ↔ cafeteria), M26 · First-pass yield (+1 more)

### Community 163 - "Family E — Demand & forecast (M40–M47)"
Cohesion: 0.22
Nodes (9): Family E — Demand & forecast (M40–M47), M40 · Forward demand curve, M41 · Demand forecast (naive seasonal), M42 · Requirement mix, M43 · Pipeline conversion, M44 · Approval throughput by school, M45 · Event calendar density, M46 · Registration conversion (+1 more)

### Community 164 - "Family G — People & productivity (M60–M67)"
Cohesion: 0.22
Nodes (9): Family G — People & productivity (M60–M67), M60 · Assignments per staff, M61 · Workload balance, M62 · Completion rate per staff, M63 · Mean handling time per staff, M64 · Unassigned approved work, M65 · Claim share — **cafeteria**, M66 · Staff churn — **cafeteria** (+1 more)

### Community 165 - "Login demo-user picker (searchable, click-to-autofill)"
Cohesion: 0.22
Nodes (8): Backend, Design, Explicit decision: this is a testing-only feature, Frontend, Login demo-user picker (searchable, click-to-autofill), Out of scope, Problem, Testing

### Community 166 - "test_admin_routes.py"
Cohesion: 0.18
Nodes (11): client(), fixture, parametrize, The admin surface the Angular directory pages actually call. No database: these…, /roles/flat and /roles/archive must not be read as a role code. Werkzeug…, /users/deleted resolves to the bin, not to <int:user_id>, which would 404 on…, rules(), test_admin_routes_reject_anonymous_callers() (+3 more)

### Community 168 - "2. Auth & Accounts"
Cohesion: 0.25
Nodes (8): 2.1a Guest self-registers → welcome, 2.1b Guest self-registers → OTP verification, 2.2 Admin creates account with a set password → new user, 2.3 Cafeteria staff account created inline → new staff member, 2.4a Password reset requested, 2.4b Password reset completed, 2.5 Admin changes a user's email → old address, 2. Auth & Accounts

### Community 169 - "3. Clubs"
Cohesion: 0.25
Nodes (8): 3.1 Club created, president nominated → new president, 3.2a President reassigned → outgoing president, 3.2b President reassigned → incoming president, 3.3 Join request submitted → club president, 3.4 President-change request submitted → club admins, 3.5a President-change approved → outgoing president, 3.5b President-change approved → incoming president, 3. Clubs

### Community 170 - "FypUi"
Cohesion: 0.25
Nodes (7): Additional Resources, Building, Code scaffolding, Development server, FypUi, Running end-to-end tests, Running unit tests

### Community 175 - "API Design"
Cohesion: 0.29
Nodes (7): API Design, Filtering and pagination, Principles, Removed deliberately, Resources, Versioning, What the client no longer has to do

### Community 176 - "Decisions worth explaining"
Cohesion: 0.29
Nodes (7): Decisions worth explaining, Eleven catalogues, one resource, `/me` for "about the caller", One `decision` endpoint, not three sibling verbs, Permissions replaced wholesale, `send-back`, not `resubmit`, Sub-resources for things that are things

### Community 177 - "`/app/dashboard` — Role-Based Analytics Design"
Cohesion: 0.29
Nodes (7): `/app/dashboard` — Role-Based Analytics Design, Four principles the whole design obeys, Reading order, Source of truth, The ten, What this design deliberately excludes, Why ten dashboards and not one

### Community 179 - "errors.py"
Cohesion: 0.28
Nodes (7): ApiError, _payload(), Any, Centralised error handling. Every failure leaves the API as the same JSON…, Base for every deliberate, client-visible failure., ValidationError, Exception

### Community 181 - "RequestOptionKind"
Cohesion: 0.32
Nodes (3): FlatDepartmentWorkflowConfig, UnitDepartmentWorkflowConfig, RequestOptionKind

### Community 182 - "3. Clubs"
Cohesion: 0.33
Nodes (6): 3.1 Club created, president nominated → new president, 3.2 Club Admin reassigns president → old + new president, 3.3 Join request submitted → club president, 3.4 President-change request submitted → club admins, 3.5 President-change approved → outgoing + incoming president, 3. Clubs

### Community 183 - "staff-tasks.ts"
Cohesion: 0.10
Nodes (13): COMMON_END, DEFAULT_PRESENTATION, PageMode, ROLE_PRESENTATION, RolePresentation, InternalRowAction, InternalTableColumn, InternalDataTableComponent (+5 more)

### Community 184 - "cafeteria.service.ts"
Cohesion: 0.08
Nodes (21): CafeteriaStaffAuditAction, CafeteriaStaffAuditActorRole, CafeteriaStaffAuditEntry, CafeteriaStaffAuditQuery, CafeteriaStaffAuditSortKey, Page, SortOrder, AssignableCafeteriaUser (+13 more)

### Community 185 - "hero.ts"
Cohesion: 0.29
Nodes (4): MockIntersectionObserver, CtaLinkArrow, CtaLinkComponent, Component

### Community 188 - "AiOrbAwarenessService"
Cohesion: 0.40
Nodes (3): AiAwarenessEvent, AiOrbAwarenessService, Injectable

### Community 189 - "4. Published Events"
Cohesion: 0.40
Nodes (5): 4.1 Registration submitted, pending approval → organiser + co-owners, 4.2 Registration confirmed → registrant (any registrant, not just guests), 4.3 Registration rejected → registrant, 4.4 Event starting soon → registered attendees (⚠️ requires new scheduler), 4. Published Events

### Community 194 - "APU Event Management System"
Cohesion: 0.40
Nodes (5): APU Event Management System, Architecture, Documentation, Running it, Tests

### Community 195 - "API Documentation"
Cohesion: 0.50
Nodes (4): API Documentation, Conventions, Quick start, Reading the spec

### Community 196 - "ImageUploadFieldComponent"
Cohesion: 0.40
Nodes (3): ImageUploadFieldComponent, Component, ViewChild

### Community 202 - "PopoverComponent"
Cohesion: 0.40
Nodes (3): PopoverComponent, Component, HostListener

### Community 211 - "happening-soon.spec.ts"
Cohesion: 0.67
Nodes (3): inDays(), MOCK_EVENT_FIXTURES, MOCK_PUBLISHED_EVENTS

### Community 213 - "topic_access.py"
Cohesion: 0.24
Nodes (9): askable_topics_document(), denied_topics(), log_denials(), The ONE place that decides whether a caller may ask about a given topic. Every…, The CONTEXT block answering "what can I ask about?" - built live from the same…, May this caller ask about `topic`? True for an ungated topic (not in…, Every classified topic this caller may NOT ask about, in stable order so the…, Record each refused topic in ai_access_denial for the System Admin's audit… (+1 more)

### Community 215 - "DeadlineReminderService"
Cohesion: 0.40
Nodes (3): DeadlineReminderService, ReminderTask, Injectable

### Community 217 - "department-workflow.config.ts"
Cohesion: 0.14
Nodes (15): assignmentRequiredForManager(), FLAT_DEPARTMENT_WORKFLOWS, isFlatRoleCode(), MAX_ASSIGNEES_PER_ROW, optionKindsForManager(), SAME_DAY_START_ONLY, staffUnitCodeForManager(), UNIT_DEPARTMENT_WORKFLOWS (+7 more)

## Knowledge Gaps
- **808 isolated node(s):** `$schema`, `version`, `packageManager`, `newProjectRoot`, `projectType` (+803 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **50 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `EventProposalComponent` connect `EventProposalComponent` to `EditableTableColumn`, `.navigateToTableError`, `event-proposal.ts`, `environment.ts`, `.logisticsExceedsRemaining`, `.requestFieldError`, `shared-library.ts`, `.performSubmit`, `.row`, `OptionPickerItem`, `EditableRow`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `apiErrorMessage()` connect `apiErrorMessage` to `.clearMessages`, `event-proposal.ts`, `ClubService`, `AdminDirectoryComponent`, `shared-library.ts`, `AiAccessLogComponent`, `EventCatalogSectionComponent`, `ProposalDepartmentViewComponent`, `ClubCategoryManagementComponent`, `RequestOptionManagementComponent`, `RolesComponent`, `ClubManagementComponent`, `PageVisibilityComponent`, `CafeteriaManageComponent`, `CafeteriaStaffAssignmentsComponent`, `.performSubmit`, `staff-tasks.ts`, `CafeteriaMyStaffComponent`, `StaffTasksComponent`, `.restorePage`, `InternalLayoutComponent`, `CafeteriaStaffTasksComponent`, `.restore`, `DepartmentResubmitComponent`, `HubPresidentChangeRequestsComponent`, `HubRegistrationsComponent`, `RecordsPageComponent`, `ProposalReviewerViewComponent`, `auth.service.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `RequestOptionManagementComponent` connect `RequestOptionManagementComponent` to `.toCardViewModel`, `apiErrorMessage`, `RequestOptionKind`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 143 inferred relationships involving `cur()` (e.g. with `own_event_registrants()` and `add_grant()`) actually correct?**
  _`cur()` has 143 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `version`, `packageManager` to the rest of the system?**
  _808 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin.py` be split into smaller, more focused modules?**
  _Cohesion score 0.060526315789473685 - nodes in this community are weakly interconnected._
- **Should `events.py` be split into smaller, more focused modules?**
  _Cohesion score 0.07727272727272727 - nodes in this community are weakly interconnected._