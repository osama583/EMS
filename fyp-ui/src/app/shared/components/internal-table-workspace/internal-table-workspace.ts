import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { InternalPaginationComponent } from '../internal-data-page/internal-data-page-parts';

@Component({
  selector: 'app-internal-table-workspace',
  imports: [InternalPaginationComponent],
  templateUrl: './internal-table-workspace.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalTableWorkspaceComponent {
  readonly ariaLabel = input('Table workspace');
  readonly hideHeader = input(false);
  readonly hideControls = input(false);
  readonly paginationLabel = input('Pagination');
  readonly rowsPerPageLabel = input('Rows per page');
  readonly totalPages = input(1);
  readonly pageSizeOptions = input<readonly number[]>([10, 25, 50, 100]);
  readonly page = model(1);
  readonly pageSize = model(10);

  updatePageSize(value: number): void {
    this.pageSize.set(value);
    this.page.set(1);
  }
}
