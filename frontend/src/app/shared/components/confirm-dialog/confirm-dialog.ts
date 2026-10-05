import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormModalComponent } from '../form-modal/form-modal';

@Component({
  selector: 'app-confirm-dialog',
  imports: [FormModalComponent],
  template: `
    <app-form-modal
      [open]="open()" [title]="title()" [primaryLabel]="confirmLabel()" [secondaryLabel]="cancelLabel()"
      [loading]="loading()" loadingLabel="Deleting…" [danger]="danger()"
      (close)="cancel.emit()" (cancel)="cancel.emit()" (submit)="confirm.emit()"
    >
      <p class="confirm-dialog__message">{{ message() }}</p>
    </app-form-modal>
  `,
  styles: `
    :host { display: contents; }
    .confirm-dialog__message { margin: 0; color: var(--apu-navy-900); font-size: .95rem; line-height: 1.55; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input('Confirm');
  readonly message = input('');
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly loading = input(false);
  readonly danger = input(true);
  readonly confirm = output<void>();
  readonly cancel = output<void>();
}
