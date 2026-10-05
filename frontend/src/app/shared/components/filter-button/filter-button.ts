import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-filter-button',
  template: `
    <button
      type="button"
      class="shared-filter-button"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-expanded]="expanded() === null ? null : expanded()"
      (click)="triggered.emit()"
    >
      <span class="shared-filter-button__icon material-symbols-rounded" aria-hidden="true">
        tune
      </span>
      <span class="shared-filter-button__label">{{ label() }}</span>
      @if (count() > 0) {
        <span class="shared-filter-button__count">{{ count() }}</span>
      }
    </button>
  `,
  styleUrl: './filter-button.scss',
  host: { class: 'shared-filter-button-host' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterButtonComponent {
  readonly label = input('Filters');
  readonly ariaLabel = input('Open filters');
  readonly count = input(0);
  readonly expanded = input<boolean | null>(null);
  readonly triggered = output<void>();
}
