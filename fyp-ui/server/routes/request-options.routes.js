const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;

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
  waterLogo: 'water_logo_options',
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
  waterLogo: 'water_logo_option_id',
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
      return { ...base, maximumPersonnel: row.max_personnel ?? undefined };
    case 'soundLight':
      return { ...base, availableQuantity: row.available_quantity ?? undefined, setupRequirements: row.technical_description ?? undefined };
    case 'fmb': {
      const servingUnit = db.serving_unit_options.find((s) => s.serving_unit_option_id === row.serving_unit_option_id);
      const dietary = db.dietary_information_options.find((d) => d.dietary_information_option_id === row.dietary_information_option_id);
      return {
        ...base,
        imageDataUrl: row.menu_image_url ?? undefined,
        servingUnitId: servingUnit ? `servingUnit:${servingUnit.serving_unit_option_id}` : undefined,
        orderingNotes: row.availability_ordering_notes ?? undefined,
        dietaryInformationId: dietary ? `dietaryInformation:${dietary.dietary_information_option_id}` : undefined,
      };
    }
    case 'dietaryInformation':
      return base;
    case 'servingUnit':
      return base;
    case 'campusTourStart':
      return { ...base, meetingInstructions: row.meeting_instructions ?? undefined, maximumGroupSize: row.max_group_size ?? undefined };
    case 'waterLogo':
      return {
        ...base,
        bottleCount: row.number_of_bottles,
        availableStock: row.available_stock,
        brandingRequirement: row.logo_branding_requirement ?? undefined,
        orderingInstructions: row.lead_time_ordering_instructions ?? undefined,
      };
    case 'waterNormal':
      return {
        ...base,
        bottleCount: row.number_of_bottles,
        availableStock: row.available_stock,
        orderingInstructions: row.ordering_delivery_instructions ?? undefined,
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
      return { label: draft.label, description: draft.description ?? null, active: draft.active, max_personnel: draft.maximumPersonnel ?? null };
    case 'soundLight':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, available_quantity: draft.availableQuantity ?? null, technical_description: draft.setupRequirements ?? '' };
    case 'fmb':
      return {
        label: draft.label, description: draft.description ?? null, active: draft.active, menu_image_url: draft.imageDataUrl ?? null,
        serving_unit_option_id: parseRef(draft.servingUnitId), dietary_information_option_id: parseRef(draft.dietaryInformationId),
        availability_ordering_notes: draft.orderingNotes ?? null,
      };
    case 'dietaryInformation':
    case 'servingUnit':
      return { label: draft.label, description: draft.description ?? null, active: draft.active };
    case 'campusTourStart':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, meeting_instructions: draft.meetingInstructions ?? null, max_group_size: draft.maximumGroupSize ?? null };
    case 'waterLogo':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, number_of_bottles: draft.bottleCount, available_stock: draft.availableStock, logo_branding_requirement: draft.brandingRequirement ?? null, lead_time_ordering_instructions: draft.orderingInstructions ?? null };
    case 'waterNormal':
      return { label: draft.label, description: draft.description ?? null, active: draft.active, number_of_bottles: draft.bottleCount, available_stock: draft.availableStock, ordering_delivery_instructions: draft.orderingInstructions ?? null };
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
    for (const row of db[KIND_TO_TABLE[kind]]) results.push(projectOption(kind, row));
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
    res.json(options);
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

router.delete('/:id', async (req, res, next) => {
  try {
    const { kind, numericId } = parseId(req.params.id);
    const table = KIND_TO_TABLE[kind];
    const index = db[table].findIndex((r) => r[KIND_TO_PK[kind]] === numericId);
    if (index === -1) return res.status(404).json({ message: 'Request option not found.' });
    db[table].splice(index, 1);
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
