import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { UserRole } from './auth.models';
import { RequestOptionKind } from '../request-options/request-option.models';
import { canManageRequestOptions, managerOptionKinds } from '../request-options/request-option.permissions';

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

export const requestOptionManagerGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const user = auth.user();
  const optionKind = route.data['optionKind'] as RequestOptionKind | undefined;
  const cafeteriaPage = route.data['optionPage'] === 'menu';
  const authorised = user && (optionKind
    ? managerOptionKinds(user.role).includes(optionKind)
    : canManageRequestOptions(user.role, cafeteriaPage));
  return authorised
    ? true
    : inject(Router).createUrlTree([auth.defaultRoute()]);
};

export const systemAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.user()?.role === UserRole.SystemAdmin
    ? true
    : inject(Router).createUrlTree([auth.defaultRoute()]);
};
