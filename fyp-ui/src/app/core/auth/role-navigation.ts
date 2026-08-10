import { AuthNavigationItem, RoleNavigation, UserRole } from './auth.models';
import { managerOptionKinds } from '../request-options/request-option.permissions';
import { RequestOptionKind } from '../request-options/request-option.models';

const item = (label: string, icon: string, route: string): AuthNavigationItem => ({ label, icon, route });
const how = item('How It Works', 'help_center', '/app/how-it-works');
const dashboard = item('Dashboard', 'space_dashboard', '/app/dashboard');
const inbox = item('Inbox', 'inbox', '/app/inbox');
const exploreEvents = item('Explore Events', 'explore', '/app/events/explore-events');
const myEvents = item('My Events', 'favorite', '/app/events/my-events');
const drafts = item('Drafts', 'draft', '/app/proposals/drafts');
const ingoing = item('Ongoing', 'schedule', '/app/proposals/pending');
const proposalHistory = item('History', 'history', '/app/proposals/history');
const proposalForm = item('Proposal', 'note_add', '/app/forms/event-proposal');
const requestOngoing = item('Ongoing Orders', 'pending_actions', '/app/requests/ongoing');
const requestIngoing = item('Ongoing', 'pending_actions', '/app/requests/ongoing');
const requestHistory = item('History', 'history', '/app/requests/history');
const taskHistory = item('History', 'history', '/app/tasks/history');
const myTasks = item('My Tasks', 'task', '/app/tasks');
const eventsSection = (role: UserRole) => ({
  key: 'events',
  label: 'Events',
  icon: 'event',
  items: roleCanUseSavedEvents(role) ? [exploreEvents, myEvents] : [exploreEvents],
});
const OPTION_NAVIGATION: Readonly<Record<RequestOptionKind, AuthNavigationItem>> = {
  logistics: item('Logistics Items', 'inventory_2', '/app/dropdown-options/logistics'),
  transportation: item('Transportation Types', 'directions_bus', '/app/dropdown-options/transportation'),
  photoVideo: item('Photography Services', 'photo_camera', '/app/dropdown-options/photoVideo'),
  soundLight: item('Sound & Light', 'settings_input_component', '/app/dropdown-options/soundLight'),
  fnb: item('My Menu', 'restaurant_menu', '/app/menu'),
  dietaryInformation: item('Dietary Information', 'nutrition', '/app/dropdown-options/dietaryInformation'),
  servingUnit: item('Serving Units', 'straighten', '/app/dropdown-options/servingUnit'),
  campusTourStart: item('Campus Tour Starting Points', 'location_on', '/app/dropdown-options/campusTourStart'),
  campusTourArea: item('Campus Tour Areas', 'map', '/app/dropdown-options/campusTourArea'),
  campusTourMap: item('Campus Map Information', 'map_search', '/app/dropdown-options/campusTourMap'),
  waterLogo: item('Mineral Water with Logo', 'water_bottle', '/app/dropdown-options/waterLogo'),
  waterNormal: item('Mineral Water Normal', 'water_drop', '/app/dropdown-options/waterNormal'),
  fundingMain: item('Funding Main Items', 'account_balance_wallet', '/app/dropdown-options/fundingMain'),
  fundingSub: item('Funding Sub-items', 'account_tree', '/app/dropdown-options/fundingSub'),
};
const dropdownSettings = (role: UserRole) => ({ key: 'dropdown-settings', label: 'Dropdown Settings', icon: 'tune', items: managerOptionKinds(role).map((kind) => OPTION_NAVIGATION[kind]) });

const proposalRole = (label: string, includesOwnSubmissions = false): RoleNavigation => ({
  defaultRoute: '/app/dashboard', primary: [how, dashboard, inbox],
  sections: [
    { key: 'proposals', label, icon: 'description', items: includesOwnSubmissions ? [drafts, ingoing, proposalHistory] : [drafts, ingoing, proposalHistory] },
    eventsSection(UserRole.Applicant),
    { key: 'forms', label: 'Forms', icon: 'assignment', items: [proposalForm] },
  ],
});
const managerRole = (role: UserRole, kind: 'cafeteria' | 'service'): RoleNavigation => ({
  defaultRoute: '/app/dashboard',
  primary: kind === 'cafeteria'
    ? [dashboard, inbox, item('Reports', 'analytics', '/app/reports')]
    : [dashboard, inbox],
  sections: [
    { key: 'requests', label: 'Request Tracking', icon: 'fact_check', items: kind === 'cafeteria' ? [requestOngoing, requestHistory] : [requestIngoing, requestHistory] },
    eventsSection(role),
    dropdownSettings(role),
  ],
});

export const ROLE_NAVIGATION: Readonly<Record<UserRole, RoleNavigation>> = {
  [UserRole.ExternalUser]: { defaultRoute: '/my-events/saved', primary: [], sections: [] },
  [UserRole.Applicant]: proposalRole('My Proposals', true),
  [UserRole.ClubPresident]: proposalRole('My Proposals', true),
  [UserRole.HosHod]: proposalRole('Event Proposals'),
  [UserRole.Cfo]: (() => { const navigation = proposalRole('Event Proposals'); return { ...navigation, sections: [...navigation.sections, dropdownSettings(UserRole.Cfo)] }; })(),
  [UserRole.FmbReviewer]: proposalRole('Event Proposals'),
  [UserRole.FmbManager]: managerRole(UserRole.FmbManager, 'service'),
  [UserRole.CafeteriaManager]: managerRole(UserRole.CafeteriaManager, 'cafeteria'),
  [UserRole.CafeteriaStaff]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.CafeteriaStaff)] },
  [UserRole.CafeteriaAdmin]: { defaultRoute: '/app/dashboard', primary: [dashboard], sections: [eventsSection(UserRole.CafeteriaAdmin)] },
  [UserRole.LogisticsManager]: managerRole(UserRole.LogisticsManager, 'service'),
  [UserRole.LogisticsStaff]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.LogisticsStaff)] },
  [UserRole.StudentServicesManager]: managerRole(UserRole.StudentServicesManager, 'service'),
  [UserRole.StudentServicesMember]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.StudentServicesMember)] },
  [UserRole.FmbWaterServicesStaff]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.FmbWaterServicesStaff)] },
  [UserRole.AvManager]: managerRole(UserRole.AvManager, 'service'),
  [UserRole.AvTechnician]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.AvTechnician)] },
  [UserRole.PhotographyManager]: managerRole(UserRole.PhotographyManager, 'service'),
  [UserRole.PhotographyStaff]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.PhotographyStaff)] },
  [UserRole.TransportManager]: managerRole(UserRole.TransportManager, 'service'),
  [UserRole.TransportStaff]: { defaultRoute: '/app/tasks', primary: [myTasks, taskHistory], sections: [eventsSection(UserRole.TransportStaff)] },
  [UserRole.SystemAdmin]: {
    defaultRoute: '/app/users',
    primary: [],
    sections: [
      {
        key: 'admin-directory',
        label: 'Internal Directory',
        icon: 'folder_shared',
        items: [
          item('Users', 'group', '/app/users'),
          item('Units', 'domain', '/app/units'),
        ],
      },
      {
        key: 'system-config',
        label: 'System Configuration',
        icon: 'settings',
        items: [
          item('Settings', 'tune', '/app/admin/settings'),
          item('Routing Matrix', 'account_tree', '/app/admin/matrix'),
        ],
      },
      eventsSection(UserRole.SystemAdmin),
    ],
  },
};

export function roleCanAccess(role: UserRole, url: string): boolean {
  const cleanUrl = (url.split(/[?#]/, 1)[0] || url).replace(/\/$/, '');
  if (cleanUrl === '/app' || cleanUrl === '/app/profile' || cleanUrl === '/app/logout') return true;
  if (cleanUrl === '/app/events/explore-events') return true;
  if (cleanUrl.startsWith('/app/proposals/review/')) return true;
  if (cleanUrl === '/app/events/saved-events' || cleanUrl === '/app/saved-events') return roleCanUseSavedEvents(role);
  if (cleanUrl === '/app/events/my-events' || cleanUrl.startsWith('/app/events/my-events/')) return roleCanUseSavedEvents(role);
  if (cleanUrl === '/app/dropdown-options') return managerOptionKinds(role).some((kind) => kind !== 'fnb' && kind !== 'servingUnit');
  const navigation = ROLE_NAVIGATION[role];
  return [...navigation.primary, ...navigation.sections.flatMap((section) => section.items)]
    .some((entry) => cleanUrl === entry.route || cleanUrl.startsWith(`${entry.route}/`));
}

export function roleCanUseSavedEvents(role: UserRole): boolean {
  return [
    UserRole.ExternalUser,
    UserRole.Applicant,
    UserRole.ClubPresident,
    UserRole.HosHod,
    UserRole.Cfo,
    UserRole.FmbReviewer,
    UserRole.FmbManager,
  ].includes(role);
}
