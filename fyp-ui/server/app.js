const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 10mb ceiling covers base64 image data URLs from event-image-upload

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/request-options', require('./routes/request-options.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/staff-tasks', require('./routes/staff-tasks.routes'));
app.use('/api/proposal-workflow', require('./routes/proposal-workflow.routes'));
app.use('/api/events', require('./routes/events.routes'));
app.use('/api/event-engagement', require('./routes/event-engagement.routes'));
app.use('/api/config', require('./routes/config.routes'));
app.use('/api/uploads', require('./routes/uploads.routes'));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error.' });
});

module.exports = app;
