import { Injectable, inject, signal } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { AuthUser, EXTERNAL_ACCOUNTS_STORAGE_KEY, PersistedExternalAccount, UserRole } from './auth.models';
import { DOCUMENT } from '@angular/common';
import { AuthService } from './auth.service';
import {
  ExternalRegistrationApi,
  ExternalUserRegistrationRequest,
  ExternalUserRegistrationResponse,
  VerifyExternalOtpRequest,
  VerifyExternalOtpResponse,
} from '../events/event-engagement.models';

interface PendingChallenge { readonly request: ExternalUserRegistrationRequest; readonly otp: string; }

@Injectable({ providedIn: 'root' })
export class ExternalRegistrationService implements ExternalRegistrationApi {
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly challenges = new Map<string, PendingChallenge>();

  registerExternalUser(request: ExternalUserRegistrationRequest): Observable<ExternalUserRegistrationResponse> {
    const challengeId = `external-${Date.now()}`;
    const otp = '246810';
    this.challenges.set(challengeId, { request: { ...request, email: request.email.trim().toLowerCase() }, otp });
    return of({
      challengeId,
      status: 'otp-required' as const,
      maskedEmail: this.maskEmail(request.email),
      developmentOtp: otp,
    }).pipe(delay(260));
  }

  verifyOtp(request: VerifyExternalOtpRequest): Observable<VerifyExternalOtpResponse> {
    const challenge = this.challenges.get(request.challengeId);
    if (!challenge) return of<VerifyExternalOtpResponse>({ status: 'expired', message: 'This verification request has expired.' }).pipe(delay(180));
    if (!/^\d{6}$/.test(request.otp.trim())) return of<VerifyExternalOtpResponse>({ status: 'invalid', message: 'The verification code is incorrect.' }).pipe(delay(180));

    const user: AuthUser = {
      email: challenge.request.email,
      displayName: challenge.request.firstName,
      username: challenge.request.email.split('@', 1)[0],
      role: UserRole.ExternalUser,
      accountType: 'external',
      roleLabel: 'Registered External User',
      department: 'External Community',
    };
    this.persistAccount({ user, password: challenge.request.password });
    this.challenges.delete(request.challengeId);
    this.auth.establishSession(user);
    return of<VerifyExternalOtpResponse>({ status: 'verified', user, message: 'Your account has been verified.' }).pipe(delay(220));
  }

  private maskEmail(email: string): string {
    const [name = '', domain = ''] = email.trim().split('@');
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
  }

  private persistAccount(account: PersistedExternalAccount): void {
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) return;
      const current = JSON.parse(storage.getItem(EXTERNAL_ACCOUNTS_STORAGE_KEY) ?? '[]') as PersistedExternalAccount[];
      const next = [...current.filter((item) => item.user.email !== account.user.email), account];
      storage.setItem(EXTERNAL_ACCOUNTS_STORAGE_KEY, JSON.stringify(next));
    } catch { /* Development storage may be unavailable. */ }
  }
}

@Injectable({ providedIn: 'root' })
export class GuestRegistrationFlowService {
  readonly open = signal(false);
  readonly pendingEventId = signal<string | null>(null);
  readonly returnUrl = signal<string | null>(null);
  readonly initialView = signal<'login' | 'register'>('login');

  requestForEvent(eventId: string): void { this.pendingEventId.set(eventId); this.returnUrl.set(null); this.initialView.set('login'); this.open.set(false); }
  requestForSavedEvents(): void { this.requestLogin('/my-events/saved'); }
  requestLogin(returnUrl: string | null = null): void { this.pendingEventId.set(null); this.returnUrl.set(returnUrl); this.initialView.set('login'); this.open.set(false); }
  requestRegistration(returnUrl: string | null = null): void { this.pendingEventId.set(null); this.returnUrl.set(returnUrl); this.initialView.set('register'); this.open.set(false); }
  close(): void { this.open.set(false); this.pendingEventId.set(null); this.returnUrl.set(null); this.initialView.set('login'); }
}
