# Wireframes, responsive behaviour, and mobile

Per-role page wireframes live in each role document's § 6. This document covers what
they share: component anatomy, the responsive grid, and what happens when 1,440px of
dashboard has to become 390px of phone.

---

## 1. Component anatomy

### Stat tile

```
┌─────────────────────────────┐
│ Decision latency        ⓘ   │  label · sentence case · --apu-text-muted · 0.8125rem
│                             │
│ 31h / 74h                   │  value · 1.75rem · weight 700 · proportional figures
│ ▁▂▃▂▄▅▄▆                    │  sparkline · 12 pts · de-emphasis, last pt in accent
│ ▼ 12% vs previous 30 days   │  delta · signed · direction × whether up is good
│ ✓ target ≤ 48h              │  status · icon + label + colour, never colour alone
└─────────────────────────────┘
```

- `ⓘ` reveals the metric definition and its ID — the semantic layer, reachable from
  the number rather than filed in a document nobody opens.
- Median and p90 sit side by side as `31h / 74h`. A single latency figure is dominated
  by the one item nobody picked up, which is the item you already know about.
- The whole tile is the hit target, not just the value.
- `font-variant-numeric` stays **proportional**. `tabular-nums` gives every digit the
  width of a zero, which makes `121` look loose at 1.75rem.

### Hero figure

```
┌──────────────────────────────────────────┐
│ Crew coverage ratio · next 14 days   ⓘ   │
│                                          │
│   0.94                                   │  ≥ 3rem · same sans · proportional
│   ▁▂▃▅▆█                                 │
│   peak Sep 12 · target ≤ 0.80            │
│   ⚠ Above target                         │
│   ── Assumes 8h shifts (G2) ──           │  assumption travels with the number
└──────────────────────────────────────────┘
```

**Exactly one hero per view.** It occupies four grid columns and full band height, so
it reads as the page's lead rather than a larger tile. Same typeface as everything
else — a display or serif face here reads as off-brand decoration.

Where the metric rests on an assumption or a schema gap, the caveat is rendered
**inside the card**, not in a footnote. A cost figure that is 84% priced and a cost
figure that is 100% priced are different claims, and the difference belongs where the
number is read.

### Chart frame

```
┌──────────────────────────────────────────────────────────────┐
│ Panel title                        [ filter ▾ ]  ⊞ table  ⤓  │
│ Subtitle · what this measures and over what window           │
│ ● Series A   ● Series B   ● Other                            │  legend: ≥2 series only
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   plot area · hairline solid grid · recessive axes           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│   x-axis band — inside the container, never clipped          │
│ 2 buckets below reporting threshold                          │  R8 footnote when >0
└──────────────────────────────────────────────────────────────┘
```

- `⊞ table` toggles the table view. It ships with every panel, so no value is gated
  behind a hover.
- `⤓` exports that panel's table as CSV via `GET /dashboard/export`.
- Container height is `plot + axis band`. Fixing a height that excludes the axis is how
  a card ends up with a tiny nested scrollbar.
- Panel-local filters sit in the panel header. The page filter row above scopes
  everything; a panel filter narrows within that slice and never replaces it.

### Insight card

```
┌────────────────────────────────────────────────────┐
│ ⚠ SERIOUS   Seat-fill fell below 55% for a third   │
│             consecutive week                        │
│                                                     │
│ Median 0.54 against a 0.60–0.95 target. The         │
│ 40-seat coach on APU→KLIA carries 12 passengers     │
│ on average.                                         │
│                                                     │
│ M32 · 3 weeks · 14 trips                            │  evidence, always
│ [ Review vehicle assignments → ]      [ snooze ▾ ]  │
└────────────────────────────────────────────────────┘
```

Severity as icon + word + colour. `warning` and `serious` sit below 3:1 on white by
design; the icon and the word are what carry them.

### Meter

```
Water · 500ml pack           ████████████████░░░░░░  72%
                             committed 1,440 / 2,000 bottles
```

Fill carries severity; the unfilled track is a **lighter step of the same blue ramp**,
so the state reads across the whole bar rather than only where the fill stops.

---

## 2. The grid

12 columns, `--space-4` gutter, `--layout-max` container. All tokens exist in
`_design-system.scss`; the dashboard adds none.

| Band | Purpose | Desktop span |
|---|---|---|
| Header | Title, profile switcher, unit/outlet switcher | 12 |
| Filter row | Period + dimensions, sticky at the top | 12 |
| 1 · Signal | Hero + four to five KPI tiles | 4 + 2 × 4 |
| 2 · Signature | The role's own instrument | 12 |
| 3 · Analysis | Supporting panels | 6+6, then 4+4+4 |
| 4 · Decision support | Insights rail + alerts rail | 8 + 4 |
| 5 · Quick actions | Three to four buttons with counts | 12 |

**Band 2 is the differentiator.** Bands 1, 3, 4 and 5 share a skeleton across all ten
roles. Band 2 is the widest and tallest element on the page and is different for every
one of them — an inventory heatmap for Logistics, a collision timeline for A/V, a
delivery funnel for Photography, a fan-out board for F&B, a gate-coverage matrix for
the CFO, a service board for a Cafeteria Manager.

---

## 3. Breakpoints

Three, matching the media queries already in `_design-system.scss` (`64rem`, `48rem`).

| Width | Grid | Behaviour |
|---|---|---|
| ≥ 1280px | 12 col | As designed |
| 1024–1279px | 12 col | Band 3 becomes 6+6 throughout; the 4+4+4 row stacks to 6+6 then 12 |
| 768–1023px | 8 col | Hero full width; KPIs 2 per row; every panel full width; insights and alerts stack |
| < 768px | 4 col | Single column; see § 4 |

The filter row is `position: sticky` from 1024px up. Below that it collapses to a
single control that opens a sheet — a sticky filter row on a phone costs a quarter of
the viewport for controls that are used once per session.

---

## 4. Mobile

### What mobile is for

A department head on a phone is not doing analysis. They are between meetings checking
whether anything is on fire, and acting on it if so. The mobile dashboard is therefore
**not the desktop dashboard reflowed** — it is a re-ordering around that job.

### Universal mobile order

1. **Alerts rail first.** Critical and serious insights, above everything.
2. **Hero**, full width.
3. **KPI tiles**, two per row, in each role's own priority order.
4. **Quick actions**, promoted from band 5 to here — they are the whole point of the
   visit.
5. **Signature panel**, in its mobile form (§ 4.2).
6. **Remaining panels**, collapsed to title + one-line summary, expanding on tap.

Band 3 arrives collapsed. On a 390px screen it is scroll cost, not analysis, and a
head who wants it will open it deliberately.

### 4.1 Per-role mobile priority

The first three KPI tiles after the hero, chosen as what that role would check at a bus stop:

| Role | 1 | 2 | 3 |
|---|---|---|---|
| A/V | Rig collisions | Unassigned rigs | Decision latency |
| F&B | Orders at risk | Gate queue | Push-back rate |
| Logistics | Items over capacity | Venue conflicts | Unassigned rows |
| Photography | Coverage gap | Undelivered backlog | Double-booked |
| Student Services | Tours needing a split | Start-point congestion | Unassigned tours |
| Transport | Bound days | Unassigned trips | Seat fill |
| HOS Computing | Gate queue | Stalled proposals | End-to-end time |
| HOS Business | Gate queue | Collection tail | Cost per pax |
| CFO | Gate queue | Collection | Forward spend |
| Cafeteria Manager | At risk now | Claim latency | Staff availability |

The Cafeteria Manager's mobile view is the most-used of the ten, and the only one whose
default period is **Today**. It is a shift tool. It opens on the Outlet Service Board
filtered to today, with accept and push-back available inline.

### 4.2 Charts on a phone

Not every form survives 390px. Each has a specified fallback rather than being squeezed.

| Desktop form | < 768px |
|---|---|
| `heatmap` (item × date) | Today + next 3 days only, as a ranked list of breaches. A 30-column heatmap on a phone is unreadable at any cell size |
| `timeline-chart` | Vertical list ordered by time, one row per item, with state and overlap badge |
| `funnel` | Vertical stacked bars, full width, with the conversion percentage on each step |
| `column-chart` | Last 7 buckets, horizontally scrollable within the card with a visible scroll affordance |
| `line-chart` | Unchanged; reduce to the two most important series and move the rest to the table view |
| `dot-plot` | Ranked list with an inline bar |
| `stacked-bar` (horizontal) | Unchanged — already the most phone-friendly form here |
| `meter` | Unchanged |
| `stat-tile` | Unchanged; the sparkline hides below 360px |

**Touch targets are ≥ 44px**, larger than the 24px minimum that suffices for a mouse.
Mark hit areas include the 2px surface gap. Dense scatter uses a nearest-point layer
rather than requiring a hit on the dot itself.

**Tooltips become tap-to-pin.** A hover tooltip has no meaning on a touch device; the
panel's table view is one tap away and carries every value regardless.

### 4.3 Offline and slow connections

- The last successful document is cached and rendered immediately with its generation
  time shown, then refreshed. A dashboard that shows nothing for two seconds on a
  campus connection is a dashboard people stop opening.
- Refetch holds the previous render at reduced opacity. Never a skeleton flash: it
  causes a layout jump on a page someone is mid-read of.
- Panels load progressively — band 1 and the alerts rail first, band 3 last.

---

## 5. Accessibility

Beyond the palette work in [03](03-dashboard-architecture.md) § 6:

- **Every chart has a table view**, always shipped, never lazily fetched. It is the
  screen-reader path, the copy-paste path, and the fallback when a chart cannot render.
- **Identity is never colour-alone.** Legend for two or more series, direct labels on
  up to four, status as icon + label + colour, threshold breaches as ring + glyph.
- **Keyboard reaches everything hover does.** Focus on a mark shows the same tooltip;
  arrow keys move between marks; `Esc` dismisses.
- **Focus rings** use the existing `--internal-focus-ring` token.
- **`prefers-reduced-motion`** disables sparkline draw-in and panel transitions. Chart
  content is static in either case — nothing here animates data.
- **`forced-colors`** switches to the texture channel: one directional fill at 45° and
  its 135° mirror, ordered on value scales.
- **Announcements.** New critical insights announce via a polite live region. Polite,
  not assertive — an alert that interrupts a screen-reader user mid-sentence trains
  them to turn the region off.

---

## 6. Print and export

- `@media print` drops the sidebar, filter row and quick actions; expands every
  collapsed panel; renders charts at full width in a single column; and prints the
  generation time and active filters in the header, so a printed page cannot be
  mistaken for current.
- `⤓` on any panel exports its table view as CSV, respecting every active filter and
  the R8 suppression — a suppressed bucket exports as `—`, never as its underlying
  count. Export must not be the hole through which the bucket floor leaks.
- Whole-dashboard PDF export is deferred. It needs a server-side renderer and nothing
  in the brief asks for it; per-panel CSV covers the reporting case.
