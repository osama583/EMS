import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-proposal-field',
  template: `
    <article class="prv-field">
      <span class="prv-field__label">{{ label() }}</span>
      <strong class="prv-field__value">{{ value() }}</strong>
    </article>
  `,
  styleUrl: './proposal-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalFieldComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
}
