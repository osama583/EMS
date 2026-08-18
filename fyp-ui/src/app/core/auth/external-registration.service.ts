import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, delay, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser } from './auth.models';
import { AuthService } from './auth.service';

import {
  ExternalRegistrationApi,
  ExternalUserRegistrationRequest,
  ExternalUserRegistrationResponse,
  VerifyExternalOtpRequest,
  VerifyExternalOtpResponse,
} from '../events/event-engagement.models';

/** Registration returns the same envelope as login, so the guest is signed in at once. */
interface RegistrationResponse {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

interface PendingChallenge { readonly request: ExternalUserRegistrationRequest; readonly otp: string; }

@Injectable({ providedIn: 'root' })
export class ExternalRegistrationService implements ExternalRegistrationApi {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly challenges = new Map<string, PendingChallenge>();

  // OTP delivery is still a dev-only mock (no email/SMS provider wired up) — this only stages
  // the submitted form data locally and hands back a fixed code to display on-screen. The real
  // account is NOT created here; it's created by verifyOtp() below, once the (mock) code is
  // confirmed, via a real backend call — so a challenge that's never verified never becomes an
  // account.
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
    if (request.otp.trim() !== challenge.otp) return of<VerifyExternalOtpResponse>({ status: 'invalid', message: 'The verification code is incorrect.' }).pipe(delay(180));

    const { email, firstName, lastName, age, gender, password } = challenge.request;
    return this.http.post<RegistrationResponse>(`${environment.apiBaseUrl}/auth/register`, { email, firstName, lastName, age, gender, password }).pipe(
      map((response) => {
        this.challenges.delete(request.challengeId);
        this.auth.establishSession(response.user, {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresAt: Date.now() + response.expiresIn * 1000,
        });
        return { status: 'verified' as const, user: response.user, message: 'Your account has been verified.' };
      }),
      catchError((err) => of<VerifyExternalOtpResponse>({
        status: 'invalid',
        message: err?.error?.error?.message || 'Registration could not be completed. Please try again.',
      })),
    );
  }

  private maskEmail(email: string): string {
    const [name = '', domain = ''] = email.trim().split('@');
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
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
