import { formatScheduleDate, formatScheduleTime, joinScheduleRows } from './hub-proposals';

// The proposal tables split one schedule into three columns (date / time / location). What can
// break is the alignment between them and the timezone the bare date is read in — both here.
describe('hub-proposals schedule cells', () => {
  const rows = [
    { date: '2026-01-12', start: '09:00:00', end: '17:00:00', location: 'Auditorium' },
    { date: '2026-01-13', start: '14:00:00', end: '16:30:00', location: 'Hall B' },
  ];

  it('keeps every session, in order, across all three columns', () => {
    // Built from the same call rather than a literal: the display format follows the reader's
    // locale (as it does everywhere else in the app), so only the ORDER is asserted here.
    expect(joinScheduleRows(rows, (row) => formatScheduleDate(String(row['date'])))).toBe(`${formatScheduleDate('2026-01-12')}, ${formatScheduleDate('2026-01-13')}`);
    expect(joinScheduleRows(rows, (row) => formatScheduleTime(String(row['start']), String(row['end'])))).toBe('09:00–17:00, 14:00–16:30');
    expect(joinScheduleRows(rows, (row) => String(row['location']))).toBe('Auditorium, Hall B');
  });

  it('shows a dash rather than an empty cell when there is no schedule', () => {
    expect(joinScheduleRows([], (row) => String(row['date']))).toBe('—');
  });

  // `new Date('2026-01-12')` parses as UTC and prints 11 Jan west of it.
  it('reads a bare date in local time, not UTC', () => {
    expect(formatScheduleDate('2026-01-12')).toBe(new Date(2026, 0, 12).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
  });

  it('drops the seconds the server sends', () => {
    expect(formatScheduleTime('09:00:00', '17:00:00')).toBe('09:00–17:00');
  });
});
