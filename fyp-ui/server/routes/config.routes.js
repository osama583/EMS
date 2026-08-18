const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;

const router = express.Router();

// Every admin-settable number in `config` (ems_database_schema.sql SECTION 5) is surfaced here
// under one camelCase wire name, so the frontend never hardcodes a threshold. Adding a row to
// this map is the only step needed to expose a new one — GET/PUT below are generic over it.
const CONFIG_FIELDS = [
  { code: 'HIGH_PAX_THRESHOLD', field: 'paxReviewerThreshold', min: 1 },
  { code: 'CANCELLATION_DEADLINE_DAYS', field: 'cancellationDaysLimit', min: 0 },
  { code: 'MAX_EVENT_CATEGORIES', field: 'maxEventCategories', min: 1 },
];

function configRow(code) {
  const row = db.config.find((c) => c.code === code);
  if (!row) throw new WorkflowError(`${code} config not found.`, 404);
  return row;
}

function projectConfig() {
  const projection = {};
  for (const { code, field } of CONFIG_FIELDS) projection[field] = configRow(code).number;
  return projection;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(projectConfig());
  } catch (err) { next(err); }
});

// Event Categories / Event Formats moved to their own id-backed catalog routes
// (routes/event-catalog.routes.js) — this endpoint now only covers the scalar policy values.
router.put('/', async (req, res, next) => {
  try {
    // Validate every incoming value BEFORE writing any of them, so a rejected field can't leave
    // the other two already persisted (the shared saveDb() middleware runs on any 2xx response).
    const updates = [];
    for (const { code, field, min } of CONFIG_FIELDS) {
      if (req.body[field] === undefined) continue;
      const value = Number(req.body[field]);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
        throw new WorkflowError(`${field} must be a whole number of at least ${min}.`, 400);
      }
      updates.push({ row: configRow(code), value });
    }
    for (const { row, value } of updates) row.number = value;

    res.json(projectConfig());
  } catch (err) { next(err); }
});

module.exports = router;
