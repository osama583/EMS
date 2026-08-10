const express = require('express');
const { db } = require('../db');
const { isPublishedEvent, projectPublishedEvent } = require('../services/published-event-projection.service');

const router = express.Router();

// notification-preferences has NO backing table in ems_database_schema.sql (system.md §8
// flags notifications as a future addition, not built) — stored in-memory, local to this
// router, keyed by email. NOT a db.js table since it's outside the schema entirely.
const notificationPreferences = new Map();
const DEFAULT_PREFERENCES = {
  registrationClosingReminder: true,
  eventStartingReminder: true,
  registrationClosingStatus: 'pending-api',
  eventStartingStatus: 'pending-api',
};

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
    res.json(notificationPreferences.get(email) || DEFAULT_PREFERENCES);
  } catch (err) { next(err); }
});

router.put('/notification-preferences', async (req, res, next) => {
  try {
    const { email, ...preferences } = req.body;
    const merged = { ...DEFAULT_PREFERENCES, ...notificationPreferences.get(email), ...preferences };
    notificationPreferences.set(email, merged);
    res.json(merged);
  } catch (err) { next(err); }
});

module.exports = router;
