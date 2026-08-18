# Security

## Authentication

**Passwords** are hashed with bcrypt (cost 12, configurable). bcrypt silently
truncates at 72 bytes, so longer passwords are rejected at validation rather
than having their tail quietly ignored. When the cost factor is raised, a
successful login transparently re-hashes at the new cost.

**Tokens.** Login returns two JWTs:

| Token | Lifetime | Purpose |
|---|---|---|
| Access | 30 min | Sent as `Authorization: Bearer` on every call |
| Refresh | 14 days | Exchanged at `POST /auth/refresh` for a new pair |

They share a secret but carry a `typ` claim that is checked on decode, so a
long-lived refresh token cannot be replayed as an access token. Both directions
are covered by tests.

**Roles are not in the token.** They are re-read from `user_unit_roles` on every
request. Baking them in would mean a revoked role stays live until the token
expires — up to 30 minutes of access the administrator believes they removed.
The cost is one indexed query per request.

**Login is enumeration-safe.** Unknown email, wrong password and deactivated
account return an identical message, and bcrypt runs even when the user does not
exist so the three cannot be told apart by response timing.

## Authorisation

Two layers, because they answer different questions.

**Role gates** (`security/decorators.py`) — coarse, evaluated before the handler:

```python
@require_auth          # a valid token
@require_internal      # not a self-registered guest account
@require_roles("cfo")  # holds one of these roles
@require_admin         # system-admin
```

**Row-state rules** (`services/workflow/authorization.py`) — need the row loaded
first, because the answer depends on it:

- Only the head of a School the applicant belongs to may act at `hos_hod_review`
- Only the head of the unit a task routed to may approve it
- Only the applicant or a co-owner may edit, resubmit or cancel
- Only the staff member a task is assigned to may progress it
- Only the manager of the cafeteria an order belongs to may accept it
- Only a club's President may decide its join requests

Routing is always read from the stored row, never from what the client claims.
A manager cannot act on another department's task by naming it in the body.

## Data exposure

The defect this backend exists to fix: the mock returned every proposal in the
database to every caller and filtered in the browser. Applicant names, emails,
departments, bank account names and numbers, cost amounts, guest lists and
reviewer comments were all in the response of any list page.

Now `GET /proposals` scopes in SQL. A caller sees a proposal only if they are
the applicant, a co-owner, the reviewer it currently awaits, the head of a unit
it is routed to, an assigned staff member, or a cafeteria handling its order.

Related fixes:

- Reading a proposal you may not see returns **404, not 403**. A 403 confirms it
  exists.
- The event attendee list is organiser-only.
- `/admin/*` requires system-admin. The mock's user directory had no check.
- Password hashes never enter a projection. `logging_setup.py` also redacts
  `password`, `token` and `authorization` from any log record.

## Injection

Every statement uses psycopg2 parameter binding. No user input is ever
concatenated into SQL.

Where a *column name* varies (partial updates), names come from a whitelist
built by intersecting the caller's keys with `information_schema.columns` for
that table — a key that is not a real column is dropped, not interpolated. Where
a *table name* varies (`/options/{kind}`), the kind indexes a fixed registry;
unknown kinds 404.

## Transport and browser-facing

**CORS** allows exact origins from `CORS_ORIGINS`, never `*`. A wildcard with
credentials is both invalid and unsafe.

**CSRF** does not apply. Authentication is a bearer token in a header, not a
cookie, so there is no ambient credential a cross-site form can ride on — the
header must be set deliberately by first-party code. If tokens ever move to
cookies, `SameSite` and a CSRF token become mandatory.

**XSS** is the client's responsibility for rendering, but the API helps: it
returns JSON with `X-Content-Type-Options: nosniff`, and sets `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on every
response so authenticated payloads are not cached by intermediaries.

**Request size** is capped at 12 MB, enough for a base64 event image.

## Rate limiting

| Scope | Limit |
|---|---|
| Global | 300 / minute |
| Auth endpoints | 10 / minute |
| Public event discovery | 120 / minute |

Keyed per authenticated user where possible, falling back to client IP
(honouring `X-Forwarded-For`). Keying on IP alone would let one abusive account
hide behind a shared campus NAT, and would throttle everyone behind it together.

Storage defaults to in-process, which is per-worker and resets on restart — fine
for development. **Set `RATELIMIT_STORAGE_URI` to Redis in production**, or the
effective limit is multiplied by the worker count.

## Auditing

Every workflow transition writes a `workflow_history` row — action, actor,
previous and new status, comment, timestamp — inside the same transaction as the
change, so a state change without its audit record is not representable.

Administrative actions additionally emit structured `audit` log lines. Every log
record carries the request id, so a client-reported error traces to the exact
request.

## Known gaps

Honest list of what is not done.

1. **No token revocation.** Logout is client-side; a stolen access token stays
   valid until it expires (30 min). A denylist keyed on the `jti` claim is the
   fix — the claim is already issued, and `/auth/logout` exists as the hook.
2. **Refresh tokens do not rotate on use.** A stolen refresh token is valid for
   its full 14 days. Storing a token family and invalidating on reuse is the
   standard remedy.
3. **No password policy.** Length and complexity are unenforced beyond the
   72-byte ceiling.
4. **No account lockout.** Rate limiting slows credential stuffing but does not
   stop a patient attacker.
5. **Uploads are base64 in the JSON body**, stored as data URLs. Real object
   storage with content-type validation and a size cap is the production answer.
6. **Rate limit storage is in-process by default** — see above.
