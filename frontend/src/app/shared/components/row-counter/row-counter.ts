import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-row-counter',
  template: `<p class="shared-row-counter" aria-live="polite" [attr.aria-label]="count() + ' of ' + maximum() + ' rows'">{{ count() }}<span aria-hidden="true"> / {{ maximum() }}</span></p>`,
  styleUrl: './row-counter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowCounterComponent {
  readonly count = input(0);
  readonly maximum = input(20);
}
