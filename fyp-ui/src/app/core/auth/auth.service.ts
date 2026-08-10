import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthUser, EXTERNAL_ACCOUNTS_STORAGE_KEY, PersistedExternalAccount, UserRole } from './auth.models';
import { ROLE_NAVIGATION, roleCanAccess } from './role-navigation';

const STORAGE_KEY = 'apu-ems-auth-user';
const SESSION_VERSION = 1;

interface PersistedSession {
  readonly version: number;
  readonly user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  readonly user = signal<AuthUser | null>(this.restoreUser());
  readonly authenticated = computed(() => this.user() !== null);
  readonly isInternalUser = computed(() => this.user()?.accountType === 'internal');
  readonly isExternalUser = computed(() => this.user()?.accountType === 'external');
  readonly navigation = computed(() => this.user() ? ROLE_NAVIGATION[this.user()!.role] : null);
  readonly defaultRoute = computed(() => this.isExternalUser() ? '/' : this.navigation()?.defaultRoute ?? '/login');

  login(email: string, password: string): { success: true; user: AuthUser } | { success: false; message: string } {
    if (!environment.enableMockAuth) return { success: false, message: 'Authentication service is not configured.' };
    const normalizedEmail = email.trim().toLowerCase();
    const record = environment.mockUsers.find((candidate) => candidate.email === normalizedEmail && candidate.password === password)
      ?? this.restoreExternalAccounts().find((candidate) => candidate.user.email === normalizedEmail && candidate.password === password);
    if (!record) return { success: false, message: 'The email or password is incorrect.' };
    const user = 'user' in record ? record.user : (({ password: _password, ...account }) => account)(record);
    this.user.set(user);
    this.writeUser(user);
    return { success: true, user };
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
  private restoreExternalAccounts(): readonly PersistedExternalAccount[] {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(EXTERNAL_ACCOUNTS_STORAGE_KEY);
      return raw ? JSON.parse(raw) as readonly PersistedExternalAccount[] : [];
    } catch { return []; }
  }
}
