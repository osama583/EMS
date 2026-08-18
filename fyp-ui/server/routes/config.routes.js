const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;

const router = express.Router();

function projectConfig() {
  const paxConfig = db.config.find((c) => c.code === 'HIGH_PAX_THRESHOLD');
  const cancellationConfig = db.config.find((c) => c.code === 'CANCELLATION_DEADLINE_DAYS');
  if (!paxConfig) throw new WorkflowError('HIGH_PAX_THRESHOLD config not found.', 404);
  if (!cancellationConfig) throw new WorkflowError('CANCELLATION_DEADLINE_DAYS config not found.', 404);
  return {
    paxReviewerThreshold: paxConfig.number,
    cancellationDaysLimit: cancellationConfig.number,
  };
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(projectConfig());
  } catch (err) { next(err); }
});

// Event Categories / Event Formats moved to their own id-backed catalog routes
// (routes/event-catalog.routes.js) — this endpoint now only covers the two scalar policy values.
router.put('/', async (req, res, next) => {
  try {
    const { paxReviewerThreshold, cancellationDaysLimit } = req.body;
    const paxConfig = db.config.find((c) => c.code === 'HIGH_PAX_THRESHOLD');
    const cancellationConfig = db.config.find((c) => c.code === 'CANCELLATION_DEADLINE_DAYS');
    if (!paxConfig) throw new WorkflowError('HIGH_PAX_THRESHOLD config not found.', 404);
    if (!cancellationConfig) throw new WorkflowError('CANCELLATION_DEADLINE_DAYS config not found.', 404);
    if (paxReviewerThreshold !== undefined) paxConfig.number = Number(paxReviewerThreshold);
    if (cancellationDaysLimit !== undefined) cancellationConfig.number = Number(cancellationDaysLimit);

    res.json(projectConfig());
  } catch (err) { next(err); }
});

module.exports = router;
