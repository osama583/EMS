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
  return {
    id: String(row.event_registration_id),
    eventId: String(row.request_id),
    email: row.registrant_email,
    status: mapRegistrationStatus(row.status),
    paymentProofUrl: row.payment_proof_url || null,
    paymentProofFileName: row.payment_proof_file_name || null,
    paymentStatus: row.payment_status || 'not_required',
  };
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
    const { email, paymentProofUrl, paymentProofFileName } = req.body;
    const existing = db.event_registration.find((r) => r.request_id === request.request_id && r.registrant_email === email);
    if (existing) {
      return res.json({
        status: mapRegistrationStatus(existing.status) === 'confirmed' ? 'confirmed' : 'duplicate',
        message: 'You are already registered for this event.',
      });
    }
    const user = db.users.find((u) => u.email === email);
    const cost = request.cost_amount != null ? Number(request.cost_amount) : null;
    const isPaidEvent = cost != null && cost > 0;
    // Paid events always need human review of the payment proof, regardless of the event's
    // registration_approval mode — same inbox that already handles manual registration review.
    const status = isPaidEvent ? 'pending_approval' : (request.registration_approval === 'Automatic' ? 'registered' : 'pending_approval');
    const paymentStatus = isPaidEvent ? 'pending_review' : 'not_required';
    db.event_registration.push({
      event_registration_id: nextId('event_registration'),
      request_id: request.request_id,
      user_id: user ? user.user_id : null,
      registrant_name: user ? user.full_name : email,
      registrant_email: email,
      reason_for_attending: null,
      status,
      payment_proof_url: paymentProofUrl || null,
      payment_proof_file_name: paymentProofFileName || null,
      payment_status: paymentStatus,
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
    // Approving the registration approves the payment too — one combined action, no separate
    // payment-review step. Leave 'not_required' untouched (free event, nothing to approve).
    if (registration.payment_status === 'pending_review') registration.payment_status = 'approved';
    res.json(projectRegistration(registration));
  } catch (err) { next(err); }
});

router.post('/registrations/:id/reject', async (req, res, next) => {
  try {
    const registration = db.event_registration.find((r) => r.event_registration_id === Number(req.params.id));
    if (!registration) throw new WorkflowError('Registration not found.', 404);
    registration.status = 'rejected';
    if (registration.payment_status === 'pending_review') registration.payment_status = 'rejected';
    res.json(projectRegistration(registration));
  } catch (err) { next(err); }
});

module.exports = router;
