# EMS Web Client

Angular 21 client for the APU Event Management System. It renders what the API
returns and decides nothing about permissions — every authorisation decision is
made by the backend and arrives as data (see `core/auth`).

## Prerequisites

The API must be running first; `npm start` proxies `/api` to `http://localhost:5000`.
See the repository README for backend setup.

## Commands

```bash
npm install
npm start          # dev server on http://localhost:4200, proxying /api to :5000
npm run build      # production bundle into dist/
npm test           # unit tests (Vitest)
```

## Layout

| Path | Contents |
|---|---|
| `src/app/core/` | Services, models, repositories, guards. One folder per domain. |
| `src/app/features/` | Routed pages, grouped by area (`internal/`, `landing/`, `auth/`). |
| `src/app/shared/` | Components and utilities used by more than one feature. |
| `src/styles/` | Global SCSS partials, imported by `src/styles.scss`. |
| `public/` | Static assets copied verbatim into the build. |

Components follow the Angular style guide's flat naming (`event-proposal.ts`,
not `event-proposal.component.ts`) and are standalone with `OnPush` change
detection throughout.
