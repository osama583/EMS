import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { OptionCardViewModel } from './option-card-grid.models';

@Component({
  selector: 'app-option-card-grid',
  templateUrl: './option-card-grid.html',
  styleUrl: './option-card-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionCardGridComponent {
  readonly items = input.required<readonly OptionCardViewModel[]>();
  readonly loading = input(false);
  readonly emptyTitle = input('No items found');
  readonly emptyDescription = input('Add an item or change the search and status filters.');

  readonly viewDetails = output<string>();
  readonly edit = output<string>();
  readonly toggleActive = output<string>();
  readonly delete = output<string>();

  readonly failedImages = signal<Record<string, boolean>>({});

  onImageError(id: string): void {
    this.failedImages.update((map) => ({ ...map, [id]: true }));
  }
}
