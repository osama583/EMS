import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ValueFormat } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import { formatValue, rampColor } from './viz';

interface FunnelStage {
  stage: string;
  value: number | null;
  share?: number | null;
  format?: ValueFormat;
  medianAgeDays?: number | null;
  [key: string]: unknown;
}

/**
 * Stage conversion, as full-width bars rather than a tapering polygon.
 *
 * A drawn funnel encodes each stage as a *trapezoid area*, which readers
 * compare badly and which exaggerates the drop at every step. Equal-height bars
 * scaled by width encode the same numbers on a length scale, which is the one
 * people read accurately — and the conversion percentage between steps is the
 * fact the panel exists for, so it is printed rather than inferred.
 *
 * The ordinal blue ramp starts no lighter than step 250, so the first stage
 * still clears 2:1 against white.
 *
 * A `net` value renders with the diverging pair — blue above break-even, red
 * below, neutral grey at zero — because it is the one figure here with a sign.
 */
@Component({
  selector: 'app-funnel',
  imports: [],
  template: `
    <ol class="viz-funnel" (mouseleave)="clearHover()">
      @for (stage of stages(); track stage.key) {
        <li class="viz-funnel__step">
          <div class="viz-funnel__head">
            <span class="viz-funnel__name">{{ stage.name }}</span>
            <span class="viz-funnel__value">{{ stage.text }}</span>
          </div>
          <div class="viz-funnel__track">
            <button
              type="button"
              class="viz-funnel__fill"
              [style.width.%]="stage.percent"
              [style.background]="stage.fill"
              [attr.aria-label]="stage.aria"
              (mouseenter)="hover('funnel', stage.raw)"
              (focus)="hover('funnel', stage.raw)"
              (click)="select('funnel', stage.raw)"
            ></button>
          </div>
          <div class="viz-funnel__foot">
            @if (stage.conversion) {
              <span class="viz-funnel__conversion">{{ stage.conversion }} of the step before</span>
            }
            @if (stage.age) {
              <span class="dash-status" [class]="'dash-status--' + stage.ageStatus">
                <span class="material-symbols-rounded" aria-hidden="true">schedule</span>
                {{ stage.age }}
              </span>
            }
          </div>
        </li>
      } @empty {
        <li class="viz-funnel__empty">No stage has any volume in this period.</li>
      }
    </ol>

    @if (net() !== null) {
      <p class="viz-funnel__net" [class]="'viz-funnel__net--' + netDirection()">
        <span class="material-symbols-rounded" aria-hidden="true">{{ netIcon() }}</span>
        Net position {{ netText() }}
      </p>
    }

    @if (hovered(); as active) {
      <p class="viz-tooltip" role="status">
        <strong>{{ tipName(active.point) }}</strong>
        {{ tipValue(active.point) }}
      </p>
    }
  `,
  styleUrl: './funnel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FunnelComponent extends VizChartBase {
  /** Every stage already prints its value, but the hover contract is the same
   *  on every chart in the system: point at a mark, read its exact figure. */
  tipName(point: Record<string, unknown>): string {
    return String(point?.['label'] ?? point?.['name'] ?? point?.['stage'] ?? 'Stage');
  }

  tipValue(point: Record<string, unknown>): string {
    return formatValue(Number(point?.['value'] ?? 0), (point?.['format'] as ValueFormat) ?? 'count');
  }

  protected plotHeight(): number {
    return 0; // Flow-laid-out; height follows content.
  }

  readonly rawStages = computed(() => (this.data()?.['stages'] as FunnelStage[]) ?? []);
  readonly net = computed(() => {
    const value = this.data()?.['net'];
    return typeof value === 'number' ? value : null;
  });
  readonly netDirection = computed(() => (this.data()?.['netDirection'] as string) ?? 'neutral');

  readonly stages = computed(() => {
    const raw = this.rawStages();
    // Mixed units (ringgit at the ends, headcount in the middle) cannot share
    // one length scale, so each stage is scaled against the largest value that
    // shares its format. The conversion percentages carry the comparison.
    const maxByFormat = new Map<string, number>();
    for (const stage of raw) {
      const key = stage.format ?? 'number';
      maxByFormat.set(key, Math.max(maxByFormat.get(key) ?? 0, Math.abs(Number(stage.value ?? 0))));
    }
    return raw.map((stage, index) => {
      const format = stage.format ?? 'number';
      const max = maxByFormat.get(format) || 1;
      const value = Number(stage.value ?? 0);
      const age = stage.medianAgeDays;
      return {
        key: `${stage.stage}-${index}`,
        name: stage.stage,
        raw: stage,
        text: stage.value === null ? '—' : formatValue(stage.value, format as ValueFormat),
        percent: Math.max(2, (Math.abs(value) / max) * 100),
        fill: rampColor(raw.length > 1 ? 1 - index / (raw.length - 1) : 1, 250),
        conversion: stage.share != null ? formatValue(stage.share, 'percent') : null,
        age: age != null ? `${formatValue(age, 'days')} median age` : null,
        ageStatus: age != null && age > 7 ? 'warning' : 'good',
        aria: `${stage.stage}: ${stage.value === null ? 'no data' : formatValue(stage.value, format as ValueFormat)}`,
      };
    });
  });

  netText(): string {
    return formatValue(Math.abs(this.net() ?? 0), 'currency');
  }

  netIcon(): string {
    const direction = this.netDirection();
    return direction === 'positive' ? 'trending_up' : direction === 'negative' ? 'trending_down' : 'trending_flat';
  }
}
