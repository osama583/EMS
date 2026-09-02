// 'Internal' is visible to any authenticated internal (non-guest) user, same reach as Public but
// excluded from the guest-facing landing page/discovery surface — see events.py's
// _published_clause()/_INTERNAL_VISIBLE. 'Private' is never surfaced on any discovery endpoint.
export type EventVisibility = 'Public' | 'Private' | 'Club Only' | 'Internal';
// 'Automatic' | 'Manual' are the backend's REGISTRATION_MODES (proposals.py) — published-event reads
// (events.py's registrationMode column) only ever send these two.
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
  // Already selected by events.py's _event_select; the model simply never declared it, so
  // the details modal could not show who is running the event.
  readonly organiser: string;
  // Clubs the event belongs to (request_clubs, migration 029). Empty for an event that is
  // not run by any club.
  readonly clubs: readonly string[];
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
  // When the organiser approved or rejected this registration. NULL for rows decided
  // before migration 039 recorded it, and for automatic-approval events, where the
  // registration IS the decision — both fall back to registeredAt for display.
  readonly decidedAt: string | null;
  readonly status: 'confirmed' | 'pending' | 'rejected';
  readonly paymentProofUrl: string | null;
  readonly paymentProofFileName: string | null;
  readonly paymentStatus: PaymentStatus;
}

/** What the organiser's attendee panel asks the server for. */
export interface RegistrationListQuery {
  readonly q?: string;
  readonly order?: 'asc' | 'desc';
  readonly page: number;
  readonly pageSize: number;
}

/**
 * One page of an event's attendees.
 *
 * `counts` is deliberately not derived from `items`: the panel's tiles describe the
 * event, so they must hold still while the reader searches and pages.
 */
export interface RegistrationListPage {
  readonly items: readonly EventRegistration[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly counts: { readonly confirmed: number; readonly pending: number; readonly rejected: number };
}

export interface RegistrationResult { readonly status: RegistrationStatus; readonly message: string; }

// A pending registration enriched with the event it belongs to — what the applicant reviews in
// their Inbox (system specification §6). Manual-approval registrations are a single-approver
// flow with no request_task, so they arrive as their own list rather than through the workflow.
export interface PendingEventRegistration extends EventRegistration {
  readonly eventTitle: string;
  readonly eventCode: string;
  readonly paymentRequired: boolean;
  // Who approved/rejected this — absent while still pending. 'Owner' when the decider was the
  // event's applicant, 'Co-owner' when it was a co-owner acting on the applicant's behalf.
  readonly decidedByName?: string | null;
  readonly decidedByRole?: 'Owner' | 'Co-owner' | null;
  // Whether the CALLER themself is the decider — distinguishes "decided by me" from "decided by
  // a different co-owner" when decidedByRole is 'Co-owner' (decidedByRole alone can't tell those
  // apart, since it only says Owner-vs-any-co-owner, not which specific person).
  readonly decidedByIsViewer?: boolean;
}

/** The server's paginated envelope for GET /events/me/pending-approvals. */
export interface PendingEventRegistrationPage {
  readonly items: readonly PendingEventRegistration[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
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
  // 'My Clubs' narrows results to events run by a club the viewer belongs to or presides
  // over; resolved server-side against live membership (events.py's _list_events_filters).
  readonly club?: readonly string[];
  readonly date?: readonly string[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly excludeRegistered?: boolean;
  // My Events > Saved only: drops saved events the caller already has a confirmed place on, which
  // belong under Registered instead. Applied in the same query that produces the count, so the
  // pagination describes the list actually on screen.
  readonly excludeConfirmed?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
  // Skips building/decorating `items` server-side entirely (schedule/categories/audience sub-queries,
  // event image, bank details, ...) and returns only `total` — for callers that just want a result
  // count (the filter dialog's live "N events match" preview), not a page of full event records.
  readonly countOnly?: boolean;
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

/**
 * One window an internal venue is already spoken for, from GET /events/venue-bookings.
 * Times only — a Private event contributes its hours with `eventTitle` null and
 * `isRestricted` true, because a room being occupied is a fact about the room even when the
 * event in it is not the reader's business.
 */
export interface VenueBooking {
  readonly startTime: string;
  readonly endTime: string;
  readonly eventTitle: string | null;
  readonly isRestricted: boolean;
}

export interface VenueBookingsResponse {
  readonly venueId: string;
  readonly date: string;
  readonly bookings: readonly VenueBooking[];
}
