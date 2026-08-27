import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TableView } from '../../../core/dashboard/dashboard.models';
import { formatValue } from './viz';

/**
 * A panel's table twin.
 *
 * Ships with every panel and is never lazily fetched. It is three things at
 * once: the screen-reader path, the copy-paste path, and the fallback when a
 * chart cannot render. A value that exists only inside a hover tooltip is a
 * value some readers never get.
 *
 * A suppressed row renders as an em dash, here and in the CSV export. Export
 * must not be the hole through which the bucket floor leaks.
 */
@Component({
  selector: 'app-table-view',
  imports: [],
  template: `
    @if (view(); as table) {
      <div class="viz-table__scroll">
        <table class="viz-table">
          <caption class="viz-table__caption">{{ caption() }}</caption>
          <thead>
            <tr>
              @for (column of table.columns; track column.key) {
                <th scope="col" [class.viz-table__num]="isNumeric(column.format)">{{ column.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              <tr [class.viz-table__row--suppressed]="row['suppressed']">
                @for (column of table.columns; track column.key) {
                  <td [class.viz-table__num]="isNumeric(column.format)">{{ cell(row, column.key, column.format) }}</td>
                }
              </tr>
            } @empty {
              <tr><td [attr.colspan]="table.columns.length" class="viz-table__empty">Nothing to show for this period.</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (table.rows.length > rows().length) {
        <p class="viz-table__more">Showing the first {{ rows().length }} of {{ table.rows.length }} rows. Export the CSV for the rest.</p>
      }
    }
  `,
  styleUrl: './table-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableViewComponent {
  readonly view = input.required<TableView | null>();
  readonly caption = input('Every value in the chart above.');
  readonly limit = input(50);

  readonly rows = computed(() => (this.view()?.rows ?? []).slice(0, this.limit()));

  isNumeric(format: string): boolean {
    return !['text', 'date', 'datetime', 'time'].includes(format);
  }

  cell(row: Record<string, unknown>, key: string, format: string): string {
    // A suppressed bucket shows the em dash for its measures but keeps its
    // label — a reader has to be able to tell which bucket was suppressed.
    if (row['suppressed'] && this.isNumeric(format)) return '—';
    return formatValue(row[key], format as never);
  }
}
