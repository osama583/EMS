const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { deriveUnitCode } = require('../services/unit-code');
const softDeleteService = require('../services/soft-delete.service');

const router = express.Router();

// Event Categories & Event Formats — two structurally-identical, id-backed admin-managed
// catalogs (System Configuration -> Event Categories / Event Formats). `code` is server-derived
// from `name` via deriveUnitCode() (same slug convention as unit.code/role.role_code/
// nav_page.page_code — lowercase_with_underscores, immutable once created, never client-supplied).
// Soft-delete/restore/purge is fully delegated to soft-delete.service.js, registered with an EMPTY
// dependency list in admin-deletion.registry.js: proposals freeze the category/format NAME into a
// snapshot column at save time (request_categories.category_name, request.event_format_snapshot),
// so no later change here can ever affect an already-submitted proposal's display.

function makeCatalog({ table, pk, entityKey, resourcePath, notFoundMessage }) {
  function project(row) {
    return { id: String(row[pk]), name: row.name, code: row.code, active: row.active };
  }

  router.get(resourcePath, async (req, res, next) => {
    try {
      let rows = db[table].filter((r) => !r.archived_at);
      if (req.query.active === 'true') rows = rows.filter((r) => r.active);
      res.json(rows.map(project));
    } catch (err) { next(err); }
  });

  // Soft-delete (7-day retention, restore, permanent purge, pre-confirm dependency preview) via
  // the shared registry — see admin-deletion.registry.js's eventCategory/eventFormat entries.
  // Registered BEFORE the generic GET/:id below: mountRoutes() adds `GET <path>/deleted` and
  // `GET <path>/:id/deletion-check`, both of which Express would otherwise never reach if a plain
  // `GET <path>/:id` were registered first (it greedily matches the literal "deleted" segment).
  softDeleteService.mountRoutes(router, resourcePath, entityKey, project);

  router.get(`${resourcePath}/:id`, async (req, res, next) => {
    try {
      const row = db[table].find((r) => r[pk] === Number(req.params.id) && !r.archived_at);
      if (!row) throw new WorkflowError(notFoundMessage, 404);
      res.json(project(row));
    } catch (err) { next(err); }
  });

  router.post(resourcePath, async (req, res, next) => {
    try {
      const name = req.body.name ? String(req.body.name).trim() : '';
      if (!name) throw new WorkflowError('name is required.', 400);
      const code = deriveUnitCode(name);
      if (db[table].some((r) => r.code === code && !r.archived_at)) {
        throw new WorkflowError(`An entry with the derived code '${code}' already exists.`, 409);
      }
      const row = { [pk]: nextId(table), name, code, active: req.body.active !== undefined ? Boolean(req.body.active) : true, archived_at: null };
      db[table].push(row);
      res.status(201).json(project(row));
    } catch (err) { next(err); }
  });

  router.put(`${resourcePath}/:id`, async (req, res, next) => {
    try {
      const row = db[table].find((r) => r[pk] === Number(req.params.id));
      if (!row) throw new WorkflowError(notFoundMessage, 404);
      // `code` is immutable once created (matches nav_page.page_code) — only `name`/`active` are
      // editable here; renaming does NOT re-derive `code`, so already-frozen proposal snapshots
      // and the row's own identity stay stable.
      if (req.body.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) throw new WorkflowError('name is required.', 400);
        row.name = name;
      }
      if (req.body.active !== undefined) row.active = Boolean(req.body.active);
      res.json(project(row));
    } catch (err) { next(err); }
  });

  router.patch(`${resourcePath}/:id/status`, async (req, res, next) => {
    try {
      const row = db[table].find((r) => r[pk] === Number(req.params.id));
      if (!row) throw new WorkflowError(notFoundMessage, 404);
      row.active = Boolean(req.body.active);
      res.json(project(row));
    } catch (err) { next(err); }
  });
}

makeCatalog({ table: 'event_category', pk: 'event_category_id', entityKey: 'eventCategory', resourcePath: '/categories', notFoundMessage: 'Event category not found.' });
makeCatalog({ table: 'event_format', pk: 'event_format_id', entityKey: 'eventFormat', resourcePath: '/formats', notFoundMessage: 'Event format not found.' });

module.exports = router;
