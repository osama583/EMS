import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Point } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import { barPath, formatValue, linearScale, niceDomain } from './viz';

/**
 * Horizontal bars — ranked comparison, and horizontal stacked bars.
 *
 * Horizontal because the category names here are long ("Sound & Light",
 * "Level 3 Food Court", "Photography / Videography"), and a rotated axis label
 * is a label a reader has to tilt their head for.
 *
 * The value sits at the tip, always. This is one of the forms that can seat
 * slots 3-5, which fall under 3:1 on white, so a direct label is the obligation
 * the palette warning creates rather than a nicety.
 */
@Component({
  selector: 'app-bar-chart',
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
      @for (row of rows(); track row.key) {
        <text class="viz-axis-label viz-bar__name" [attr.x]="0" [attr.y]="row.y + row.height / 2 + 4">{{ row.label }}</text>

        <rect class="viz-bar__track" [attr.x]="labelWidth()" [attr.y]="row.y" [attr.width]="plotWidth()" [attr.height]="row.height" rx="4" />

        @for (segment of row.segments; track segment.seriesKey) {
          <path
            class="viz-mark"
            [class.viz-mark--muted]="segment.muted"
            [attr.d]="segment.path"
            [attr.fill]="colorFor(segment.colorSlot)"
            tabindex="0"
            [attr.aria-label]="row.label + ' ' + segment.label + ' ' + valueLabel(segment.value)"
            (mouseenter)="hover(segment.seriesKey, segment.point)"
            (focus)="hover(segment.seriesKey, segment.point)"
            (click)="select(segment.seriesKey, segment.point)"
            (keydown.enter)="select(segment.seriesKey, segment.point)"
          />
        }

        @if (row.warn) {
          <text class="viz-glyph" [attr.x]="labelWidth() - 8" [attr.y]="row.y + row.height / 2 + 4" text-anchor="end">!</text>
        }

        <text class="viz-value-label" [attr.x]="row.tipX + 6" [attr.y]="row.y + row.height / 2 + 4">
          {{ row.suppressed ? '—' : row.valueText }}@if (row.annotation) { <tspan class="viz-bar__note"> · {{ row.annotation }}</tspan> }
        </text>
      }
    </svg>

    @if (hovered(); as active) {
      <p class="viz-tooltip" role="status">
        <strong>{{ active.point.label }}</strong>
        {{ seriesLabel(active.seriesKey) }} · {{ valueLabel(active.point.x ?? active.point.y) }}
      </p>
    }
  `,
  styleUrl: './bar-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarChartComponent extends VizChartBase {
  readonly stacked = input(false);
  readonly limit = input(12);

  protected plotHeight(): number {
    return Math.max(120, this.rowKeys().length * this.rowPitch() + 12);
  }

  private rowPitch(): number {
    return this.isNarrow() ? 34 : 30;
  }

  /** Label gutter takes a third of a narrow card and a quarter of a wide one —
   *  enough for a long department name without starving the plot. */
  readonly labelWidth = computed(() => Math.round(Math.min(200, Math.max(96, this.width() * (this.isNarrow() ? 0.34 : 0.26)))));
  readonly plotWidth = computed(() => Math.max(40, this.width() - this.labelWidth() - 72));

  /** Rows come from the server already ordered descending; the cap keeps a
   *  120-item catalogue from becoming a scrolling wall. The table view carries
   *  the tail. */
  readonly rowKeys = computed(() => {
    const first = this.series()[0];
    if (!first) return [];
    return first.points.slice(0, this.limit());
  });

  readonly domain = computed(() => {
    const values: number[] = [];
    for (const entry of this.series()) {
      for (const point of entry.points) {
        // Horizontal bars carry their magnitude on x.
        values.push(Number(point.x ?? point.y ?? 0));
      }
    }
    if (this.stacked() || this.series().length > 1) {
      const totals = this.rowKeys().map((_, index) =>
        this.series().reduce((sum, entry) => sum + Number(entry.points[index]?.x ?? entry.points[index]?.y ?? 0), 0),
      );
      values.push(...totals);
    }
    return niceDomain(values);
  });

  readonly x = computed(() => linearScale(this.domain(), [this.labelWidth(), this.labelWidth() + this.plotWidth()]));

  readonly rows = computed(() => {
    const x = this.x();
    const pitch = this.rowPitch();
    const barHeight = Math.min(24, pitch - 8);
    const multi = this.series().length > 1;

    return this.rowKeys().map((anchor, index) => {
      const y = 6 + index * pitch;
      let cursor = this.labelWidth();
      let total = 0;
      const segments = this.series().map((entry) => {
        const point = (entry.points[index] ?? { x: 0, label: anchor.label }) as Point;
        const value = Number(point.x ?? point.y ?? 0);
        total += value;
        const rawWidth = x(value) - this.labelWidth();
        const segmentWidth = Math.max(0, rawWidth - (multi ? 2 : 0));
        const path = barPath(cursor, y, segmentWidth, barHeight, 4);
        cursor += segmentWidth + (multi ? 2 : 0);
        return {
          seriesKey: entry.key,
          label: entry.label,
          colorSlot: entry.colorSlot,
          value,
          point,
          muted: !!point['muted'],
          path,
        };
      });
      const label = String(anchor.label ?? anchor.x ?? '');
      return {
        key: `${label}-${index}`,
        label: this.truncate(label),
        y,
        height: barHeight,
        tipX: Math.max(cursor, this.labelWidth() + 2),
        valueText: multi
          ? formatValue(total, this.axes().x?.format ?? 'number')
          : formatValue(anchor.x ?? anchor.y, this.axes().x?.format ?? 'number'),
        annotation: (anchor['annotation'] as string) ?? null,
        warn: !!anchor['warn'],
        suppressed: !!anchor['suppressed'],
        segments,
      };
    });
  });

  readonly ariaLabel = computed(() => `${this.rowKeys().length} ranked bars. The table view carries every value.`);

  seriesLabel(key: string): string {
    return this.series().find((entry) => entry.key === key)?.label ?? key;
  }

  override valueLabel(value: unknown): string {
    return formatValue(value, this.axes().x?.format ?? 'number');
  }

  private truncate(label: string): string {
    const budget = Math.floor(this.labelWidth() / 6.6);
    return label.length > budget ? `${label.slice(0, budget - 1)}…` : label;
  }
}
