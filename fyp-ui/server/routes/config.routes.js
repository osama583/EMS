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
    eventCategories: db.event_category.filter((c) => c.active).map((c) => c.name),
  };
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(projectConfig());
  } catch (err) { next(err); }
});

// SystemConfigComponent (features/internal/pages/system-config/system-config.ts) manages
// categories as a flat name array in its own local `categories` signal, sent whole on every
// save (add/edit/delete all mutate the array client-side, then the FULL resulting list is
// PUT here) — so the server-side reconciliation is a full-list diff against db.event_category,
// not a per-item add/remove call.
router.put('/', async (req, res, next) => {
  try {
    const { paxReviewerThreshold, cancellationDaysLimit, eventCategories } = req.body;
    const paxConfig = db.config.find((c) => c.code === 'HIGH_PAX_THRESHOLD');
    const cancellationConfig = db.config.find((c) => c.code === 'CANCELLATION_DEADLINE_DAYS');
    if (!paxConfig) throw new WorkflowError('HIGH_PAX_THRESHOLD config not found.', 404);
    if (!cancellationConfig) throw new WorkflowError('CANCELLATION_DEADLINE_DAYS config not found.', 404);
    if (paxReviewerThreshold !== undefined) paxConfig.number = Number(paxReviewerThreshold);
    if (cancellationDaysLimit !== undefined) cancellationConfig.number = Number(cancellationDaysLimit);

    if (Array.isArray(eventCategories)) {
      const { nextId } = require('../db');
      const incomingNames = new Set(eventCategories);
      // Mark categories no longer present as inactive rather than deleting the row (keeps
      // request_categories foreign-key references from earlier requests intact).
      for (const category of db.event_category) {
        if (!incomingNames.has(category.name)) category.active = false;
        else category.active = true;
      }
      const existingNames = new Set(db.event_category.map((c) => c.name));
      for (const name of eventCategories) {
        if (!existingNames.has(name)) {
          db.event_category.push({ event_category_id: nextId('event_category'), name, active: true });
        }
      }
    }

    res.json(projectConfig());
  } catch (err) { next(err); }
});

module.exports = router;
