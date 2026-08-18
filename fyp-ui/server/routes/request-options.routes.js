const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { computeAvailability } = require('../services/logistics-availability.service');
const softDeleteService = require('../services/soft-delete.service');

const router = express.Router();

// RequestOption.id is typed `string` in Angular (request-option.models.ts) but Task 3.3's seed
// uses real auto-incrementing integer PKs per table — encode as `${kind}:${integerId}` so
// GET/PUT/PATCH/DELETE /:id can parse which table to look in.
const KIND_TO_TABLE = {
  logistics: 'logistics_options',
  transportation: 'transportation_options',
  photoVideo: 'media_options',
  soundLight: 'sound_light_options',
  fmb: 'fmb_options',
  dietaryInformation: 'dietary_information_options',
  servingUnit: 'serving_unit_options',
  campusTourStart: 'campus_tour_start_options',
  campusTourType: 'campus_tour_type_options',
  waterNormal: 'water_normal_options',
  fundingMain: 'funding_main_options',
  fundingSub: 'funding_sub_options',
};

const KIND_TO_PK = {
  logistics: 'logistics_option_id',
  transportation: 'transportation_option_id',
  photoVideo: 'media_option_id',
  soundLight: 'sound_light_option_id',
  fmb: 'fmb_option_id',
  dietaryInformation: 'dietary_information_option_id',
  servingUnit: 'serving_unit_option_id',
  campusTourStart: 'campus_tour_start_option_id',
  campusTourType: 'campus_tour_type_option_id',
  waterNormal: 'water_normal_option_id',
  fundingMain: 'funding_main_option_id',
  fundingSub: 'funding_sub_option_id',
};

// Maps DB snake_case columns back to the exact RequestOption union member shape
// (request-option.models.ts), reversing Task 3.3's seed field mapping per kind.
function projectOption(kind, row) {
  const id = `${kind}:${row[KIND_TO_PK[kind]]}`;
  const base = { id, kind, label: row.label, description: row.description ?? undefined, active: row.active };
  switch (kind) {
    case 'logistics':
      return { ...base, imageDataUrl: row.item_image_url ?? undefined, availableQuantity: row.available_quantity, quantityUnit: row.quantity_unit };
    case 'transportation':
      return { ...base, imageDataUrl: row.vehicle_image_url ?? undefined, passengerCapacity: row.passenger_capacity, availableVehicles: row.available_vehicle_count, instructions: row.instructions ?? undefined };
    case 'photoVideo':
      return base;
    case 'soundLight':
      return { ...base, setupRequirements: row.technical_description ?? undefined };
    case 'fmb': {
      const servingUnit = db.serving_unit_options.find((s) => s.serving_unit_option_id === row.serving_unit_option_id);
      const dietary = db.dietary_information_options.find((d) => d.dietary_information_option_id === row.dietary_information_option_id);
      const cafeteria = db.unit.find((u) => u.code === row.unit_code);
      return {
        ...base,
        imageDataUrl: row.menu_image_url ?? undefined,
        servingUnitId: servingUnit ? `servingUnit:${servingUnit.serving_unit_option_id}` : undefined,
        orderingNotes: row.availability_ordering_notes ?? undefined,
        dietaryInformationId: dietary ? `dietaryInformation:${dietary.dietary_information_option_id}` : undefined,
        cafeteriaCode: cafeteria ? cafeteria.code : undefined,
        cafeteriaName: cafeteria ? cafeteria.description : undefined,
      };
    }
    case 'dietaryInformation':
      return base;
    case 'servingUnit':
      return base;
    case 'campusTourStart':
      return { ...base, meetingInstructions: row.meeting_instructions ?? undefined, maximumGroupSize: row.max_group_size ?? undefined };
    case 'campusTourType':
      return base;
    case 'waterNormal':
      return {
        ...base,
        bottleCount: row.number_of_bottles,
        availableStock: row.available_stock,
        orderingInstructions: row.ordering_delivery_instructions ?? undefined,
        brandingRequirement: row.logo_branding_requirement ?? undefined,
      };
    case 'fundingMain':
      return { ...base, financeCode: row.budget_category_finance_code ?? undefined, purchasingGuidance: row.purchasing_guidance ?? undefined };
    case 'fundingSub': {
      const parent = db.funding_main_options.find((m) => m.funding_main_option_id === row.main_option_id);
      return {
        ...base,
        parentId: parent ? `fundingMain:${parent.funding_main_option_id}` : '',
        financeCode: row.finance_procurement_code ?? undefined,
        purchasingNote: row.default_unit_purchasing_note ?? undefined,
      };
    }
    default:
      throw new WorkflowError(`Unknown request option kind: ${kind}`, 400);
  }
}

// Reverse of projectOption: maps a RequestOptionDraft (camelCase, Angular shape) onto the
// DB row's snake_case columns for the given kind's table.
function draftToRow(kind, draft) {
  const parseRef = (value) => {
    if (!value) return null;
    const parts = String(value).split(':');
    return Number(parts[parts.length - 1]);
  };
  switch (kind) {
    case 'logistics':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, item_image_url: draft.imageDataUrl ?? null, available_quantity: draft.availableQuantity, quantity_unit: draft.quantityUnit };
    case 'transportation':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, vehicle_image_url: draft.imageDataUrl ?? null, passenger_capacity: draft.passengerCapacity, available_vehicle_count: draft.availableVehicles, instructions: draft.instructions ?? null };
    case 'photoVideo':
      return { label: draft.label, description: draft.description ?? null, active: draft.active };
    case 'soundLight':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, technical_description: draft.setupRequirements ?? '' };
    case 'fmb':
      return {
        label: draft.label, description: draft.description ?? null, active: draft.active, menu_image_url: draft.imageDataUrl ?? null,
        serving_unit_option_id: parseRef(draft.servingUnitId), dietary_information_option_id: parseRef(draft.dietaryInformationId),
        availability_ordering_notes: draft.orderingNotes ?? null,
        unit_code: draft.cafeteriaCode ?? null,
      };
    case 'dietaryInformation':
    case 'servingUnit':
      return { label: draft.label, description: draft.description ?? null, active: draft.active };
    case 'campusTourStart':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, meeting_instructions: draft.meetingInstructions ?? null, max_group_size: draft.maximumGroupSize ?? null };
    case 'campusTourType':
      return { label: draft.label, description: draft.description ?? null, active: draft.active };
    case 'waterNormal':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, number_of_bottles: draft.bottleCount, available_stock: draft.availableStock, ordering_delivery_instructions: draft.orderingInstructions ?? null, logo_branding_requirement: draft.brandingRequirement ?? null };
    case 'fundingMain':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, budget_category_finance_code: draft.financeCode ?? null, purchasing_guidance: draft.purchasingGuidance ?? null };
    case 'fundingSub':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, main_option_id: parseRef(draft.parentId), finance_procurement_code: draft.financeCode ?? null, default_unit_purchasing_note: draft.purchasingNote ?? null };
    default:
      throw new WorkflowError(`Unknown request option kind: ${kind}`, 400);
  }
}

function allOptions() {
  const results = [];
  for (const kind of Object.keys(KIND_TO_TABLE)) {
    for (const row of db[KIND_TO_TABLE[kind]]) {
      if (!row.archived_at) results.push(projectOption(kind, row));
    }
  }
  return results;
}

function parseId(id) {
  const [kind, rawId] = String(id).split(':');
  if (!KIND_TO_TABLE[kind]) throw new WorkflowError('Unknown request option id.', 400);
  return { kind, numericId: Number(rawId) };
}

router.get('/', async (req, res, next) => {
  try {
    let options = allOptions();
    if (req.query.kinds) {
      const kinds = String(req.query.kinds).split(',').filter(Boolean);
      options = options.filter((o) => kinds.includes(o.kind));
    }
    if (req.query.active === 'true') options = options.filter((o) => o.active);
    if (req.query.search) {
      const search = String(req.query.search).toLowerCase();
      options = options.filter((o) => o.label.toLowerCase().includes(search) || (o.description || '').toLowerCase().includes(search));
    }
    // Only fmb (menu items) carries cafeteriaCode — used by the F&B/Cafeteria Admin read-only
    // menu views to scope to one cafeteria at a time.
    if (req.query.cafeteriaCode !== undefined) {
      const cafeteriaCode = String(req.query.cafeteriaCode);
      options = options.filter((o) => o.kind !== 'fmb' || o.cafeteriaCode === cafeteriaCode);
    }
    res.json(options);
  } catch (err) { next(err); }
});

// Cross-request availability for a Logistics item over a requested [date, start, end] window —
// see logistics-availability.service.js for the overlap/buffer math. :optionId is the bare
// numeric logistics_option_id (frontend already has the "logistics:<id>" form from the option
// catalog and strips the prefix before calling, matching how :id is used everywhere else here).
router.get('/logistics/:optionId/availability', async (req, res, next) => {
  try {
    const numericId = Number(req.params.optionId);
    const row = db.logistics_options.find((r) => r.logistics_option_id === numericId);
    if (!row) return res.status(404).json({ message: 'Request option not found.' });
    const { date, start, end, quantity } = req.query;
    if (!date || !start || !end) throw new WorkflowError('date, start, and end query parameters are required.', 400);
    const requestedQuantity = quantity !== undefined ? Number(quantity) : undefined;
    const optionId = `logistics:${numericId}`;
    const result = computeAvailability(db, { optionId, availableQuantity: row.available_quantity, date: String(date), start: String(start), end: String(end), requestedQuantity });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    const row = db[KIND_TO_TABLE[kind]].find((r) => r[KIND_TO_PK[kind]] === numericId);
    if (!row) return res.status(404).json({ message: 'Request option not found.' });
    res.json(projectOption(kind, row));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { kind } = req.body;
    const table = KIND_TO_TABLE[kind];
    if (!table) throw new WorkflowError(`Unknown request option kind: ${kind}`, 400);
    const row = draftToRow(kind, req.body);
    row[KIND_TO_PK[kind]] = nextId(table);
    row.archived_at = null;
    db[table].push(row);
    res.json(projectOption(kind, row));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    const row = db[KIND_TO_TABLE[kind]].find((r) => r[KIND_TO_PK[kind]] === numericId);
    if (!row) return res.status(404).json({ message: 'Request option not found.' });
    Object.assign(row, draftToRow(kind, req.body));
    res.json(projectOption(kind, row));
  } catch (err) { next(err); }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    const row = db[KIND_TO_TABLE[kind]].find((r) => r[KIND_TO_PK[kind]] === numericId);
    if (!row) return res.status(404).json({ message: 'Request option not found.' });
    row.active = req.body.active;
    res.json(projectOption(kind, row));
  } catch (err) { next(err); }
});

// Soft-delete (7-day retention, restore, permanent purge, pre-confirm dependency preview) — the
// registry key for each kind is its own table name (see admin-deletion.registry.js's SIMPLE_KINDS
// + the fmb/serving-unit/dietary-information/funding-main/funding-sub entries), matching
// KIND_TO_TABLE exactly. Funding sub-items reference their parent main item; F&B menu items
// reference a serving unit + dietary info row — those are the only real, enforced dependencies
// (see admin-deletion.registry.js's comment on why request snapshot rows are never checked).
router.get('/:id/deletion-check', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    res.json(softDeleteService.previewDeletion(KIND_TO_TABLE[kind], numericId));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    const row = softDeleteService.softDelete(KIND_TO_TABLE[kind], numericId);
    res.json(projectOption(kind, row));
  } catch (err) { next(err); }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    const row = softDeleteService.restore(KIND_TO_TABLE[kind], numericId);
    res.json(projectOption(kind, row));
  } catch (err) { next(err); }
});

router.delete('/:id/purge', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    softDeleteService.purge(KIND_TO_TABLE[kind], numericId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// Every kind's deleted list, in one call — the frontend's "Deleted" view shows all option kinds
// together rather than one request per kind.
router.get('/deleted/all', async (req, res, next) => {
  try {
    const results = [];
    for (const kind of Object.keys(KIND_TO_TABLE)) {
      for (const { row, deletedAt, permanentDeletionAt, daysRemaining } of softDeleteService.archivedList(KIND_TO_TABLE[kind])) {
        results.push({ ...projectOption(kind, row), deletedAt, permanentDeletionAt, daysRemaining });
      }
    }
    res.json(results);
  } catch (err) { next(err); }
});

module.exports = router;
