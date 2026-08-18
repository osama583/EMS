import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

// Small anchored overlay for a short list/detail disclosure triggered by a click (e.g. a table
// badge showing "N grants"/"N items") — lighter than app-form-modal (no page-scroll lock, no
// footer/actions), but shares its backdrop-click-to-close and Escape-to-close conventions.
@Component({
  selector: 'app-popover',
  template: `
    @if (open()) {
      <div class="shared-popover__backdrop" (click)="close.emit()">
        <section class="shared-popover" role="dialog" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
          <header class="shared-popover__header">
            @if (icon()) { <span class="material-symbols-rounded" aria-hidden="true">{{ icon() }}</span> }
            <span class="shared-popover__title">{{ title() }}</span>
            <button type="button" class="shared-popover__close" aria-label="Close" (click)="close.emit()">
              <span class="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </header>
          <div class="shared-popover__body"><ng-content /></div>
        </section>
      </div>
    }
  `,
  styleUrl: './popover.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopoverComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly icon = input('');
  readonly close = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.open()) this.close.emit(); }
}
