import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VizChartBase } from './viz-chart.base';
import { categoriesOf, columnPath, linearScale, niceDomain, stackedTotals, thinLabels, ticksFor } from './viz';

/**
 * Vertical columns, single series or stacked.
 *
 * Mark spec: ≤24px thick, 4px rounded cap, square foot at the baseline, and a
 * 2px surface gap between stack segments so adjacent segments read as separate
 * quantities rather than one gradient.
 *
 * Multiple threshold rules are supported and *labelled*, because Transport has
 * two genuine ceilings — fleet and drivers. Both are counts of the same kind as
 * the plotted value, so one axis is correct; this is not the dual-axis
 * anti-pattern even though it looks superficially similar.
 */
@Component({
  selector: 'app-column-chart',
  imports: [],
  template: `
    <div [class.viz-scroll]="scrollable()">
      <svg
        class="viz-svg"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        [attr.width]="scrollable() ? width() : null"
        [attr.height]="height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (mouseleave)="clearHover()"
      >
        @for (tick of yTicks(); track tick) {
          <line class="viz-grid-line" [attr.x1]="padding().left" [attr.x2]="width() - padding().right" [attr.y1]="y()(tick)" [attr.y2]="y()(tick)" />
          <text class="viz-axis-label" [attr.x]="padding().left - 8" [attr.y]="y()(tick) + 4" text-anchor="end">{{ axisLabel(tick, 'y') }}</text>
        }

        @for (column of columns(); track column.key) {
          @for (segment of column.segments; track segment.seriesKey) {
            <path
              class="viz-mark viz-mark--column"
              [class.viz-mark--selected]="isSelected(segment.seriesKey, segment.point)"
              [class.viz-mark--dimmed]="hasSelection() && !isSelected(segment.seriesKey, segment.point)"
              [attr.d]="segment.path"
              [attr.fill]="colorFor(segment.colorSlot)"
              [style.color]="colorFor(segment.colorSlot)"
              [attr.opacity]="segment.dashed ? 0.55 : 1"
              [attr.stroke]="segment.dashed ? colorFor(segment.colorSlot) : null"
              [attr.stroke-dasharray]="segment.dashed ? '5 3' : null"
              tabindex="0"
              [attr.aria-label]="segment.label + ' ' + column.label + ' ' + valueLabel(segment.value)"
              (mouseenter)="hover(segment.seriesKey, segment.point)"
              (focus)="hover(segment.seriesKey, segment.point)"
              (click)="select(segment.seriesKey, segment.point)"
              (keydown.enter)="select(segment.seriesKey, segment.point)"
            />
          }
          <!-- A breach takes a ring and a glyph, never colour alone. -->
          @if (column.breached) {
            <rect class="viz-breach-ring" [attr.x]="column.x - 1" [attr.y]="column.top - 1" [attr.width]="column.width + 2" [attr.height]="baseline() - column.top + 2" rx="4" />
            <text class="viz-glyph" [attr.x]="column.x + column.width / 2" [attr.y]="column.top - 6" text-anchor="middle">!</text>
          }
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

        @for (column of columns(); track column.key) {
          @if (column.showLabel) {
            <text class="viz-axis-label" [attr.x]="column.x + column.width / 2" [attr.y]="height() - 10" text-anchor="middle">{{ axisLabel(column.key, 'x') }}</text>
          }
        }
      </svg>
    </div>
    @if (scrollable()) {
      <p class="viz-scroll__hint">Scroll sideways for earlier buckets.</p>
    }

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
export class ColumnChartComponent extends VizChartBase {
  readonly stacked = input(false);

  protected plotHeight(): number {
    return this.isNarrow() ? 190 : 240;
  }

  readonly categories = computed(() => categoriesOf(this.series()));

  /** On a phone the plot keeps its column width and scrolls, rather than
   *  compressing thirty buckets into hairlines. */
  readonly scrollable = computed(() => this.isNarrow() && this.categories().length > 7);

  override readonly width = computed(() => {
    const measured = Math.max(240, this.hostWidth());
    if (!this.scrollable()) return measured;
    return Math.max(measured, this.padding().left + this.padding().right + this.categories().length * 40);
  });

  readonly domain = computed(() => {
    const values = this.stacked() ? stackedTotals(this.series()) : [];
    for (const entry of this.series()) {
      for (const point of entry.points) values.push(Number(point.y ?? 0));
    }
    for (const annotation of this.annotations()) {
      if (annotation.value != null) values.push(annotation.value);
    }
    return niceDomain(values);
  });

  readonly y = computed(() => linearScale(this.domain(), [this.height() - this.padding().bottom, this.padding().top]));
  readonly baseline = computed(() => this.height() - this.padding().bottom);
  readonly yTicks = computed(() => ticksFor(this.domain(), this.isNarrow() ? 3 : 4));
  readonly thresholds = computed(() => this.annotations().filter((a) => a.type === 'threshold' && a.value != null));

  readonly columns = computed(() => {
    const categories = this.categories();
    if (!categories.length) return [];
    const slotWidth = this.innerWidth() / categories.length;
    const y = this.y();
    const baseline = this.baseline();
    const lowest = Math.min(...this.thresholds().map((t) => t.value ?? Infinity), Infinity);
    const keptLabels = thinLabels(categories, this.isNarrow() ? 4 : 8);
    const grouped = !this.stacked() && this.series().length > 1;

    // Grouped: each series gets its own bar, side by side, with a 4px gap
    // between them — three bars that read as three separate quantities rather
    // than the stacked total this shape is deliberately not.
    const groupGap = 4;
    const barWidth = grouped
      ? Math.min(24, Math.max(4, (slotWidth * 0.72 - groupGap * (this.series().length - 1)) / this.series().length))
      : Math.min(24, Math.max(4, slotWidth * 0.62));
    const groupWidth = grouped ? barWidth * this.series().length + groupGap * (this.series().length - 1) : barWidth;

    return categories.map((category, index) => {
      const groupX = this.padding().left + slotWidth * index + (slotWidth - groupWidth) / 2;
      let cursor = baseline;
      let total = 0;
      const segments = this.series().map((entry, seriesIndex) => {
        const point = entry.points.find((candidate) => String(candidate.x ?? '') === category) ?? { x: category, y: 0 };
        const value = Number(point.y ?? 0);
        total += value;
        if (grouped) {
          const x = groupX + seriesIndex * (barWidth + groupGap);
          const height = Math.max(0, baseline - y(value));
          const top = baseline - height;
          return {
            seriesKey: entry.key,
            label: entry.label,
            colorSlot: entry.colorSlot,
            dashed: !!entry.dashed,
            value,
            point,
            path: columnPath(x, top, barWidth, height, 4),
          };
        }
        const rawHeight = baseline - y(value);
        // 2px surface gap between stack segments.
        const height = Math.max(0, rawHeight - (this.series().length > 1 ? 2 : 0));
        const top = cursor - height;
        cursor = top - (this.series().length > 1 ? 2 : 0);
        return {
          seriesKey: entry.key,
          label: entry.label,
          colorSlot: entry.colorSlot,
          dashed: !!entry.dashed,
          value,
          point,
          path: columnPath(groupX, top, barWidth, height, 4),
        };
      });
      return {
        key: category,
        label: this.axisLabel(category, 'x'),
        x: groupX,
        width: groupWidth,
        top: grouped ? y(Math.max(...segments.map((s) => s.value), 0)) : y(total),
        breached: Number.isFinite(lowest) && total > lowest,
        showLabel: keptLabels[index] !== null,
        segments,
      };
    });
  });

  readonly ariaLabel = computed(
    () => `${this.series().map((entry) => entry.label).join(', ')} across ${this.categories().length} buckets.`,
  );

  seriesLabel(key: string): string {
    return this.series().find((entry) => entry.key === key)?.label ?? key;
  }
}
