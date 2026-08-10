export const EVENT_CATEGORY_OPTIONS = [
  'Academic & Career', 'Workshops & Training', 'Sports & Wellness', 'Culture & Community',
  'Clubs & Societies', 'Entertainment & Social', 'Volunteering',
] as const;

export type EventCategory = typeof EVENT_CATEGORY_OPTIONS[number];
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
  readonly categories: readonly EventCategory[];
  readonly eventVisibility: EventVisibility;
  readonly promotionMethod?: string;
  readonly eventFormat: 'On Campus' | 'Online' | 'Hybrid' | 'Off Campus';
  readonly eventImage: EventImageAsset;
  readonly schoolDepartment: string;
  readonly audience: readonly string[];
  readonly schedule: readonly ProposalEventSchedule[];
  readonly totalExpectedPax: number;
  readonly registrationMode: RegistrationMode;
  readonly confirmedRegistrationCount: number;
  readonly pendingRegistrationCount: number;
  readonly isFree: boolean;
}

export interface EventRegistration {
  readonly id: string;
  readonly eventId: string;
  readonly email: string;
  readonly status: 'confirmed' | 'pending' | 'rejected';
}

export interface RegistrationResult { readonly status: RegistrationStatus; readonly message: string; }

export const EVENT_FIELD_MAPPING = {
  card: ['eventTitle', 'categories', 'schedule', 'confirmedRegistrationCount', 'eventImage'],
  details: ['shortIntroduction', 'goals', 'expectedBenefits', 'eventVisibility', 'eventFormat', 'totalExpectedPax', 'registrationMode'],
  registration: ['id', 'registrationMode', 'confirmedRegistrationCount', 'pendingRegistrationCount'],
} as const;
