import { Routes } from '@angular/router';
import { authGuard, defaultRoleRouteGuard, externalUserGuard, loginGuard, publicLandingGuard, requestOptionManagerGuard, roleGuard, systemAdminGuard } from './core/auth/auth.guards';

const dropdownSettingRoutes = [
  ['logistics', 'Logistics Items'],
  ['transportation', 'Transportation Types'],
  ['photoVideo', 'Photography Services'],
  ['soundLight', 'Sound & Light'],
  ['dietaryInformation', 'Dietary Information'],
  ['servingUnit', 'Serving Units'],
  ['campusTourStart', 'Campus Tour Starting Points'],
  ['campusTourArea', 'Campus Tour Areas'],
  ['campusTourMap', 'Campus Map Information'],
  ['waterLogo', 'Mineral Water with Logo'],
  ['waterNormal', 'Mineral Water Normal'],
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
        loadComponent: () =>
          import('./features/internal/pages/inbox/inbox').then((module) => module.InboxComponent),
        title: 'Inbox | APU Events',
        data: {
          eyebrow: 'Communication',
          title: 'Inbox',
          description: 'Review conversations related to your event requests.',
          icon: 'inbox',
        },
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/internal/pages/records-page/records-page').then(
            (module) => module.RecordsPageComponent,
          ),
        title: 'Notifications | APU Events',
        data: {
          eyebrow: 'Updates',
          title: 'Notifications',
          description: 'Stay informed about proposal progress and required actions.',
          icon: 'notifications',
          collectionPage: 'notifications',
        },
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
        path: 'proposals/pending',
        loadComponent: () =>
          import('./features/internal/pages/records-page/records-page').then(
            (module) => module.RecordsPageComponent,
          ),
        title: 'Ongoing Proposals | APU Events',
        data: {
          eyebrow: 'My proposals',
          title: 'Ongoing',
          description: 'Track related proposals that are moving through review and are not currently waiting for your action.',
          icon: 'schedule',
          collectionPage: 'pending',
        },
      },
      {
        path: 'proposals/history',
        loadComponent: () =>
          import('./features/internal/pages/records-page/records-page').then(
            (module) => module.RecordsPageComponent,
          ),
        title: 'Proposal History | APU Events',
        data: {
          eyebrow: 'My proposals',
          title: 'History',
          description: 'Review the history and final outcomes of your event proposals.',
          icon: 'history',
          collectionPage: 'history',
        },
      },
      {
        path: 'proposals/approved',
        loadComponent: placeholderPage,
        title: 'Approved Proposals | APU Events',
        data: {
          eyebrow: 'My proposals',
          title: 'Approved',
          description: 'View event proposals that have received approval.',
          icon: 'verified',
        },
      },
      {
        path: 'proposals/rejected',
        loadComponent: placeholderPage,
        title: 'Rejected Proposals | APU Events',
        data: {
          eyebrow: 'My proposals',
          title: 'Rejected',
          description: 'Review proposals that were not approved.',
          icon: 'cancel',
        },
      },
      {
        path: 'proposals/completed',
        loadComponent: placeholderPage,
        title: 'Completed Proposals | APU Events',
        data: {
          eyebrow: 'My proposals',
          title: 'Completed',
          description: 'Access the history of completed event proposals.',
          icon: 'task_alt',
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
        path: 'requests/ongoing',
        loadComponent: () =>
          import('./features/internal/pages/records-page/records-page').then(
            (module) => module.RecordsPageComponent,
          ),
        title: 'Ongoing Requests | APU Events',
        data: { collectionPage: 'request-ongoing' },
      },
      {
        path: 'requests/history',
        loadComponent: () =>
          import('./features/internal/pages/records-page/records-page').then(
            (module) => module.RecordsPageComponent,
          ),
        title: 'Request History | APU Events',
        data: { collectionPage: 'request-history' },
      },
      {
        path: 'menu',
        canActivate: [requestOptionManagerGuard],
        loadComponent: () => import('./features/internal/pages/request-option-management/request-option-management').then((module) => module.RequestOptionManagementComponent),
        title: 'My Menu | APU Events',
        data: { optionPage: 'menu' },
      },
      ...dropdownSettingRoutes.map(([optionKind, title]) => ({
        path: `dropdown-options/${optionKind}`,
        canActivate: [requestOptionManagerGuard],
        loadComponent: () => import('./features/internal/pages/request-option-management/request-option-management').then((module) => module.RequestOptionManagementComponent),
        title: `${title} | APU Events`,
        data: { optionPage: 'dropdown', optionKind },
      })),
      {
        path: 'dropdown-options',
        canActivate: [requestOptionManagerGuard],
        loadComponent: () => import('./features/internal/pages/request-option-management/request-option-management').then((module) => module.RequestOptionManagementComponent),
        title: 'Dropdown Box Options | APU Events',
        data: { optionPage: 'dropdown' },
      },
      {
        path: 'admin/settings',
        canActivate: [systemAdminGuard],
        loadComponent: () => import('./features/internal/pages/system-config/system-config').then((module) => module.SystemConfigComponent),
        title: 'System Configuration | APU Events',
      },
      {
        path: 'admin/matrix',
        canActivate: [systemAdminGuard],
        loadComponent: () => import('./features/internal/pages/routing-matrix/routing-matrix').then((module) => module.RoutingMatrixComponent),
        title: 'Routing Matrix | APU Events',
      },
      {
        path: 'users',
        canActivate: [systemAdminGuard],
        loadComponent: () => import('./features/internal/pages/admin-directory/admin-directory').then((module) => module.AdminDirectoryComponent),
        title: 'Users | APU Events',
        data: { adminEntity: 'users' },
      },
      {
        path: 'units',
        canActivate: [systemAdminGuard],
        loadComponent: () => import('./features/internal/pages/admin-directory/admin-directory').then((module) => module.AdminDirectoryComponent),
        title: 'Units | APU Events',
        data: { adminEntity: 'units' },
      },
      {
        path: 'tasks',
        loadComponent: () => import('./features/internal/pages/staff-tasks/staff-tasks').then((module) => module.StaffTasksComponent),
        title: 'My Tasks | APU Events',
        data: { taskPage: 'active' },
      },
      {
        path: 'tasks/history',
        loadComponent: () => import('./features/internal/pages/staff-tasks/staff-tasks').then((module) => module.StaffTasksComponent),
        title: 'Task History | APU Events',
        data: { taskPage: 'history' },
      },
      ...[
        ['reports', 'Operations', 'Reports', 'Review operational activity and service reporting.', 'analytics'],
      ].map(([path, eyebrow, title, description, icon]) => ({
        path,
        loadComponent: placeholderPage,
        title: `${title} | APU Events`,
        data: { eyebrow, title, description, icon },
      })),
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
