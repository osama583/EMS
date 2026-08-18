import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject, catchError, map, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthUser, RoleNavigation } from './auth.models';
import { isExternalUser } from './role-access';
import { navigationFor, roleCanAccess } from './role-navigation';
import { AuthTokens, TokenStore } from './token-store';

const USER_KEY = 'apu-ems-auth-user';
const SESSION_VERSION = 2;

interface PersistedSession {
  readonly version: number;
  readonly user: AuthUser;
}

interface LoginResponse {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export type LoginResult = { success: true; user: AuthUser } | { success: false; message: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStore);

  readonly user = signal<AuthUser | null>(this.restoreUser());
  readonly authenticated = computed(() => this.user() !== null && this.tokens.hasSession());
  readonly isInternalUser = computed(() => this.user()?.accountType === 'internal');
  readonly isExternalUser = computed(() => this.user()?.accountType === 'external');

  // The sidebar is computed server-side and delivered on the AuthUser; this only
  // reshapes it for the layout component.
  readonly navigation = computed<RoleNavigation | null>(() => {
    const user = this.user();
    return user ? navigationFor(user) : null;
  });
  readonly defaultRoute = computed(() =>
    this.isExternalUser() ? '/' : this.navigation()?.defaultRoute ?? '/login',
  );

  // Lets the HTTP interceptor coalesce concurrent 401s onto one refresh.
  private readonly refreshing = signal(false);
  private readonly refreshDone = new Subject<boolean>();
  readonly refreshInFlight = () => this.refreshing();
  readonly refreshCompleted$ = this.refreshDone.asObservable();

  login(email: string, password: string): Observable<LoginResult> {
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, {
        email: email.trim().toLowerCase(),
        password,
      })
      .pipe(
        map((response) => {
          this.storeSession(response);
          return { success: true, user: response.user } as const;
        }),
        catchError((error: HttpErrorResponse) =>
          of<LoginResult>({
            success: false,
            // The API returns a deliberately uninformative message here; it is
            // shown as-is rather than being second-guessed.
            message: error.error?.error?.message ?? 'The email or password is incorrect.',
          }),
        ),
      );
  }

  /**
   * Exchange the refresh token for a new pair. Resolves to null when the session
   * is genuinely over, which the interceptor treats as "log out".
   */
  refreshTokens(): Observable<AuthTokens | null> {
    const refreshToken = this.tokens.refreshToken();
    if (!refreshToken) return of(null);

    this.refreshing.set(true);
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/refresh`, { refreshToken })
      .pipe(
        map((response) => {
          this.storeSession(response);
          return {
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: Date.now() + response.expiresIn * 1000,
          } satisfies AuthTokens;
        }),
        catchError(() => of(null)),
        tap((result) => {
          this.refreshing.set(false);
          this.refreshDone.next(result !== null);
        }),
      );
  }

  canAccess(url: string): boolean {
    const user = this.user();
    return !!user && roleCanAccess(user, url);
  }

  /**
   * Adopt a session produced outside `login()` — guest self-registration, and
   * specs. Tokens are required: `authenticated` means "can call the API", and a
   * user without a token cannot.
   */
  establishSession(user: AuthUser, tokens: AuthTokens): void {
    this.tokens.set(tokens);
    this.user.set(user);
    this.writeUser(user);
  }

  /**
   * Re-pull the caller's own projection (roles, nav tree, club identity).
   *
   * The sidebar is computed at login and never recomputed otherwise, so an admin
   * editing Page Visibility or Roles would see stale navigation until they
   * logged out. Called after any such mutation. Fails silently: this is a
   * background refresh, not a user action.
   */
  refreshSession(): Observable<AuthUser | null> {
    if (!this.tokens.hasSession()) return of(null);
    return this.http.get<AuthUser>(`${environment.apiBaseUrl}/auth/me`).pipe(
      tap((user) => {
        this.user.set(user);
        this.writeUser(user);
      }),
      catchError(() => of(null)),
    );
  }

  logout(): void {
    // Best-effort: the server audits the logout, but the session ends locally
    // whether or not that call succeeds.
    if (this.tokens.hasSession()) {
      this.http.post(`${environment.apiBaseUrl}/auth/logout`, {}).subscribe({
        error: () => undefined,
      });
    }
    this.endSession();
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  /** Drop the session without navigating. Used by the interceptor on a dead refresh. */
  endSession(): void {
    this.user.set(null);
    this.tokens.clear();
    try {
      this.document.defaultView?.localStorage.removeItem(USER_KEY);
    } catch { /* Storage may be unavailable. */ }
  }

  private storeSession(response: LoginResponse): void {
    this.tokens.set({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
    });
    this.user.set(response.user);
    this.writeUser(response.user);
  }

  private restoreUser(): AuthUser | null {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(USER_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as PersistedSession;
      if (stored.version !== SESSION_VERSION) return null;
      const parsed = stored.user;
      const accountTypeMatchesRoles =
        parsed.accountType === 'external' ? isExternalUser(parsed) : !isExternalUser(parsed);
      return parsed?.id &&
        parsed.email &&
        parsed.displayName &&
        Array.isArray(parsed.roles) &&
        Array.isArray(parsed.nav) &&
        accountTypeMatchesRoles
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private writeUser(user: AuthUser): void {
    try {
      this.document.defaultView?.localStorage.setItem(
        USER_KEY,
        JSON.stringify({ version: SESSION_VERSION, user } satisfies PersistedSession),
      );
    } catch { /* Storage may be unavailable. */ }
  }
}
