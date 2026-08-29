import { EventImageAsset, EventVisibility, ProposalEventSchedule, RegistrationMode } from './published-event.models';

/**
 * The master event calendar's own feed (/app/event-calendar), served by
 * events.py's master_calendar(). Deliberately a separate model from
 * PublishedEvent because the master calendar shows a DIFFERENT population under
 * DIFFERENT rules:
 *
 *   * It includes events still at department_review — approved by HOS/HOD (normal
 *     flow) or by the CFO (high-pax flow) but not yet fully approved — which no
 *     discovery endpoint ever returns.
 *   * Its rows are visibility-REDACTED per viewer rather than filtered away, so a
 *     row here may carry no details at all (see `restricted`).
 *
 * A row is one of two shapes and `restricted` is the discriminant:
 *   restricted === false → every detail field is present (MasterCalendarEvent).
 *   restricted === true  → only id/schedule dates survive; the server sent no
 *                          title, organiser, venue or time at all.
 */
export interface RestrictedCalendarEvent {
  readonly id: string;
  readonly restricted: true;
  /** Display label for the redacted row, e.g. "Restricted Club Event". */
  readonly restrictedLabel: string;
  readonly eventVisibility: EventVisibility;
  /** Dates only — start/end/location come back as empty strings by design. */
  readonly schedule: readonly ProposalEventSchedule[];
}

export interface VisibleCalendarEvent {
  readonly id: string;
  readonly restricted: false;
  readonly eventTitle: string;
  readonly shortIntroduction: string;
  readonly eventVisibility: EventVisibility;
  readonly eventFormat: string;
  readonly eventImage: EventImageAsset | null;
  readonly schoolDepartment: string;
  readonly organiser: string;
  /**
   * 'department_review' | 'completed_approved'. A department_review event is on
   * the calendar but not yet fully approved, which the UI marks as provisional so
   * nobody plans against it as if it were final.
   */
  readonly proposalStatus: string;
  readonly categories: readonly string[];
  /** Frozen club-audience labels (migration 029); non-empty only for Club Only events. */
  readonly clubs: readonly string[];
  readonly schedule: readonly ProposalEventSchedule[];
  readonly totalExpectedPax: number;
  readonly maxPax: number | null;
  readonly registrationMode: RegistrationMode;
  readonly confirmedRegistrationCount: number;
  readonly cost: number | null;
  readonly isFree: boolean;
}

export type MasterCalendarEvent = VisibleCalendarEvent | RestrictedCalendarEvent;

export interface MasterCalendarResponse {
  readonly events: readonly MasterCalendarEvent[];
  /**
   * Per-date count of Private events, keyed 'YYYY-MM-DD'. Private events are
   * never present in `events` in any form — the count is all the server sends,
   * so there is nothing here that could disclose one. Always empty for CFO/F&B,
   * who receive private events as ordinary visible rows instead.
   */
  readonly privateCounts: Readonly<Record<string, number>>;
}

/** Narrowing helper so templates and computeds can branch on the discriminant. */
export function isVisibleEvent(event: MasterCalendarEvent): event is VisibleCalendarEvent {
  return !event.restricted;
}
