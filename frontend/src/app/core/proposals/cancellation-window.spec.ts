import { describe, expect, it } from 'vitest';
import { cancellationWindowFor, earliestScheduleDate, parseScheduleDate } from './cancellation-window';

// The boundary these assert is the server's: workflow/authorization.py cancels while
// `today <= firstEventDay - CANCELLATION_DEADLINE_DAYS`. A drift here would quote the applicant
// a date the server would not honour.
describe('cancellationWindowFor', () => {
  const today = new Date(2026, 8, 1); // 1 Sep 2026

  it('counts the days between today and the last cancellable day', () => {
    const window = cancellationWindowFor(new Date(2026, 8, 30), 3, today)!;
    expect(window.lastDay).toEqual(new Date(2026, 8, 27));
    expect(window.daysRemaining).toBe(26);
    expect(window.passed).toBe(false);
  });

  it('reports zero days remaining on the last cancellable day, still open', () => {
    const window = cancellationWindowFor(new Date(2026, 8, 4), 3, today)!;
    expect(window.daysRemaining).toBe(0);
    expect(window.passed).toBe(false);
  });

  it('reports the window closed once the last day has gone', () => {
    const window = cancellationWindowFor(new Date(2026, 8, 3), 3, today)!;
    expect(window.daysRemaining).toBe(-1);
    expect(window.passed).toBe(true);
  });

  it('treats a zero-day deadline as cancellable up to the event date itself', () => {
    const window = cancellationWindowFor(new Date(2026, 8, 1), 0, today)!;
    expect(window.daysRemaining).toBe(0);
    expect(window.passed).toBe(false);
  });

  it('has no window to quote without an event date', () => {
    expect(cancellationWindowFor(null, 3, today)).toBeNull();
  });

  // The two callers hold different shapes: the form has ISO rows, a projected proposal has
  // rendered text.
  it('parses both the schedule table and a rendered proposal string', () => {
    expect(parseScheduleDate('2026-09-30')).toEqual(new Date(2026, 8, 30));
    expect(parseScheduleDate('8 Aug 2026 · 4:00 PM')).toEqual(new Date(2026, 7, 8));
    expect(parseScheduleDate('')).toBeNull();
  });

  it('measures from the earliest scheduled day, not the first row entered', () => {
    const rows = [{ date: '2026-09-30' }, { date: '2026-09-12' }, { date: '2026-10-02' }];
    expect(earliestScheduleDate(rows)).toEqual(new Date(2026, 8, 12));
  });

  it('has nothing to measure from when no row carries a date yet', () => {
    expect(earliestScheduleDate([{ date: '' }])).toBeNull();
    expect(earliestScheduleDate(undefined)).toBeNull();
  });
});
