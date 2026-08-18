export type EventVisibility = 'Public' | 'Private' | 'Club Only';
export type RegistrationMode = 'Automatic' | 'Approval Required';
export type RegistrationStatus = 'confirmed' | 'pending' | 'duplicate' | 'rejected';

export interface ProposalEventSchedule {
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly location: string;
}

/** The proposal-owned image payload used unchanged by cards, details and saved events. */
export interface EventImageAsset {
  readonly url: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: 'local' | 'uploaded';
  readonly storageKey?: string;
}

/** API-ready public projection of fields collected by the Event Proposal form. */
export interface PublishedEvent {
  readonly id: string;
  readonly eventTitle: string;
  readonly shortIntroduction: string;
  readonly goals: string;
  readonly expectedBenefits: string;
  readonly categories: readonly string[];
  readonly eventVisibility: EventVisibility;
  readonly promotionMethod?: string;
  readonly eventFormat: string;
  readonly eventImage: EventImageAsset;
  readonly schoolDepartment: string;
  readonly audience: readonly string[];
  readonly schedule: readonly ProposalEventSchedule[];
  readonly totalExpectedPax: number;
  // Organizer-set registration capacity; null = uncapped. The server refuses registrations past
  // this number, so the UI only uses it to show how many places are left.
  readonly maxPax: number | null;
  readonly registrationMode: RegistrationMode;
  readonly confirmedRegistrationCount: number;
  readonly pendingRegistrationCount: number;
  readonly cost: number | null;
  readonly bankAccountName: string | null;
  readonly bankAccountNumber: string | null;
  readonly isFree: boolean;
}

export type PaymentStatus = 'not_required' | 'pending_review' | 'approved' | 'rejected';

// Applicants reviewing a manual-approval event see the registrant's name, email and reason
// (system specification §6), so all three travel with the registration record.
export interface EventRegistration {
  readonly id: string;
  readonly eventId: string;
  readonly email: string;
  readonly name: string;
  readonly reason: string;
  readonly registeredAt: string;
  readonly status: 'confirmed' | 'pending' | 'rejected';
  readonly paymentProofUrl: string | null;
  readonly paymentProofFileName: string | null;
  readonly paymentStatus: PaymentStatus;
}

export interface RegistrationResult { readonly status: RegistrationStatus; readonly message: string; }

// A pending registration enriched with the event it belongs to — what the applicant reviews in
// their Inbox (system specification §6). Manual-approval registrations are a single-approver
// flow with no request_task, so they arrive as their own list rather than through the workflow.
export interface PendingEventRegistration extends EventRegistration {
  readonly eventTitle: string;
  readonly eventCode: string;
  readonly paymentRequired: boolean;
}

/** Public events are visible to everyone; Private/Club Only events are APU-community-only. */
export function isEventVisibleTo(visibility: EventVisibility, isAuthenticated: boolean): boolean {
  return visibility === 'Public' || isAuthenticated;
}

export const EVENT_FIELD_MAPPING = {
  card: ['eventTitle', 'categories', 'schedule', 'confirmedRegistrationCount', 'eventImage'],
  details: ['shortIntroduction', 'goals', 'expectedBenefits', 'eventVisibility', 'eventFormat', 'totalExpectedPax', 'registrationMode'],
  registration: ['id', 'registrationMode', 'confirmedRegistrationCount', 'pendingRegistrationCount'],
} as const;
