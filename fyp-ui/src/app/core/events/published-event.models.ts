// 'Internal' is visible to any authenticated internal (non-guest) user, same reach as Public but
// excluded from the guest-facing landing page/discovery surface — see events.py's
// _published_clause()/_INTERNAL_VISIBLE. 'Private' is never surfaced on any discovery endpoint.
export type EventVisibility = 'Public' | 'Private' | 'Club Only' | 'Internal';
// 'Automatic' | 'Manual' are the backend's REGISTRATION_MODES (proposals.py) — published-event
// reads (events.py's registrationMode column) only ever send these two. 'Approval Required' is
// the proposal FORM's own UI label for 'Manual' (event-proposal.ts bridges the two on submit/load);
// it is never present on a published event, so published-event call sites must compare against
// 'Manual', not 'Approval Required'.
export type RegistrationMode = 'Automatic' | 'Manual' | 'Approval Required';
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
  readonly eventImage: EventImageAsset | null;
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

// Public events are visible to everyone; Club Only is APU-community-only. In practice this only
// ever receives 'Public' or 'Club Only' — the endpoints that feed it (GET /events) never return
// 'Private' or 'Internal' events to begin with (see events.py's list_events()/_EVENT_SELECT).
export function isEventVisibleTo(visibility: EventVisibility, isAuthenticated: boolean): boolean {
  return visibility === 'Public' || isAuthenticated;
}

// Query params for GET /events/search - one field per Explore Events filter group, plus search
// and pagination. Every field is optional; an absent/empty array means "no filter applied" for
// that group, matching how the old client-side `matches()` treated an empty selection.
export interface EventSearchParams {
  readonly q?: string;
  readonly visibility?: readonly EventVisibility[];
  readonly category?: readonly string[];
  readonly school?: readonly string[];
  readonly format?: readonly string[];
  readonly time?: readonly ('Morning' | 'Afternoon' | 'Evening')[];
  readonly registration?: readonly ('No Registration Required' | 'Registration Required')[];
  readonly cost?: readonly ('Free' | 'Paid')[];
  readonly date?: readonly string[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly excludeRegistered?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface EventSearchResponse {
  readonly items: readonly PublishedEvent[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export const EVENT_FIELD_MAPPING = {
  card: ['eventTitle', 'categories', 'schedule', 'confirmedRegistrationCount', 'eventImage'],
  details: ['shortIntroduction', 'goals', 'expectedBenefits', 'eventVisibility', 'eventFormat', 'totalExpectedPax', 'registrationMode'],
  registration: ['id', 'registrationMode', 'confirmedRegistrationCount', 'pendingRegistrationCount'],
} as const;
