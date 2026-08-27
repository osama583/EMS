# APU Event Management System

Angular frontend + Flask API on Supabase PostgreSQL.

| Directory | What it is |
|---|---|
| `backend/` | Flask REST API. Owns the workflow state machine and every authorisation decision. |
| `fyp-ui/` | Angular 21 client. Renders what the API returns; decides nothing about permissions. |

## Running it

Two processes. The backend first, since the frontend proxies to it.

```bash
# 1. API - http://localhost:5000
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # POSIX: .venv/bin/pip
cp .env.example .env                               # fill in SECRET_KEY, DATABASE_URL, SUPABASE_SERVICE_KEY
.venv/Scripts/python -m migrations.run             # create the schema
.venv/Scripts/python -m seed.run --reset           # system data; prints the demo password once
.venv/Scripts/python wsgi.py

# 2. Frontend - http://localhost:4200
cd fyp-ui
npm install
npm start                                          # proxies /api to :5000
```

Health check: `curl http://localhost:5000/health`

## Documentation

- [backend/docs/](backend/docs/README.md) — API reference, and the guides below
- [api-design.md](backend/docs/api-design.md) — why the resources are shaped this way
- [workflow.md](backend/docs/workflow.md) — the proposal state machine
- [security.md](backend/docs/security.md) — auth, authorisation, known gaps
- [database.md](backend/docs/database.md) — migrations and schema notes
- [docs/dashboards/](docs/dashboards/README.md) — the ten role dashboards at
  `/app/dashboard`: their metrics, access rules, insight rules and layouts

Interactive API docs: `cd backend/docs && python -m http.server 8080`, then open
`index.html`.

## Tests

```bash
# Most of the backend suite runs against the live database; test_dashboard.py
# deliberately does not, so the layout, empty-database and scope checks are
# runnable without one.
cd backend && .venv/Scripts/python -m pytest tests/ -q                  # against the live database
cd backend && .venv/Scripts/python -m pytest tests/test_dashboard.py -q # 223, no database needed
cd fyp-ui  && npm test
```

## Architecture

The backend owns the workflow. The client sends an action and renders the
result; it evaluates no permission rule as the authority. Concretely:

- The acting user comes from the JWT, never from a request field.
- List endpoints return only what the caller may see, scoped in SQL.
- Stage transitions, validation and routing are decided server-side and
  recorded in `workflow_history` in the same transaction as the change.

The previous Node/Express mock (`fyp-ui/server`) has been removed.
