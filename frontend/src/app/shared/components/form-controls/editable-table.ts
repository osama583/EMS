import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { EditableRow, EditableTableColumn, SelectOption, StaffOption } from './form-controls.models';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';
import { ValidationMessageComponent } from '../validation-message/validation-message';

@Component({
  selector: 'app-data-table',
  imports: [SearchableDropdownComponent, ValidationMessageComponent],
  template: `
    <section class="shared-editable-table" [id]="tableId()" [class.shared-editable-table--invalid]="error()">
      @if (showHeading()) {
        <div class="shared-editable-table__heading">
          <div>
            <h3>{{ title() }}</h3>
            @if (hint()) { <p>{{ hint() }}</p> }
          </div>
          @if (showAddButton()) {
            <button type="button" class="table-control" [disabled]="maxRows() > 0 && rows().length >= maxRows()" (click)="add.emit()">
              <span class="material-symbols-rounded" aria-hidden="true">add</span> Add row
            </button>
          }
        </div>
      }

      <div class="shared-editable-table__desktop">
        <table class="shared-data-table">
          <thead><tr>@for (column of columns(); track column.key) { <th [style.width]="column.width ?? null">{{ column.label }}</th> }<th data-actions>Action</th></tr></thead>
          <tbody>
            @for (row of rows(); track rowId(row, $index); let rowIndex = $index) {
              <tr>
                @for (column of columns(); track column.key) {
                  <td [id]="tableId() + '-' + rowIndex + '-' + column.key">
                    @if (column.type === 'select') {
                      <app-searchable-dropdown [placeholder]="column.placeholder ?? 'Select'" [options]="optionsFor(column, row)" [value]="stringValue(row[column.key])" [required]="column.required ?? false" [errorLabel]="column.label" [error]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (valueChange)="changeValue(rowIndex, column, $event)" />
                    } @else if (column.type === 'staff') {
                      <app-searchable-dropdown placeholder="Search staff" [options]="staffOptions()" [value]="stringValue(row[column.key])" [required]="column.required ?? false" [errorLabel]="column.label" [error]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (valueChange)="changeValue(rowIndex, column, $event)" />
                    } @else if (column.type === 'readonly') {
                      <input type="text" [value]="row[column.key]" [attr.aria-label]="column.label" readonly />
                    } @else if (column.type === 'textarea') {
                      <textarea rows="2" [value]="row[column.key]" [attr.aria-label]="column.label" [placeholder]="column.placeholder ?? ''" [class.is-invalid]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (blur)="markTouched(rowIndex, column.key)" (input)="change(rowIndex, column, $event)"></textarea>
                    } @else {
                      <input [type]="column.type" [value]="row[column.key]" [attr.aria-label]="column.label" [placeholder]="column.placeholder ?? ''" [min]="column.min ?? null" [step]="column.step ?? null" [readOnly]="column.readOnly" [class.is-invalid]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (blur)="markTouched(rowIndex, column.key)" (input)="change(rowIndex, column, $event)" />
                    }
                    <app-validation-message [controlId]="tableId() + '-' + rowIndex + '-' + column.key" [message]="cellError(rowIndex, column.key)" />
                  </td>
                }
                <td data-actions><button type="button" class="shared-editable-table__delete" [attr.aria-label]="'Remove row ' + (rowIndex + 1)" (click)="remove.emit(rowIndex)"><span class="material-symbols-rounded" aria-hidden="true">delete</span></button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="shared-editable-table__mobile">
        @for (row of rows(); track rowId(row, $index); let rowIndex = $index) {
          <article>
            <span class="shared-editable-table__mobile-number">Row {{ rowIndex + 1 }}</span>
            @for (column of columns(); track column.key) {
              <label [id]="tableId() + '-' + rowIndex + '-' + column.key + '-mobile'"><span>{{ column.label }} @if (column.required) { <b>*</b> }</span>
                @if (column.type === 'select') {
                    <app-searchable-dropdown [options]="optionsFor(column, row)" [value]="stringValue(row[column.key])" [required]="column.required ?? false" [errorLabel]="column.label" [error]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (valueChange)="changeValue(rowIndex, column, $event)" />
                } @else if (column.type === 'staff') {
                    <app-searchable-dropdown [options]="staffOptions()" [value]="stringValue(row[column.key])" [required]="column.required ?? false" [errorLabel]="column.label" [error]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (valueChange)="changeValue(rowIndex, column, $event)" />
                } @else {
                  <input [type]="mobileInputType(column)" [value]="row[column.key]" [readOnly]="column.type === 'readonly' || column.readOnly" [class.is-invalid]="cellError(rowIndex, column.key)" (pointerup)="markTouched(rowIndex, column.key)" (blur)="markTouched(rowIndex, column.key)" (input)="change(rowIndex, column, $event)" />
                }
                <app-validation-message [controlId]="tableId() + '-' + rowIndex + '-' + column.key + '-mobile'" [message]="cellError(rowIndex, column.key)" />
              </label>
            }
            <button type="button" class="shared-editable-table__remove-mobile" (click)="remove.emit(rowIndex)"><span class="material-symbols-rounded" aria-hidden="true">delete</span> Remove row</button>
          </article>
        }
      </div>
      @if (staff().length) { <datalist [id]="tableId() + '-staff'">@for (person of staff(); track person.value) { <option [value]="person.label">{{ person.email }} — {{ person.role }}</option> }</datalist> }
      <app-validation-message [controlId]="tableId()" [message]="error()" />
      @if (footerValue()) { <div class="shared-editable-table__total"><span>{{ footerLabel() }}</span><strong>{{ footerValue() }}</strong></div> }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataTableComponent {
  readonly tableId = input.required<string>();
  readonly title = input.required<string>();
  readonly hint = input('');
  readonly columns = input.required<readonly EditableTableColumn[]>();
  readonly rows = input.required<readonly EditableRow[]>();
  readonly staff = input<readonly StaffOption[]>([]);
  readonly maxRows = input(0);
  readonly error = input('');
  readonly errors = input<Readonly<Record<string, string>>>({});
  readonly footerLabel = input('');
  readonly footerValue = input('');
  readonly showHeading = input(true);
  readonly showAddButton = input(true);
  readonly rowsChange = output<readonly EditableRow[]>();
  readonly add = output<void>();
  readonly remove = output<number>();
  readonly touchedCells = signal<ReadonlySet<string>>(new Set());

  rowId(row: EditableRow, index: number): string | number { return row['id'] ?? index; }
  cellError(row: number, key: string): string {
    const error = this.errors()[`${row}.${key}`];
    if (error) return error;
    const column = this.columns().find((item) => item.key === key);
    const touched = this.touchedCells().has(`${row}.${key}`);
    return column?.required && touched && !String(this.rows()[row]?.[key] ?? '').trim() ? `${column.label} is required.` : '';
  }
  markTouched(row: number, key: string): void { this.touchedCells.update((current) => new Set(current).add(`${row}.${key}`)); }
  optionsFor(column: EditableTableColumn, row: EditableRow): readonly SelectOption[] {
    return column.parentKey ? column.dependentOptions?.[String(row[column.parentKey] ?? '')] ?? [] : column.options ?? [];
  }
  staffOptions(): readonly SelectOption[] { return this.staff().map((person) => ({ value: person.label, label: person.label, description: `${person.email} — ${person.role}` })); }
  stringValue(value: string | number | undefined): string { return String(value ?? ''); }
  mobileInputType(column: EditableTableColumn): string { return ['select', 'staff', 'readonly', 'textarea'].includes(column.type) ? 'text' : column.type; }
  change(rowIndex: number, column: EditableTableColumn, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    this.changeValue(rowIndex, column, target.value);
  }
  changeValue(rowIndex: number, column: EditableTableColumn, incoming: string | readonly string[]): void {
    const value = Array.isArray(incoming) ? incoming[0] ?? '' : incoming;
    const next = this.rows().map((row, index) => index === rowIndex ? { ...row, [column.key]: value } : row);
    if (column.type === 'staff') {
      const person = this.staff().find((entry) => entry.label.toLowerCase() === value.trim().toLowerCase());
      next[rowIndex] = { ...next[rowIndex], email: person?.email ?? '', role: person?.role ?? '' };
    }
    this.columns().filter((item) => item.parentKey === column.key).forEach((child) => {
      next[rowIndex] = { ...next[rowIndex], [child.key]: '' };
    });
    this.rowsChange.emit(next);
  }
}
