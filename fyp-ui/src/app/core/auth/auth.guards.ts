import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { hasRole, isClubPresident } from './role-access';
import { staffTaskRoutingKeyFor } from '../staff-tasks/staff-task-routing';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (!auth.authenticated()) return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  return auth.isInternalUser() ? true : inject(Router).createUrlTree(['/']);
};

export const roleGuard: CanActivateChildFn = (_route, state) => {
  const auth = inject(AuthService);
  if (!auth.authenticated()) return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  if (!auth.isInternalUser()) return inject(Router).createUrlTree(['/']);
  return auth.canAccess(state.url) ? true : inject(Router).createUrlTree([auth.defaultRoute()]);
};

export const defaultRoleRouteGuard: CanActivateFn = () => inject(Router).createUrlTree([inject(AuthService).defaultRoute()]);

// The empty child path under /app/inbox, /app/ongoing, /app/history used to hardcode redirectTo:
// 'proposals'.
export const recordsHubDefaultTabGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const user = inject(AuthService).user();
  const router = inject(Router);
  const bucket = route.parent?.data['bucket'] as 'inbox' | 'ongoing' | 'history' | undefined;
  // No ActivatedRoute instance exists yet at guard time (only its snapshot) - relativeTo needs
  // one, so build the absolute path from the parent's own URL segments instead.
  const parentPath = '/' + route.parent!.pathFromRoot.flatMap((s) => s.url.map((seg) => seg.path)).join('/');

  if (!user) return router.createUrlTree([parentPath, 'proposals']);

  if (hasRole(user, 'cafeteria-staff')) {
    if (bucket !== 'ongoing') {
      const routingKey = staffTaskRoutingKeyFor(user);
      if (routingKey !== null) {
        const tasksPath = routingKey === 'cafeteria-staff' ? 'cafeteria-tasks' : 'tasks';
        return router.createUrlTree([parentPath, tasksPath]);
      }
    }
    return router.createUrlTree([parentPath, 'events']);
  }

  // A Club Admin (not also a System Admin) never sees Proposals - route Inbox/History straight to
  // President Change Requests instead, same "decide it before any component activates" reasoning.
  // Ongoing has no President Change Requests tab, so they fall through to the normal default there.
  if (hasRole(user, 'club-admin') && !hasRole(user, 'system-admin') && bucket !== 'ongoing') {
    return router.createUrlTree([parentPath, 'president-change-request']);
  }

  return router.createUrlTree([parentPath, 'proposals']);
};

export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.authenticated() ? inject(Router).createUrlTree([auth.defaultRoute()]) : true;
};

export const publicLandingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isInternalUser() ? inject(Router).createUrlTree([auth.defaultRoute()]) : true;
};

export const externalUserGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isExternalUser()) return true;
  if (auth.isInternalUser()) return inject(Router).createUrlTree([auth.defaultRoute()]);
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Page-level authorization (system-admin-only pages, F&B-only pages, cafeteria-admin-only pages,
// dropdown-option/My Menu pages, ...) has NO bespoke guard any more — nav_page_grants IS the single
// source of truth for who can reach a URL, enforced once via roleGuard's (above)
// auth.canAccess(state.url), which checks the URL against the user's server-computed nav tree (role-
// navigation.ts's roleCanAccess()).
