// Generic soft-delete/restore/purge + dependency-validation for every System-Admin-managed entity
// in Admin Settings — one consistent mechanism instead of a bespoke implementation per table. See
// "7-day soft delete and restore" in docs/superpowers/specs (2026-08-14 admin-settings-deletion).
//
// Lifecycle for any registered entity:
//   active row (archived_at = null)
//     -> DELETE: dependency check runs FIRST (see checkDependencies below); if blocked, throws
//        WorkflowError(409) with a message naming exactly what's still referencing it. If clear,
//        archived_at is stamped with the current time — the row stays in its table, just excluded
//        from every normal list/lookup (callers filter `!row.archived_at` same as before).
//   archived row (archived_at set, < 7 days old)
//     -> POST restore: archived_at reset to null, row instantly returns to its previous active
//        state (every other field untouched, so relationships/data are preserved as-is).
//     -> DELETE purge: dependency check runs AGAIN (a restore of some OTHER row could have created
//        a new reference since the soft-delete) — if clear, the row is actually removed.
//   archived row (archived_at set, >= 7 days old)
//     -> swept automatically by runRetentionSweep() (see server/index.js's setInterval) — same
//        purge path as a manual one, silently skipped (not hard-failed) if a dependency reappeared
//        in the meantime, so the sweep never crashes or force-deletes something still in use.
let db;
function init(dbRef) {
  db = dbRef;
}

const { WorkflowError } = require('./workflow.service');

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// One entry per soft-deletable table. `table`/`pk` locate the table + its primary-key column in
// `db`. `label(row)` renders the entity name for confirmation/error messages. `dependencies` is a
// list of { describe(row) -> count, label } checks run in order before delete/purge; every failing
// one is reported together (matches the existing Users/Units/Roles "list every blocking reason at
// once" behavior) rather than surfacing only the first.
const REGISTRY = {};

function register(entityKey, config) {
  REGISTRY[entityKey] = config;
}

function requireEntity(entityKey) {
  const entry = REGISTRY[entityKey];
  if (!entry) throw new Error(`soft-delete.service: unknown entity '${entityKey}' — register() it first.`);
  return entry;
}

function findRow(entityKey, id) {
  const entry = requireEntity(entityKey);
  const row = db[entry.table].find((r) => String(r[entry.pk]) === String(id));
  if (!row) throw new WorkflowError(`${entry.displayName} not found.`, 404);
  return row;
}

// Runs every registered dependency check for `row` and returns the human-readable reasons that
// are currently blocking (empty array = clear to delete/purge).
function checkDependencies(entityKey, row) {
  const entry = requireEntity(entityKey);
  const reasons = [];
  for (const dep of entry.dependencies || []) {
    const count = dep.count(db, row);
    if (count > 0) reasons.push(dep.reason(count, row));
  }
  return reasons;
}

// GET .../:id/deletion-check — lets the frontend show the exact blocking reasons INSIDE the
// confirmation dialog, before the admin even clicks the delete button, per the design requirement
// that dependency validation must not surface only after confirming. Read-only, no mutation.
function previewDeletion(entityKey, id) {
  const entry = requireEntity(entityKey);
  const row = findRow(entityKey, id);
  const reasons = checkDependencies(entityKey, row);
  return { canDelete: reasons.length === 0, blockingReasons: reasons, entityLabel: entry.label(row) };
}

// Soft-deletes: throws WorkflowError(409) with every blocking reason if dependencies exist,
// otherwise stamps archived_at and returns the updated row.
function softDelete(entityKey, id) {
  const entry = requireEntity(entityKey);
  const row = findRow(entityKey, id);
  if (row.archived_at) throw new WorkflowError(`${entry.displayName} is already deleted.`, 409);
  const reasons = checkDependencies(entityKey, row);
  if (reasons.length > 0) {
    throw new WorkflowError(`Cannot delete ${entry.label(row)}: ${reasons.join('; ')}.`, 409);
  }
  row.archived_at = new Date().toISOString();
  return row;
}

function restore(entityKey, id) {
  const entry = requireEntity(entityKey);
  const row = findRow(entityKey, id);
  if (!row.archived_at) throw new WorkflowError(`${entry.displayName} is not deleted.`, 409);
  row.archived_at = null;
  return row;
}

// Permanent removal — either a manual admin action from the Deleted/Recycle Bin view, or the
// automatic 7-day sweep (see runRetentionSweep). Re-checks dependencies (something could have come
// to reference this row again during the retention window) rather than trusting the state from
// when it was soft-deleted.
function purge(entityKey, id) {
  const entry = requireEntity(entityKey);
  const row = findRow(entityKey, id);
  if (!row.archived_at) throw new WorkflowError(`${entry.displayName} must be deleted before it can be purged.`, 409);
  const reasons = checkDependencies(entityKey, row);
  if (reasons.length > 0) {
    throw new WorkflowError(`Cannot permanently delete ${entry.label(row)}: ${reasons.join('; ')}.`, 409);
  }
  db[entry.table] = db[entry.table].filter((r) => r !== row);
  if (entry.onPurge) entry.onPurge(db, row);
  return row;
}

// Archived-list projection shared by every entity's "Deleted" view — adds daysRemaining/
// permanentDeletionAt so the frontend can show "3 days left" / "scheduled for permanent deletion
// on <date>" without recomputing the retention window itself.
function archivedList(entityKey) {
  const entry = requireEntity(entityKey);
  return db[entry.table]
    .filter((r) => r.archived_at)
    .map((row) => {
      const deletedAt = new Date(row.archived_at).getTime();
      const permanentDeletionAt = new Date(deletedAt + RETENTION_MS).toISOString();
      const msRemaining = deletedAt + RETENTION_MS - Date.now();
      return {
        row,
        deletedAt: row.archived_at,
        permanentDeletionAt,
        daysRemaining: Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000))),
      };
    });
}

// Sweeps every registered entity for rows archived >= 7 days ago and purges them. Called on an
// interval from server/index.js. Never throws: a row whose dependencies reappeared during the
// retention window is simply left archived (logged) rather than force-deleted or crashing the
// sweep for every other entity.
function runRetentionSweep() {
  const results = [];
  const cutoff = Date.now() - RETENTION_MS;
  for (const entityKey of Object.keys(REGISTRY)) {
    const entry = REGISTRY[entityKey];
    const due = db[entry.table].filter((r) => r.archived_at && new Date(r.archived_at).getTime() <= cutoff);
    for (const row of due) {
      const id = row[entry.pk];
      try {
        purge(entityKey, id);
        results.push({ entityKey, id, purged: true });
      } catch (err) {
        results.push({ entityKey, id, purged: false, reason: err.message });
      }
    }
  }
  return results;
}

// Mounts the standard 5-endpoint set for a registered entity onto an Express router, so every
// route file gets identical soft-delete/restore/purge/preview behavior instead of hand-rolling it
// per entity. `idParam` is the :param name to read the id from (defaults to 'id'); `project` maps
// a raw db row to its client-facing shape (same projector the entity's other routes already use).
//   GET    <path>/deleted            -> archived rows (+ daysRemaining/permanentDeletionAt)
//   GET    <path>/:id/deletion-check -> { canDelete, blockingReasons, entityLabel } (pre-confirm)
//   DELETE <path>/:id                -> soft delete (409 with reasons if blocked)
//   POST   <path>/:id/restore        -> restore
//   DELETE <path>/:id/purge          -> permanent delete (409 with reasons if blocked)
function mountRoutes(router, path, entityKey, project, idParam = 'id') {
  router.get(`${path}/deleted`, async (_req, res, next) => {
    try {
      res.json(archivedList(entityKey).map(({ row, deletedAt, permanentDeletionAt, daysRemaining }) => ({
        ...project(row), deletedAt, permanentDeletionAt, daysRemaining,
      })));
    } catch (err) { next(err); }
  });
  router.get(`${path}/:${idParam}/deletion-check`, async (req, res, next) => {
    try { res.json(previewDeletion(entityKey, req.params[idParam])); } catch (err) { next(err); }
  });
  router.delete(`${path}/:${idParam}`, async (req, res, next) => {
    try { res.json(project(softDelete(entityKey, req.params[idParam]))); } catch (err) { next(err); }
  });
  router.post(`${path}/:${idParam}/restore`, async (req, res, next) => {
    try { res.json(project(restore(entityKey, req.params[idParam]))); } catch (err) { next(err); }
  });
  router.delete(`${path}/:${idParam}/purge`, async (req, res, next) => {
    try { project(purge(entityKey, req.params[idParam])); res.status(204).end(); } catch (err) { next(err); }
  });
}

module.exports = { init, register, previewDeletion, softDelete, restore, purge, archivedList, runRetentionSweep, mountRoutes, RETENTION_DAYS, findRow };
