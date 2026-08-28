import { DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { Annotation, Point, Series, ValueFormat, VizStatus } from '../../../core/dashboard/dashboard.models';

/**
 * Shared geometry, scales and formatting for the hand-rolled SVG charts.
 *
 * There is no charting dependency here on purpose. `package.json` carries
 * exactly `@angular/*`, `rxjs` and `tslib`, and every complex UI piece in this
 * app — data-table, step-indicator, task-calendar, option-picker-grid — is
 * hand-built. A canvas renderer would also be unable to inherit the SCSS custom
 * properties the rest of the app is themed with, which is the whole reason the
 * palette lives in `_dashboard.scss` as `--viz-*` tokens.
 *
 * The trade-off, stated plainly: a library would give zoom, brush-select and
 * animated transitions for free. This design uses none of those. The panel
 * contract is renderer-agnostic, so swapping one in later is a component
 * change rather than an API change.
 */

// --- Colour ---------------------------------------------------------------

/** Slot → token. Never a hex in a component. */
export function slotColor(slot: number | undefined): string {
  const index = Math.min(8, Math.max(1, slot ?? 1));
  return `var(--viz-slot-${index})`;
}

const SEQUENTIAL_STEPS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650];

/**
 * A magnitude → one blue. `floor` lifts the lightest step for ordinal ramps
 * (funnel stages, lifecycle states) so the palest mark still clears 2:1 on
 * white; leave it at 100 for a true 0-anchored heatmap.
 */
export function rampColor(t: number | null | undefined, floor = 100): string {
  if (t === null || t === undefined || Number.isNaN(t)) return 'var(--viz-plane)';
  const usable = SEQUENTIAL_STEPS.filter((step) => step >= floor);
  const clamped = Math.min(1, Math.max(0, t));
  const index = Math.min(usable.length - 1, Math.round(clamped * (usable.length - 1)));
  return `var(--viz-seq-${usable[index]})`;
}

export function statusColor(status: VizStatus | undefined): string {
  return `var(--viz-${status ?? 'unknown'})`;
}

/** Icon + word + colour. Hue never carries a status on its own — `warning` and
 *  `serious` are sub-3:1 on white by design. */
export const STATUS_ICON: Record<string, string> = {
  good: 'check_circle',
  warning: 'error',
  serious: 'warning',
  critical: 'dangerous',
  unknown: 'help',
};

export const STATUS_WORD: Record<string, string> = {
  good: 'On target',
  warning: 'Approaching',
  serious: 'Breached',
  critical: 'Critical',
  unknown: 'No data',
};

// --- Formatting -----------------------------------------------------------

const CURRENCY = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 });
const CURRENCY_PRECISE = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 });
const DECIMAL = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short' });
const DATE_TIME = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function formatValue(value: unknown, format: ValueFormat = 'number'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (format === 'text') return String(value);
  if (format === 'date' || format === 'datetime') {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return (format === 'date' ? DATE : DATE_TIME).format(parsed);
  }
  if (format === 'time') return String(value).slice(0, 5);

  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) return String(value);

  switch (format) {
    case 'percent':
      return `${DECIMAL.format(numeric * 100)}%`;
    case 'ratio':
      return numeric.toFixed(2);
    case 'hours':
      // Sub-day figures read better in hours; past that a reader is counting
      // days in their head anyway.
      return numeric >= 48 ? `${DECIMAL.format(numeric / 24)}d` : `${DECIMAL.format(numeric)}h`;
    case 'days':
      return `${DECIMAL.format(numeric)}d`;
    case 'minutes':
      return `${Math.round(numeric)} min`;
    case 'currency':
      return Math.abs(numeric) < 1000 ? CURRENCY_PRECISE.format(numeric) : CURRENCY.format(numeric);
    case 'count':
      return String(Math.round(numeric));
    default:
      return DECIMAL.format(numeric);
  }
}

/** Axis ticks stay terse — a full date on every tick is noise at this width. */
export function formatAxis(value: unknown, format?: ValueFormat, axisType?: string): string {
  if (axisType === 'date') return formatValue(value, 'date');
  if (axisType === 'time') return String(value ?? '').slice(0, 5);
  if (axisType === 'category') return String(value ?? '');
  if (format === 'percent') return `${Math.round(Number(value) * 100)}%`;
  if (format === 'currency') {
    const numeric = Number(value);
    return Math.abs(numeric) >= 1000 ? `${Math.round(numeric / 1000)}k` : String(Math.round(numeric));
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value ?? '');
  return Math.abs(numeric) >= 1000 ? `${DECIMAL.format(numeric / 1000)}k` : DECIMAL.format(numeric);
}

// --- Scales ---------------------------------------------------------------

export interface LinearScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/**
 * A y-domain that starts at zero for anything additive.
 *
 * Not configurable, deliberately: a bar chart whose axis starts above zero
 * exaggerates every difference on it, and that is the one distortion a reader
 * cannot correct for by looking harder.
 */
export function niceDomain(values: number[], { includeZero = true } = {}): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    max = max === 0 ? 1 : max * 1.2;
    min = Math.min(0, min);
  }
  const step = niceStep((max - min) / 4);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const rounded = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return rounded * magnitude;
}

export function ticksFor(domain: [number, number], count = 4): number[] {
  const [min, max] = domain;
  const step = niceStep((max - min) / count) || 1;
  const out: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) {
    out.push(Number(value.toFixed(6)));
  }
  return out;
}

/**
 * Which x-labels to draw. Every bucket labelled is unreadable past a dozen
 * points, so this thins to a target count and always keeps the ends — the
 * first and last are the two a reader actually looks for.
 */
export function thinLabels<T>(items: T[], target: number): (T | null)[] {
  if (items.length <= target) return items;
  const stride = Math.ceil(items.length / target);
  return items.map((item, index) =>
    index === 0 || index === items.length - 1 || index % stride === 0 ? item : null,
  );
}

// --- Paths ----------------------------------------------------------------

export function linePath(points: { cx: number; cy: number }[]): string {
  if (!points.length) return '';
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.cx.toFixed(2)} ${point.cy.toFixed(2)}`).join(' ');
}

export function areaPath(points: { cx: number; cy: number }[], baseline: number): string {
  if (!points.length) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${last.cx.toFixed(2)} ${baseline.toFixed(2)} L${first.cx.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

/** A rounded cap at the value end and a square foot at the baseline. */
export function columnPath(x: number, y: number, width: number, height: number, radius: number): string {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x} ${y + height}`,
    `L${x} ${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    `L${x + width - r} ${y}`,
    `Q${x + width} ${y} ${x + width} ${y + r}`,
    `L${x + width} ${y + height}`,
    'Z',
  ].join(' ');
}

export function barPath(x: number, y: number, width: number, height: number, radius: number): string {
  if (width <= 0) return '';
  const r = Math.min(radius, height / 2, width);
  return [
    `M${x} ${y}`,
    `L${x + width - r} ${y}`,
    `Q${x + width} ${y} ${x + width} ${y + r}`,
    `L${x + width} ${y + height - r}`,
    `Q${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `L${x} ${y + height}`,
    'Z',
  ].join(' ');
}

// --- Series helpers -------------------------------------------------------

export function seriesValues(series: Series[]): number[] {
  return series.flatMap((entry) => entry.points.map((point) => Number(point.y ?? 0)));
}

export function stackedTotals(series: Series[]): number[] {
  const length = Math.max(0, ...series.map((entry) => entry.points.length));
  const totals: number[] = [];
  for (let index = 0; index < length; index += 1) {
    totals.push(series.reduce((sum, entry) => sum + Number(entry.points[index]?.y ?? 0), 0));
  }
  return totals;
}

export function categoriesOf(series: Series[]): string[] {
  const seen: string[] = [];
  for (const entry of series) {
    for (const point of entry.points) {
      const key = String(point.x ?? '');
      if (key && !seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

export function hasData(series: Series[]): boolean {
  return series.some((entry) =>
    entry.points.some(
      (point) => (point.y !== null && point.y !== undefined) || (point.x !== null && point.x !== undefined),
    ),
  );
}

export function pointsHaveValues(points: Point[]): boolean {
  return points.some((point) => point.x !== null && point.x !== undefined);
}

export function annotationsFor(annotations: Annotation[], type: Annotation['type']): Annotation[] {
  return annotations.filter((annotation) => annotation.type === type && annotation.value != null);
}

// --- Time -----------------------------------------------------------------

/** "09:30:00" → minutes past midnight. Timeline bars are positioned on this. */
export function minutesOfDay(time: string | null | undefined): number | null {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours)) return null;
  return hours * 60 + (minutes || 0);
}

export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// --- Responsive width -----------------------------------------------------

/**
 * The rendered pixel width of the host element, as a signal.
 *
 * Charts lay out in real pixels rather than a fixed viewBox that CSS scales,
 * because a scaled viewBox scales the *text* too — axis labels end up either
 * microscopic on a phone or oversized on a wide monitor. Measuring costs a
 * ResizeObserver and buys type that stays the size it was designed at.
 */
export function useHostWidth(fallback = 720) {
  const host = inject(ElementRef<HTMLElement>);
  const destroyRef = inject(DestroyRef);
  const width = signal(fallback);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect?.width ?? 0;
      if (measured > 0) width.set(Math.round(measured));
    });
    observer.observe(host.nativeElement);
    destroyRef.onDestroy(() => observer.disconnect());
  }
  return width;
}

/** Below this the mobile fallback form replaces the desktop chart. */
export const MOBILE_BREAKPOINT = 560;
