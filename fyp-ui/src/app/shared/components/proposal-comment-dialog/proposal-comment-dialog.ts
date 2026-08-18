import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormModalComponent } from '../form-modal/form-modal';
import { FormFieldComponent } from '../form-controls/form-field';

// Shared reject-reason / resubmit-comment dialog — used by the Full Reviewer view (reject reason,
// resubmit comment) and the Department Manager view (resubmit comment). Owns its own textarea and
// only allows confirming once a non-empty comment has been entered.
@Component({
  selector: 'app-proposal-comment-dialog',
  imports: [FormModalComponent, FormFieldComponent],
  template: `
    <app-form-modal
      [open]="open()"
      [title]="title()"
      [primaryLabel]="confirmLabel()"
      [danger]="danger()"
      [loading]="loading()"
      [disabled]="!isValid()"
      (close)="cancel.emit()"
      (cancel)="cancel.emit()"
      (submit)="confirm.emit(comment().trim())"
    >
      @if (message()) { <p class="proposal-comment-dialog__message">{{ message() }}</p> }
      <app-form-field
        controlId="proposal-comment-dialog-textarea"
        [label]="label()"
        type="textarea"
        [required]="true"
        [maxLength]="600"
        [minLength]="minLength()"
        [value]="comment()"
        (valueChange)="comment.set($event)"
      />
    </app-form-modal>
  `,
  styleUrl: './proposal-comment-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalCommentDialogComponent {
  readonly open = input(false);
  readonly title = input('Add a comment');
  readonly message = input('');
  readonly label = input('Comment');
  readonly confirmLabel = input('Confirm');
  readonly danger = input(false);
  readonly loading = input(false);
  // Minimum trimmed-character count required before Confirm enables (beyond plain non-empty).
  readonly minLength = input<number | null>(null);
  readonly confirm = output<string>();
  readonly cancel = output<void>();

  readonly comment = signal('');
  readonly isValid = computed(() => {
    const trimmed = this.comment().trim();
    const minLength = this.minLength();
    return trimmed.length > 0 && (minLength === null || trimmed.length >= minLength);
  });

  constructor() {
    effect(() => { if (!this.open()) this.comment.set(''); });
  }
}
