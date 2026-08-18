import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, filter, switchMap, take, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { TokenStore } from './token-store';

/** Endpoints that must never carry an Authorization header. */
const ANONYMOUS_PATHS = ['/auth/login', '/auth/refresh'];

function isApiRequest(url: string): boolean {
  return url.startsWith(environment.apiBaseUrl) || url.startsWith('/api/');
}

function isAnonymous(url: string): boolean {
  return ANONYMOUS_PATHS.some((path) => url.includes(path));
}

/**
 * Attaches the bearer token to API requests, and recovers from an expired one.
 *
 * On a 401 the interceptor refreshes ONCE and replays the failed request. While
 * that refresh is in flight, other 401s wait for it rather than each firing
 * their own — otherwise a page issuing six parallel requests would trigger six
 * refreshes, five of which race and lose.
 *
 * A failed refresh means the session is genuinely over: tokens are cleared and
 * the user is sent to the login screen.
 */
export function authInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const tokens = inject(TokenStore);
  const auth = inject(AuthService);

  if (!isApiRequest(request.url) || isAnonymous(request.url)) {
    return next(request);
  }

  const token = tokens.accessToken();
  const authorised = token ? withToken(request, token) : request;

  return next(authorised).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      // No refresh token, or the refresh call itself failed: nothing to retry.
      if (!tokens.refreshToken()) {
        auth.endSession();
        return throwError(() => error);
      }

      if (auth.refreshInFlight()) {
        // Wait for the in-flight refresh, then replay with whatever it produced.
        return auth.refreshCompleted$.pipe(
          filter((done) => done),
          take(1),
          switchMap(() => {
            const fresh = tokens.accessToken();
            if (!fresh) return throwError(() => error);
            return next(withToken(request, fresh));
          }),
        );
      }

      return auth.refreshTokens().pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            auth.endSession();
            return throwError(() => error);
          }
          return next(withToken(request, refreshed.accessToken));
        }),
      );
    }),
  );
}

function withToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
