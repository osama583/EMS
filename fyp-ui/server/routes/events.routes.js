const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { isPublishedEvent, projectPublishedEvent, publishedEvents } = require('../services/published-event-projection.service');

const router = express.Router();

function mapRegistrationStatus(status) {
  if (status === 'pending_approval') return 'pending';
  if (status === 'registered') return 'confirmed';
  return status;
}

function projectRegistration(row) {
  return { id: String(row.event_registration_id), eventId: String(row.request_id), email: row.registrant_email, status: mapRegistrationStatus(row.status) };
}

function findPublishedRequest(id) {
  const request = db.request.find((r) => r.request_id === Number(id));
  if (!request || !isPublishedEvent(request)) throw new WorkflowError('Published event not found.', 404);
  return request;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(publishedEvents());
  } catch (err) { next(err); }
});

router.get('/my-registrations', async (req, res, next) => {
  try {
    const { email, scope } = req.query;
    const registrations = db.event_registration.filter((r) => r.registrant_email === email);
    const items = [];
    for (const registration of registrations) {
      const request = db.request.find((r) => r.request_id === registration.request_id);
      if (!request || !isPublishedEvent(request)) continue;
      const schedule = db.event_schedule.find((s) => s.request_id === request.request_id);
      const ended = schedule ? new Date(`${schedule.date}T${schedule.end_time || '23:59'}:00`).getTime() < Date.now() : false;
      const isHistory = ended;
      if ((scope === 'history') !== isHistory) continue;
      items.push({ event: projectPublishedEvent(request), status: mapRegistrationStatus(registration.status) });
    }
    res.json({ items, total: items.length });
  } catch (err) { next(err); }
});

router.get('/:id/registration-count', async (req, res, next) => {
  try {
    const event = projectPublishedEvent(findPublishedRequest(req.params.id));
    res.json({ count: event.confirmedRegistrationCount });
  } catch (err) { next(err); }
});

router.get('/:id/registrations/mine', async (req, res, next) => {
  try {
    findPublishedRequest(req.params.id);
    const { email } = req.query;
    const registration = db.event_registration.find((r) => r.request_id === Number(req.params.id) && r.registrant_email === email);
    res.json(registration ? projectRegistration(registration) : null);
  } catch (err) { next(err); }
});

router.get('/:id/registrations', async (req, res, next) => {
  try {
    findPublishedRequest(req.params.id);
    let registrations = db.event_registration.filter((r) => r.request_id === Number(req.params.id));
    if (req.query.status === 'pending') registrations = registrations.filter((r) => r.status === 'pending_approval');
    res.json(registrations.map(projectRegistration));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json(projectPublishedEvent(findPublishedRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/register', async (req, res, next) => {
  try {
    const request = findPublishedRequest(req.params.id);
    const { email } = req.body;
    const existing = db.event_registration.find((r) => r.request_id === request.request_id && r.registrant_email === email);
    if (existing) {
      return res.json({
        status: mapRegistrationStatus(existing.status) === 'confirmed' ? 'confirmed' : 'duplicate',
        message: 'You are already registered for this event.',
      });
    }
    const user = db.users.find((u) => u.email === email);
    const status = request.registration_approval === 'Automatic' ? 'registered' : 'pending_approval';
    db.event_registration.push({
      event_registration_id: nextId('event_registration'),
      request_id: request.request_id,
      user_id: user ? user.user_id : null,
      registrant_name: user ? `${user.first_name} ${user.last_name}` : email,
      registrant_email: email,
      reason_for_attending: null,
      status,
      registered_at: new Date().toISOString(),
    });
    res.json({
      status: status === 'registered' ? 'confirmed' : 'pending',
      message: status === 'registered' ? 'You are registered for this event.' : 'Your registration request has been submitted for approval.',
    });
  } catch (err) { next(err); }
});

router.post('/registrations/:id/approve', async (req, res, next) => {
  try {
    const registration = db.event_registration.find((r) => r.event_registration_id === Number(req.params.id));
    if (!registration) throw new WorkflowError('Registration not found.', 404);
    registration.status = 'registered';
    res.json(projectRegistration(registration));
  } catch (err) { next(err); }
});

router.post('/registrations/:id/reject', async (req, res, next) => {
  try {
    const registration = db.event_registration.find((r) => r.event_registration_id === Number(req.params.id));
    if (!registration) throw new WorkflowError('Registration not found.', 404);
    registration.status = 'rejected';
    res.json(projectRegistration(registration));
  } catch (err) { next(err); }
});

module.exports = router;
