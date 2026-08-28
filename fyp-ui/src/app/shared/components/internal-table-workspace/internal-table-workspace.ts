import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { InternalPaginationComponent } from '../internal-data-page/internal-data-page-parts';
import { PAGE_SIZE_OPTIONS } from '../internal-data-page/internal-data-page.models';

@Component({
  selector: 'app-internal-table-workspace',
  imports: [InternalPaginationComponent],
  templateUrl: './internal-table-workspace.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalTableWorkspaceComponent {
  readonly ariaLabel = input('Table workspace');
  // 'card' forces the card list at every viewport; 'table' keeps the default responsive behaviour
  // (table on desktop, cards below 48rem). See _internal-table-workspace.scss.
  readonly viewMode = input<'card' | 'table'>('table');
  readonly hideHeader = input(false);
  readonly hideControls = input(false);
  readonly paginationLabel = input('Pagination');
  readonly rowsPerPageLabel = input('Rows per page');
  readonly totalPages = input(1);
  readonly pageSizeOptions = input<readonly number[]>(PAGE_SIZE_OPTIONS);
  readonly page = model(1);
  readonly pageSize = model(10);

  updatePageSize(value: number): void {
    this.pageSize.set(value);
    this.page.set(1);
  }
}
