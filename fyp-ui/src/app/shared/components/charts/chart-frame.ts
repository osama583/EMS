import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PanelWidget } from '../../../core/dashboard/dashboard.models';
import { formatValue, slotColor } from './viz';

/**
 * The card every chart sits in: title, subtitle, legend, table toggle, export,
 * and the empty / error / suppressed states.
 *
 * Three rules are enforced here rather than merely documented, so a future
 * panel cannot violate them:
 *
 * - **Legend for two or more series, none for one.** Derived from
 *   `series.length`; it is not a prop, so nobody can pass a legend to a
 *   single-series chart where the title already names the measure.
 * - **The table view always ships.** It is the screen-reader path, the CSV
 *   source, and the render fallback. Nothing is gated behind a hover.
 * - **The container includes the axis band.** Height is content-driven, never a
 *   fixed height that nests a scrollbar inside the card.
 */
@Component({
  selector: 'app-chart-frame',
  imports: [],
  template: `
    <section class="dash-card dash-panel" [class.dash-panel--signature]="panel().signature" [attr.id]="'panel-' + panel().id">
      <header class="dash-panel__head">
        <div class="dash-panel__titles">
          <h3 class="dash-panel__title">{{ panel().title }}</h3>
          @if (panel().subtitle) {
            <p class="dash-panel__subtitle">{{ panel().subtitle }}</p>
          }
        </div>
        <div class="dash-panel__tools">
          <button
            type="button"
            class="dash-panel__tool"
            [class.dash-panel__tool--on]="showTable()"
            [attr.aria-pressed]="showTable()"
            (click)="toggleTable()"
          >
            <span class="material-symbols-rounded" aria-hidden="true">table_rows</span>
            <span class="dash-panel__tool-text">Table</span>
          </button>
          @if (exportHref()) {
            <a class="dash-panel__tool" [href]="exportHref()" [attr.download]="panel().id + '.csv'" title="Download this panel as CSV">
              <span class="material-symbols-rounded" aria-hidden="true">download</span>
              <span class="dash-panel__tool-text">CSV</span>
            </a>
          }
        </div>
      </header>

      @if (showLegend()) {
        <ul class="dash-legend dash-panel__legend">
          @for (entry of panel().series; track entry.key) {
            <li class="dash-legend__item">
              <span class="dash-swatch" [style.background]="colorFor(entry.colorSlot)" [class.dash-swatch--dashed]="entry.dashed"></span>
              {{ entry.label }}
            </li>
          }
        </ul>
      }

      <div class="dash-panel__body">
        @if (panel().state === 'error') {
          <div class="viz-empty viz-empty--error">
            <div>
              <p>{{ panel().message || 'This panel could not be loaded.' }}</p>
              <button type="button" class="dash-panel__retry" (click)="retry.emit(panel().id)">Retry</button>
            </div>
          </div>
        } @else if (showTable()) {
          <ng-content select="[data-slot='table']" />
        } @else if (isEmpty()) {
          <p class="viz-empty">{{ panel().empty || 'Nothing to show for this period.' }}</p>
        } @else {
          <ng-content />
        }
      </div>

      @if (panel().caption && panel().state !== 'error') {
        <p class="dash-caption">{{ panel().caption }}</p>
      }
      @if (panel().caveat) {
        <p class="dash-caveat">{{ panel().caveat }}</p>
      }
      @if (suppressed() > 0) {
        <p class="dash-caption dash-caption--footnote">
          {{ suppressed() }} bucket{{ suppressed() === 1 ? '' : 's' }} below the reporting threshold, shown as —.
        </p>
      }
    </section>
  `,
  styleUrl: './chart-frame.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartFrameComponent {
  readonly panel = input.required<PanelWidget>();
  /** True when the chart itself has nothing to draw. Passed in because only the
   *  chart knows whether its own shape of data is populated. */
  readonly empty = input(false);
  readonly exportHref = input<string | null>(null);
  readonly suppressed = input(0);
  readonly retry = output<string>();

  private readonly tableOpen = signal(false);

  readonly showTable = computed(() => this.tableOpen());
  readonly isEmpty = computed(() => this.empty());
  /** Derived, never passed: two or more series need a legend, one does not. */
  readonly showLegend = computed(() => this.panel().series.length >= 2 && this.panel().state !== 'error');

  toggleTable(): void {
    this.tableOpen.update((open) => !open);
  }

  colorFor(slot: number): string {
    return slotColor(slot);
  }

  protected readonly format = formatValue;
}
