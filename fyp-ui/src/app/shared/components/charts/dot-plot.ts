import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { Point } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import { formatValue, linearScale, niceDomain, ticksFor } from './viz';

/**
 * A distribution, not a mean.
 *
 * Three technicians at 12 / 11 / 1 is invisible in an average of 8, and one
 * shoot sitting at 40 days is the story a median of 9 hides. Every panel that
 * would otherwise report a central tendency for a small population uses this
 * instead, with the median drawn as a reference line so the average is still
 * readable — just not the only thing readable.
 *
 * Markers are ≥8px with a 2px surface ring, so overlapping dots stay countable.
 * On a phone it becomes a ranked list with an inline bar: a scatter at 390px is
 * a cluster of taps nobody can hit.
 */
@Component({
  selector: 'app-dot-plot',
  imports: [],
  template: `
    @if (isNarrow()) {
      <ul class="viz-dot__list">
        @for (item of ranked(); track $index) {
          <li class="viz-dot__row">
            <span class="viz-dot__name">{{ item.label }}</span>
            <span class="viz-dot__bar" aria-hidden="true"><span class="viz-dot__fill" [style.width.%]="item.percent"></span></span>
            <span class="viz-dot__value">{{ item.value }}</span>
          </li>
        } @empty {
          <li class="viz-dot__empty">Nothing to compare in this period.</li>
        }
      </ul>
    } @else {
      <svg
        class="viz-svg"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        [attr.height]="height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (mouseleave)="clearHover()"
      >
        @for (band of bands(); track $index) {
          <rect class="viz-band" [attr.x]="x()(band.from!)" [attr.width]="x()(band.to!) - x()(band.from!)" [attr.y]="padding().top" [attr.height]="innerHeight()" />
          <text class="viz-axis-label" [attr.x]="(x()(band.from!) + x()(band.to!)) / 2" [attr.y]="padding().top + 10" text-anchor="middle">{{ band.label }}</text>
        }

        @for (tick of xTicks(); track tick) {
          <line class="viz-grid-line" [attr.x1]="x()(tick)" [attr.x2]="x()(tick)" [attr.y1]="padding().top" [attr.y2]="baseline()" />
          <text class="viz-axis-label" [attr.x]="x()(tick)" [attr.y]="height() - 10" text-anchor="middle">{{ axisLabel(tick, 'x') }}</text>
        }

        @for (reference of references(); track $index) {
          <line class="viz-reference" [attr.x1]="x()(reference.value!)" [attr.x2]="x()(reference.value!)" [attr.y1]="padding().top" [attr.y2]="baseline()" />
          <text class="viz-threshold-label" [attr.x]="x()(reference.value!)" [attr.y]="padding().top - 2" text-anchor="middle">{{ reference.label }}</text>
        }

        <line class="viz-axis-line" [attr.x1]="padding().left" [attr.x2]="width() - padding().right" [attr.y1]="baseline()" [attr.y2]="baseline()" />

        @for (dot of dots(); track $index) {
          <circle
            class="viz-mark viz-dot"
            [attr.cx]="dot.cx"
            [attr.cy]="dot.cy"
            [attr.r]="dot.over ? 6 : 5"
            [attr.fill]="dot.over ? 'var(--viz-critical)' : colorFor(dot.colorSlot)"
            stroke="var(--viz-surface)"
            stroke-width="2"
            tabindex="0"
            [attr.aria-label]="dot.aria"
            (mouseenter)="hover(dot.seriesKey, dot.point)"
            (focus)="hover(dot.seriesKey, dot.point)"
            (click)="select(dot.seriesKey, dot.point)"
            (keydown.enter)="select(dot.seriesKey, dot.point)"
          />
          <!-- Selective direct labels only — there is no 'all'. -->
          @if (dot.label) {
            <text class="viz-value-label" [attr.x]="dot.cx + 9" [attr.y]="dot.cy + 4">{{ dot.label }}</text>
          }
        }
      </svg>
    }

    @if (hovered(); as active) {
      <p class="viz-tooltip" role="status">
        <strong>{{ active.point['label'] || '—' }}</strong>
        {{ describe(active.point) }}
      </p>
    }
  `,
  styleUrl: './dot-plot.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DotPlotComponent extends VizChartBase {
  protected plotHeight(): number {
    return this.isNarrow() ? 150 : 190;
  }

  private readonly allPoints = computed(() =>
    this.series().flatMap((entry) =>
      entry.points
        .filter((point) => point.x !== null && point.x !== undefined)
        .map((point) => ({ seriesKey: entry.key, colorSlot: entry.colorSlot, point })),
    ),
  );

  readonly domain = computed(() => {
    const values = this.allPoints().map((item) => Number(item.point.x));
    for (const annotation of this.annotations()) {
      if (annotation.value != null) values.push(annotation.value);
      if (annotation.to != null) values.push(annotation.to);
      if (annotation.from != null) values.push(annotation.from);
    }
    return niceDomain(values);
  });

  readonly x = computed(() => linearScale(this.domain(), [this.padding().left, this.width() - this.padding().right]));
  readonly baseline = computed(() => this.height() - this.padding().bottom);
  readonly xTicks = computed(() => ticksFor(this.domain(), this.isNarrow() ? 3 : 5));
  readonly references = computed(() => this.annotations().filter((a) => a.type === 'reference' && a.value != null));
  readonly bands = computed(() => this.annotations().filter((a) => a.type === 'band' && a.from != null && a.to != null));

  /**
   * Vertical placement is a deterministic jitter, not a random one: a chart
   * that moves its own dots between renders is a chart nobody can point at.
   */
  readonly dots = computed(() => {
    const x = this.x();
    const items = this.allPoints();
    const lanes = Math.max(1, Math.min(6, Math.ceil(items.length / 4)));
    const top = this.padding().top + 16;
    const usable = Math.max(20, this.baseline() - top - 10);
    return items.map((item, index) => ({
      ...item,
      cx: x(Number(item.point.x)),
      cy: top + ((index % lanes) + 0.5) * (usable / lanes),
      over: !!item.point['over'],
      label: item.point.label ?? null,
      aria: `${item.point.label ?? 'value'} ${formatValue(item.point.x, this.axes().x?.format ?? 'number')}`,
    }));
  });

  /** Phone fallback: ranked, with an inline bar for magnitude. */
  readonly ranked = computed(() => {
    const items = this.allPoints()
      .slice()
      .sort((a, b) => Number(b.point.x) - Number(a.point.x))
      .slice(0, 10);
    const max = Math.max(1, ...items.map((item) => Number(item.point.x)));
    return items.map((item) => ({
      label: String(item.point.label ?? formatValue(item.point.x, this.axes().x?.format ?? 'number')),
      value: formatValue(item.point.x, this.axes().x?.format ?? 'number'),
      percent: Math.max(2, (Number(item.point.x) / max) * 100),
    }));
  });

  describe(point: Point): string {
    const parts = [formatValue(point.x, this.axes().x?.format ?? 'number')];
    if (point['sendBackRate'] != null) parts.push(`${formatValue(point['sendBackRate'], 'percent')} sent back`);
    if (point['meanCost'] != null) parts.push(`${formatValue(point['meanCost'], 'currency')} mean cost`);
    if (point['completed'] != null) parts.push(`${point['completed']} completed`);
    if (point['share'] != null) parts.push(`${formatValue(point['share'], 'percent')} of the pool`);
    if (point['vehicle']) parts.push(String(point['vehicle']));
    return parts.join(' · ');
  }

  readonly ariaLabel = computed(() => `${this.allPoints().length} points. Each point is focusable and names its own value.`);
}
