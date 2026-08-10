const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { projectProposal } = require('../services/proposal-projection.service');

const router = express.Router();

// Single consistent actor-identification convention for every mutating route in this router
// (Task 3.8's remaining 8 routers should copy this pattern rather than the previous mix of
// reviewerRole / confirmedByEmail / cancelledBy / implicit-role-lookup schemes). Callers
// identify themselves via `actorEmail` in the request body; routes that additionally require a
// specific role check `actor.role === '...'` after resolving the actor.
function resolveActor(req) {
  const actor = db.users.find((u) => u.email === req.body.actorEmail);
  if (!actor) throw new WorkflowError('Actor not found or actorEmail missing.', 400);
  return actor;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(db.request.map((r) => projectProposal(r)));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const request = db.request.find((r) => r.request_id === Number(req.params.id));
    if (!request) return res.status(404).json({ message: 'Proposal not found.' });
    res.json(projectProposal(request));
  } catch (err) { next(err); }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActor(req);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.approveReviewerStage(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActor(req);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.rejectReviewerStage(req.params.id, actor.user_id, reason);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const { comment } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActor(req);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.resubmitReviewerStage(req.params.id, actor.user_id, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/confirm-department', async (req, res, next) => {
  try {
    const { department } = req.body;
    const actor = resolveActor(req);
    workflow.approveDepartmentTask(req.params.id, department, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit-department', async (req, res, next) => {
  try {
    const { department, comment } = req.body;
    // NOTE: this endpoint's Angular caller (proposal-department-view.ts's resubmit()) does not
    // currently send the actor's identity in the body — it's derived from AuthService client-side
    // in the original design. For the mock server we now require the same `actorEmail` convention
    // as every other mutating route (see resolveActor above), and additionally verify the actor
    // holds the manager role for the target department. This map uses the ACTUAL seeded role
    // strings from server/db/seed-users.js (which use hyphens, e.g. 'logistics-manager',
    // 'transport-manager', 'photography-manager', 'av-manager', 'student-services-manager',
    // 'cafeteria-manager') rather than workflow.service.js's internal `roleForRequirement` map
    // (createDepartmentTasks, ~line 257), whose underscored role strings ('logistics_manager',
    // 'transportation_manager', 'photo_video_manager', 'sound_light_manager',
    // 'student_services_manager') do not match any seeded user and are never read back elsewhere
    // in the codebase yet — that mismatch is a pre-existing latent issue in Task 3.4's
    // request_task.assigned_role field, out of scope to fix here.
    const managerRoleFor = { logistics: 'logistics-manager', transportation: 'transport-manager', photoVideo: 'photography-manager', soundLight: 'av-manager', campusTour: 'student-services-manager', fmb: 'cafeteria-manager', fundingPurchase: 'cfo' };
    const actor = resolveActor(req);
    const expectedRole = managerRoleFor[department];
    if (expectedRole && actor.role !== expectedRole) throw new WorkflowError(`Only the ${expectedRole} can resubmit this department's task.`, 403);
    workflow.resubmitDepartmentTask(req.params.id, department, actor.user_id, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit-applicant', async (req, res, next) => {
  try {
    // req.body carries Partial<ProposalReviewRecord> from Angular — the mock server does not
    // attempt to re-decompose this back into every underlying snapshot table (that would require
    // re-implementing the entire event-proposal form's field mapping server-side, out of scope
    // for a mock). Instead, apply only the top-level fields that map directly onto the `request`
    // row's own columns, and ignore the rest — sufficient for validating the STAGE TRANSITION
    // behavior (the actual point of this endpoint), even though it doesn't fully persist a
    // resubmitted proposal's edited request/table details end-to-end.
    const allowedFields = ['eventTitle', 'shortIntroduction', 'goals', 'benefits', 'totalPax'];
    const fieldMap = { eventTitle: 'event_title', shortIntroduction: 'short_introduction', goals: 'goals_objectives', benefits: 'expected_benefits', totalPax: 'total_pax' };
    const updates = {};
    for (const field of allowedFields) if (req.body[field] !== undefined) updates[fieldMap[field]] = req.body[field];
    workflow.applicantResubmit(req.params.id, updates);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const actor = resolveActor(req);
    workflow.authorizeAction(req.params.id, actor, 'cancel');
    workflow.cancelProposal(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/approve', async (req, res, next) => {
  try {
    const actor = resolveActor(req);
    if (actor.role !== 'cafeteria-manager') throw new WorkflowError('Only the cafeteria manager can approve this order.', 403);
    workflow.approveFmbSelection(req.params.selectionId, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/resubmit', async (req, res, next) => {
  try {
    const actor = resolveActor(req);
    if (actor.role !== 'cafeteria-manager') throw new WorkflowError('Only the cafeteria manager can resubmit this order.', 403);
    workflow.resubmitFmbSelection(req.params.selectionId, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

module.exports = router;
