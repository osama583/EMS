const express = require('express');
const { db } = require('../db');
const { isPublishedEvent, projectPublishedEvent } = require('../services/published-event-projection.service');

const router = express.Router();

// notification-preferences has NO backing table in ems_database_schema.sql (system.md §8
// flags notifications as a future addition, not built) — stored in db.notification_preference,
// a mock-layer-only table (one row per user email), so it persists to db.json like every other
// table instead of being lost on server restart.
const DEFAULT_PREFERENCES = {
  registrationClosingReminder: true,
  eventStartingReminder: true,
  registrationClosingStatus: 'pending-api',
  eventStartingStatus: 'pending-api',
};

function findPreferenceRow(email) {
  return db.notification_preference.find((p) => p.email === email);
}

router.get('/saved', async (req, res, next) => {
  try {
    const { email } = req.query;
    const savedRows = db.saved_event.filter((s) => {
      const user = db.users.find((u) => u.user_id === s.user_id);
      return user && user.email === email;
    });
    const items = savedRows
      .map((s) => db.request.find((r) => r.request_id === s.request_id))
      .filter((r) => r && isPublishedEvent(r))
      .map(projectPublishedEvent);
    res.json({ items, total: items.length });
  } catch (err) { next(err); }
});

router.post('/saved', async (req, res, next) => {
  try {
    const { email, eventId } = req.body;
    const user = db.users.find((u) => u.email === email);
    const requestId = Number(eventId);
    const alreadySaved = user && db.saved_event.some((s) => s.user_id === user.user_id && s.request_id === requestId);
    if (user && !alreadySaved) {
      db.saved_event.push({ user_id: user.user_id, request_id: requestId, saved_at: new Date().toISOString() });
    }
    res.json({ eventId, saved: true });
  } catch (err) { next(err); }
});

router.delete('/saved/:eventId', async (req, res, next) => {
  try {
    const { email } = req.query;
    const user = db.users.find((u) => u.email === email);
    const requestId = Number(req.params.eventId);
    if (user) {
      const index = db.saved_event.findIndex((s) => s.user_id === user.user_id && s.request_id === requestId);
      if (index !== -1) db.saved_event.splice(index, 1);
    }
    res.json({ eventId: req.params.eventId, saved: false });
  } catch (err) { next(err); }
});

router.get('/notification-preferences', async (req, res, next) => {
  try {
    const { email } = req.query;
    const row = findPreferenceRow(email);
    res.json(row ? { registrationClosingReminder: row.registration_closing_reminder, eventStartingReminder: row.event_starting_reminder, registrationClosingStatus: row.registration_closing_status, eventStartingStatus: row.event_starting_status } : DEFAULT_PREFERENCES);
  } catch (err) { next(err); }
});

router.put('/notification-preferences', async (req, res, next) => {
  try {
    const { email, ...preferences } = req.body;
    const existing = findPreferenceRow(email);
    const current = existing ? { registrationClosingReminder: existing.registration_closing_reminder, eventStartingReminder: existing.event_starting_reminder, registrationClosingStatus: existing.registration_closing_status, eventStartingStatus: existing.event_starting_status } : DEFAULT_PREFERENCES;
    const merged = { ...current, ...preferences };
    const row = {
      email,
      registration_closing_reminder: merged.registrationClosingReminder,
      event_starting_reminder: merged.eventStartingReminder,
      registration_closing_status: merged.registrationClosingStatus,
      event_starting_status: merged.eventStartingStatus,
    };
    if (existing) Object.assign(existing, row);
    else db.notification_preference.push(row);
    res.json(merged);
  } catch (err) { next(err); }
});

module.exports = router;
