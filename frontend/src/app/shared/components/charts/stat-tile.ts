import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { StatWidget } from '../../../core/dashboard/dashboard.models';
import { formatValue, linePath, linearScale, niceDomain } from './viz';

/**
 * KPI tile and hero figure — one component, two sizes.
 *
 * They are the same object with different weight: label, value, sparkline.
 * Splitting them into two components would mean two places to keep the caveat
 * rendering and the drill target in step, and they would drift.
 *
 * The tile deliberately carries **no target chip and no period-on-period
 * delta**. Both were removed as noise: a "target: none" chip states an absence,
 * and "40% vs previous" competes with the number it qualifies for the reader's
 * attention while being the less important of the two. The server still sends
 * `target` and `delta`; this component simply does not render them.
 *
 * **Exactly one hero per view.** It occupies four grid columns and full band
 * height so it reads as the page's lead rather than a larger tile. Same
 * typeface as everything else — a display face here reads as off-brand
 * decoration.
 *
 * **A tile does not navigate.** It is a figure to read, not a link. Clicking
 * one used to throw away whatever the reader had on screen, usually by accident
 * while trying to read the number. This is the rule the chart marks already
 * follow (chart-panel.ts's `onMark`): the dashboard is somewhere you look, and
 * leaving it is a deliberate act through the sidebar, not a stray click.
 *
 * The server still sends a `drill` on most tiles; this component ignores it.
 */
@Component({
  selector: 'app-stat-tile',
  imports: [],
  template: `
    <div class="dash-card dash-stat" [class.dash-stat--hero]="isHero()">
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

}
