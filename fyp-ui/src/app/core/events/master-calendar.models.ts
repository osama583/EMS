import { EventVisibility, ProposalEventSchedule, RegistrationMode } from './published-event.models';

/**
 * The master event calendar's own feed (/app/event-calendar), served by events.py's
 * master_calendar / master_calendar_day / master_calendar_event. Deliberately separate models
 * from PublishedEvent because the master calendar shows a DIFFERENT population under DIFFERENT
 * rules:
 *
 *   * It includes events still at department_review — approved by HOS/HOD (normal flow) or by
 *     the CFO (high-pax flow) but not yet fully approved — which no discovery endpoint returns.
 *   * Its rows are visibility-REDACTED per viewer rather than filtered away, so a row here may
 *     carry no details at all (see `restricted`).
 *
 * It is fetched in THREE tiers, and the split is the point: the grid asks for the least it can
 * draw a cell with, and each heavier shape is fetched only when the viewer asks for it.
 *
 *   tier 1  MasterCalendarSummary   one row per OCCURRENCE for the visible range. Paints the
 *                                   month/week grid, the mobile dots, the in-view counts and
 *                                   the legend. No description, image, pax, cost, registration
 *                                   count or club audience — none of it is on screen yet.
 *   tier 2  MasterCalendarDay       one day's rows, +venue +organiser, fetched on opening a day.
 *   tier 3  MasterCalendarEventDetail  one event's dialog payload, fetched on opening it.
 *
 * An occurrence is one SESSION of one event on one date: a multi-day event arrives as one row
 * per date, already expanded server-side beside the date filter.
 */

/**
 * A Club Only event the viewer does not belong to. The server sends the date and nothing else —
 * not the title, not the time, not even the event id — so the day reads as occupied and no more.
 * `occurrenceId` is an event_schedule row id, which no endpoint accepts, so it addresses nothing.
 */
export interface RestrictedOccurrence {
  readonly occurrenceId: string;
  readonly date: string;
  readonly restricted: true;
}

/** Tier 1: everything a month/week chip or a mobile dot draws, and nothing else. */
export interface VisibleOccurrence {
  readonly occurrenceId: string;
  readonly eventId: string;
  /** 'YYYY-MM-DD'. */
  readonly date: string;
  /** 'HH:MM', 24-hour, as stored. */
  readonly start: string;
  readonly end: string;
  readonly title: string;
  /** The event's FIRST category only — all the chip colour and the legend need. */
  readonly category: string;
  /** Still at department_review: on the calendar but not yet fully approved. */
  readonly provisional: boolean;
  readonly restricted: false;
}

/** Tier 2 adds the two fields a day-list row shows that a month chip does not. */
export interface VisibleDayOccurrence extends VisibleOccurrence {
  readonly venue: string;
  readonly organiser: string;
}

export type MasterCalendarOccurrence = VisibleOccurrence | RestrictedOccurrence;
export type MasterCalendarDayOccurrence = VisibleDayOccurrence | RestrictedOccurrence;

export interface MasterCalendarSummary {
  readonly occurrences: readonly MasterCalendarOccurrence[];
  /**
   * Per-date count of Private events, keyed 'YYYY-MM-DD'. Private events are never present in
   * `occurrences` in any form — the count is all the server sends, so there is nothing here that
   * could disclose one. Deliberately unaffected by the search term, and always empty for CFO/F&B,
   * who receive private events as ordinary visible rows instead.
   */
  readonly privateCounts: Readonly<Record<string, number>>;
}

export interface MasterCalendarDay {
  readonly occurrences: readonly MasterCalendarDayOccurrence[];
  readonly privateCount: number;
}

/** Tier 3: the detail dialog's payload for ONE event, fetched when the dialog opens. */
export interface MasterCalendarEventDetail {
  readonly id: string;
  readonly eventTitle: string;
  readonly shortIntroduction: string;
  readonly eventVisibility: EventVisibility;
  readonly eventFormat: string;
  readonly schoolDepartment: string;
  readonly organiser: string;
  /** 'department_review' | 'completed_approved'. */
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

/**
 * Narrowing helper so templates and computeds can branch on the discriminant. Generic over the
 * tier so it narrows a tier-2 row to VisibleDayOccurrence (venue/organiser included) rather than
 * flattening it back to the tier-1 shape.
 */
export function isVisibleOccurrence<T extends MasterCalendarDayOccurrence>(
  occurrence: T,
): occurrence is Extract<T, { readonly restricted: false }> {
  return !occurrence.restricted;
}
