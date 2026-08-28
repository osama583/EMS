/**
 * The dashboard response contract.
 *
 * The API decides, the client renders. Every number here arrives pre-aggregated
 * — no widget fetches a list and reduces it in the browser, because client-side
 * aggregation means shipping rows the caller is not allowed to see.
 *
 * `colorSlot` is an integer, not a hex. The server assigns identity from the
 * entity key and the client maps slot → colour, which is what makes "colour
 * follows the entity, never its rank" enforceable: filtering a series out
 * cannot repaint the survivors.
 */

export type WidgetState = 'ok' | 'error';
export type WidgetKind = 'hero' | 'kpi' | 'panel';
export type VizStatus = 'good' | 'warning' | 'serious' | 'critical' | 'unknown';

export type ValueFormat =
  | 'number'
  | 'percent'
  | 'ratio'
  | 'hours'
  | 'days'
  | 'currency'
  | 'count'
  | 'minutes'
  | 'date'
  | 'datetime'
  | 'time'
  | 'text';

/** Every chart form the panel contract can name. `alert-list` is the rail. */
export type ChartKind =
  | 'line-chart'
  | 'area-chart'
  | 'column-chart'
  | 'stacked-bar'
  | 'bar-chart'
  | 'heatmap'
  | 'timeline-chart'
  | 'dot-plot'
  | 'funnel'
  | 'donut-chart'
  | 'meter'
  | 'alert-list';

/** The phone fallback for a form that does not survive 390px. */
export type MobileForm = 'ranked-list' | 'breach-list' | 'time-list' | 'stacked-bars' | 'scroll';

export interface Delta {
  value: number;
  percent: number | null;
  /** Which way it moved. */
  direction: 'up' | 'down' | 'flat';
  /** Whether that movement is good — separate from direction, because latency
   *  falling is good and coverage falling is not. */
  isGood: boolean;
}

export interface Target {
  min?: number | null;
  max?: number | null;
  label?: string;
}

export interface Drill {
  /** An `/app/...` path, or a `#panel-<id>` in-page anchor. */
  route: string;
  params: Record<string, string | number | boolean>;
}

export interface Point {
  x?: string | number | null;
  y?: number | null;
  label?: string | null;
  [key: string]: unknown;
}

export interface Series {
  key: string;
  label: string;
  /** 1–8. The client maps this to `--viz-slot-N`. */
  colorSlot: number;
  points: Point[];
  /** Reserved for the projected segment of a forecast, and nothing else. */
  dashed?: boolean;
  band?: boolean;
  rampStep?: number;
}

export interface AxisSpec {
  type?: 'linear' | 'date' | 'category' | 'time';
  label?: string;
  format?: ValueFormat;
}

/** One y-axis only. Two measures of different scale are two panels. */
export interface Axes {
  x?: AxisSpec;
  y?: AxisSpec;
}

export interface Annotation {
  type: 'threshold' | 'reference' | 'band' | 'vertical-rule';
  axis?: 'x' | 'y';
  value?: number | null;
  from?: number;
  to?: number;
  label?: string;
  style?: 'solid' | 'long-dash';
}

interface WidgetBase {
  id: string;
  kind: WidgetKind;
  state: WidgetState;
  message?: string;
}

export interface StatWidget extends WidgetBase {
  kind: 'hero' | 'kpi';
  label: string;
  value: number | null;
  format: ValueFormat;
  secondary?: string | null;
  caption?: string | null;
  target?: Target | null;
  status: VizStatus;
  delta?: Delta | null;
  sparkline: Point[];
  /** The metric definition, reachable from the number rather than filed in a
   *  document nobody opens. */
  definition?: string | null;
  /** An assumption or schema gap the figure rests on. Rendered inside the card,
   *  never as a page footnote. */
  caveat?: string | null;
  drill?: Drill | null;
  empty?: string | null;
}

export interface PanelWidget extends WidgetBase {
  kind: 'panel';
  title: string;
  subtitle?: string | null;
  chart: ChartKind;
  data?: Record<string, unknown> | null;
  series: Series[];
  axes: Axes;
  annotations: Annotation[];
  caption?: string | null;
  caveat?: string | null;
  empty?: string | null;
  filters: string[];
  drill?: Drill | null;
  signature: boolean;
  mobile?: MobileForm | null;
  /** Buckets *this* panel withheld under the k>=5 floor. Per panel, not the page
   *  total: a footnote repeating one number under five charts says nothing about
   *  which chart is incomplete. */
  suppressed?: number;
}

/** One count chip in the Request Counts strip (Inbox / Ongoing / Completed / Late). */
export interface CountItem {
  key: string;
  label: string;
  value: number;
  status: VizStatus;
  drill?: Drill | null;
}

export interface CountsWidget {
  kind: 'counts';
  items: CountItem[];
}

export type DashboardWidget = StatWidget | PanelWidget;

export interface QuickAction {
  key: string;
  label: string;
  icon: string;
  route: string | null;
  params: Record<string, string | number | boolean>;
  badge?: number | null;
}

export interface ProfileSummary {
  id: string;
  key: string;
  title: string;
  unitCode: string | null;
  unitLabel: string | null;
  eyebrow?: string;
  roleCode?: string;
}

export interface DashboardProfile extends ProfileSummary {
  variant: string | null;
  roleCode: string;
  eyebrow: string;
  switchable: ProfileSummary[];
  outlets: { code: string; label: string }[];
  activeOutlet: string;
}

export interface DashboardPeriod {
  key: string;
  label: string;
  from: string;
  to: string;
  comparedTo: { from: string; to: string; label: string };
}

export interface DashboardMeta {
  generatedAt: string;
  queryMs: number;
  /** Renders the R8 footnote. Silently dropping buckets would misstate a chart. */
  suppressedBuckets: number;
  foldedSeries: number;
  cached: boolean;
  widgetCount: number;
}

export interface DashboardDocument {
  profile: DashboardProfile | null;
  reason?: string;
  message?: string;
  period: DashboardPeriod;
  requestCounts: CountsWidget | null;
  hero: StatWidget;
  kpis: StatWidget[];
  signature: PanelWidget;
  panels: PanelWidget[];
  alerts: PanelWidget;
  quickActions: QuickAction[];
  mobile: { kpiOrder: string[] };
  extras: Record<string, DashboardWidget>;
  meta: DashboardMeta;
}

export const PERIOD_OPTIONS: { key: string; label: string; short: string }[] = [
  { key: '7d', label: 'Last 7 days', short: '7d' },
  { key: '30d', label: 'Last 30 days', short: '30d' },
  { key: '90d', label: 'Last 90 days', short: '90d' },
  { key: 'term', label: 'This term', short: 'Term' },
  { key: 'ytd', label: 'Year to date', short: 'YTD' },
];

export function isPanel(widget: DashboardWidget): widget is PanelWidget {
  return widget.kind === 'panel';
}

export function isStat(widget: DashboardWidget): widget is StatWidget {
  return widget.kind === 'hero' || widget.kind === 'kpi';
}
