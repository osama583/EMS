const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { projectProposal } = require('../services/proposal-projection.service');

const router = express.Router();

// Angular's ApiProposalWorkflowRepository (core/proposals/proposal-workflow.repository.ts) sends
// a DIFFERENT actor-identifying field per route. These helpers mirror that per-route contract
// exactly, while still guarding every lookup with a null check before dereferencing (thrown as a
// 400 WorkflowError) instead of letting a missing/unmatched actor crash further down as a
// TypeError.
//
// Unit + Level model: the /approve, /reject, /resubmit routes used to resolve the acting
// reviewer by `req.body.reviewerRole` (find the FIRST user with role==='hos-hod', etc.) — that
// was already a latent correctness gap (picks an arbitrary matching user, not necessarily the
// one actually logged in) that became actively WRONG once HOS/HOD/F&B stopped being distinct
// role strings: 'manager' now matches every unit-scoped manager account across every School and
// Service department, so resolveActorByRole would resolve to essentially a random manager.
// Angular now sends `reviewerEmail` (the real logged-in AuthUser.email) instead — resolved the
// same way resolveActorByEmail() below already resolves cancel/confirm-department actors.
function resolveActorByEmail(req, field) {
  const actor = db.users.find((u) => u.email === req.body[field]);
  if (!actor) throw new WorkflowError(`Actor not found for the given ${field}.`, 400);
  return actor;
}

// Same resolution for routes with no body to carry the actor (DELETE).
function resolveActorByQuery(req, field) {
  const actor = db.users.find((u) => u.email === req.query[field]);
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

// Deletes a draft (status='draft' only) — used by the Drafts list's delete action. Only the
// applicant or a co-owner may delete; the actor is identified by the `actorEmail` query param
// (this mock backend has no session middleware — a real deployment would read it from the token).
router.delete('/:id', async (req, res, next) => {
  try {
    const actor = resolveActorByQuery(req, 'actorEmail');
    workflow.deleteDraft(req.params.id, actor.user_id);
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
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.approveReviewerStage(req.params.id, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.rejectReviewerStage(req.params.id, actor.user_id, reason);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const { comment } = req.body;
    const request = workflow.findRequest(req.params.id);
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    workflow.authorizeAction(req.params.id, actor, request.status);
    workflow.resubmitReviewerStage(req.params.id, actor.user_id, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/confirm-department', async (req, res, next) => {
  try {
    const { department } = req.body;
    // approveDepartmentTask() authorizes internally (authorizeDepartmentTask): the actor must
    // head the unit this requirement is routed to, and the proposal must be in department review.
    const actor = resolveActorByEmail(req, 'confirmedByEmail');
    workflow.approveDepartmentTask(req.params.id, department, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/resubmit-department', async (req, res, next) => {
  try {
    const { department, comment } = req.body;
    // The acting department head is now identified by their real logged-in email (Angular's
    // resubmitAsDepartment() sends `reviewerEmail`), not guessed by searching for "any manager of
    // this unit" — resubmitDepartmentTask() then runs the same authorizeDepartmentTask() gate as
    // approve, so only the head of the routed unit can push a request back.
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    workflow.resubmitDepartmentTask(req.params.id, department, actor.user_id, comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

// Applicant resubmits a proposal a reviewer sent back for changes. req.body carries the
// event-proposal form's FULL submission payload (same shape as POST / and POST /draft) — every
// field the applicant edited (including child tables: schedule, co-owners, requests, etc.) is
// persisted via workflow.applicantResubmit(), which delegates to saveRequestContent() before
// doing the stage transition. draftRequestId is stripped like the other two routes do, since a
// resubmission-required proposal is never itself a draft row.
router.post('/:id/resubmit-applicant', async (req, res, next) => {
  try {
    const { draftRequestId, actorEmail, ...payload } = req.body;
    const actor = resolveActorByEmail(req, 'actorEmail');
    workflow.applicantResubmit(req.params.id, payload, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

// "Save changes without resubmitting" — an applicant editing a resubmission-required proposal can
// persist their in-progress edits (full form payload, same shape as above) without leaving the
// stage that sent it back to them and without clearing the reviewer's comment. Stays in the
// applicant's Inbox exactly where it was; only a subsequent POST /:id/resubmit-applicant advances
// the workflow. Gated to resubmission_required for now (the only caller today), but
// saveRequestContent() itself has no such opinion — see its comment in workflow.service.js.
router.post('/:id/save-edits', async (req, res, next) => {
  try {
    const request = workflow.findRequest(req.params.id);
    // Also allowed while a DEPARTMENT has pushed one of its tasks back: the proposal itself stays
    // in department_review (parallel independence), so gating strictly on resubmission_required
    // would leave that applicant unable to save work-in-progress edits.
    const departmentSentBack = request.status === 'department_review'
      && db.request_task.some((t) => t.request_id === request.request_id && t.status === 'resubmitted');
    if (request.status !== 'resubmission_required' && !departmentSentBack) {
      throw new WorkflowError(`Cannot save edits from status ${request.status}.`, 400);
    }
    const { draftRequestId, actorEmail, ...payload } = req.body;
    const actor = resolveActorByEmail(req, 'actorEmail');
    workflow.saveRequestContent(req.params.id, payload, actor.user_id);
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

// 2026-08-17 Cafeteria refactor: 'cafeteria-manager' is a real, unit-linked role again (see
// db.js's seedCafeteriaDomain()) — each request_fmb_selection row belongs to a specific cafeteria
// (selection.unit_code), and ONLY that cafeteria's own Cafeteria Manager may approve/resubmit it,
// same authorization shape as isHosHodOfUnit/isManagerOfUnit elsewhere in workflow.service.js.
// Previously this resolved to "any F&B head-of-department" regardless of who actually called the
// endpoint — a stale leftover from when the cafeteria-manager role was briefly retired.
function isCafeteriaManagerOfSelection(actorUserId, selection) {
  return db.user_unit_roles.some((uur) => uur.user_id === actorUserId && uur.unit_code === selection.unit_code && uur.role_code === 'cafeteria-manager');
}

function isFmbHead(actorUserId) {
  return db.user_unit_roles.some((uur) => uur.user_id === actorUserId && uur.unit_code === 'food_beverage_services' && uur.role_code === 'head-of-department');
}

// F&B reads a proposal's raw food/water requests (request_fmb rows, surfaced as "Your
// Department's Requested Items") and fans each one out into one or more concrete cafeteria
// orders — one row per order, until the requested pax/quantity is fulfilled (per-request, not
// atomic — matches createFmbSelection()'s existing per-cafeteria design in workflow.service.js).
// Each created row starts 'pending' in the OWNING cafeteria's Cafeteria Manager's Inbox; F&B
// itself never approves its own selection (see isCafeteriaManagerOfSelection above).
router.post('/:id/fmb-selections', async (req, res, next) => {
  try {
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    if (!isFmbHead(actor.user_id)) throw new WorkflowError('Only Food & Beverage Services can create cafeteria orders.', 403);
    const { requestFmbId, cafeteriaCode, fmbOptionId, menuItemLabel, quantity, notes } = req.body;
    if (!requestFmbId || !cafeteriaCode || !fmbOptionId || !menuItemLabel || !quantity) {
      throw new WorkflowError('requestFmbId, cafeteriaCode, fmbOptionId, menuItemLabel, and quantity are required.', 400);
    }
    const fmbRow = db.request_fmb.find((f) => f.request_fmb_id === Number(requestFmbId) && f.request_id === Number(req.params.id));
    if (!fmbRow) throw new WorkflowError('Request item not found on this proposal.', 404);
    const cafeteria = db.unit.find((u) => u.code === cafeteriaCode && !u.archived_at && u.is_active);
    if (!cafeteria) throw new WorkflowError('Cafeteria not found or inactive.', 400);
    workflow.createFmbSelection(requestFmbId, cafeteriaCode, fmbOptionId, menuItemLabel, quantity, notes);
    res.status(201).json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/approve', async (req, res, next) => {
  try {
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    const selection = workflow.findFmbSelection(req.params.selectionId);
    if (!isCafeteriaManagerOfSelection(actor.user_id, selection)) throw new WorkflowError('Only this cafeteria\'s manager can act on this selection.', 403);
    workflow.approveFmbSelection(req.params.selectionId, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

router.post('/:id/fmb-selections/:selectionId/resubmit', async (req, res, next) => {
  try {
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    const selection = workflow.findFmbSelection(req.params.selectionId);
    if (!isCafeteriaManagerOfSelection(actor.user_id, selection)) throw new WorkflowError('Only this cafeteria\'s manager can act on this selection.', 403);
    workflow.resubmitFmbSelection(req.params.selectionId, actor.user_id, req.body.comment);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

// F&B edits an order a Cafeteria Manager pushed back (or cancels it outright). Saving IS the
// re-send — the row returns to 'pending' in whichever cafeteria now owns it, and every sibling
// order on the same proposal is untouched. Authorization (F&B head only, editable statuses only)
// lives in workflow.service.js's editFmbSelection().
router.post('/:id/fmb-selections/:selectionId/edit', async (req, res, next) => {
  try {
    const actor = resolveActorByEmail(req, 'reviewerEmail');
    const { cafeteriaCode, fmbOptionId, menuItemLabel, quantity, notes, cancel } = req.body;
    if (!cancel && cafeteriaCode !== undefined) {
      const cafeteria = db.unit.find((u) => u.code === cafeteriaCode && !u.archived_at && u.is_active);
      if (!cafeteria) throw new WorkflowError('Cafeteria not found or inactive.', 400);
    }
    if (!cancel && quantity !== undefined && !(Number(quantity) > 0)) {
      throw new WorkflowError('Quantity must be at least 1.', 400);
    }
    workflow.editFmbSelection(req.params.selectionId, { cafeteriaCode, fmbOptionId, menuItemLabel, quantity, notes, cancel }, actor.user_id);
    res.json(projectProposal(workflow.findRequest(req.params.id)));
  } catch (err) { next(err); }
});

module.exports = router;
