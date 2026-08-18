const app = require('./app');
const { saveDb } = require('./db');
const { runRetentionSweep } = require('./services/soft-delete.service');

const PORT = process.env.PORT || 4000;

// 7-day soft-delete retention sweep (see soft-delete.service.js): every admin-managed entity
// registered in admin-deletion.registry.js gets permanently purged once its archived_at is at
// least 7 days old, unless something newly references it again during the retention window (in
// which case it's left archived — see runRetentionSweep()'s comment). Runs once on boot (in case
// the server was down when a purge was due) and every hour after — this is a mock in-memory
// backend, not a real cron-capable deployment, so a coarse interval is sufficient rather than
// scheduling exactly at each row's 7-day mark.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
function sweep() {
  const results = runRetentionSweep();
  const purged = results.filter((r) => r.purged);
  if (purged.length > 0) {
    console.log(`Retention sweep: permanently deleted ${purged.length} record(s) past 7-day retention.`);
    saveDb();
  }
}
sweep();
setInterval(sweep, SWEEP_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`EMS mock server listening on http://localhost:${PORT}`);
});
