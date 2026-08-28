import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Point } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import {
  areaPath,
  categoriesOf,
  linePath,
  linearScale,
  niceDomain,
  seriesValues,
  thinLabels,
  ticksFor,
} from './viz';

/**
 * Line and area, on **one y-axis**.
 *
 * There is no second-axis input, and that is the point: two measures of
 * different scale are two panels or one indexed series. A dual axis lets a
 * reader draw a crossing point that means nothing, and it is the single most
 * common dashboard mistake — the contract makes it unrepresentable rather than
 * merely discouraged.
 *
 * A dashed segment means one thing only: the projected continuation of a
 * forecast. Gridlines are solid hairlines so dashing keeps that meaning.
 */
@Component({
  selector: 'app-line-chart',
  imports: [],
  template: `
    <svg
      class="viz-svg"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      [attr.height]="height()"
      role="img"
      [attr.aria-label]="ariaLabel()"
      (mouseleave)="clearHover()"
    >
      <!-- Solid hairline grid. Dashing is reserved for projections. -->
      @for (tick of yTicks(); track tick) {
        <line class="viz-grid-line" [attr.x1]="padding().left" [attr.x2]="width() - padding().right" [attr.y1]="y()(tick)" [attr.y2]="y()(tick)" />
        <text class="viz-axis-label" [attr.x]="padding().left - 8" [attr.y]="y()(tick) + 4" text-anchor="end">{{ axisLabel(tick, 'y') }}</text>
      }

      @for (band of bands(); track band.label) {
        <rect class="viz-band" [attr.x]="padding().left" [attr.width]="innerWidth()" [attr.y]="y()(band.to!)" [attr.height]="Math.abs(y()(band.from!) - y()(band.to!))" />
      }

      @for (threshold of thresholds(); track threshold.label) {
        <line
          [class]="threshold.style === 'long-dash' ? 'viz-threshold--alt' : 'viz-threshold'"
          [attr.x1]="padding().left"
          [attr.x2]="width() - padding().right"
          [attr.y1]="y()(threshold.value!)"
          [attr.y2]="y()(threshold.value!)"
        />
        <text class="viz-threshold-label" [attr.x]="width() - padding().right" [attr.y]="y()(threshold.value!) - 5" text-anchor="end">{{ threshold.label }}</text>
      }

      <line class="viz-axis-line" [attr.x1]="padding().left" [attr.x2]="width() - padding().right" [attr.y1]="baseline()" [attr.y2]="baseline()" />

      @for (entry of laidOut(); track entry.key) {
        @if (mode() === 'area' && !entry.dashed) {
          <path [attr.d]="entry.area" [attr.fill]="colorFor(entry.colorSlot)" opacity="0.1" />
        }
        @if (entry.band) {
          <path [attr.d]="entry.bandPath" [attr.fill]="colorFor(entry.colorSlot)" opacity="0.08" />
        }
        <path
          [attr.d]="entry.line"
          fill="none"
          [attr.stroke]="colorFor(entry.colorSlot)"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          [attr.stroke-dasharray]="entry.dashed ? '6 4' : null"
        />
        <!-- Endpoint markers only. There is no 'label everything' strategy:
             every point is unreadable past a dozen of them. -->
        @if (entry.marks.length) {
          <circle
            class="viz-mark"
            [attr.cx]="entry.marks[entry.marks.length - 1].cx"
            [attr.cy]="entry.marks[entry.marks.length - 1].cy"
            r="4.5"
            [attr.fill]="colorFor(entry.colorSlot)"
            stroke="var(--viz-surface)"
            stroke-width="2"
          />
        }
        @for (mark of entry.marks; track $index) {
          <circle
            class="viz-mark viz-hit"
            [attr.cx]="mark.cx"
            [attr.cy]="mark.cy"
            r="10"
            fill="transparent"
            tabindex="0"
            [attr.aria-label]="entry.label + ' ' + axisLabel(mark.point.x, 'x') + ' ' + valueLabel(mark.point.y)"
            (mouseenter)="hover(entry.key, mark.point)"
            (focus)="hover(entry.key, mark.point)"
            (click)="select(entry.key, mark.point)"
            (keydown.enter)="select(entry.key, mark.point)"
          />
          @if (isHovered(entry.key, mark.point)) {
            <circle [attr.cx]="mark.cx" [attr.cy]="mark.cy" r="5" [attr.fill]="colorFor(entry.colorSlot)" stroke="var(--viz-surface)" stroke-width="2" />
            <line class="viz-reference" [attr.x1]="mark.cx" [attr.x2]="mark.cx" [attr.y1]="padding().top" [attr.y2]="baseline()" />
          }
        }
      }

      @for (label of xLabels(); track $index) {
        @if (label.text) {
          <text class="viz-axis-label" [attr.x]="label.cx" [attr.y]="height() - 10" text-anchor="middle">{{ label.text }}</text>
        }
      }
    </svg>

    @if (hovered(); as active) {
      <p class="viz-tooltip" role="status">
        <strong>{{ axisLabel(active.point.x, 'x') }}</strong>
        {{ seriesLabel(active.seriesKey) }} · {{ valueLabel(active.point.y) }}
      </p>
    }
  `,
  styleUrl: './xy-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChartComponent extends VizChartBase {
  readonly mode = input<'line' | 'area'>('line');
  readonly compact = input(false);

  protected readonly Math = Math;

  protected plotHeight(): number {
    return this.compact() ? 150 : this.isNarrow() ? 190 : 240;
  }

  readonly categories = computed(() => categoriesOf(this.series()));

  readonly domain = computed(() => {
    const values = seriesValues(this.series());
    for (const annotation of this.annotations()) {
      if (annotation.value != null) values.push(annotation.value);
      if (annotation.to != null) values.push(annotation.to);
    }
    // Forecast bands widen the domain, so a projection cannot run off the top.
    for (const entry of this.series()) {
      for (const point of entry.points) {
        if (typeof point['high'] === 'number') values.push(point['high'] as number);
      }
    }
    return niceDomain(values, { includeZero: this.mode() === 'area' });
  });

  readonly y = computed(() =>
    linearScale(this.domain(), [this.height() - this.padding().bottom, this.padding().top]),
  );

  readonly x = computed(() => {
    const count = Math.max(1, this.categories().length - 1);
    return linearScale([0, count], [this.padding().left, this.width() - this.padding().right]);
  });

  readonly baseline = computed(() => this.height() - this.padding().bottom);
  readonly yTicks = computed(() => ticksFor(this.domain(), this.isNarrow() ? 3 : 4));

  readonly thresholds = computed(() => this.annotations().filter((a) => a.type === 'threshold' && a.value != null));
  readonly bands = computed(() => this.annotations().filter((a) => a.type === 'band' && a.from != null && a.to != null));

  readonly laidOut = computed(() => {
    const categories = this.categories();
    const x = this.x();
    const y = this.y();
    return this.series().map((entry) => {
      const marks = entry.points
        .filter((point) => point.y !== null && point.y !== undefined)
        .map((point) => ({
          point,
          cx: x(Math.max(0, categories.indexOf(String(point.x ?? '')))),
          cy: y(Number(point.y)),
        }));
      const bandPoints = entry.band
        ? entry.points
            .filter((point) => typeof point['high'] === 'number')
            .map((point) => ({
              cx: x(Math.max(0, categories.indexOf(String(point.x ?? '')))),
              high: y(Number(point['high'])),
              low: y(Number(point['low'] ?? point.y ?? 0)),
            }))
        : [];
      return {
        key: entry.key,
        label: entry.label,
        colorSlot: entry.colorSlot,
        dashed: !!entry.dashed,
        band: !!entry.band,
        marks,
        line: linePath(marks),
        area: areaPath(marks, this.baseline()),
        bandPath: bandPoints.length
          ? `${bandPoints.map((p, i) => `${i ? 'L' : 'M'}${p.cx} ${p.high}`).join(' ')} ${bandPoints
              .slice()
              .reverse()
              .map((p) => `L${p.cx} ${p.low}`)
              .join(' ')} Z`
          : '',
      };
    });
  });

  readonly xLabels = computed(() => {
    const categories = this.categories();
    const x = this.x();
    const kept = thinLabels(categories, this.isNarrow() ? 3 : 6);
    return categories.map((category, index) => ({
      cx: x(index),
      text: kept[index] === null ? '' : this.axisLabel(category, 'x'),
    }));
  });

  readonly ariaLabel = computed(() => {
    const names = this.series().map((entry) => entry.label).join(', ');
    return `${names} over ${this.categories().length} points. Hover or focus a point for its exact value.`;
  });

  seriesLabel(key: string): string {
    return this.series().find((entry) => entry.key === key)?.label ?? key;
  }
}
