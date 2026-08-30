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

// GET /events/me/registration-history — the merged, server-side searched/filtered/paginated
// replacement for fetching registration history (getRegistrationHistory) and every decided
// registration (getDecidedRegistrations) separately and re-bucketing/filtering them in the browser.
export interface RegistrationHistoryRow {
  readonly key: string;
  readonly requester: 'me' | 'other';
  readonly eventTitle: string;
  readonly eventCode: string;
  readonly outcome: 'confirmed' | 'rejected';
  readonly registeredAt: string;
  readonly registrantName: string | null;
  readonly registrantEmail: string | null;
  readonly reason: string | null;
  readonly decidedByName: string | null;
  readonly decidedByRole: 'Owner' | 'Co-owner' | null;
  readonly decidedByIsViewer: boolean | null;
}

export interface RegistrationHistoryQuery {
  readonly order?: 'asc' | 'desc';
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
  readonly requester?: 'me' | 'other';
  readonly decidedBy?: 'me' | 'co-owner';
}

export interface RegistrationHistoryPage {
  readonly items: readonly RegistrationHistoryRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

/**
 * Which event reminder emails this reader wants, one flag per reminder the
 * backend can actually send (see backend services/email/reminders.py).
 *
 * Grouped by the My Events tab that owns them, which is why they are three
 * separate flags rather than one: the Saved tab controls the two saved-list
 * reminders, the Registered tab controls its own. "Remind me about events I am
 * attending, but do not nag me about bookmarks" is a real preference that a
 * single global toggle could not express.
 *
 * All default to true. The server treats a missing row as "all on", so a reader
 * who never opens these toggles still gets reminders.
 */
export interface NotificationPreference {
  /** A saved event passes SAVED_CAPACITY_PERCENT full and you have not registered. */
  readonly savedCapacityReminder: boolean;
  /** A saved event is near and you still have not registered. */
  readonly savedStartingReminder: boolean;
  /** An event you ARE registered for is near. */
  readonly registeredStartingReminder: boolean;
}

/** The subset of toggles one My Events tab owns. */
export type ReminderKey = keyof NotificationPreference;

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
  // No email argument: the server identifies the reader from the bearer token,
  // so one caller can never read or rewrite another's preferences.
  getNotificationPreferences(): import('rxjs').Observable<NotificationPreference>;
  updateNotificationPreferences(preferences: Partial<NotificationPreference>): import('rxjs').Observable<NotificationPreference>;
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
