const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { projectProposal } = require('../services/proposal-projection.service');

const router = express.Router();

// Angular's ApiProposalWorkflowRepository (core/proposals/proposal-workflow.repository.ts, Task
// 2.10, already committed) sends a DIFFERENT actor-identifying field per route — not a unified
// `actorEmail`. These helpers mirror that per-route contract exactly, while still guarding every
// lookup with a null check before dereferencing (thrown as a 400 WorkflowError) instead of letting
// a missing/unmatched actor crash further down as a TypeError.
function resolveActorByRole(req) {
  const actor = db.users.find((u) => u.role === req.body.reviewerRole);
  if (!actor) throw new WorkflowError('Actor not found for the given reviewerRole.', 400);
  return actor;
}
function resolveActorByEmail(req, field) {
  const actor = db.users.find((u) => u.email === req.body[field]);
  if (!actor) throw new WorkflowError(`Actor not found for the given ${field}.`, 400);
  return actor;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(db.request.map((r) => projectProposal(r)));
  } catch (err) { next(err); }
});

// Creates a brand-new proposal from the event-proposal form's full submission payload and
// immediately routes it into the workflow (see workflow.service.js's createProposal, which
// calls submitProposal() internally) — the applicant never sees a bare 'draft' state.
router.post('/', async (req, res, next) => {
  try {
    const { draftRequestId, ...payload } = req.body;
    const request = workflow.createProposal(payload, draftRequestId);
    res.status(201).json(projectProposal(request));
  } catch (err) { next(err); }
});

// "Save as Draft" — persists the form's current in-progress state without entering the review
// workflow. req.body.draftRequestId (optional, set by the Angular form after its first save)
// targets an existing draft row for update-in-place instead of creating a new row on every
// click within the same editing session.
router.post('/draft', async (req, res, next) => {
  try {
    const { draftRequestId, ...payload } = req.body;
    const request = workflow.saveDraft(payload, draftRequestId);
    res.status(200).json(projectProposal(request));
  } catch (err) { next(err); }
});

// Deletes a draft (status='draft' only) — used by the Drafts list's delete action.
router.delete('/:id', async (req, res, next) => {
  try {
    workflow.deleteDraft(req.params.id);
    res.status(204).end();
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
    const actor = resolveActorByRole(req);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.approveReviewerStage(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActorByRole(req);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.rejectReviewerStage(req.params.id, actor.user_id, reason);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const { comment } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActorByRole(req);
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.resubmitReviewerStage(req.params.id, actor.user_id, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/confirm-department', async (req, res, next) => {
  try {
    const { department } = req.body;
    const actor = resolveActorByEmail(req, 'confirmedByEmail');
    workflow.approveDepartmentTask(req.params.id, department, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit-department', async (req, res, next) => {
  try {
    const { department, comment } = req.body;
    // NOTE: this endpoint's Angular caller (proposal-department-view.ts's resubmit()) does not
    // send any actor identity in the body at all — it's derived from AuthService client-side in
    // the original design, and Angular's resubmitAsDepartment() body is just { department, comment }.
    // For the mock server, look up ANY user with a role matching this department's manager role as
    // a stand-in actor (acceptable simplification — a real backend would authenticate the request
    // and use the actual session user). This map uses the ACTUAL seeded role
    // strings (hyphenated, e.g. 'logistics-manager', 'transport-manager', 'photography-manager',
    // 'av-manager', 'student-services-manager',
    // 'cafeteria-manager') rather than workflow.service.js's internal `roleForRequirement` map
    // (createDepartmentTasks, ~line 257), whose underscored role strings ('logistics_manager',
    // 'transportation_manager', 'photo_video_manager', 'sound_light_manager',
    // 'student_services_manager') do not match any seeded user and are never read back elsewhere
    // in the codebase yet — that mismatch is a pre-existing latent issue in Task 3.4's
    // request_task.assigned_role field, out of scope to fix here.
    const managerRoleFor = { logistics: 'logistics-manager', transportation: 'transport-manager', photoVideo: 'photography-manager', soundLight: 'av-manager', campusTour: 'student-services-manager', fmb: 'cafeteria-manager', fundingPurchase: 'cfo' };
    const actor = db.users.find((u) => u.role === managerRoleFor[department]);
    if (!actor) throw new WorkflowError(`No user found with the ${managerRoleFor[department]} role.`, 400);
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
    const actor = resolveActorByEmail(req, 'cancelledBy');
    workflow.authorizeAction(req.params.id, actor, 'cancel');
    workflow.cancelProposal(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/approve', async (req, res, next) => {
  try {
    const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
    if (!cafeteriaManager) throw new WorkflowError('No user found with the cafeteria-manager role.', 400);
    workflow.approveFmbSelection(req.params.selectionId, cafeteriaManager.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/resubmit', async (req, res, next) => {
  try {
    const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
    if (!cafeteriaManager) throw new WorkflowError('No user found with the cafeteria-manager role.', 400);
    workflow.resubmitFmbSelection(req.params.selectionId, cafeteriaManager.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

module.exports = router;
