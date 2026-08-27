import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { StatWidget } from '../../../core/dashboard/dashboard.models';
import { STATUS_ICON, STATUS_WORD, formatValue, linePath, linearScale, niceDomain } from './viz';

/**
 * KPI tile and hero figure — one component, two sizes.
 *
 * They are the same object with different weight: label, value, sparkline,
 * delta, status. Splitting them into two components would mean two places to
 * keep the caveat rendering, the delta direction logic and the drill target in
 * step, and they would drift.
 *
 * **Exactly one hero per view.** It occupies four grid columns and full band
 * height so it reads as the page's lead rather than a larger tile. Same
 * typeface as everything else — a display face here reads as off-brand
 * decoration.
 *
 * The whole tile is the hit target, not just the value.
 */
@Component({
  selector: 'app-stat-tile',
  imports: [],
  template: `
    <div
      class="dash-card dash-stat"
      [class.dash-stat--hero]="isHero()"
      [class.dash-card--interactive]="!!stat().drill"
      [attr.role]="stat().drill ? 'button' : null"
      [attr.tabindex]="stat().drill ? 0 : null"
      (click)="activate()"
      (keydown.enter)="activate()"
      (keydown.space)="activate($event)"
    >
      <p class="dash-label">
        {{ stat().label }}
        @if (stat().definition) {
          <span class="dash-stat__info material-symbols-rounded" [title]="stat().definition!" aria-hidden="true">info</span>
        }
      </p>

      @if (stat().state === 'error') {
        <p class="dash-value dash-value--empty">Unavailable</p>
        <p class="dash-caption">{{ stat().message || 'This figure could not be loaded.' }}</p>
      } @else if (stat().value === null || stat().value === undefined) {
        <p class="dash-value dash-value--empty">—</p>
        <p class="dash-caption">{{ stat().empty || stat().caption || 'Nothing recorded in this period.' }}</p>
      } @else {
        <p class="dash-value" [class.dash-value--hero]="isHero()">
          {{ display() }}
          @if (stat().secondary) {
            <span class="dash-stat__secondary">{{ stat().secondary }}</span>
          }
        </p>

        @if (sparkPath()) {
          <svg class="viz-svg dash-sparkline" [attr.viewBox]="'0 0 ' + SPARK_W + ' ' + SPARK_H" [attr.height]="SPARK_H" role="presentation" aria-hidden="true">
            <path [attr.d]="sparkPath()" fill="none" stroke="var(--viz-deemphasis)" stroke-width="2" stroke-linecap="round" />
            @if (lastPoint(); as point) {
              <circle [attr.cx]="point.cx" [attr.cy]="point.cy" r="3" fill="var(--viz-slot-1)" stroke="var(--viz-surface)" stroke-width="2" />
            }
          </svg>
        }

        @if (stat().caption) {
          <p class="dash-caption">{{ stat().caption }}</p>
        }

        <div class="dash-stat__foot">
          @if (stat().delta; as delta) {
            <span class="dash-delta" [class]="'dash-delta--' + deltaTone(delta.direction, delta.isGood)">
              <span class="material-symbols-rounded" aria-hidden="true">{{ deltaIcon(delta.direction) }}</span>
              {{ deltaText(delta) }}
            </span>
          }
          <span class="dash-status" [class]="'dash-status--' + stat().status">
            <span class="material-symbols-rounded" aria-hidden="true">{{ statusIcon() }}</span>
            {{ statusLabel() }}
          </span>
        </div>
      }

      @if (stat().caveat) {
        <p class="dash-caveat">{{ stat().caveat }}</p>
      }
    </div>
  `,
  styleUrl: './stat-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTileComponent {
  readonly stat = input.required<StatWidget>();
  readonly drill = output<StatWidget>();

  protected readonly SPARK_W = 120;
  protected readonly SPARK_H = 28;

  readonly isHero = computed(() => this.stat().kind === 'hero');
  readonly display = computed(() => formatValue(this.stat().value, this.stat().format));

  private readonly sparkPoints = computed(() => {
    const values = (this.stat().sparkline ?? [])
      .map((point) => Number(point.y))
      .filter((value) => Number.isFinite(value));
    // Two points is a line; one is a dot pretending to be a trend.
    if (values.length < 3) return [];
    const [min, max] = niceDomain(values, { includeZero: false });
    const x = linearScale([0, values.length - 1], [2, this.SPARK_W - 2]);
    const y = linearScale([min, max], [this.SPARK_H - 3, 3]);
    return values.map((value, index) => ({ cx: x(index), cy: y(value) }));
  });

  readonly sparkPath = computed(() => linePath(this.sparkPoints()));
  readonly lastPoint = computed(() => this.sparkPoints().at(-1) ?? null);

  readonly statusIcon = computed(() => STATUS_ICON[this.stat().status] ?? 'help');
  readonly statusLabel = computed(() => {
    const target = this.stat().target?.label;
    if (target) return target;
    return STATUS_WORD[this.stat().status] ?? 'No data';
  });

  activate(event?: Event): void {
    if (!this.stat().drill) return;
    event?.preventDefault();
    this.drill.emit(this.stat());
  }

  /** Direction and goodness are separate: latency falling is 'down' and good,
   *  coverage falling is 'down' and bad. */
  deltaTone(direction: string, isGood: boolean): string {
    if (direction === 'flat') return 'flat';
    return isGood ? 'good' : 'bad';
  }

  deltaIcon(direction: string): string {
    return direction === 'up' ? 'trending_up' : direction === 'down' ? 'trending_down' : 'trending_flat';
  }

  deltaText(delta: { percent: number | null; value: number; direction: string }): string {
    if (delta.direction === 'flat') return 'No change';
    const suffix = ` vs ${this.stat().kind === 'hero' ? 'the previous period' : 'previous'}`;
    if (delta.percent !== null && Number.isFinite(delta.percent)) {
      return `${Math.abs(delta.percent * 100).toFixed(0)}%${suffix}`;
    }
    return `${formatValue(Math.abs(delta.value), this.stat().format)}${suffix}`;
  }
}
