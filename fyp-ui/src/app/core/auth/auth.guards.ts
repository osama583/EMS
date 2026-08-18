import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

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
// dropdown-option/My Menu pages, ...) has NO bespoke guard any more — nav_page_grants IS the
// single source of truth for who can reach a URL, enforced once via roleGuard's (above)
// auth.canAccess(state.url), which checks the URL against the user's server-computed nav tree
// (role-navigation.ts's roleCanAccess()). A page visible in the sidebar and a page whose URL
// actually loads can no longer drift out of sync, since both read the exact same
// nav_page_grants rows. Previously this file exported systemAdminGuard/cafeteriaMenuViewerGuard/
// cafeteriaAdminGuard/requestOptionManagerGuard, each duplicating in TypeScript a rule already
// expressed in nav_page_grants — removed 2026-08-17 (see docs/superpowers/specs history for the
// audit that confirmed every one of those guards had an exact-matching grant row already).
