import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, DemoAuthUser, RoleNavigation } from './auth.models';
import { navigationFor, roleCanAccess } from './role-navigation';
import { isExternalUser } from './role-access';

const STORAGE_KEY = 'apu-ems-auth-user';
const SESSION_VERSION = 1;

interface PersistedSession {
  readonly version: number;
  readonly user: AuthUser;
}

export type LoginResult = { success: true; user: AuthUser } | { success: false; message: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  readonly user = signal<AuthUser | null>(this.restoreUser());
  readonly authenticated = computed(() => this.user() !== null);
  readonly isInternalUser = computed(() => this.user()?.accountType === 'internal');
  readonly isExternalUser = computed(() => this.user()?.accountType === 'external');
  // Club Admin and the student/lecturer club pages are real nav_page_grants rows now (see
  // role-navigation.ts's comment) — navigationFor() alone already reflects them via the server
  // nav tree, no separate additive club layer needed.
  readonly navigation = computed<RoleNavigation | null>(() => {
    const user = this.user();
    return user ? navigationFor(user) : null;
  });
  readonly defaultRoute = computed(() => this.isExternalUser() ? '/' : this.navigation()?.defaultRoute ?? '/login');

  login(email: string, password: string): Observable<LoginResult> {
    return this.http.post<AuthUser>(`${environment.authApiUrl}/login`, { email: email.trim().toLowerCase(), password }).pipe(
      map((user) => {
        this.user.set(user);
        this.writeUser(user);
        return { success: true, user } as const;
      }),
      catchError((err: HttpErrorResponse) => of<LoginResult>({ success: false, message: err.error?.message || 'The email or password is incorrect.' })),
    );
  }

  canAccess(url: string): boolean { const user = this.user(); return !!user && roleCanAccess(user, url); }

  // Dev-only "Development demo users" picker on the login screen (see login.ts) — fetches the
  // real seeded accounts + their plaintext seed password straight from the db (GET
  // /api/auth/demo-users), so the list can never drift from server/db.js's actual seed data the
  // way a hand-transcribed frontend copy would. Never called when environment.enableMockAuth is
  // false. Fails soft to an empty list (the picker just shows nothing) rather than surfacing an
  // error banner on the login screen for what's purely a convenience feature.
  getDemoUsers(): Observable<readonly DemoAuthUser[]> {
    return this.http.get<readonly DemoAuthUser[]>(`${environment.authApiUrl}/demo-users`).pipe(
      catchError(() => of<readonly DemoAuthUser[]>([])),
    );
  }

  establishSession(user: AuthUser): void {
    this.user.set(user);
    this.writeUser(user);
  }

  // Re-pulls the CURRENT user's own session projection (roles, nav tree, club identity) from the
  // DB via GET /api/auth/me, replacing the cached AuthUser signal + localStorage copy in place.
  // AuthUser.nav is otherwise only ever computed at login and never touched again — an admin
  // editing Page Visibility/Roles/Units elsewhere in the same session would see stale sidebar data
  // until logout/login without this. AdminDirectoryService.refresh() calls this after every
  // nav_page/role/unit mutation so the sidebar reacts immediately (see that file). No-ops silently
  // on failure (e.g. logged out, network hiccup) — this is a background refresh, not a user action,
  // so a failure here shouldn't surface an error banner or disrupt whatever the admin was doing.
  refreshSession(): Observable<AuthUser | null> {
    const current = this.user();
    if (!current) return of(null);
    return this.http.get<AuthUser>(`${environment.authApiUrl}/me`, { params: { userId: String(current.id) } }).pipe(
      tap((user) => { this.user.set(user); this.writeUser(user); }),
      catchError(() => of(null)),
    );
  }

  logout(): void {
    this.user.set(null);
    try { this.document.defaultView?.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    void this.router.navigate(['/'], { replaceUrl: true });
  }

  private restoreUser(): AuthUser | null {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as PersistedSession | AuthUser;
      if ('user' in stored && stored.version !== SESSION_VERSION) return null;
      const parsed = 'user' in stored ? stored.user : stored;
      const accountTypeMatchesRoles = parsed.accountType === 'external'
        ? isExternalUser(parsed)
        : !isExternalUser(parsed);
      // Sessions persisted before AuthUser.id/roles[]/nav[] existed (pre-RBAC-redesign schema)
      // are rejected outright — the shapes are incompatible, and features that need to act "as"
      // the user server-side (club join requests, President approvals) would silently send an
      // empty/NaN id and fail. Reject the stale session so the user is routed back to /login and
      // re-authenticates through the current /login response shape.
      return parsed.id && parsed.email && parsed.displayName && Array.isArray(parsed.roles) && Array.isArray(parsed.nav) && accountTypeMatchesRoles ? parsed : null;
    } catch { return null; }
  }
  private writeUser(user: AuthUser): void {
    try { this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION, user } satisfies PersistedSession)); } catch { /* Storage may be unavailable. */ }
  }
}
