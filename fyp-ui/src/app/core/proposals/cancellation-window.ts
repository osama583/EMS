// The applicant-facing side of CANCELLATION_DEADLINE_DAYS.
//
// The server owns the rule (workflow/authorization.py's is_within_cancellation_window:
// `today <= firstEventDay - deadlineDays`). This computes the same boundary so the form and
// the review page can say what it will be, and can never quote a different date to the one
// the server would enforce.

export interface CancellationWindow {
  /** Last day the applicant may still cancel. */
  readonly lastDay: Date;
  /** Whole days from today until lastDay. 0 means today is the last day. */
  readonly daysRemaining: number;
  /** True once lastDay is behind us — cancellation is closed. */
  readonly passed: boolean;
}

const MS_PER_DAY = 86_400_000;

/** Midnight local time, so a comparison is between dates and never between times of day. */
function atMidnight(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/**
 * Accepts what the two callers actually hold: an ISO `yyyy-mm-dd` from the schedule table, or a
 * rendered string like "8 Aug 2026 · 4:00 PM" from a projected proposal.
 */
export function parseScheduleDate(raw: string | number | null | undefined): Date | null {
  const text = String(raw ?? '').split('·')[0].split(',')[0].trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return atMidnight(parsed);

  const written = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (written) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(written[2].slice(0, 3).toLowerCase());
    if (month >= 0) return new Date(+written[3], month, +written[1]);
  }
  return null;
}

/**
 * The window for an event starting on `eventDate`, or null when there is no date to measure
 * against yet — an unscheduled proposal has no deadline to quote.
 */
export function cancellationWindowFor(
  eventDate: Date | null,
  deadlineDays: number,
  today: Date = new Date(),
): CancellationWindow | null {
  if (!eventDate || isNaN(eventDate.getTime())) return null;

  const lastDay = atMidnight(eventDate);
  lastDay.setDate(lastDay.getDate() - Math.max(0, deadlineDays));

  const daysRemaining = Math.round((lastDay.getTime() - atMidnight(today).getTime()) / MS_PER_DAY);
  return { lastDay, daysRemaining, passed: daysRemaining < 0 };
}

/** The earliest date across schedule rows — the one the deadline is measured from. */
export function earliestScheduleDate(
  rows: readonly { readonly [key: string]: string | number }[] | undefined,
): Date | null {
  const dates = (rows ?? [])
    .map((row) => parseScheduleDate(row['date']))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}
