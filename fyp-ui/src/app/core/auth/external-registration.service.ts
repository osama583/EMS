import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser } from './auth.models';
import { AuthService } from './auth.service';

import {
  EmailStatusResponse,
  ExternalRegistrationApi,
  ExternalUserRegistrationRequest,
  ExternalUserRegistrationResponse,
  ResendOtpResponse,
  VerifyExternalOtpRequest,
  VerifyExternalOtpResponse,
} from '../events/event-engagement.models';

interface StartRegistrationResponse {
  readonly challengeId: string;
  readonly status: 'otp-required';
  readonly maskedEmail: string;
}

/** Verification returns the same envelope as login, so a verified guest is signed in at once. */
interface VerifyRegistrationResponse {
  readonly status: 'verified' | 'invalid' | 'expired';
  readonly message: string;
  readonly user?: AuthUser;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresIn?: number;
}

@Injectable({ providedIn: 'root' })
export class ExternalRegistrationService implements ExternalRegistrationApi {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  // Step 1: the backend stages the submitted form under a 6-digit code and
  // emails it — no account exists yet. Step 2 (verifyOtp) checks the code and
  // only then creates the account, so an abandoned or never-verified attempt
  // never becomes a row in the database.
  registerExternalUser(request: ExternalUserRegistrationRequest): Observable<ExternalUserRegistrationResponse> {
    return this.http
      .post<StartRegistrationResponse>(`${environment.apiBaseUrl}/auth/register/start`, request)
      .pipe(
        map((response) => ({
          challengeId: response.challengeId,
          status: response.status,
          maskedEmail: response.maskedEmail,
        })),
      );
  }

  verifyOtp(request: VerifyExternalOtpRequest): Observable<VerifyExternalOtpResponse> {
    return this.http
      .post<VerifyRegistrationResponse>(`${environment.apiBaseUrl}/auth/register/verify`, request)
      .pipe(
        map((response) => {
          if (response.status !== 'verified' || !response.user || !response.accessToken || !response.refreshToken) {
            return { status: response.status, message: response.message };
          }
          this.auth.establishSession(response.user, {
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresAt: Date.now() + (response.expiresIn ?? 0) * 1000,
          });
          return { status: 'verified' as const, user: response.user, message: response.message };
        }),
        catchError((err) => of<VerifyExternalOtpResponse>({
          status: 'invalid',
          message: err?.error?.error?.message || 'Verification could not be completed. Please try again.',
        })),
      );
  }

  resendOtp(challengeId: string): Observable<ResendOtpResponse> {
    return this.http.post<ResendOtpResponse>(`${environment.apiBaseUrl}/auth/register/resend`, { challengeId });
  }

  /** Live email-field check: is this address free, and does it already have
   * a pending (unexpired) signup the user could resume instead of starting over? */
  checkEmailStatus(email: string): Observable<EmailStatusResponse> {
    return this.http.get<EmailStatusResponse>(
      `${environment.apiBaseUrl}/auth/register/email-status`,
      { params: { email } },
    );
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
