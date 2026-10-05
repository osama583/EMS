import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { FormFieldComponent } from '../form-controls/form-field';
import { FormModalComponent } from '../form-modal/form-modal';

@Component({
  selector: 'app-forgot-password-modal',
  imports: [FormModalComponent, FormFieldComponent],
  template: `
    <app-form-modal
      [open]="open()"
      title="Reset your password"
      [primaryLabel]="sent() ? 'Done' : 'Send reset link'"
      [loading]="loading()"
      [disabled]="!emailLooksValid()"
      [showSecondary]="!sent()"
      (close)="close()"
      (cancel)="close()"
      (submit)="sent() ? close() : submit()"
    >
      @if (!sent()) {
        <div class="forgot-password-form">
          <p>We'll send a reset link to the email address on your account.</p>
          <app-form-field
            controlId="forgot-password-email" label="Email" type="email" autocomplete="email"
            [required]="true" [readOnly]="emailLocked()" [value]="email()" (valueChange)="email.set($event)"
          />
        </div>
      } @else {
        <div class="forgot-password-form forgot-password-form--sent">
          <span class="material-symbols-rounded forgot-password-form__icon" aria-hidden="true">mark_email_read</span>
          <p>{{ resultMessage() }}</p>
          <p class="forgot-password-form__hint">The link expires in 10 minutes. Check your spam folder if it doesn't arrive shortly.</p>
        </div>
      }
    </app-form-modal>
  `,
  styleUrl: './forgot-password-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordModalComponent {
  private readonly auth = inject(AuthService);

  readonly open = signal(false);
  readonly email = signal('');
  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly resultMessage = signal('');
  // Locked when opened for the signed-in user (their real, known email); editable
  // from the login page, where the prefill is just an unverified guess the visitor typed.
  readonly emailLocked = signal(false);

  readonly emailLooksValid = () => /^\S+@\S+\.\S+$/.test(this.email().trim());

  show(prefillEmail = '', options: { lockEmail?: boolean } = {}): void {
    this.email.set(prefillEmail);
    this.emailLocked.set(options.lockEmail ?? false);
    this.loading.set(false);
    this.sent.set(false);
    this.resultMessage.set('');
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  submit(): void {
    if (!this.emailLooksValid()) return;
    this.loading.set(true);
    this.auth.requestPasswordReset(this.email()).subscribe((message) => {
      this.loading.set(false);
      this.sent.set(true);
      this.resultMessage.set(message);
    });
  }
}
