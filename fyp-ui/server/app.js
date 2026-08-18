const express = require('express');
const cors = require('cors');
const { saveDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10mb ceiling covers base64 image data URLs from event-image-upload

// Every route module mutates the shared in-memory `db` object directly (no repository layer),
// so persistence is handled centrally here rather than requiring every route handler to
// remember to call saveDb() itself: after any non-GET request finishes successfully (status
// < 400), write the current db state to disk. A no-op for GET/HEAD/OPTIONS and for requests
// that errored (the error-handling middleware below sets its own status, which this runs
// before — res.on('finish') fires after headers are sent either way, so failed mutations that
// partially wrote to `db` before throwing are still persisted; every service function in this
// codebase either completes a mutation fully or throws before mutating, so that's acceptable).
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400) saveDb(); });
  }
  next();
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/request-options', require('./routes/request-options.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/staff-tasks', require('./routes/staff-tasks.routes'));
app.use('/api/proposal-workflow', require('./routes/proposal-workflow.routes'));
app.use('/api/events', require('./routes/events.routes'));
app.use('/api/event-engagement', require('./routes/event-engagement.routes'));
app.use('/api/config', require('./routes/config.routes'));
app.use('/api/event-catalog', require('./routes/event-catalog.routes'));
app.use('/api/cafeterias', require('./routes/cafeterias.routes'));
app.use('/api/uploads', require('./routes/uploads.routes'));
app.use('/api', require('./routes/clubs.routes'));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error.' });
});

module.exports = app;
