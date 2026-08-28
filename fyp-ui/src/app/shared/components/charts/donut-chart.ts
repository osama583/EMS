import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ValueFormat } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import { formatValue, slotColor } from './viz';

interface DonutSegment {
  label: string;
  value: number | null;
  optionId?: number;
  [key: string]: unknown;
}

/**
 * A ring divided by share, with the whole it divides printed in the centre.
 *
 * The centre figure is the reason this is a donut and not a pie: the total
 * ("359 downloads", "42 orders this period") is a fact the reader wants as
 * often as the split is, and a hole in the middle is the one place on the
 * mark that does not compete with a wedge for it.
 *
 * Segments are ordered by share, descending, so the legend below reads as a
 * ranking rather than an arbitrary list — the biggest slice is always first.
 */
@Component({
  selector: 'app-donut-chart',
  imports: [],
  template: `
    <div class="viz-donut">
      <svg class="viz-donut__ring" viewBox="0 0 120 120" role="img" [attr.aria-label]="ariaLabel()">
        @for (segment of segments(); track segment.key) {
          <path
            class="viz-mark"
            [attr.d]="segment.path"
            [attr.fill]="segment.color"
            tabindex="0"
            [attr.aria-label]="segment.label + ' ' + segment.percentText"
            (mouseenter)="hover(segment.key, segment.point)"
            (focus)="hover(segment.key, segment.point)"
            (click)="select(segment.key, segment.point)"
            (keydown.enter)="select(segment.key, segment.point)"
          />
        }
        @if (!segments().length) {
          <circle cx="60" cy="60" r="48" class="viz-donut__track" />
        }
      </svg>
      <div class="viz-donut__center">
        <span class="viz-donut__total">{{ totalText() }}</span>
        <span class="viz-donut__caption">{{ totalLabel() }}</span>
      </div>
    </div>

    <ul class="viz-donut__legend">
      @for (segment of segments(); track segment.key) {
        <li class="viz-donut__item">
          <span class="dash-swatch" [style.background]="segment.color"></span>
          <span class="viz-donut__percent">{{ segment.percentText }}</span>
          <span class="viz-donut__name">{{ segment.label }}</span>
        </li>
      } @empty {
        <li class="viz-donut__empty">Nothing recorded in this period.</li>
      }
    </ul>

    @if (hovered(); as active) {
      <p class="viz-tooltip" role="status">
        <strong>{{ active.point.label }}</strong>
        {{ valueLabel(active.point.y) }}
      </p>
    }
  `,
  styleUrl: './donut-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DonutChartComponent extends VizChartBase {
  protected plotHeight(): number {
    return 0; // Flow-laid-out; height follows content.
  }

  readonly rawSegments = computed(() => (this.data()?.['segments'] as DonutSegment[]) ?? []);
  readonly totalOverride = computed(() => {
    const value = this.data()?.['total'];
    return typeof value === 'number' ? value : null;
  });
  readonly totalLabel = computed(() => (this.data()?.['totalLabel'] as string) ?? 'Total');
  readonly format = computed(() => (this.data()?.['format'] as ValueFormat) ?? 'count');

  private readonly total = computed(() => {
    const override = this.totalOverride();
    if (override !== null) return override;
    return this.rawSegments().reduce((sum, segment) => sum + Math.max(0, Number(segment.value ?? 0)), 0);
  });

  readonly totalText = computed(() => formatValue(this.total(), this.format()));

  readonly segments = computed(() => {
    const total = this.total();
    const ordered = [...this.rawSegments()]
      .filter((segment) => Number(segment.value ?? 0) > 0)
      .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));

    const radius = 48;
    const thickness = 18;
    const inner = radius - thickness;
    const circumference = 2 * Math.PI * radius;
    // A hairline gap between wedges, in degrees, so adjacent slices read as
    // separate quantities rather than one ring — the same reason the bar and
    // column marks carry a surface gap between stacked segments.
    const gapDegrees = ordered.length > 1 ? 1.5 : 0;

    let cursor = -90; // 12 o'clock start, clockwise.
    return ordered.map((segment, index) => {
      const value = Math.max(0, Number(segment.value ?? 0));
      const share = total > 0 ? value / total : 0;
      const sweep = Math.max(0, share * 360 - gapDegrees);
      const start = cursor;
      const end = cursor + sweep;
      cursor += share * 360;

      return {
        key: `${segment.label}-${index}`,
        label: segment.label,
        color: slotColor((index % 8) + 1),
        path: donutWedgePath(60, 60, radius, inner, start, end),
        percentText: formatValue(share, 'percent'),
        point: { x: index, y: value, label: segment.label, optionId: segment.optionId },
      };
    });
  });

  readonly ariaLabel = computed(
    () => `${this.segments().length} segment(s) of ${this.totalText()} ${this.totalLabel().toLowerCase()}.`,
  );
}

function donutWedgePath(cx: number, cy: number, outerR: number, innerR: number, startDeg: number, endDeg: number): string {
  if (endDeg <= startDeg) return '';
  const full = endDeg - startDeg >= 359.99;
  const start = polar(cx, cy, outerR, startDeg);
  const end = polar(cx, cy, outerR, full ? startDeg + 359.99 : endDeg);
  const innerStart = polar(cx, cy, innerR, full ? startDeg + 359.99 : endDeg);
  const innerEnd = polar(cx, cy, innerR, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M${start.x} ${start.y}`,
    `A${outerR} ${outerR} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    `L${innerStart.x} ${innerStart.y}`,
    `A${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: Number((cx + r * Math.cos(rad)).toFixed(3)), y: Number((cy + r * Math.sin(rad)).toFixed(3)) };
}
