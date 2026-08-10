import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, UserRole } from './auth.models';
import { ROLE_NAVIGATION, roleCanAccess } from './role-navigation';

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
  readonly navigation = computed(() => this.user() ? ROLE_NAVIGATION[this.user()!.role] : null);
  readonly defaultRoute = computed(() => this.isExternalUser() ? '/' : this.navigation()?.defaultRoute ?? '/login');

  login(email: string, password: string): Observable<LoginResult> {
    return this.http.post<AuthUser>(`${environment.authApiUrl}/login`, { email: email.trim().toLowerCase(), password }).pipe(
      map((user) => {
        this.user.set(user);
        this.writeUser(user);
        return { success: true, user } as const;
      }),
      catchError(() => of<LoginResult>({ success: false, message: 'The email or password is incorrect.' })),
    );
  }

  canAccess(url: string): boolean { const user = this.user(); return !!user && roleCanAccess(user.role, url); }

  establishSession(user: AuthUser): void {
    this.user.set(user);
    this.writeUser(user);
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
      const normalized: AuthUser = { ...parsed, accountType: parsed.accountType ?? (parsed.role === UserRole.ExternalUser ? 'external' : 'internal') };
      const accountTypeMatchesRole = normalized.accountType === 'external'
        ? normalized.role === UserRole.ExternalUser
        : normalized.role !== UserRole.ExternalUser;
      return normalized.email && normalized.displayName && normalized.role && accountTypeMatchesRole ? normalized : null;
    } catch { return null; }
  }
  private writeUser(user: AuthUser): void {
    try { this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION, user } satisfies PersistedSession)); } catch { /* Storage may be unavailable. */ }
  }
}
