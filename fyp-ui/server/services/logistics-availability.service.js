// Pure derived-data computation for Logistics availability — no db/route concerns here, mirrors
// the shape of published-event-projection.service.js. Business rule (confirmed with the user):
// only request_logistics rows belonging to a `request` with status='completed_approved' count as
// "committed" against an option's available_quantity. A committed booking occupies its
// [start_time, end_time + BUFFER_MINUTES) window — the buffer covers physically moving items
// between events — and two windows are "overlapping" using the standard half-open interval test
// (startA < endB && startB < endA).
const BUFFER_MINUTES = 15;

function toMinutes(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  return hour * 60 + minute;
}

function fromMinutes(totalMinutes) {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function windowsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

// db: the module's live db object. optionId: e.g. "logistics:3" (request_logistics.option_id,
// matching the string id format request-options.routes.js hands to the frontend). date:
// "YYYY-MM-DD". start/end: "HH:MM". Returns committed windows overlapping [start, end) for that
// option/date, each with its buffered end time, sorted by buffered end ascending.
function committedWindowsFor(db, optionId, date, start, end) {
  const requestedStart = toMinutes(start);
  const requestedEnd = toMinutes(end);
  return db.request_logistics
    .filter((row) => row.option_id === optionId && row.date === date)
    .filter((row) => {
      const request = db.request.find((r) => r.request_id === row.request_id);
      return request && request.status === 'completed_approved';
    })
    .map((row) => {
      const startMinutes = toMinutes(row.start_time);
      const bufferedEndMinutes = toMinutes(row.end_time) + BUFFER_MINUTES;
      return {
        quantity: row.quantity,
        startTime: row.start_time,
        endTime: row.end_time,
        bufferedEndTime: fromMinutes(bufferedEndMinutes),
        startMinutes,
        bufferedEndMinutes,
      };
    })
    .filter((window) => windowsOverlap(requestedStart, requestedEnd, window.startMinutes, window.bufferedEndMinutes))
    .sort((a, b) => a.bufferedEndMinutes - b.bufferedEndMinutes);
}

// Walks forward through the overlapping committed windows in the order they free up capacity,
// returning the first buffered-end time at which cumulative freed quantity brings remaining
// capacity to at least `requestedQuantity`. Returns null if even freeing everything isn't enough
// (caller should fall back to "unavailable for the foreseeable future" messaging) or if nothing
// is currently blocking (shouldn't be called in that case — remaining already covers the ask).
function nextAvailableAt(availableQuantity, committedWindows, requestedQuantity) {
  let remaining = availableQuantity - committedWindows.reduce((sum, w) => sum + w.quantity, 0);
  for (const window of committedWindows) {
    remaining += window.quantity;
    if (remaining >= requestedQuantity) return window.bufferedEndTime;
  }
  return null;
}

// Main entry point: computes { availableQuantity, remainingQuantity, committedWindows,
// nextAvailableAt } for a given logistics option and requested [date, start, end] window.
// requestedQuantity is optional — when given and remaining is insufficient, nextAvailableAt is
// populated; otherwise it's null.
function computeAvailability(db, { optionId, availableQuantity, date, start, end, requestedQuantity }) {
  const committedWindows = committedWindowsFor(db, optionId, date, start, end);
  const committedTotal = committedWindows.reduce((sum, w) => sum + w.quantity, 0);
  const remainingQuantity = availableQuantity - committedTotal;
  const wantsMoreThanRemains = typeof requestedQuantity === 'number' && requestedQuantity > remainingQuantity;
  return {
    availableQuantity,
    remainingQuantity,
    committedWindows: committedWindows.map(({ quantity, startTime, endTime, bufferedEndTime }) => ({ quantity, startTime, endTime, bufferedEndTime })),
    nextAvailableAt: wantsMoreThanRemains ? nextAvailableAt(availableQuantity, committedWindows, requestedQuantity) : null,
  };
}

module.exports = { computeAvailability, committedWindowsFor, nextAvailableAt, BUFFER_MINUTES, toMinutes, fromMinutes };
