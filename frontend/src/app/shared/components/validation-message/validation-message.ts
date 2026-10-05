import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-validation-message',
  template: `
    @if (message()) {
      <small class="shared-validation-message" [id]="controlId() ? controlId() + '-error' : null" role="alert">
        <span class="material-symbols-rounded" aria-hidden="true">warning</span>
        <span>{{ message() }}</span>
      </small>
    }
  `,
  styleUrl: './validation-message.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValidationMessageComponent {
  readonly controlId = input('');
  readonly message = input('');
}
