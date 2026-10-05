import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-character-counter',
  template: `<small class="shared-character-counter" [class.shared-character-counter--limit]="length() >= maxLength()" aria-live="polite">{{ length() }} / {{ maxLength() }}</small>`,
  styleUrl: './character-counter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CharacterCounterComponent {
  readonly value = input<string | number>('');
  readonly maxLength = input(100);
  length(): number { return String(this.value() ?? '').length; }
}
