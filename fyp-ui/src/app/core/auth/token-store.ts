import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

// Bumped whenever the persisted shape changes, so an old session is discarded
// rather than half-read.
const STORAGE_KEY = 'apu-ems-session';
const SESSION_VERSION = 2;

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. Used to refresh proactively rather than waiting for a 401. */
  readonly expiresAt: number;
}

interface PersistedTokens extends AuthTokens {
  readonly version: number;
}

/**
 * Holds the access and refresh tokens, in memory and mirrored to localStorage
 * so a page reload does not log the user out.
 *
 * localStorage is readable by any script on the origin, so a successful XSS can
 * read these. The alternative — httpOnly cookies — trades that for CSRF and
 * requires the API to be same-site, which it is not. Given a token-authenticated
 * cross-origin API, this is the standard trade; see backend/docs/security.md.
 * Access tokens are short-lived to limit the window.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly document = inject(DOCUMENT);
  private readonly tokens = signal<AuthTokens | null>(this.restore());

  readonly accessToken = () => this.tokens()?.accessToken ?? null;
  readonly refreshToken = () => this.tokens()?.refreshToken ?? null;
  readonly hasSession = () => this.tokens() !== null;

  /** True when the access token has expired or is within `skewMs` of doing so. */
  isExpiring(skewMs = 30_000): boolean {
    const current = this.tokens();
    return current ? Date.now() + skewMs >= current.expiresAt : true;
  }

  set(tokens: AuthTokens): void {
    this.tokens.set(tokens);
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...tokens, version: SESSION_VERSION } satisfies PersistedTokens),
      );
    } catch { /* Storage may be unavailable (private mode, quota). */ }
  }

  clear(): void {
    this.tokens.set(null);
    try { this.storage?.removeItem(STORAGE_KEY); } catch { /* as above */ }
  }

  private get storage(): Storage | undefined {
    return this.document.defaultView?.localStorage;
  }

  private restore(): AuthTokens | null {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as PersistedTokens;
      if (stored.version !== SESSION_VERSION || !stored.accessToken || !stored.refreshToken) return null;
      // An expired REFRESH token is unusable, so treat it as no session at all
      // rather than letting the first request fail.
      return stored.expiresAt ? stored : null;
    } catch { return null; }
  }
}
