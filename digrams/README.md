# Design chapter — thirteen figures

Each file is a standalone HTML page containing one inline SVG. No page frame, no title,
no legend block, no caption — the figure itself is the deliverable, so you add your own
figure numbering and captions in the report.

`png/` holds a rendered copy of each at device resolution. Open the HTML and screenshot
at your own zoom if you need higher.

## The figures

| # | File | Type | Owns, exclusively |
|---|---|---|---|
| 0 | `00-erd.html` | ERD | Physical database: all 68 tables, 471 columns, 111 relationships |
| 1 | `01-deployment-architecture.html` | Architecture | Topology, stack, module layering, external services |
| 2 | `02-security-identity.html` | Architecture | RBAC identity model and the three authorization tiers |
| 3 | `03-usecase-access.html` | Use case | Guest, external, student, lecturer and club capability |
| 4 | `04-usecase-proposal.html` | Use case | Applicant, reviewer, department and cafeteria capability |
| 5 | `05-usecase-admin.html` | Use case | Administration, configuration, dashboards, oversight |
| 6 | `06-activity-proposal-lifecycle.html` | Activity | All ten `request.status` values, routing, fork/join, resume |
| 7 | `07-activity-fulfilment.html` | Activity | Task and F&B selection states, assignment, shared-pool claim |
| 8 | `08-activity-registration.html` | Activity | Registration and payment status lifecycles |
| 9 | `09-sequence-auth.html` | Sequence | OTP registration, login, silent session recovery |
| 10 | `10-sequence-write-path.html` | Sequence | Transaction boundary, audit trail, post-commit notification |
| 11 | `11-sequence-ai.html` | Sequence | Text-to-SQL pipeline, guard, bounded retry, denial logging |
| 12 | `12-sitemap.html` | Site map | Page catalog, hub-with-tabs, runtime-configurable visibility |

## The rule these follow

One concept, one figure. If a fact is owned by figure 6, it is not redrawn in 4 or 10 —
the other figure cross-references it in its own annotation instead. That is why, for
example, the use case diagrams name the capabilities but never the stage order, and why
figure 1 shows `app/security/` as a module but explains nothing about it.

## Shared visual language

Held identical across all thirteen so they read as one system:

- **Solid border** — inside the system boundary. **Dashed border** — outside it, or a
  third party.
- **Oxide-red stroke** — an exceptional path: refused, rejected, sent back, or a
  constraint annotation.
- **Monospace type** — always a literal identifier copied from source
  (`hos_hod_review`, `HIGH_PAX_THRESHOLD`, `request_fmb_selection`).
- Type: Barlow Condensed for headings, IBM Plex Mono for identifiers.

Every distinction is carried by stroke style or shape as well as colour, so the figures
survive a greyscale print.

## Regenerating the ERD

Figure 0 is generated, not hand-drawn — 68 tables laid out by hand would drift from the
schema. It is built directly from a live introspection of the Supabase database, so it
cannot disagree with what is actually deployed.

```bash
# 1. read the live schema (read-only; needs backend/.env for DATABASE_URL)
backend/.venv/Scripts/python digrams/_introspect_schema.py > digrams/_schema.json

# 2. lay it out and emit the SVG
backend/.venv/Scripts/python digrams/_build_erd.py
```

The build script asserts that every table in the database lands in a cluster, so a new
migration cannot silently drop a table off the figure — it appears under "Unclassified"
until you place it.

## Notes on accuracy

Everything in these figures was read out of the repository or the live database. Two
things worth knowing:

- The API base path is `/api/v1`, not `/api`. The Angular dev proxy forwards `/api`,
  which makes it easy to misread.
- There are 15 blueprint registrations, not 13 — `clubs.py` and `tasks.py` each export
  two.
- The live database has **no** `water_normal_options` table, although migration 001
  creates one. Mineral water options are reached another way. If your report describes
  that table, check it against the schema first.
