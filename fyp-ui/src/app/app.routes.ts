import { Routes } from '@angular/router';
import { authGuard, defaultRoleRouteGuard, externalUserGuard, loginGuard, publicLandingGuard, roleGuard } from './core/auth/auth.guards';

const dropdownSettingRoutes = [
  ['logistics', 'Logistics Items'],
  ['transportation', 'Transportation Types'],
  ['photoVideo', 'Photography Services'],
  ['soundLight', 'Sound & Light'],
  ['dietaryInformation', 'Dietary Information'],
  ['servingUnit', 'Serving Units'],
  ['campusTourStart', 'Campus Tour Starting Points'],
  ['campusTourType', 'Campus Tour Types'],
  ['waterNormal', 'Mineral Water'],
  ['fundingMain', 'Funding Main Items'],
  ['fundingSub', 'Funding Sub-items'],
] as const;

const placeholderPage = () =>
  import('./features/internal/pages/internal-placeholder').then(
    (module) => module.InternalPlaceholderComponent,
  );

export const routes: Routes = [
  {
    path: '',
    canActivate: [publicLandingGuard],
    loadComponent: () =>
      import('./features/landing/landing-page').then((module) => module.LandingPageComponent),
    title: 'APU Events | Discover Campus Life',
  },
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/auth/login/login').then((module) => module.LoginComponent),
    title: 'Sign In | APU Event Management System',
  },
  {
    path: 'my-events',
    canActivate: [externalUserGuard],
    loadComponent: () => import('./features/my-events/my-events').then((module) => module.MyEventsComponent),
    title: 'My Events | APU Events',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'saved' },
      { path: 'saved', loadComponent: () => import('./features/my-events/my-events-tab/my-events-tab').then((module) => module.MyEventsTabComponent), data: { mode: 'saved' } },
      { path: 'registered', loadComponent: () => import('./features/my-events/my-events-tab/my-events-tab').then((module) => module.MyEventsTabComponent), data: { mode: 'registered' } },
      { path: 'history', loadComponent: () => import('./features/my-events/my-events-tab/my-events-tab').then((module) => module.MyEventsTabComponent), data: { mode: 'history' } },
    ],
  },
  { path: 'saved-events', pathMatch: 'full', redirectTo: 'my-events/saved' },
  { path: 'registered-events', pathMatch: 'full', redirectTo: 'my-events/registered' },
  { path: 'reminder-preferences', pathMatch: 'full', redirectTo: 'my-events/saved' },
  {
    path: 'app',
    canActivate: [authGuard],
    canActivateChild: [roleGuard],
    loadComponent: () =>
      import('./features/internal/layout/internal-layout').then(
        (module) => module.InternalLayoutComponent,
      ),
    children: [
      { path: '', pathMatch: 'full', canActivate: [defaultRoleRouteGuard], loadComponent: placeholderPage },
      {
        // Always-allowed (see role-navigation.ts's roleCanAccess) — lands here instead of looping
        // when a user's role(s) have zero nav_page_grants (nothing for a System Admin to have
        // wired into Page Visibility yet, or a brand-new custom role).
        path: 'no-access',
        loadComponent: placeholderPage,
        title: 'No Pages Assigned | APU Events',
        data: {
          eyebrow: 'Access',
          title: 'No pages assigned yet',
          description: 'Your account has a role but no pages have been made visible to it yet. Contact a System Admin to grant access via Page Visibility.',
          icon: 'visibility_off',
        },
      },
      {
        path: 'how-it-works',
        loadComponent: () =>
          import('./features/internal/pages/how-it-works/how-it-works').then(
            (module) => module.HowItWorksComponent,
          ),
        title: 'How It Works | APU Events',
        data: {
          eyebrow: 'Getting started',
          title: 'How It Works',
          description: 'Understand the APU event proposal journey before you begin.',
          icon: 'route',
        },
      },
      {
        path: 'dashboard',
        loadComponent: placeholderPage,
        title: 'Dashboard | APU Events',
        data: {
          eyebrow: 'Overview',
          title: 'Dashboard',
          description: 'Your event activity and important updates will appear here.',
          icon: 'space_dashboard',
        },
      },
      {
        path: 'inbox',
        loadComponent: () => import('./features/internal/pages/records-hub/records-hub').then((module) => module.RecordsHubComponent),
        title: 'Inbox | APU Events',
        data: { bucket: 'inbox' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'proposals' },
          {
            path: 'proposals',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-proposals/hub-proposals').then((module) => module.HubProposalsComponent),
            title: 'Inbox | APU Events',
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/internal/pages/staff-tasks/staff-tasks').then((module) => module.StaffTasksComponent),
            title: 'Inbox | APU Events',
            data: { taskPage: 'active' },
          },
          {
            path: 'requests',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-requests/hub-requests').then((module) => module.HubRequestsComponent),
            title: 'Inbox | APU Events',
          },
          {
            path: 'club-requests',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-club-requests/hub-club-requests').then((module) => module.HubClubRequestsComponent),
            title: 'Club Requests | APU Events',
          },
          {
            path: 'registrations',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-registrations/hub-registrations').then((module) => module.HubRegistrationsComponent),
            title: 'Registrations | APU Events',
          },
        ],
      },
      {
        path: 'ongoing',
        loadComponent: () => import('./features/internal/pages/records-hub/records-hub').then((module) => module.RecordsHubComponent),
        title: 'Ongoing | APU Events',
        data: { bucket: 'ongoing' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'proposals' },
          {
            path: 'proposals',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-proposals/hub-proposals').then((module) => module.HubProposalsComponent),
            title: 'Ongoing | APU Events',
          },
          {
            path: 'requests',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-requests/hub-requests').then((module) => module.HubRequestsComponent),
            title: 'Ongoing | APU Events',
          },
        ],
      },
      {
        path: 'history',
        loadComponent: () => import('./features/internal/pages/records-hub/records-hub').then((module) => module.RecordsHubComponent),
        title: 'History | APU Events',
        data: { bucket: 'history' },
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'proposals' },
          {
            path: 'proposals',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-proposals/hub-proposals').then((module) => module.HubProposalsComponent),
            title: 'History | APU Events',
          },
          {
            path: 'tasks',
            loadComponent: () => import('./features/internal/pages/staff-tasks/staff-tasks').then((module) => module.StaffTasksComponent),
            title: 'History | APU Events',
            data: { taskPage: 'history' },
          },
          {
            path: 'requests',
            loadComponent: () => import('./features/internal/pages/records-hub/hub-requests/hub-requests').then((module) => module.HubRequestsComponent),
            title: 'History | APU Events',
          },
        ],
      },
      {
        path: 'proposals/drafts',
        loadComponent: () =>
          import('./features/internal/pages/records-page/records-page').then(
            (module) => module.RecordsPageComponent,
          ),
        title: 'Draft Proposals | APU Events',
        data: {
          eyebrow: 'My proposals',
          title: 'Drafts',
          description: 'Continue event proposals that have not been submitted.',
          icon: 'draft',
          collectionPage: 'drafts',
        },
      },
      {
        path: 'proposals/review/:id',
        loadComponent: () =>
          import('./features/internal/pages/proposal-review-page/proposal-review-page').then(
            (module) => module.ProposalReviewPageComponent,
          ),
        title: 'Proposal Review | APU Events',
      },
      {
        path: 'forms/event-proposal',
        loadComponent: () =>
          import('./features/internal/pages/event-proposal/event-proposal').then(
            (module) => module.EventProposalComponent,
          ),
        title: 'Event Proposal Form | APU Events',
        data: {
          eyebrow: 'Forms',
          title: 'Event Proposal',
          description: 'The event proposal form will be created in this workspace.',
          icon: 'note_add',
        },
      },
      {
        path: 'events',
        children: [
          {
            path: 'explore-events',
            loadComponent: () => import('./features/internal/pages/explore-events/explore-events').then((module) => module.InternalExploreEventsComponent),
            title: 'Explore Events | APU Events',
          },
          {
            path: 'my-events',
            loadComponent: () => import('./features/my-events/my-events').then((module) => module.MyEventsComponent),
            title: 'My Events | APU Events',
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'saved' },
              { path: 'saved', loadComponent: () => import('./features/my-events/my-events-tab/my-events-tab').then((module) => module.MyEventsTabComponent), data: { mode: 'saved' } },
              { path: 'registered', loadComponent: () => import('./features/my-events/my-events-tab/my-events-tab').then((module) => module.MyEventsTabComponent), data: { mode: 'registered' } },
              { path: 'history', loadComponent: () => import('./features/my-events/my-events-tab/my-events-tab').then((module) => module.MyEventsTabComponent), data: { mode: 'history' } },
            ],
          },
          { path: 'saved-events', pathMatch: 'full', redirectTo: 'my-events/saved' },
        ],
      },
      { path: 'saved-events', pathMatch: 'full', redirectTo: 'events/my-events/saved' },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/internal/pages/profile/profile').then(
            (module) => module.ProfileComponent,
          ),
        title: 'Profile | APU Events',
        data: {
          eyebrow: 'Account',
          title: 'Profile',
          description: 'Your internal user profile will be managed here.',
          icon: 'account_circle',
        },
      },
      {
        path: 'logout',
        loadComponent: () => import('./features/auth/logout/logout').then((module) => module.LogoutComponent),
        title: 'Logout | APU Events',
      },
      {
        path: 'menu',
        loadComponent: () => import('./features/internal/pages/request-option-management/request-option-management').then((module) => module.RequestOptionManagementComponent),
        title: 'My Menu | APU Events',
        data: { optionPage: 'menu' },
      },
      {
        path: 'cafeterias/manage',
        loadComponent: () => import('./features/internal/pages/cafeteria-manage/cafeteria-manage').then((module) => module.CafeteriaManageComponent),
        title: 'Manage Cafeterias | APU Events',
      },
      {
        path: 'cafeterias/staff-requests',
        loadComponent: () => import('./features/internal/pages/cafeteria-staff-requests/cafeteria-staff-requests').then((module) => module.CafeteriaStaffRequestsComponent),
        title: 'Staff Requests | APU Events',
      },
      {
        path: 'cafeterias/staff-requests-history',
        loadComponent: () => import('./features/internal/pages/cafeteria-staff-requests-history/cafeteria-staff-requests-history').then((module) => module.CafeteriaStaffRequestsHistoryComponent),
        title: 'Staff Request History | APU Events',
      },
      {
        path: 'cafeterias/staff-assignments',
        loadComponent: () => import('./features/internal/pages/cafeteria-staff-assignments/cafeteria-staff-assignments').then((module) => module.CafeteriaStaffAssignmentsComponent),
        title: 'Staff Assignments | APU Events',
      },
      {
        path: 'cafeterias/menu-oversight',
        loadComponent: () => import('./features/internal/pages/cafeteria-menu-oversight/cafeteria-menu-oversight').then((module) => module.CafeteriaMenuOversightComponent),
        title: 'Menu Oversight | APU Events',
      },
      {
        path: 'cafeterias/my-staff',
        loadComponent: () => import('./features/internal/pages/cafeteria-my-staff/cafeteria-my-staff').then((module) => module.CafeteriaMyStaffComponent),
        title: 'My Staff | APU Events',
      },
      {
        path: 'cafeterias/my-staff-history',
        loadComponent: () => import('./features/internal/pages/cafeteria-my-staff-history/cafeteria-my-staff-history').then((module) => module.CafeteriaMyStaffHistoryComponent),
        title: 'My Staff History | APU Events',
      },
      ...dropdownSettingRoutes.map(([optionKind, title]) => ({
        path: `dropdown-options/${optionKind}`,
        loadComponent: () => import('./features/internal/pages/request-option-management/request-option-management').then((module) => module.RequestOptionManagementComponent),
        title: `${title} | APU Events`,
        data: { optionPage: 'dropdown', optionKind },
      })),
      {
        path: 'dropdown-options',
        loadComponent: () => import('./features/internal/pages/request-option-management/request-option-management').then((module) => module.RequestOptionManagementComponent),
        title: 'Dropdown Box Options | APU Events',
        data: { optionPage: 'dropdown' },
      },
      {
        path: 'clubs/manage',
        loadComponent: () => import('./features/internal/pages/clubs/club-management/club-management').then((module) => module.ClubManagementComponent),
        title: 'Manage Clubs | APU Events',
      },
      {
        path: 'clubs/discover',
        loadComponent: () => import('./features/internal/pages/clubs/club-discover/club-discover').then((module) => module.ClubDiscoverComponent),
        title: 'Discover Clubs | APU Events',
      },
      // Unified shell for the 3 member-facing club tabs — each tab keeps its own route (deep
      // links/back-forward still work) but they share one tab strip, same pattern as 'my-events'.
      {
        path: 'clubs',
        loadComponent: () => import('./features/internal/pages/clubs/club-hub/club-hub').then((module) => module.ClubHubComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'my-clubs' },
          {
            path: 'my-clubs',
            loadComponent: () => import('./features/internal/pages/clubs/club-hub/hub-my-clubs/hub-my-clubs').then((module) => module.HubMyClubsComponent),
            title: 'My Clubs | APU Events',
          },
          {
            path: 'pending',
            loadComponent: () => import('./features/internal/pages/clubs/club-hub/hub-pending/hub-pending').then((module) => module.HubPendingComponent),
            title: 'Pending Requests | APU Events',
          },
          {
            path: 'history',
            loadComponent: () => import('./features/internal/pages/clubs/club-hub/hub-history/hub-history').then((module) => module.HubHistoryComponent),
            title: 'Request History | APU Events',
          },
        ],
      },
      { path: 'clubs/browse', pathMatch: 'full', redirectTo: 'clubs/discover' },
      // Three separate System Configuration pages, each its own sidebar entry under the
      // 'System Configuration' folder (see db.js's backfillSplitSystemConfigNavPages()/seedRoles())
      // — previously one 'admin/settings' page with an in-page tab strip, which meant opening any
      // one tab injected (and fetched from) all three services at once.
      { path: 'admin/settings', pathMatch: 'full', redirectTo: 'admin/settings/policies' },
      {
        path: 'admin/settings/policies',
        loadComponent: () => import('./features/internal/pages/system-config/policies-tab/policies-tab').then((module) => module.PoliciesTabComponent),
        title: 'System Configuration | APU Events',
      },
      {
        path: 'admin/settings/categories',
        loadComponent: () => import('./features/internal/pages/system-config/categories-tab/categories-tab').then((module) => module.CategoriesTabComponent),
        title: 'Event Categories | APU Events',
      },
      {
        path: 'admin/settings/formats',
        loadComponent: () => import('./features/internal/pages/system-config/formats-tab/formats-tab').then((module) => module.FormatsTabComponent),
        title: 'Event Formats | APU Events',
      },
      {
        path: 'admin/matrix',
        loadComponent: () => import('./features/internal/pages/routing-matrix/routing-matrix').then((module) => module.RoutingMatrixComponent),
        title: 'Routing Matrix | APU Events',
      },
      {
        path: 'users',
        loadComponent: () => import('./features/internal/pages/admin-directory/admin-directory').then((module) => module.AdminDirectoryComponent),
        title: 'Users | APU Events',
        data: { adminEntity: 'users' },
      },
      {
        path: 'units',
        loadComponent: () => import('./features/internal/pages/admin-directory/admin-directory').then((module) => module.AdminDirectoryComponent),
        title: 'Units | APU Events',
        data: { adminEntity: 'units' },
      },
      {
        path: 'roles',
        loadComponent: () => import('./features/internal/pages/roles/roles').then((module) => module.RolesComponent),
        title: 'Roles | APU Events',
      },
      {
        path: 'admin/page-visibility',
        loadComponent: () => import('./features/internal/pages/page-visibility/page-visibility').then((module) => module.PageVisibilityComponent),
        title: 'Page Visibility | APU Events',
      },
      ...[
        ['reports', 'Operations', 'Reports', 'Review operational activity and service reporting.', 'analytics'],
      ].map(([path, eyebrow, title, description, icon]) => ({
        path,
        loadComponent: placeholderPage,
        title: `${title} | APU Events`,
        data: { eyebrow, title, description, icon },
      })),
      // Catches any admin-created Page Visibility route (/app/<page_code>, auto-derived — see
      // admin.routes.js's deriveNavRoutePath()) that has no real component wired up yet. Safe as
      // a wildcard because roleGuard's canActivateChild already ran and confirmed the URL is in
      // the logged-in user's own nav tree before this route is ever reached — an admin adding a
      // page here shows the shared placeholder immediately, no separate route-table edit needed,
      // until a developer builds the real page and adds its own explicit route above this one.
      { path: '**', loadComponent: placeholderPage },
    ],
  },
  {
    path: 'shared',
    loadComponent: () =>
      import('./features/shared-library/shared-library').then(
        (module) => module.SharedLibraryComponent,
      ),
    title: 'Shared Components Library | APU Events',
  },
  { path: '**', redirectTo: '' },
];
