import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ExpandableSearchComponent } from '../expandable-search/expandable-search';
import { OptionPickerItem } from './option-picker-grid.models';

// Image-aware alternative to app-searchable-dropdown, used only where the option list has a
// thumbnail worth showing (currently just Logistics' Item/Need field in the proposal form).
// Kept separate from SearchableDropdownComponent — that component is used everywhere else in
// the app (staff pickers, category pickers, every other select field) and its SelectOption type
// has no image field, so growing it here would risk unrelated UI.
const SEARCH_THRESHOLD = 8;

@Component({
  selector: 'app-option-picker-grid',
  imports: [ExpandableSearchComponent],
  templateUrl: './option-picker-grid.html',
  styleUrl: './option-picker-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionPickerGridComponent {
  readonly options = input.required<readonly OptionPickerItem[]>();
  readonly value = input('');
  readonly emptyMessage = input('No options available.');
  readonly ariaLabel = input('Choose an item');

  readonly valueChange = output<string>();

  readonly search = signal('');
  readonly failedImages = signal<Record<string, boolean>>({});

  readonly showSearch = computed(() => this.options().length > SEARCH_THRESHOLD);
  readonly filteredOptions = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.options();
    return this.options().filter((item) => item.label.toLowerCase().includes(term) || (item.description ?? '').toLowerCase().includes(term));
  });

  select(id: string): void { this.valueChange.emit(id); }
  onImageError(id: string): void { this.failedImages.update((map) => ({ ...map, [id]: true })); }
}
