# API Design

This API was designed from the business rules, not ported from the mock
backend's endpoint shapes. Where the two differ, this document says why.

## Principles

**The backend owns every decision.** The client sends an action and renders the
result. No permission rule, stage transition or validation runs in the browser
as the authority. The frontend may hide a button it believes is unavailable —
that is a courtesy, not a control, and the API refuses the call regardless.

**The actor comes from the token, never the body.** The mock identified the
acting user from a client-supplied field, which varied by route: `reviewerEmail`
here, `actorEmail` there, `cancelledBy` elsewhere. Any client could send any
address. Now `Authorization` is the sole source of identity.

**Reads are scoped server-side.** A list endpoint returns what the caller may
see. Sending everything and filtering in the client is not a filter.

## Versioning

Everything lives under `/api/v1`. Versioned from the first commit so the
frontend can migrate route by route rather than in one flag day.

## Resources

| Resource | Path |
|---|---|
| Authentication | `/auth` |
| Proposals | `/proposals` |
| Department tasks | `/tasks` |
| Cafeteria orders | `/cafeteria-orders` |
| Reference data | `/catalog` |
| Dropdown catalogues | `/options` |
| Administration | `/admin` |
| Published events | `/events` |
| Clubs | `/clubs` |
| Role dashboards | `/dashboard` |

## Decisions worth explaining

### One `decision` endpoint, not three sibling verbs

The mock had `POST /:id/approve`, `/:id/reject` and `/:id/resubmit`. All three
resolve the same actor, check the same stage, apply the same authorisation and
write the same audit row. Only the resulting status differs.

```
POST /proposals/{id}/decision
{ "decision": "approve" | "reject" | "send-back", "comment": "..." }
```

Three routes meant three chances to forget the authorisation call, and it is
exactly where the mock's inconsistent actor fields crept in. One route has one
guard.

The same shape appears on `/tasks/{id}/decision`, `/cafeteria-orders/{id}/decision`
and `/clubs/join-requests/{id}/decision`. Note that the task version accepts
only `approve` and `send-back`: **a department cannot reject.** Only the
single-actor stages can end a proposal outright.

### `send-back`, not `resubmit`

The mock called it `resubmit` for both directions: a reviewer returning work,
and an applicant returning it fixed. Two opposite movements, one word.

- `POST /proposals/{id}/decision` with `"send-back"` — reviewer returns it
- `POST /proposals/{id}/resubmission` — applicant returns it fixed

### Eleven catalogues, one resource

Logistics items, transport types, menu items and eight more live in eleven
tables with near-identical shapes. Rather than eleven near-duplicate blueprints:

```
GET    /options?kind=logistics
POST   /options/{kind}
PATCH  /options/{kind}/{id}
DELETE /options/{kind}/{id}
```

`kind` indexes a fixed registry in `api/options.py`. It is never interpolated
into SQL as a table name — an unknown kind is a 404, not an opportunity to name
an arbitrary table.

### Permissions replaced wholesale

```
PUT /admin/nav-pages/{code}/grants
{ "grants": [ { "grantType": "unit_role", "roleCodes": [...], "unitCodes": [...] } ] }
```

PUT rather than per-row POST/DELETE. A permission set is only meaningful as a
whole; applied one row at a time it passes through intermediate states that
grant more (or less) than the administrator intended. An empty array is valid
and means "visible to nobody".

### Sub-resources for things that are things

`/proposals/{id}/history`, `/tasks/{id}/assignments`, `/events/{id}/registrations`.
Each is a collection in its own right with its own visibility rule, so each gets
its own path rather than a flag on the parent.

### The dashboard is one document, not a metric API

`GET /dashboard` returns a whole page: the resolved profile, its hero, its KPI
tiles, its panels, its insight cards and its quick actions, each with the data
already aggregated. There is no `/metrics/decision-latency` to compose from.

Two reasons. The page is one request on a 1-10 connection pool, and ten
parallel metric calls would exhaust it for a single page load — the widgets run
sequentially on one `read_cursor()` instead. And a metric endpoint invites a
client to divide one figure by another, which is how two screens end up
disagreeing about what "decision latency" means. Every ratio here is computed
in SQL, and the client renders what it is given.

The layout is data. A profile is a dict naming widget ids; the Angular
component walks it. Adding a Cafeteria Admin dashboard later is a `PROFILES`
entry plus any new widgets, with no change to the component, the route, or this
contract.

`GET /dashboard/widgets/<id>` re-fetches one widget on a filter change,
`/dashboard/profiles` lists what the caller may switch between, and
`/dashboard/export` returns any panel's table view as CSV.

There is no `@require_roles` on any of them. The profile resolver is the gate
and it fails closed: a caller holding none of the four dashboard roles gets a
200 carrying `{"profile": null}`, because the client's job in that case is to
render the existing no-access placeholder rather than an error page.

### `/me` for "about the caller"

`/events/me/registrations`, `/events/me/saved`, `/events/me/reminders`. No user
id in the path — the token already says who you are, and accepting an id would
invite passing someone else's.

## Filtering and pagination

`GET /proposals` accepts `?status=`, `?mine=true`, `?page=`, `?pageSize=`
(capped at 200) and returns:

```json
{ "items": [...], "page": 1, "pageSize": 50, "total": 137, "totalPages": 3 }
```

Filtering happens in SQL. `?status=hos_hod_review,cfo_review` becomes a
parameterised `= ANY(...)`, never string concatenation.

## What the client no longer has to do

| Was computed in the browser | Now returned by the server |
|---|---|
| Which proposals this user may see | `GET /proposals` returns exactly those |
| Whether the cancel button is enabled | `GET /proposals/{id}/cancellation` → `{"open": bool}` |
| Whether the viewer is a club member | `viewerIsMember` on each club |
| Which staff may be assigned to a task | `GET /tasks/{id}/assignable-staff` |
| Which roles are legal in a unit | `GET /admin/units/{code}/roles` |
| The sidebar for this user | `nav` on the login response |

The pattern: if the client needs to answer a question about permission or state,
the server answers it. `proposal-visibility.ts` — a complete authorisation model
living in the browser — has no counterpart here.

## Removed deliberately

**`GET /auth/demo-users`.** The mock returned every seeded account's *plaintext*
password so a login-screen picker could autofill. There is no version of that
which is safe. The seed script prints credentials to the operator's console
instead.
