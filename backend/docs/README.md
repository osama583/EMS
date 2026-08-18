# API Documentation

| Document | What it covers |
|---|---|
| [openapi.json](openapi.json) | Machine-readable spec — 69 paths, 91 operations |
| [index.html](index.html) | Swagger UI. Open it in a browser to read and try the API |
| [api-design.md](api-design.md) | Why the resources are shaped the way they are |
| [workflow.md](workflow.md) | The proposal state machine, stage by stage |
| [security.md](security.md) | Auth, authorisation, and the threat model |
| [database.md](database.md) | Schema notes, migrations, and documented deviations |

## Reading the spec

```bash
# Swagger UI, no install needed
cd backend/docs && python -m http.server 8080
# then open http://localhost:8080/index.html
```

`openapi.json` is **generated**, never hand-edited:

```bash
cd backend && .venv/Scripts/python -m docs.generate_openapi
```

It reads the live Flask URL map, so a route that exists is documented and a
route that is deleted disappears. Summaries and descriptions come from each
view's docstring — the documentation and the code cannot drift apart, because
they are the same text.

Re-run it whenever you add or change a route.

## Quick start

```bash
# 1. Log in
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"hoshod@demo.apu.edu.my","password":"<seed password>"}'

# 2. Use the access token
curl http://localhost:5000/api/v1/proposals \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

The seed password is printed once when `python -m seed.run` finishes. Only the
bcrypt hash is stored, so it cannot be recovered afterwards — re-seed with
`--reset --password <value>` to set a known one.

## Conventions

**Every response is JSON.** Errors share one envelope:

```json
{ "error": { "code": "workflow_error", "message": "...", "request_id": "a1b2c3..." } }
```

`message` is safe to show a user. `request_id` matches `X-Request-Id` on the
response and appears in the server logs, so a user-reported error can be traced
to the exact request.

**Status codes carry meaning:**

| Code | Means |
|---|---|
| 400 | The request itself is malformed |
| 401 | No token, or an expired/invalid one |
| 403 | Authenticated, but not permitted |
| 404 | Not found — **or found but not visible to you** |
| 409 | Well-formed, but not allowed in the resource's current state |
| 422 | Field validation failed; `details.errors` lists every problem |
| 429 | Rate limited |

404-for-hidden is deliberate. Returning 403 for a proposal you may not read
confirms it exists, which is itself a disclosure.

422 returns **all** validation errors at once, not just the first, so a form can
mark every bad field in one pass.

**Naming.** JSON is `camelCase`; the database is `snake_case`. The API translates
at its edge — the client never sees a column name.
