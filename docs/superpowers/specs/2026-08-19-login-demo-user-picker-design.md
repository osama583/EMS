# Login demo-user picker (searchable, click-to-autofill)

Status: approved
Date: 2026-08-19

## Problem

The login page needs a searchable, scrollable list of every user in the
system (name, role, department) so the developer can quickly find an account
and sign in as it during testing, without memorizing emails or passwords.

This exact feature existed before. It was deliberately deleted in commit
`0ec8334` ("migrate the Angular frontend onto the Flask API") along with
`GET /auth/demo-users`, because that endpoint returned **every seeded
account's plaintext password to any unauthenticated caller**. The SCSS for
the picker (`.login-demo-users*` classes in `login.scss`) was left behind and
is still fully styled and unused.

Passwords are never stored in plaintext (`users.password` is a bcrypt hash,
one-way, unrecoverable). The old picker worked because every seeded demo
account shares **one** plaintext password, chosen or generated once by
`backend/seed/run.py` and printed to the console. Autofill means "fill in
that one shared value," not "recover a per-user secret."

## Explicit decision: this is a testing-only feature

The user has confirmed this is for local testing, will be deleted before
production, and wants it easy to find and rip out cleanly. Every piece of
code added for this feature — backend and frontend — must be:

- Clearly bounded (dedicated functions/blocks, not scattered inline changes)
- Marked with a `TESTING ONLY — DELETE BEFORE PRODUCTION` comment banner
- Inert by default in any deployment that doesn't explicitly opt in

## Design

### Backend

**Config** (`app/config.py`) — two new fields, both env-driven, both default
to off/empty like every other secret in this file:

```python
demo_mode: bool = os.getenv("DEMO_MODE", "").strip().lower() == "true"
demo_password: str = os.getenv("DEMO_PASSWORD", "")
```

**New endpoint** in `app/api/auth.py`, fenced with a comment banner:

```
GET /auth/dev-users
```

- First line: `if not config.demo_mode: raise NotFound()`. With the flag off
  (the default), this route 404s exactly as if it didn't exist — no auth
  bypass surface exists in a default deployment.
- No `@require_auth` — this must be callable from the login page before a
  session exists. Safety comes entirely from the `demo_mode` gate above, not
  from an auth decorator.
- Reads active, non-archived users (mirrors `admin.py`'s `_USER_SELECT`
  pattern: joins `staff`/`student` for department, `user_unit_roles`/`role`
  for the first role label).
- Returns one shared `password` field on every row — `config.demo_password`
  — since that's the actual value every seeded account holds. Not a per-user
  secret; the same string on every entry.

Response shape:

```json
[
  { "id": "12", "displayName": "Jane Tan", "email": "jane.tan@apu.edu.my",
    "roleLabel": "Lecturer", "department": "School of Computing",
    "password": "Demo-xk8vQp2z1" }
]
```

**`.env.example`** — new section:

```
# --- Demo login picker (TESTING ONLY - delete before production) ---------
# Enables GET /auth/dev-users, which lists every seeded account (with the
# shared demo password) for the login page's account picker. Never set this
# in a deployed environment.
DEMO_MODE=false
DEMO_PASSWORD=
```

**`seed/run.py`** — extend the existing end-of-run report (it already prints
`DEMO ACCOUNT PASSWORD: <value>` once) with one line pointing at the new
variables:

```
Copy this into DEMO_PASSWORD= in your .env, and set DEMO_MODE=true, to
enable the login page's demo-user picker.
```

No change to how the DB is seeded — the report already has the value in
hand; this just tells the developer where to put it.

### Frontend

**Service call** — a small method (on `AuthService`, or a tiny new
`DevUsersService` alongside it) hitting `GET /auth/dev-users`. A 404 (feature
disabled) is treated as "no demo users" and resolves to `[]`, not an error —
the picker section simply doesn't render rather than surfacing a failure.

**`login.ts`** — restore, inside a clearly banner-commented block:

- `demoUsers = signal<DevUser[]>([])`, populated from the service call in
  the constructor (fire-and-forget; failure/404 leaves it empty).
- `demoSearch = signal('')` — free-text query.
- `demoGroups = computed(...)` — filters `demoUsers()` by
  name/email/role/department substring match against `demoSearch()`, then
  groups by `roleLabel` alphabetically (no hardcoded role-bucket ordering —
  the old `DEMO_GROUP_ORDER` enum mapping is not being recreated, since it
  coupled to a specific `UserRole` enum shape that may not still match).
- `selectedDemoEmail = signal<string | null>(null)`.
- `selectDemoUser(user)` — sets `email`, `password`, `selectedDemoEmail`,
  and clears both field errors, exactly like the deleted version.

**`login.html`** — restore the `<section class="login-demo-users">` block
(search input + grouped `role="listbox"` list + badges), using the classes
already defined in `login.scss`. Gated on `@if (demoUsers().length)` instead
of an `environment.enableMockAuth` flag — it has no reason to render when
the list is empty (backend flag off, or no users returned), so no separate
"enabled" flag is needed on the frontend.

Both blocks carry the same banner comment so a future cleanup pass can
grep for it and know exactly what to delete on both ends:

```
// TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
```

## Out of scope

- Recreating the old curated group ordering (Students → School Staff →
  Department Staff → HOS/HOD → Managers → Service Staff). Grouping by
  `roleLabel` alphabetically is simpler and doesn't require maintaining a
  role-enum mapping that can drift from the seeded roles.
- Any change to `/admin/users` or its auth requirements.
- Any change to how passwords are hashed, verified, or stored.

## Testing

- Backend: a test that `GET /auth/dev-users` 404s when `DEMO_MODE` is unset
  or false, and returns the expected shape (including the shared password)
  when true.
- Frontend: existing login spec extended to cover the picker rendering when
  demo users are present, filtering by search text, and `selectDemoUser`
  filling both fields; and to confirm the section renders nothing when the
  service returns `[]`.
