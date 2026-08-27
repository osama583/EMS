import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { VizStatus } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import { STATUS_ICON, formatValue, statusColor } from './viz';

interface MeterSpec {
  label: string;
  optionId?: number;
  value: number | null;
  committed?: number | null;
  available?: number | null;
  status: VizStatus;
  unit?: string;
  [key: string]: unknown;
}

/**
 * One ratio against one limit.
 *
 * A meter and not a pie: a pie asks the reader to compare two angles that sum
 * to a whole, when the question here is "how close is this to its ceiling" —
 * which is a position on a line. The limit is drawn as a rule on the track so
 * over-commitment is visible as overflow rather than inferred from a number.
 *
 * The fill carries severity; the unfilled track is a lighter step of the same
 * blue, so the state reads across the whole bar rather than only where the fill
 * stops.
 */
@Component({
  selector: 'app-meter',
  imports: [],
  template: `
    <ul class="viz-meters">
      @for (meter of meters(); track meter.key) {
        <li class="viz-meter">
          <div class="viz-meter__head">
            <span class="viz-meter__name">{{ meter.label }}</span>
            <span class="viz-meter__value" [style.color]="meter.color">{{ meter.percent }}</span>
          </div>
          <div class="viz-meter__track">
            <button
              type="button"
              class="viz-meter__fill"
              [style.width.%]="meter.width"
              [style.background]="meter.color"
              [attr.aria-label]="meter.aria"
              (click)="select('meter', meter.raw)"
            ></button>
            @if (meter.overflow) {
              <span class="viz-meter__limit" [style.left.%]="meter.limitAt"></span>
            }
          </div>
          <div class="viz-meter__foot">
            <span>{{ meter.detail }}</span>
            <span class="dash-status" [class]="'dash-status--' + meter.status">
              <span class="material-symbols-rounded" aria-hidden="true">{{ meter.icon }}</span>
              {{ meter.statusWord }}
            </span>
          </div>
        </li>
      } @empty {
        <li class="viz-meter__empty">Nothing is configured to measure here yet.</li>
      }
    </ul>
  `,
  styleUrl: './meter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeterComponent extends VizChartBase {
  protected plotHeight(): number {
    return 0;
  }

  readonly specs = computed(() => (this.data()?.['meters'] as MeterSpec[]) ?? []);

  readonly meters = computed(() =>
    this.specs().map((spec, index) => {
      const ratio = Number(spec.value ?? 0);
      // Over 1.0 the bar keeps growing past the limit rule rather than pinning
      // at full: a meter that saturates hides exactly the case worth seeing.
      const scale = Math.max(1, ...this.specs().map((other) => Number(other.value ?? 0)));
      return {
        key: `${spec.label}-${index}`,
        label: spec.label,
        raw: spec,
        status: spec.status,
        color: statusColor(spec.status),
        icon: STATUS_ICON[spec.status] ?? 'help',
        statusWord: spec.status === 'critical' ? 'Over capacity' : spec.status === 'warning' ? 'Approaching' : 'Within limit',
        percent: spec.value === null ? '—' : formatValue(spec.value, 'percent'),
        width: Math.min(100, Math.max(1, (ratio / scale) * 100)),
        overflow: ratio > 1,
        limitAt: Math.min(100, (1 / scale) * 100),
        detail:
          spec.committed != null && spec.available != null
            ? `committed ${formatValue(spec.committed, 'count')} / ${formatValue(spec.available, 'count')}${spec.unit ? ` ${spec.unit}` : ''}`
            : '',
        aria: `${spec.label}: ${spec.value === null ? 'no data' : formatValue(spec.value, 'percent')} of capacity`,
      };
    }),
  );
}
