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

// Only the applicant or a co-owner of the underlying proposal may approve or reject a
// registration for their own event — the same ownership gate the proposal itself uses.
function assertEventOwner(requestId, actorEmail) {
  const actor = db.users.find((u) => u.email === actorEmail);
  if (!actor) throw new WorkflowError('Actor not found for the given actorEmail.', 400);
  workflow.assertProposalOwner(requestId, actor.user_id);
  return actor;
}

const REGISTRATION_REASON_MAX_LENGTH = 100;

function projectRegistration(row) {
  return {
    id: String(row.event_registration_id),
    eventId: String(row.request_id),
    email: row.registrant_email,
    // Name and reason are what the applicant actually reviews when registration_approval is
    // 'manual' (system specification §6) — they were collected but never surfaced.
    name: row.registrant_name,
    reason: row.reason_for_attending || '',
    registeredAt: row.registered_at,
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

// Every registration awaiting approval across all events this user owns (as applicant or
// co-owner) — the data behind the applicant's Inbox "Registrations" tab. Manual-approval events
// have no request_task of their own (a single-approver flow, see ems_database_schema.sql's note
// above event_registration), so this is a direct query rather than a workflow stage.
router.get('/registrations/pending', async (req, res, next) => {
  try {
    const actor = db.users.find((u) => u.email === req.query.email);
    if (!actor) throw new WorkflowError('Actor not found for the given email.', 400);
    const rows = db.event_registration
      .filter((r) => r.status === 'pending_approval')
      .filter((r) => workflow.isProposalOwner(r.request_id, actor.user_id))
      .map((r) => {
        const request = db.request.find((req2) => req2.request_id === r.request_id);
        return {
          ...projectRegistration(r),
          eventTitle: request ? request.event_title : '',
          eventCode: request ? request.request_code : '',
          paymentRequired: !!request && request.cost_amount != null && Number(request.cost_amount) > 0,
        };
      });
    res.json(rows);
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
    // Cancelled rows are skipped so the UI offers "Register" again rather than showing a stale
    // cancelled state (mirrors POST /:id/register's duplicate check).
    const registration = db.event_registration.find((r) => r.request_id === Number(req.params.id) && r.registrant_email === email && r.status !== 'cancelled');
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
    const { email, paymentProofUrl, paymentProofFileName, reason } = req.body;
    // Cancelled registrations are ignored here so someone who cancelled can register again —
    // matching the schema's partial unique index (uq_event_registration_active).
    const existing = db.event_registration.find((r) => r.request_id === request.request_id && r.registrant_email === email && r.status !== 'cancelled');
    if (existing) {
      return res.json({
        status: mapRegistrationStatus(existing.status) === 'confirmed' ? 'confirmed' : 'duplicate',
        message: existing.status === 'rejected'
          ? 'Your registration request for this event was declined.'
          : 'You are already registered for this event.',
      });
    }
    const user = db.users.find((u) => u.email === email);
    const isManual = request.registration_approval !== 'Automatic';
    const trimmedReason = String(reason || '').trim();
    if (isManual && !trimmedReason) {
      throw new WorkflowError('This event needs a short reason for attending before you can register.', 400);
    }
    if (trimmedReason.length > REGISTRATION_REASON_MAX_LENGTH) {
      throw new WorkflowError(`Keep your reason for attending to ${REGISTRATION_REASON_MAX_LENGTH} characters or fewer.`, 400);
    }
    // Registration capacity (request.max_pax) is enforced here, not in the browser — a full event
    // stops accepting registrations regardless of what the client shows. Pending approvals count
    // toward the cap so an organizer cannot over-commit while reviewing.
    if (request.max_pax != null && Number(request.max_pax) > 0) {
      const taken = db.event_registration.filter((r) => r.request_id === request.request_id && (r.status === 'registered' || r.status === 'pending_approval')).length;
      if (taken >= Number(request.max_pax)) {
        throw new WorkflowError('This event has reached its registration capacity.', 400);
      }
    }
    const cost = request.cost_amount != null ? Number(request.cost_amount) : null;
    const isPaidEvent = cost != null && cost > 0;
    // Paid events always need human review of the payment proof, regardless of the event's
    // registration_approval mode — same inbox that already handles manual registration review.
    const status = isPaidEvent || isManual ? 'pending_approval' : 'registered';
    const paymentStatus = isPaidEvent ? 'pending_review' : 'not_required';
    db.event_registration.push({
      event_registration_id: nextId('event_registration'),
      request_id: request.request_id,
      user_id: user ? user.user_id : null,
      registrant_name: user ? user.full_name : email,
      registrant_email: email,
      reason_for_attending: trimmedReason || null,
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
    assertEventOwner(registration.request_id, req.body.actorEmail);
    if (registration.status !== 'pending_approval') throw new WorkflowError('This registration is not awaiting approval.', 400);
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
    assertEventOwner(registration.request_id, req.body.actorEmail);
    if (registration.status !== 'pending_approval') throw new WorkflowError('This registration is not awaiting approval.', 400);
    registration.status = 'rejected';
    if (registration.payment_status === 'pending_review') registration.payment_status = 'rejected';
    res.json(projectRegistration(registration));
  } catch (err) { next(err); }
});

module.exports = router;
