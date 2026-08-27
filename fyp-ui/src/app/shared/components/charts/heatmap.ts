import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VizChartBase } from './viz-chart.base';
import { formatValue, rampColor } from './viz';

interface HeatCell {
  label: string;
  date: string;
  ratio: number | null;
  committed?: number | null;
  available?: number | null;
  suppressed?: boolean;
  [key: string]: unknown;
}

/**
 * Date × item magnitude, on a single sequential blue.
 *
 * One hue, light → dark. A rainbow ramp invents category boundaries a
 * continuous quantity does not have, and a reader ends up believing green and
 * yellow are different *kinds* of busy.
 *
 * Cells above the threshold take a status ring **and a glyph**. Cells below the
 * reporting floor render as an em dash with the suppression note, not as an
 * empty cell — a reader cannot tell "none" from "too few to report" otherwise.
 *
 * On a phone this becomes a ranked list of breaches. A thirty-column heatmap is
 * unreadable at any cell size on 390px, and shrinking it produces a decorative
 * texture rather than a chart.
 */
@Component({
  selector: 'app-heatmap',
  imports: [],
  template: `
    @if (isNarrow()) {
      <ul class="viz-heat__list">
        @for (item of narrowList(); track item.key) {
          <li class="viz-heat__row" [class.viz-heat__row--breach]="item.breach">
            <span class="viz-heat__row-label">{{ item.label }}</span>
            <span class="viz-heat__row-date">{{ item.date }}</span>
            <span class="viz-heat__row-value">
              @if (item.breach) { <span class="material-symbols-rounded" aria-hidden="true">warning</span> }
              {{ item.value }}
            </span>
          </li>
        } @empty {
          <li class="viz-heat__row viz-heat__row--clear">Nothing in the next few days is over its limit.</li>
        }
      </ul>
      <p class="viz-scroll__hint">Showing the next {{ NARROW_DAYS }} days, worst first. Open the table for the full grid.</p>
    } @else {
      <div class="viz-heat" [style.--heat-cols]="columns().length">
        <div class="viz-heat__corner"></div>
        @for (column of columns(); track column) {
          <div class="viz-heat__col-head">{{ columnLabel(column) }}</div>
        }
        @for (row of rows(); track row) {
          <div class="viz-heat__row-head" [title]="row">{{ row }}</div>
          @for (column of columns(); track column) {
            @let cell = cellAt(row, column);
            <button
              type="button"
              class="viz-heat__cell"
              [class.viz-heat__cell--breach]="!!cell && isBreach(cell)"
              [class.viz-heat__cell--warn]="!!cell && isWarn(cell)"
              [class.viz-heat__cell--void]="!cell"
              [style.background]="cell ? fill(cell) : 'transparent'"
              [attr.aria-label]="describe(row, column, cell)"
              [title]="describe(row, column, cell)"
              (click)="cell && select('heatmap', cell)"
            >
              @if (cell?.suppressed) { <span class="viz-heat__dash">—</span> }
              @else if (cell && isBreach(cell)) { <span class="viz-heat__glyph" aria-hidden="true">!</span> }
            </button>
          }
        }
      </div>

      <div class="viz-heat__scale" aria-hidden="true">
        <span class="viz-heat__scale-label">low</span>
        @for (step of scaleSteps(); track step) {
          <span class="viz-heat__scale-step" [style.background]="step"></span>
        }
        <span class="viz-heat__scale-label">high</span>
      </div>
    }
  `,
  styleUrl: './heatmap.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapComponent extends VizChartBase {
  readonly rampFloor = input(100);
  protected readonly NARROW_DAYS = 4;

  protected plotHeight(): number {
    return 0; // Grid-laid-out, not SVG: height follows content.
  }

  readonly rows = computed(() => ((this.data()?.['rows'] as string[]) ?? []).slice(0, 14));
  readonly allColumns = computed(() => (this.data()?.['columns'] as string[]) ?? []);
  readonly columns = computed(() => this.allColumns().slice(0, this.isNarrow() ? 4 : 30));
  readonly cells = computed(() => (this.data()?.['cells'] as HeatCell[]) ?? []);
  readonly threshold = computed(() => Number(this.data()?.['threshold'] ?? 1));
  readonly warnAt = computed(() => Number(this.data()?.['warn'] ?? this.threshold() * 0.85));
  /** An empty cell is a breach in the dietary matrix (no item covers that tag)
   *  and merely absent in an inventory matrix. The server says which. */
  readonly emptyIsBreach = computed(() => !!this.data()?.['emptyIsBreach']);

  private readonly index = computed(() => {
    const map = new Map<string, HeatCell>();
    for (const cell of this.cells()) {
      map.set(`${cell.label}|${cell.date}`, cell);
    }
    return map;
  });

  private readonly maxRatio = computed(() =>
    Math.max(this.threshold(), ...this.cells().map((cell) => Number(cell.ratio ?? 0)), 0.0001),
  );

  cellAt(row: string, column: string): HeatCell | null {
    return this.index().get(`${row}|${column}`) ?? null;
  }

  fill(cell: HeatCell): string {
    if (cell.suppressed) return 'var(--viz-plane)';
    const ratio = Number(cell.ratio ?? 0);
    return rampColor(ratio / this.maxRatio(), this.rampFloor());
  }

  isBreach(cell: HeatCell): boolean {
    if (this.emptyIsBreach()) return !cell.ratio;
    return Number(cell.ratio ?? 0) > this.threshold();
  }

  isWarn(cell: HeatCell): boolean {
    if (this.isBreach(cell)) return false;
    return Number(cell.ratio ?? 0) >= this.warnAt();
  }

  columnLabel(column: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(column) ? formatValue(column, 'date') : column;
  }

  describe(row: string, column: string, cell: HeatCell | null): string {
    if (!cell) return `${row}, ${this.columnLabel(column)}: nothing committed`;
    if (cell.suppressed) return `${row}, ${this.columnLabel(column)}: below the reporting threshold`;
    const parts = [`${row}, ${this.columnLabel(column)}`];
    if (cell.committed != null && cell.available != null) {
      parts.push(`${formatValue(cell.committed, 'count')} of ${formatValue(cell.available, 'count')}`);
    }
    if (cell.ratio != null) parts.push(formatValue(cell.ratio, 'ratio'));
    return parts.join(' · ');
  }

  readonly scaleSteps = computed(() => [0, 0.25, 0.5, 0.75, 1].map((t) => rampColor(t, this.rampFloor())));

  /** Phone fallback: the next few days as a ranked list, worst first. */
  readonly narrowList = computed(() => {
    const days = this.allColumns().slice(0, this.NARROW_DAYS);
    return this.cells()
      .filter((cell) => days.includes(cell.date) && (this.isBreach(cell) || this.isWarn(cell)))
      .sort((a, b) => Number(b.ratio ?? 0) - Number(a.ratio ?? 0))
      .slice(0, 8)
      .map((cell) => ({
        key: `${cell.label}|${cell.date}`,
        label: cell.label,
        date: this.columnLabel(cell.date),
        value: cell.suppressed ? '—' : formatValue(cell.ratio, 'ratio'),
        breach: this.isBreach(cell),
      }));
  });
}
