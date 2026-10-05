// RBAC redesign (2026-08-13): the sidebar is now built server-side (nav-tree.service.js's
// navTreeFor(), returned as AuthUser.nav on login) instead of the old hardcoded ROLE_NAVIGATION /
// unitNavigationFor() maps keyed by UserRole/FunctionLevel/UnitKind.
import { AuthNavigationItem, AuthNavNode, AuthUser, RoleNavigation, RoleNavigationEntry } from './auth.models';
import { isClubPresident, roleCanUseSavedEvents } from './role-access';

export { roleCanUseSavedEvents };

// A logged-in user whose role(s) have zero nav_page_grants (e.g. a brand-new custom role before a
// System Admin wires it into Page Visibility) has nothing to route to.
export const FALLBACK_NAVIGATION: RoleNavigation = { defaultRoute: '/app/no-access', entries: [] };

const item = (label: string, icon: string, route: string): AuthNavigationItem => ({ label, icon, route });

function toItem(node: AuthNavNode): AuthNavigationItem {
  return item(node.label, node.icon || '', node.routePath || '/app/dashboard');
}

// Every top-level nav_page node renders at the same sidebar level, in server order (sort_order — i.e.
export function navigationFor(user: AuthUser): RoleNavigation {
  if (!user.nav || user.nav.length === 0) return FALLBACK_NAVIGATION;

  const entries: RoleNavigationEntry[] = user.nav.map((node) =>
    node.entryType === 'folder'
      ? { kind: 'section', section: { key: node.pageCode, label: node.label, icon: node.icon || '', items: node.children.map(toItem) } }
      : { kind: 'item', item: toItem(node) },
  );

  const firstRoute = entries
    .map((entry) => (entry.kind === 'item' ? entry.item.route : entry.section.items[0]?.route))
    .find((route): route is string => !!route);
  // Same infinite-loop hazard as FALLBACK_NAVIGATION above: a non-empty nav tree that somehow
  // resolves to zero routable leaf items (e.g. every top-level entry is an empty folder) must
  // still land somewhere always-allowed, never '/app/dashboard'.
  return { defaultRoute: firstRoute || '/app/no-access', entries };
}

function flattenRoutes(nodes: readonly AuthNavNode[]): string[] {
  return nodes.flatMap((node) => [node.routePath, ...flattenRoutes(node.children)].filter((r): r is string => !!r));
}

export function roleCanAccess(user: AuthUser, url: string): boolean {
  const cleanUrl = (url.split(/[?#]/, 1)[0] || url).replace(/\/$/, '');
  if (cleanUrl === '/app' || cleanUrl === '/app/profile' || cleanUrl === '/app/logout' || cleanUrl === '/app/no-access') return true;
  // '/app/events/explore-events' has its own real nav_page_grants row (granted to every internal
  // role) — no separate bypass needed, unlike the two exceptions above, which are truly
  // universal and outside Page Visibility's page catalog entirely.
  if (cleanUrl.startsWith('/app/proposals/review/')) return true;
  // Same reasoning as proposals/review/ above: which SPECIFIC proposal (and which department's task on
  // it) a user may open here is an instance-level question the backend already enforces
  // (assert_proposal_owner + the task's own 'resubmitted' status), not a sidebar-page question — there
  // is no standalone nav_page for "resubmit a department's request" to grant.
  if (cleanUrl.startsWith('/app/proposals/department-resubmit/')) return true;
  const allowedRoutes = flattenRoutes(user.nav || []);
  return allowedRoutes.some((route) => cleanUrl === route || cleanUrl.startsWith(`${route}/`));
}

// Club President (AuthUser.presidentOfClubIds) stays a pure data fact, never a role or a nav grant — a
// club has exactly one President and it isn't assignable from the Roles system (see clubs.user_id in
// ems_database_schema.sql).
export { isClubPresident };
