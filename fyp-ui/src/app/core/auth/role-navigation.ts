// RBAC redesign (2026-08-13): the sidebar is now built server-side (nav-tree.service.js's
// navTreeFor(), returned as AuthUser.nav on login) instead of the old hardcoded
// ROLE_NAVIGATION / unitNavigationFor() maps keyed by UserRole/FunctionLevel/UnitKind. This file
// now only ADAPTS that server tree into the RoleNavigation shape the shell/sidebar components
// already render, plus the additive club-derived sections (still data-driven, unaffected by the
// RBAC redesign) and access-guard helpers.
import { AuthNavigationItem, AuthNavNode, AuthUser, RoleNavigation, RoleNavigationEntry } from './auth.models';
import { isClubPresident, roleCanUseSavedEvents } from './role-access';

export { roleCanUseSavedEvents };

// A logged-in user whose role(s) have zero nav_page_grants (e.g. a brand-new custom role before
// a System Admin wires it into Page Visibility) has nothing to route to. '/app/dashboard' is
// WRONG here — it isn't universally accessible, so roleGuard would immediately reject it and
// redirect back to defaultRoute(), an infinite loop. '/app/no-access' is a real, always-allowed
// route (see roleCanAccess below and app.routes.ts) that explains the situation instead.
export const FALLBACK_NAVIGATION: RoleNavigation = { defaultRoute: '/app/no-access', entries: [] };

const item = (label: string, icon: string, route: string): AuthNavigationItem => ({ label, icon, route });

function toItem(node: AuthNavNode): AuthNavigationItem {
  return item(node.label, node.icon || '', node.routePath || '/app/dashboard');
}

// Every top-level nav_page node renders at the same sidebar level, in server order (sort_order —
// i.e. append-at-the-bottom-of-siblings, see nextSiblingSortOrder() in admin.routes.js): folders
// become expandable sections, standalone pages become items. Both live in ONE ordered `entries`
// array (rather than separate primary/sections lists) so a newly admin-created standalone page
// takes its natural place among existing folders instead of always jumping above all of them.
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
  const allowedRoutes = flattenRoutes(user.nav || []);
  return allowedRoutes.some((route) => cleanUrl === route || cleanUrl.startsWith(`${route}/`));
}

// Club President (AuthUser.presidentOfClubIds) stays a pure data fact, never a role or a nav
// grant — a club has exactly one President and it isn't assignable from the Roles system (see
// clubs.user_id in ems_database_schema.sql). Nothing in the sidebar is President-gated today: the
// President's join-request review happens inside /app/inbox/club-requests, already reachable via
// the normal server nav tree for every unit-scoped/cfo role.
//
// Club Admin and the student/lecturer club pages (My Clubs/Discover/Pending) used to be an
// ADDITIVE client-side layer here (clubNavigationSections/clubCanAccess), invisible to the Page
// Visibility admin screen. As of 2026-08-17 they are real nav_page/nav_page_grants rows (see
// server/db.js's seedNavPages(), 'manage-clubs' folder) — the server nav tree (AuthUser.nav)
// already includes them for whichever roles are actually granted, so navigationFor()/
// roleCanAccess() alone are the complete, correct answer now. No separate club-specific layer.
export { isClubPresident };
