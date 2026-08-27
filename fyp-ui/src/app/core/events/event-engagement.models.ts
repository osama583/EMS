import { AuthUser } from '../auth/auth.models';
import { PublishedEvent, RegistrationStatus } from './published-event.models';

export interface SavedEventRecord {
  readonly eventId: string;
  readonly userEmail: string;
  readonly savedAt: string;
  readonly registrationStatus?: RegistrationStatus;
}

export interface SavedEventMutationResponse {
  readonly eventId: string;
  readonly saved: boolean;
}

export interface SavedEventsResponse {
  readonly items: readonly PublishedEvent[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface RegisteredEventEntry {
  readonly event: PublishedEvent;
  readonly status: RegistrationStatus;
}

export interface RegisteredEventsResponse {
  readonly items: readonly RegisteredEventEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface NotificationPreference {
  readonly registrationClosingReminder: boolean;
  readonly eventStartingReminder: boolean;
  readonly registrationClosingStatus: 'enabled' | 'disabled' | 'pending-api';
  readonly eventStartingStatus: 'enabled' | 'disabled' | 'pending-api';
}

export interface ExternalUserRegistrationRequest {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly age: number;
  readonly gender: string;
  readonly password: string;
}

export interface ExternalUserRegistrationResponse {
  readonly challengeId: string;
  readonly status: 'otp-required';
  readonly maskedEmail: string;
}

export interface VerifyExternalOtpRequest {
  readonly challengeId: string;
  readonly otp: string;
}

export interface VerifyExternalOtpResponse {
  readonly status: 'verified' | 'invalid' | 'expired';
  readonly user?: AuthUser;
  readonly message: string;
}

export interface ResendOtpResponse {
  readonly status: 'sent' | 'expired';
  readonly message: string;
}

export interface EmailStatusResponse {
  readonly available: boolean;
  readonly hasPendingChallenge: boolean;
  readonly challengeId: string | null;
}

export interface SavedEventsApi {
  getSavedEvents(userEmail: string): import('rxjs').Observable<SavedEventsResponse>;
  saveEvent(userEmail: string, eventId: string): import('rxjs').Observable<SavedEventMutationResponse>;
  removeSavedEvent(userEmail: string, eventId: string): import('rxjs').Observable<SavedEventMutationResponse>;
  getNotificationPreferences(userEmail: string): import('rxjs').Observable<NotificationPreference>;
  updateNotificationPreferences(userEmail: string, preferences: NotificationPreference): import('rxjs').Observable<NotificationPreference>;
}

/** The acting user is resolved server-side from the bearer token. */
export interface EventRegistrationApi {
  getActiveRegistrations(page: number, pageSize: number): import('rxjs').Observable<RegisteredEventsResponse>;
  getRegistrationHistory(page: number, pageSize: number): import('rxjs').Observable<RegisteredEventsResponse>;
}

export interface ExternalRegistrationApi {
  registerExternalUser(request: ExternalUserRegistrationRequest): import('rxjs').Observable<ExternalUserRegistrationResponse>;
  verifyOtp(request: VerifyExternalOtpRequest): import('rxjs').Observable<VerifyExternalOtpResponse>;
  resendOtp(challengeId: string): import('rxjs').Observable<ResendOtpResponse>;
  checkEmailStatus(email: string): import('rxjs').Observable<EmailStatusResponse>;
}
