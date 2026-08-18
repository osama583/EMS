import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { EditableRow } from '../form-controls/form-controls.models';
import { RowCounterComponent } from '../row-counter/row-counter';

export interface ProposalTableColumn {
  readonly key: string;
  readonly label: string;
  readonly width?: string;
}

@Component({
  selector: 'app-proposal-table',
  imports: [RowCounterComponent],
  template: `
    <section class="proposal-table" [id]="tableId()" tabindex="-1">
      @if (loading()) {
        <div class="proposal-table__state" role="status" aria-live="polite">
          <span class="material-symbols-rounded proposal-table__state-icon" aria-hidden="true">progress_activity</span>
          <span>Loading records…</span>
        </div>
      } @else if (!rows().length) {
        <div class="proposal-table__state" [id]="tableId() + '-empty'">
          <span class="material-symbols-rounded proposal-table__state-icon" aria-hidden="true">{{ emptyIcon() }}</span>
          <span>{{ emptyMessage() }}</span>
        </div>
      } @else {
        <div class="proposal-table__scroll" [id]="tableId() + '-content'" tabindex="0" aria-label="Scrollable table">
          <table>
            <thead>
              <tr>
                <th scope="col" class="proposal-table__index">#</th>
                @for (column of columns(); track column.key) {
                  <th scope="col" [style.width]="column.width ?? null">{{ column.label }}</th>
                }
                @if (!readOnly()) { <th scope="col" class="proposal-table__actions">Actions</th> }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track rowId(row, $index); let rowIndex = $index) {
                <tr [id]="tableId() + '-row-' + rowIndex">
                  <td class="proposal-table__index">{{ rowIndex + 1 }}</td>
                  @for (column of columns(); track column.key) {
                    <td [class.proposal-table__person]="avatarKey() !== null && column.key === avatarKey()">
                      @if (avatarKey() !== null && column.key === avatarKey()) {
                        <span class="proposal-table__person-cell">
                          <span class="proposal-table__avatar" aria-hidden="true">{{ initials(row) }}</span>
                          <span>{{ value(row, column.key) }}</span>
                        </span>
                      } @else if (imageKey() !== null && column.key === imageKey()) {
                        <span class="proposal-table__person-cell">
                          @if (thumbnail(row)) {
                            <img class="proposal-table__thumb" [src]="thumbnail(row)" [alt]="value(row, column.key)" loading="lazy" />
                          } @else {
                            <span class="proposal-table__thumb proposal-table__thumb--placeholder" aria-hidden="true">
                              <span class="material-symbols-rounded">inventory_2</span>
                            </span>
                          }
                          <span>{{ value(row, column.key) }}</span>
                        </span>
                      } @else {
                        {{ value(row, column.key) }}
                      }
                    </td>
                  }
                  @if (!readOnly()) { <td class="proposal-table__actions">
                    <div class="proposal-table__action-group">
                      <button type="button" class="proposal-table__action proposal-table__action--edit" [attr.aria-label]="'Edit row ' + (rowIndex + 1)" (click)="edit.emit(rowIndex)">
                        <span class="material-symbols-rounded" aria-hidden="true">edit</span>
                      </button>
                      <button type="button" class="proposal-table__action proposal-table__action--delete" [attr.aria-label]="'Delete row ' + (rowIndex + 1)" (click)="deleteRow.emit(rowIndex)">
                        <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                      </button>
                    </div>
                  </td> }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <div [id]="tableId() + '-counter'"><app-row-counter [count]="rows().length" [maximum]="maxRows()" /></div>
      @if (rows().length >= maxRows()) { <p class="proposal-table__limit" role="status">Maximum of {{ maxRows() }} rows reached.</p> }
    </section>
  `,
  styleUrl: './proposal-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalTableComponent {
  readonly tableId = input('proposal-table');
  readonly columns = input.required<readonly ProposalTableColumn[]>();
  readonly rows = input.required<readonly EditableRow[]>();
  readonly avatarKey = input<string | null>(null);
  // When set, this column renders a small thumbnail before its text. The image URL is read from
  // `row[imageKey() + 'ImageUrl']` — callers resolve option ids to image URLs into the row data
  // before passing it in (see event-proposal.ts's logisticsRowsWithImages()), keeping this
  // component dumb/presentational like every other column here.
  readonly imageKey = input<string | null>(null);
  readonly emptyMessage = input('No records have been added yet.');
  readonly emptyIcon = input('group_add');
  readonly loading = input(false);
  readonly maxRows = input(20);
  readonly readOnly = input(false);
  readonly edit = output<number>();
  readonly deleteRow = output<number>();

  rowId(row: EditableRow, index: number): string | number { return row['id'] ?? index; }
  value(row: EditableRow, key: string): string { return String(row[key] ?? '—'); }
  thumbnail(row: EditableRow): string { const key = this.imageKey(); return key ? String(row[`${key}ImageUrl`] ?? '') : ''; }
  initials(row: EditableRow): string {
    const key = this.avatarKey();
    const name = key ? String(row[key] ?? '').trim() : '';
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase() || '—';
  }
}
