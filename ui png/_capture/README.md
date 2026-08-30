# Figure capture tooling

Regenerates every figure in `ui png/` for Chapter 4 of the report. Screenshots
come from the live application, so a figure is never a mock-up — if the UI
changes, re-running these scripts updates the report images.

## Prerequisites

Both servers must be running (see the repo README):

```bash
cd backend && .venv/Scripts/python wsgi.py     # http://localhost:5000
cd fyp-ui  && npm start                        # http://localhost:4200
```

Then install the harness dependencies once:

```bash
cd "ui png/_capture" && npm install
```

## Scripts

| Script | Produces |
|---|---|
| `preflight.mjs` | Prints the routes each demo account can actually open. Run this first after any change to roles or Page Visibility — it is how the shot list stays honest. |
| `capture.mjs` | `ui png/Implementation/` — every page at desktop and phone size. |
| `build_design_figures.mjs` | `ui png/Interface Design/` — the section 4.4 design artefacts. |
| `build_code_figures.py` + `shoot_code.mjs` | `ui png/Sample Codes/` — the section 4.6 code listings. |
| `build_index.mjs` | `ui png/FIGURE INDEX.md` — the caption sheet. |

## Typical run

```bash
node preflight.mjs                  # confirm role access first
node capture.mjs                    # all pages; --group A or --only 4.5.01 to narrow
node build_design_figures.mjs
python build_code_figures.py && node shoot_code.mjs
node build_index.mjs
```

## How it works

- **Sessions** are seeded directly into `localStorage`. The app treats a session
  as valid only when both `apu-ems-session` (tokens) and `apu-ems-auth-user`
  (the cached profile) are present, so the harness writes both.
- **Login is rate limited** to 10/min, so `login()` backs off and retries rather
  than failing a long run partway through.
- **The dev demo-account picker** is suppressed via `apu.login.demoUsers`, and
  the rotating AI nudge bubble is hidden with injected CSS, so neither appears
  in 160-odd figures.
- **Capture notes** land in `manifest.json` and are surfaced in the figure index:
  `EMPTY-STATE` (page had no rows), `PREP-MISSED` (a scripted click found no
  control), `LANDED->` (the app redirected).

Line ranges for the code listings live in `build_code_figures.py`, so the
listings track the real files rather than being pasted copies.
