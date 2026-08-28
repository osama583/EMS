import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VizChartBase } from './viz-chart.base';
import { formatClock, formatValue, minutesOfDay, rampColor } from './viz';

interface TimelineBar {
  rowId?: number;
  requestId?: number;
  selectionId?: number;
  date: string;
  start: string | null;
  end: string | null;
  label: string;
  location?: string | null;
  eventTitle?: string | null;
  overlap?: number;
  assignees?: number;
  status?: string;
  quantity?: number;
  claimedBy?: string | null;
  unclaimed?: boolean;
  unaccepted?: boolean;
  [key: string]: unknown;
}

interface TimelineLane {
  key: string;
  label: string;
  bars: TimelineBar[];
  peak?: number;
  breached?: boolean;
}

/**
 * One lane per day (or per venue, or per person), each item a bar from its
 * start time to its end.
 *
 * This is A/V's and the Cafeteria Manager's signature form, and the reason is
 * physics rather than rank: for a crew the constraint is *when within the day*,
 * because a team that finishes at noon is free at one. A heatmap cell can only
 * say "this day is busy"; only a timeline shows which two rigs collide, at what
 * hour, in which venue.
 *
 * Bars above the ceiling take a ring **and** a glyph. Unclaimed work takes a
 * hatched fill, so "nobody has this" is visible without reading the label.
 *
 * On a phone this becomes a vertical list in time order — the same information
 * with the axis removed, because a 12-hour axis at 390px is four pixels an hour.
 */
@Component({
  selector: 'app-timeline-chart',
  imports: [],
  template: `
    @if (isNarrow()) {
      <ul class="viz-tl__list">
        @for (lane of lanes(); track lane.key) {
          <li class="viz-tl__group">
            <p class="viz-tl__group-head">
              {{ laneLabel(lane) }}
              @if (lane.breached) {
                <span class="dash-status dash-status--critical">
                  <span class="material-symbols-rounded" aria-hidden="true">warning</span>
                  {{ lane.peak }} at once
                </span>
              }
            </p>
            <ul class="viz-tl__items">
              @for (bar of lane.bars; track $index) {
                <li class="viz-tl__item" [class.viz-tl__item--breach]="isBreach(lane, bar)" [class.viz-tl__item--unclaimed]="bar.unclaimed || bar.assignees === 0">
                  <span class="viz-tl__time">{{ clock(bar) }}</span>
                  <span class="viz-tl__body">
                    <span class="viz-tl__label">{{ bar.label }}</span>
                    @if (bar.location) { <span class="viz-tl__meta">{{ bar.location }}</span> }
                    @if (bar.claimedBy) { <span class="viz-tl__meta">Claimed by {{ bar.claimedBy }}</span> }
                    @else if (bar.unclaimed) { <span class="viz-tl__meta viz-tl__meta--warn">Unclaimed</span> }
                    @else if (bar.assignees === 0) { <span class="viz-tl__meta viz-tl__meta--warn">Unassigned</span> }
                  </span>
                </li>
              }
            </ul>
          </li>
        } @empty {
          <li class="viz-tl__empty">Nothing scheduled in this window.</li>
        }
      </ul>
    } @else {
      <svg
        class="viz-svg"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        [attr.height]="height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        @for (tick of hourTicks(); track tick) {
          <line class="viz-grid-line" [attr.x1]="xFor(tick)" [attr.x2]="xFor(tick)" [attr.y1]="HEAD" [attr.y2]="height() - 20" />
          <text class="viz-axis-label" [attr.x]="xFor(tick)" [attr.y]="height() - 6" text-anchor="middle">{{ clockText(tick) }}</text>
        }

        @for (lane of laidOut(); track lane.key) {
          <text class="viz-tl__lane-name" [attr.x]="0" [attr.y]="lane.y + LANE_H / 2 + 4">{{ lane.label }}</text>
          <rect class="viz-tl__lane-track" [attr.x]="gutter()" [attr.y]="lane.y" [attr.width]="plotWidth()" [attr.height]="LANE_H" rx="3" />

          @for (bar of lane.bars; track $index) {
            <rect
              class="viz-mark viz-tl__bar"
              [class.viz-tl__bar--hatched]="bar.hatched"
              [attr.x]="bar.x"
              [attr.y]="lane.y + 3"
              [attr.width]="bar.width"
              [attr.height]="LANE_H - 6"
              rx="3"
              [attr.fill]="bar.fill"
              tabindex="0"
              [attr.aria-label]="bar.aria"
              (mouseenter)="hover(lane.key, bar.raw)"
              (focus)="hover(lane.key, bar.raw)"
              (click)="select(lane.key, bar.raw)"
              (keydown.enter)="select(lane.key, bar.raw)"
            />
            @if (bar.breach) {
              <rect class="viz-breach-ring" [attr.x]="bar.x - 1" [attr.y]="lane.y + 2" [attr.width]="bar.width + 2" [attr.height]="LANE_H - 4" rx="4" />
              <text class="viz-glyph" [attr.x]="bar.x + bar.width / 2" [attr.y]="lane.y + LANE_H / 2 + 4" text-anchor="middle">!</text>
            }
            @if (bar.width > 44) {
              <text class="viz-tl__bar-label" [attr.x]="bar.x + 6" [attr.y]="lane.y + LANE_H / 2 + 4">{{ bar.short }}</text>
            }
          }

          @if (lane.breached) {
            <text class="viz-tl__breach-note" [attr.x]="width() - 2" [attr.y]="lane.y + LANE_H / 2 + 4" text-anchor="end">{{ lane.peak }} &gt; {{ ceiling() }}</text>
          }
        }
      </svg>
    }

    @if (hovered(); as active) {
      <p class="viz-tooltip" role="status">
        <strong>{{ active.point['label'] }}</strong>
        {{ tooltipFor(active.point) }}
      </p>
    }
  `,
  styleUrl: './timeline-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineChartComponent extends VizChartBase {
  protected readonly LANE_H = 26;
  protected readonly HEAD = 6;
  private readonly LANE_GAP = 4;

  readonly lanes = computed(() => ((this.data()?.['lanes'] as TimelineLane[]) ?? []).slice(0, 14));
  readonly ceiling = computed(() => {
    const value = this.data()?.['ceiling'];
    return typeof value === 'number' ? value : null;
  });

  protected plotHeight(): number {
    return this.HEAD + this.lanes().length * (this.LANE_H + this.LANE_GAP) + 24;
  }

  readonly gutter = computed(() => Math.round(Math.min(120, Math.max(64, this.width() * 0.16))));
  readonly plotWidth = computed(() => Math.max(60, this.width() - this.gutter() - 56));

  /** The window is derived from the data, not fixed at 00:00–24:00 — an event
   *  calendar that runs 08:00–20:00 wastes half the axis otherwise. */
  private readonly window = computed<[number, number]>(() => {
    const minutes: number[] = [];
    for (const lane of this.lanes()) {
      for (const bar of lane.bars) {
        const start = minutesOfDay(bar.start);
        const end = minutesOfDay(bar.end);
        if (start != null) minutes.push(start);
        if (end != null) minutes.push(end);
      }
    }
    if (!minutes.length) return [8 * 60, 20 * 60];
    const low = Math.floor(Math.min(...minutes) / 60) * 60;
    const high = Math.ceil(Math.max(...minutes) / 60) * 60;
    return [low, Math.max(high, low + 120)];
  });

  readonly hourTicks = computed(() => {
    const [low, high] = this.window();
    const span = (high - low) / 60;
    const stride = span > 10 ? 2 : 1;
    const out: number[] = [];
    for (let minute = low; minute <= high; minute += 60 * stride) out.push(minute);
    return out;
  });

  xFor(minute: number): number {
    const [low, high] = this.window();
    const ratio = (minute - low) / Math.max(1, high - low);
    return this.gutter() + ratio * this.plotWidth();
  }

  clockText(minute: number): string {
    return formatClock(minute);
  }

  readonly laidOut = computed(() => {
    const ceiling = this.ceiling();
    const maxOverlap = Math.max(1, ...this.lanes().flatMap((lane) => lane.bars.map((bar) => bar.overlap ?? 1)));
    return this.lanes().map((lane, index) => ({
      key: lane.key,
      label: this.truncate(lane.label),
      y: this.HEAD + index * (this.LANE_H + this.LANE_GAP),
      peak: lane.peak,
      breached: !!lane.breached,
      bars: lane.bars.map((bar) => {
        const start = minutesOfDay(bar.start) ?? this.window()[0];
        const rawEnd = minutesOfDay(bar.end);
        // An order has a serve time, not a window. Drawing it as a hairline
        // makes it unclickable and unreadable, so an instant gets a marker's
        // worth of width rather than its true zero duration.
        const end = rawEnd !== null && rawEnd > start ? rawEnd : start + 30;
        const x = this.xFor(start);
        const width = Math.max(14, this.xFor(end) - x);
        const breach = !!(ceiling && (bar.overlap ?? 0) > ceiling);
        return {
          raw: bar,
          x,
          width,
          breach,
          // Depth of overlap is a magnitude, so it takes the sequential ramp;
          // unclaimed work takes a hatch instead of a hue, because "nobody has
          // this" is a state rather than a quantity.
          fill: bar.unaccepted
            ? 'var(--viz-seq-250)'
            : rampColor((bar.overlap ?? 1) / maxOverlap, 250),
          hatched: !!bar.unclaimed || bar.assignees === 0,
          short: bar.label.length > 22 ? `${bar.label.slice(0, 21)}…` : bar.label,
          aria: `${bar.label}, ${this.clock(bar)}${bar.location ? `, ${bar.location}` : ''}`,
        };
      }),
    }));
  });

  laneLabel(lane: TimelineLane): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(lane.label) ? formatValue(lane.label, 'date') : lane.label;
  }

  isBreach(lane: TimelineLane, bar: TimelineBar): boolean {
    const ceiling = this.ceiling();
    return !!(ceiling && (bar.overlap ?? 0) > ceiling);
  }

  clock(bar: TimelineBar): string {
    if (!bar.start) return '—';
    const start = bar.start.slice(0, 5);
    const end = bar.end?.slice(0, 5);
    return end && end !== start ? `${start}–${end}` : start;
  }

  tooltipFor(point: Record<string, unknown>): string {
    const parts: string[] = [];
    if (point['location']) parts.push(String(point['location']));
    if (point['eventTitle']) parts.push(String(point['eventTitle']));
    if (typeof point['overlap'] === 'number') parts.push(`${point['overlap']} at once`);
    if (typeof point['assignees'] === 'number') parts.push(`${point['assignees']} assigned`);
    if (point['status']) parts.push(String(point['status']));
    return parts.join(' · ');
  }

  readonly ariaLabel = computed(
    () => `Timeline with ${this.lanes().length} lanes. Each bar is focusable and names its own details.`,
  );

  private truncate(label: string): string {
    const text = /^\d{4}-\d{2}-\d{2}$/.test(label) ? formatValue(label, 'date') : label;
    const budget = Math.floor(this.gutter() / 6.6);
    return text.length > budget ? `${text.slice(0, budget - 1)}…` : text;
  }
}
