// Seeds config table with mock-backend-wide tunable values.

module.exports = function seedConfig(db) {
  db.config.push(
    { code: 'HIGH_PAX_THRESHOLD', number: 50 },
    { code: 'CANCELLATION_DEADLINE_DAYS', number: 3 },
    { code: 'MAX_EVENT_CATEGORIES', number: 2 },
  );
};
