import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  input,
  output,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-expandable-search',
  template: `
    <div class="shared-expandable-search" [class.shared-expandable-search--open]="expanded()">
      <button
        type="button"
        class="shared-expandable-search__toggle"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-expanded]="expanded()"
        (click)="open()"
      >
        <span class="material-symbols-rounded" aria-hidden="true">search</span>
      </button>

      <label class="shared-expandable-search__field">
        <span class="visually-hidden">{{ ariaLabel() }}</span>
        <input
          #searchInput
          type="search"
          [attr.aria-label]="ariaLabel()"
          [placeholder]="placeholder()"
          [value]="value()"
          (input)="onInput($event)"
          (focus)="expanded.set(true)"
        />
        @if (value()) {
          <button type="button" class="shared-expandable-search__clear" aria-label="Clear search" (click)="clear()">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        }
      </label>
    </div>
  `,
  styleUrl: './expandable-search.scss',
  host: { class: 'shared-expandable-search-host' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpandableSearchComponent {
  readonly ariaLabel = input('Search');
  readonly placeholder = input('Search');
  readonly value = input('');
  readonly valueChange = output<string>();

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly expanded = signal(false);

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.expanded() && !this.value() && !this.host.nativeElement.contains(event.target as Node)) {
      this.expanded.set(false);
    }
  }

  open(): void {
    this.expanded.set(true);
    queueMicrotask(() => this.searchInput?.nativeElement.focus());
  }

  onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }

  clear(): void {
    this.valueChange.emit('');
    this.searchInput?.nativeElement.focus();
  }
}
