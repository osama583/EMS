# Login Demo-User Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a searchable, click-to-autofill demo-user list on the login page, sourced from a real (but explicitly opt-in, testing-only) backend endpoint instead of hardcoded frontend mock data.

**Architecture:** A new `GET /auth/dev-users` Flask endpoint, gated behind a `config.demo_mode` flag that defaults to off (404 when off), returns every active user plus the one shared plaintext demo password. The Angular login page fetches this list on load, tolerates a 404 as "no demo users" (renders nothing), and offers a searchable/grouped list that fills the email and password fields on click. Every new block on both ends is wrapped in a `TESTING ONLY — DELETE BEFORE PRODUCTION` comment banner so the whole feature is a clean, single-pass removal later.

**Tech Stack:** Flask + psycopg2 (raw SQL, no ORM) on the backend; Angular 18+ standalone components with signals, `HttpClient`, RxJS on the frontend. Backend tests: pytest. Frontend tests: Karma/Jasmine via `HttpClientTestingModule`.

## Global Constraints

- `config.demo_mode` defaults to `false`; `GET /auth/dev-users` must `raise NotFound()` immediately when it is false — no auth bypass surface exists in a default deployment.
- The endpoint is intentionally **not** `@require_auth` (it must be callable before login), so `demo_mode` is the only gate — get this check right and put it first in the function body.
- `config.demo_password` holds the one shared plaintext password every seeded account uses; the endpoint returns it verbatim on every row. This is not a per-user secret being leaked — it is one already-shared value, the same one `seed/run.py` already prints to the console once.
- Every new block of code (backend and frontend) is wrapped in a comment banner reading exactly:
  `TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)`
  so a future cleanup pass can grep one string and find every piece to remove on both ends.
- No change to `/admin/users`, its auth requirements, or password hashing/verification logic.
- Grouping in the frontend list is by `roleLabel`, sorted alphabetically — no hardcoded role-bucket ordering (the old `DEMO_GROUP_ORDER` enum mapping is explicitly not being recreated).
- Follow existing code conventions exactly: raw SQL via `query()`/`query_one()` (backend/app/db.py), signals + `computed()` for derived state (frontend), `catchError`/`of()` for graceful HTTP fallback (frontend).

---

## File Structure

**Backend — create/modify:**
- Modify `backend/app/config.py` — add `demo_mode: bool` and `demo_password: str` fields.
- Modify `backend/app/api/auth.py` — add `GET /auth/dev-users` in a banner-commented block at the end of the file.
- Modify `backend/.env.example` — add the `DEMO_MODE` / `DEMO_PASSWORD` section.
- Modify `backend/seed/run.py` — extend `_report()`'s printed output with the new env-var pointer.
- Create `backend/tests/test_dev_users.py` — endpoint gating + shape tests (no DB needed, mirrors `test_auth_wiring.py`'s no-DB `client` fixture pattern).

**Frontend — create/modify:**
- Create `fyp-ui/src/app/core/auth/dev-users.service.ts` — small `HttpClient`-based service, one method, fetches the list and swallows a 404 into `[]`.
- Create `fyp-ui/src/app/core/auth/dev-users.service.spec.ts` — service-level HTTP tests.
- Modify `fyp-ui/src/app/features/auth/login/login.ts` — restore `demoUsers`/`demoSearch`/`demoGroups`/`selectedDemoEmail`/`selectDemoUser()`, all in one banner-commented block, sourced from the new service instead of `environment.mockUsers`.
- Modify `fyp-ui/src/app/features/auth/login/login.html` — restore the `<section class="login-demo-users">` block, gated on `@if (demoUsers().length)`.
- Create `fyp-ui/src/app/features/auth/login/login.spec.ts` — component tests for rendering, search filtering, and autofill (none existed before).

No `login.scss` changes — the `.login-demo-users*` classes are already present and unused.

---

## Task 1: Backend config flags

**Files:**
- Modify: `backend/app/config.py:30-73` (the `Config` dataclass)
- Modify: `backend/.env.example`
- Test: `backend/tests/test_dev_users.py` (new file, first test only in this task)

**Interfaces:**
- Consumes: nothing new.
- Produces: `config.demo_mode: bool`, `config.demo_password: str` — consumed by Task 2's endpoint.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_dev_users.py`:

```python
"""Tests for the TESTING ONLY demo-user picker endpoint (GET /auth/dev-users).

Delete this file when the feature is removed — see config.demo_mode.
"""
from __future__ import annotations

from dataclasses import replace

import pytest

from app import create_app
from app.api import auth as auth_module


@pytest.fixture()
def client():
    app = create_app(validate_config=False)
    app.config["TESTING"] = True
    return app.test_client()


def test_dev_users_config_defaults_to_disabled():
    from app.config import config

    assert config.demo_mode is False
    assert config.demo_password == ""


def test_dev_users_route_404s_when_demo_mode_is_off(client, monkeypatch):
    monkeypatch.setattr(
        auth_module, "config", replace(auth_module.config, demo_mode=False)
    )
    res = client.get("/api/v1/auth/dev-users")
    assert res.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_dev_users.py -v`
Expected: FAIL — `test_dev_users_config_defaults_to_disabled` fails with `AttributeError: 'Config' object has no attribute 'demo_mode'` (the route test will also error, since `/auth/dev-users` doesn't exist yet — that's fine, both are addressed by the end of Task 2).

- [ ] **Step 3: Add the config fields**

In `backend/app/config.py`, add two fields to the `Config` dataclass, right after `log_format` (line 52) and before the `is_development` property:

```python
    # --- Demo login picker (TESTING ONLY - delete before production) -----
    # Gates GET /auth/dev-users. Off by default; a deployed environment that
    # never sets DEMO_MODE serves nothing from that route regardless of what
    # else is misconfigured.
    demo_mode: bool = os.getenv("DEMO_MODE", "").strip().lower() == "true"
    demo_password: str = os.getenv("DEMO_PASSWORD", "")
```

- [ ] **Step 4: Update `.env.example`**

In `backend/.env.example`, append after the `LOG_FORMAT` line:

```
# --- Demo login picker (TESTING ONLY - delete before production) ---------
# Enables GET /auth/dev-users, which lists every seeded account (with the
# shared demo password) for the login page's account picker. Never set this
# in a deployed environment.
DEMO_MODE=false
DEMO_PASSWORD=
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `cd backend && pytest tests/test_dev_users.py::test_dev_users_config_defaults_to_disabled -v`
Expected: PASS. (`test_dev_users_route_404s_when_demo_mode_is_off` still fails/errors — that's Task 2.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/.env.example backend/tests/test_dev_users.py
git commit -m "feat(backend): add DEMO_MODE/DEMO_PASSWORD config flags (testing only)"
```

---

## Task 2: Backend `GET /auth/dev-users` endpoint

**Files:**
- Modify: `backend/app/api/auth.py` (append at end of file)
- Test: `backend/tests/test_dev_users.py` (extend)

**Interfaces:**
- Consumes: `config.demo_mode`, `config.demo_password` (Task 1). `query()` from `app/db.py` (signature: `query(sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]`, already imported pattern in `admin.py`).
- Produces: `GET /auth/dev-users` → `200` with `[{ id: str, displayName: str, email: str, roleLabel: str, department: str, password: str }]`, or `404` when `demo_mode` is off. Consumed by Task 4 (frontend service).

- [ ] **Step 1: Write the failing tests**

Extend `backend/tests/test_dev_users.py` — add these after the existing tests (keep the `replace` import and `client`/`auth_module` already there):

```python
def test_dev_users_route_returns_users_when_demo_mode_is_on(client, monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "config",
        replace(auth_module.config, demo_mode=True, demo_password="Demo-test123"),
    )
    fake_rows = [
        {
            "id": "1",
            "displayName": "Jane Tan",
            "email": "jane.tan@apu.edu.my",
            "roleLabel": "Lecturer",
            "department": "School of Computing",
        },
    ]
    monkeypatch.setattr(auth_module, "_dev_user_rows", lambda: fake_rows)

    res = client.get("/api/v1/auth/dev-users")
    assert res.status_code == 200
    body = res.get_json()
    assert body == [
        {
            "id": "1",
            "displayName": "Jane Tan",
            "email": "jane.tan@apu.edu.my",
            "roleLabel": "Lecturer",
            "department": "School of Computing",
            "password": "Demo-test123",
        },
    ]


def test_dev_users_route_omits_password_field_shape_when_no_users(client, monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "config",
        replace(auth_module.config, demo_mode=True, demo_password="Demo-test123"),
    )
    monkeypatch.setattr(auth_module, "_dev_user_rows", lambda: [])

    res = client.get("/api/v1/auth/dev-users")
    assert res.status_code == 200
    assert res.get_json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_dev_users.py -v`
Expected: FAIL — `test_dev_users_route_404s_when_demo_mode_is_off` gets a 404 from Flask's *default* unmatched-route handler (coincidentally passing status-wise but not exercising real logic — that's fine, it'll be exercised for real once the route exists), and the two new tests fail with 404 because the route doesn't exist yet, or `AttributeError: module 'app.api.auth' has no attribute '_dev_user_rows'`.

- [ ] **Step 3: Implement the endpoint**

Append to the end of `backend/app/api/auth.py` (after the `register` function, which currently ends the file):

```python
# ---------------------------------------------------------------------------
# TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
#
# Lists every active user plus the one shared plaintext demo password (every
# seeded account uses the same password - see seed/run.py). Powers the login
# page's searchable account picker. Inert unless DEMO_MODE=true; a deployment
# that never sets it serves a 404 here regardless of anything else.
# ---------------------------------------------------------------------------
_DEV_USERS_SQL = """
    SELECT u.user_id AS id, u.full_name, u.email,
           COALESCE(s.department_or_school, st.school) AS department
      FROM users u
 LEFT JOIN staff s ON s.user_id = u.user_id
 LEFT JOIN student st ON st.user_id = u.user_id
     WHERE u.is_active AND u.archived_at IS NULL
  ORDER BY u.full_name
"""

_DEV_USER_ROLE_SQL = """
    SELECT r.role_name, u.description AS unit_description
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
 LEFT JOIN unit u ON u.code = uur.unit_code
     WHERE uur.user_id = %s AND r.archived_at IS NULL
  ORDER BY uur.user_unit_role_id
     LIMIT 1
"""


def _dev_user_rows() -> list[dict[str, object]]:
    from ..db import query as _query

    rows = _query(_DEV_USERS_SQL)
    out = []
    for row in rows:
        role = _query(_DEV_USER_ROLE_SQL, (row["id"],))
        role_label = "Unassigned"
        if role:
            role_label = (
                f"{role[0]['role_name']} — {role[0]['unit_description']}"
                if role[0]["unit_description"]
                else role[0]["role_name"]
            )
        out.append(
            {
                "id": str(row["id"]),
                "displayName": row["full_name"],
                "email": row["email"],
                "roleLabel": role_label,
                "department": row["department"] or "APU Community",
            }
        )
    return out


@bp.get("/dev-users")
def dev_users():
    if not config.demo_mode:
        raise NotFound("Not found.")
    return jsonify([{**row, "password": config.demo_password} for row in _dev_user_rows()])
```

Add `NotFound` to the existing import from `..errors` at the top of the file (currently `from ..errors import BadRequest, Conflict, Unauthorized`):

```python
from ..errors import BadRequest, Conflict, NotFound, Unauthorized
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_dev_users.py -v`
Expected: PASS — all three tests green.

- [ ] **Step 5: Run the full backend wiring test suite to check for regressions**

Run: `cd backend && pytest tests/test_auth_wiring.py tests/test_dev_users.py -v`
Expected: PASS — no existing test broken by the new import or route.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/auth.py backend/tests/test_dev_users.py
git commit -m "feat(backend): add GET /auth/dev-users demo picker endpoint (testing only)"
```

---

## Task 3: Seed script points at the new flags

**Files:**
- Modify: `backend/seed/run.py:406-418` (the `_report` function)

**Interfaces:**
- Consumes: nothing new (this is a print-output-only change).
- Produces: nothing consumed by later tasks — purely operator-facing guidance.

- [ ] **Step 1: Update `_report()`**

In `backend/seed/run.py`, inside `_report()`, after the existing block that prints `DEMO ACCOUNT PASSWORD:` and before the account listing loop (currently ends at `print("Re-run with --reset --password <value> to set a different one.\n")`), add:

```python
    print(f"DEMO ACCOUNT PASSWORD:  {password}")
    print("-" * 78)
    print("Every seeded account shares this password. It is printed once, here -")
    print("only the bcrypt hash is stored, so it cannot be recovered later.")
    print("Re-run with --reset --password <value> to set a different one.\n")
    print("To enable the login page's demo-user picker (testing only):")
    print(f"  Set DEMO_PASSWORD={password} and DEMO_MODE=true in backend/.env\n")
```

(This replaces the last two lines of the existing block — the four `print` lines above the two new ones are unchanged, just shown for placement context. Only the final two lines are new.)

- [ ] **Step 2: Verify by inspection**

There is no automated test for print output here — this is operator-facing console text, not behavior. Verify by reading the diff: `git diff backend/seed/run.py` and confirm the new lines appear after the existing password-reset guidance and before the account table.

- [ ] **Step 3: Commit**

```bash
git add backend/seed/run.py
git commit -m "docs(backend): point seed report at DEMO_MODE/DEMO_PASSWORD"
```

---

## Task 4: Frontend `DevUsersService`

**Files:**
- Create: `fyp-ui/src/app/core/auth/dev-users.service.ts`
- Test: `fyp-ui/src/app/core/auth/dev-users.service.spec.ts`

**Interfaces:**
- Consumes: `environment.apiBaseUrl` (from `fyp-ui/src/environments/environment.ts`), Angular `HttpClient`.
- Produces: `DevUsersService.list(): Observable<DevUser[]>` where
  ```ts
  export interface DevUser {
    readonly id: string;
    readonly displayName: string;
    readonly email: string;
    readonly roleLabel: string;
    readonly department: string;
    readonly password: string;
  }
  ```
  Resolves to `[]` (never errors) on any HTTP failure, including 404. Consumed by Task 5 (`login.ts`).

- [ ] **Step 1: Write the failing test**

Create `fyp-ui/src/app/core/auth/dev-users.service.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DevUsersService } from './dev-users.service';

describe('DevUsersService (TESTING ONLY feature)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('returns the demo user list when the backend flag is enabled', async () => {
    const service = TestBed.inject(DevUsersService);
    const httpMock = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(service.list());
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/dev-users`).flush([
      { id: '1', displayName: 'Jane Tan', email: 'jane.tan@apu.edu.my', roleLabel: 'Lecturer', department: 'School of Computing', password: 'Demo-test123' },
    ]);

    const result = await promise;
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('jane.tan@apu.edu.my');
  });

  it('resolves to an empty list when the backend flag is disabled (404)', async () => {
    const service = TestBed.inject(DevUsersService);
    const httpMock = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(service.list());
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/dev-users`).flush('not found', { status: 404, statusText: 'Not Found' });

    expect(await promise).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fyp-ui && npx ng test --watch=false --include=**/dev-users.service.spec.ts`
Expected: FAIL — `dev-users.service.ts` does not exist yet (module resolution error).

- [ ] **Step 3: Write the service**

Create `fyp-ui/src/app/core/auth/dev-users.service.ts`:

```ts
// TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
//
// Fetches the shared-password demo account list for the login page's
// account picker. The backend endpoint 404s unless DEMO_MODE=true is set on
// the server, which this service treats identically to "no demo users" —
// there is no separate frontend flag to keep in sync.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DevUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleLabel: string;
  readonly department: string;
  readonly password: string;
}

@Injectable({ providedIn: 'root' })
export class DevUsersService {
  private readonly http = inject(HttpClient);

  list(): Observable<DevUser[]> {
    return this.http
      .get<DevUser[]>(`${environment.apiBaseUrl}/auth/dev-users`)
      .pipe(catchError(() => of([])));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd fyp-ui && npx ng test --watch=false --include=**/dev-users.service.spec.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add "fyp-ui/src/app/core/auth/dev-users.service.ts" "fyp-ui/src/app/core/auth/dev-users.service.spec.ts"
git commit -m "feat(frontend): add DevUsersService for the login demo picker (testing only)"
```

---

## Task 5: Restore the picker in `login.ts` and `login.html`

**Files:**
- Modify: `fyp-ui/src/app/features/auth/login/login.ts`
- Modify: `fyp-ui/src/app/features/auth/login/login.html`
- Test: `fyp-ui/src/app/features/auth/login/login.spec.ts` (new file)

**Interfaces:**
- Consumes: `DevUsersService.list(): Observable<DevUser[]>` (Task 4), `DevUser` interface (Task 4).
- Produces: nothing consumed by later tasks — this is the terminal UI task.

- [ ] **Step 1: Write the failing tests**

Create `fyp-ui/src/app/features/auth/login/login.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { LoginComponent } from './login';

describe('LoginComponent demo picker (TESTING ONLY feature)', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('apu-ems-auth-user');
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(LoginComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushDevUsers(users: unknown[]): void {
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/dev-users`).flush(users);
  }

  it('renders no picker section when the backend has no demo users', () => {
    fixture.detectChanges();
    flushDevUsers([]);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.login-demo-users');
    expect(section).toBeNull();
  });

  it('renders the picker and fills both fields when a demo user is clicked', () => {
    fixture.detectChanges();
    flushDevUsers([
      { id: '1', displayName: 'Jane Tan', email: 'jane.tan@apu.edu.my', roleLabel: 'Lecturer', department: 'School of Computing', password: 'Demo-test123' },
    ]);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.login-demo-users');
    expect(section).not.toBeNull();

    const button = fixture.nativeElement.querySelector('.login-demo-user') as HTMLButtonElement;
    expect(button.textContent).toContain('Jane Tan');
    button.click();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.email()).toBe('jane.tan@apu.edu.my');
    expect(component.password()).toBe('Demo-test123');
  });

  it('filters the list by the search box', () => {
    fixture.detectChanges();
    flushDevUsers([
      { id: '1', displayName: 'Jane Tan', email: 'jane.tan@apu.edu.my', roleLabel: 'Lecturer', department: 'School of Computing', password: 'Demo-test123' },
      { id: '2', displayName: 'Ali Rahman', email: 'ali.rahman@apu.edu.my', roleLabel: 'Student', department: 'School of Computing', password: 'Demo-test123' },
    ]);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.login-demo-users__search input') as HTMLInputElement;
    input.value = 'Ali';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.login-demo-user');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Ali Rahman');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd fyp-ui && npx ng test --watch=false --include=**/login.spec.ts`
Expected: FAIL — no `GET /auth/dev-users` request is made (component doesn't call the service yet), so `httpMock.expectOne(...)` throws "Expected one matching request... found none."

- [ ] **Step 3: Update `login.ts`**

In `fyp-ui/src/app/features/auth/login/login.ts`:

Add imports (after the existing `GuestRegistrationModalComponent` import):

```ts
import { DevUser, DevUsersService } from '../../../core/auth/dev-users.service';
```

Add a `computed` import to the existing `@angular/core` import line (currently `import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';` — `computed` is already imported, so no change needed there).

Add, right after the `interface` — there is no existing interface in this file, so define one before the `@Component` decorator:

```ts
// TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
interface DemoUserGroup { readonly label: string; readonly users: readonly DevUser[]; }
```

Inside the class, add the injected service alongside the other `inject()` calls (after `private readonly destroyRef = inject(DestroyRef);`):

```ts
  // TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
  private readonly devUsersService = inject(DevUsersService);
```

Add new signals alongside the existing ones (after `readonly submitting = signal(false);` and before `readonly year = new Date().getFullYear();`):

```ts
  // TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
  readonly demoUsers = signal<readonly DevUser[]>([]);
  readonly demoSearch = signal('');
  readonly selectedDemoEmail = signal<string | null>(null);
  readonly demoGroups = computed<readonly DemoUserGroup[]>(() => {
    const query = this.demoSearch().trim().toLowerCase();
    const matches = (user: DevUser): boolean =>
      !query
      || user.displayName.toLowerCase().includes(query)
      || user.email.toLowerCase().includes(query)
      || user.roleLabel.toLowerCase().includes(query)
      || user.department.toLowerCase().includes(query);

    const filtered = [...this.demoUsers()].filter(matches).sort((a, b) => a.roleLabel.localeCompare(b.roleLabel));
    const groups: DemoUserGroup[] = [];
    for (const user of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.label === user.roleLabel) last.users = [...last.users, user];
      else groups.push({ label: user.roleLabel, users: [user] });
    }
    return groups;
  });
```

Update the `constructor()` to fetch the list (append at the end of the existing constructor body, after `else this.timer = setTimeout(() => this.tickTypewriter(), 420);`):

```ts
    // TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
    this.devUsersService.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((users) => this.demoUsers.set(users));
```

Add new methods, near `setPassword` (after it, before `openRegister`):

```ts
  // TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
  setDemoSearch(value: string): void { this.demoSearch.set(value); }

  // TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
  selectDemoUser(user: DevUser): void {
    this.selectedDemoEmail.set(user.email);
    this.email.set(user.email);
    this.password.set(user.password);
    this.emailError.set('');
    this.passwordError.set('');
    this.loginError.set('');
  }
```

- [ ] **Step 4: Update `login.html`**

In `fyp-ui/src/app/features/auth/login/login.html`, insert the restored section between `login-form__fields` and the `loginError()` block (i.e. right after the closing `</div>` of `login-form__fields`, before `@if (loginError())`):

```html
      <!-- TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode) -->
      @if (demoUsers().length) {
        <section class="login-demo-users" aria-labelledby="demo-users-heading">
          <div class="login-demo-users__heading">
            <span id="demo-users-heading">Development demo users</span>
            <small>Click an account to fill the form</small>
          </div>
          <label class="login-demo-users__search">
            <span class="material-symbols-rounded" aria-hidden="true">search</span>
            <input type="search" placeholder="Search by name, role, or department" [value]="demoSearch()" (input)="setDemoSearch($any($event.target).value)" aria-label="Search demo users" />
          </label>
          <div class="login-demo-users__list" role="listbox" aria-label="Development demo users">
            @for (group of demoGroups(); track group.label) {
              <div class="login-demo-users__group">
                <span class="login-demo-users__group-label">{{ group.label }}</span>
                @for (user of group.users; track user.email) {
                  <button
                    type="button"
                    class="login-demo-user"
                    [class.login-demo-user--selected]="selectedDemoEmail() === user.email"
                    [attr.aria-selected]="selectedDemoEmail() === user.email"
                    role="option"
                    (click)="selectDemoUser(user)"
                  >
                    <span class="login-demo-user__identity">
                      <strong>{{ user.displayName }}</strong>
                      <span class="login-demo-user__badges">
                        <span class="login-demo-user__badge">{{ user.roleLabel }}</span>
                        <span class="login-demo-user__badge login-demo-user__badge--muted">{{ user.department }}</span>
                      </span>
                    </span>
                    <span class="material-symbols-rounded login-demo-user__check" aria-hidden="true">check_circle</span>
                  </button>
                }
              </div>
            } @empty {
              <p class="login-demo-users__empty">No demo users match your search.</p>
            }
          </div>
        </section>
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd fyp-ui && npx ng test --watch=false --include=**/login.spec.ts`
Expected: PASS — all three tests green.

- [ ] **Step 6: Run the full frontend test suite to check for regressions**

Run: `cd fyp-ui && npx ng test --watch=false`
Expected: PASS — no existing spec (e.g. any spec touching `LoginComponent`, `AuthService`, or shared auth fixtures) broken by these changes.

- [ ] **Step 7: Commit**

```bash
git add "fyp-ui/src/app/features/auth/login/login.ts" "fyp-ui/src/app/features/auth/login/login.html" "fyp-ui/src/app/features/auth/login/login.spec.ts"
git commit -m "feat(frontend): restore searchable demo-user picker on login page (testing only)"
```

---

## Task 6: End-to-end manual verification

**Files:** none (manual verification only — no code changes).

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: nothing — this is the final confidence check before calling the feature done.

- [ ] **Step 1: Seed a local database with demo mode off and confirm the picker is absent**

```bash
cd backend
python -m seed.run --reset
```

Ensure `backend/.env` does NOT set `DEMO_MODE=true`. Start the backend (`python -m flask --app app run` or the project's usual run command) and the frontend (`cd fyp-ui && npx ng serve`). Open the login page in a browser. Confirm no "Development demo users" section renders.

- [ ] **Step 2: Enable demo mode and confirm the picker appears and works**

Copy the `DEMO ACCOUNT PASSWORD` printed by the seed command into `backend/.env` as `DEMO_PASSWORD=<value>`, add `DEMO_MODE=true`, restart the backend. Reload the login page. Confirm:
- The "Development demo users" section renders with a search box and a grouped, scrollable list.
- Typing in the search box filters the list by name/email/role/department.
- Clicking a user fills both the email and password fields.
- Clicking Sign In with those filled fields successfully logs in.

- [ ] **Step 3: Confirm the kill-switch works end to end**

Set `DEMO_MODE=false` (or remove it) in `backend/.env`, restart the backend, reload the login page. Confirm the section is gone again and a direct request to `GET /api/v1/auth/dev-users` in the browser returns 404.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any step fails, return to the relevant earlier task and fix before considering the plan complete.

---

## Self-Review Notes

- **Spec coverage:** config flag (Task 1), gated endpoint (Task 2), seed script pointer (Task 3), frontend service with 404-tolerant fallback (Task 4), restored UI with search/grouping/autofill (Task 5), manual end-to-end confirmation of the on/off switch (Task 6) — all spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has concrete code or an exact verification action.
- **Type consistency:** `DevUser` is defined once in Task 4 (`dev-users.service.ts`) and imported (not redefined) in Task 5. `DevUsersService.list()` signature is identical between its definition (Task 4) and its two call sites (Task 5 constructor, Task 5 spec). Backend `_dev_user_rows()` return shape (`id`, `displayName`, `email`, `roleLabel`, `department`) matches the JSON keys asserted in Task 2's tests and the `password` field added only in the route handler, matching Task 4's `DevUser` interface exactly.
