import { ChangeDetectionStrategy, Component, ViewChild, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserAvatarComponent } from '../../../../shared/components/user-avatar/user-avatar';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { ForgotPasswordModalComponent } from '../../../../shared/components/forgot-password-modal/forgot-password-modal';

@Component({
  selector: 'app-profile',
  imports: [UserAvatarComponent, FormFieldComponent, ForgotPasswordModalComponent],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {
  @ViewChild('forgotPasswordModal') private readonly forgotPasswordModal?: ForgotPasswordModalComponent;
  private readonly auth = inject(AuthService);
  readonly user = this.auth.user;
  readonly details = computed(() => {
    const user = this.user();
    if (!user) return [];
    return [
      { label: 'Email', value: user.email },
      { label: 'Role', value: user.roleLabel },
      { label: 'Department', value: user.department },
    ];
  });

  readonly oldPassword = signal('');
  readonly newPassword = signal('');
  readonly changingPassword = signal(false);
  readonly passwordChangeMessage = signal('');
  readonly passwordChangeSucceeded = signal(false);
  private readonly wrongOldPassword = signal(false);

  readonly oldPasswordError = computed(() => this.wrongOldPassword() ? 'Your current password is incorrect.' : '');
  readonly newPasswordError = computed(() =>
    this.newPassword() && this.newPassword().length < 8 ? 'Password must contain at least 8 characters.' : '',
  );
  readonly passwordFormValid = computed(() =>
    !!this.oldPassword() && this.newPassword().length >= 8,
  );

  setOldPassword(value: string): void {
    this.oldPassword.set(value);
    this.wrongOldPassword.set(false);
    this.passwordChangeMessage.set('');
  }

  setNewPassword(value: string): void {
    this.newPassword.set(value);
    this.passwordChangeMessage.set('');
  }

  submitPasswordChange(): void {
    if (!this.passwordFormValid()) return;
    this.changingPassword.set(true);
    this.wrongOldPassword.set(false);
    this.passwordChangeMessage.set('');
    this.auth.changeOwnPassword(this.oldPassword(), this.newPassword()).subscribe((result) => {
      this.changingPassword.set(false);
      if (!result.success) {
        this.passwordChangeSucceeded.set(false);
        this.passwordChangeMessage.set(result.message);
        // The backend gives an identical message for "wrong old password" —
        // surface it as a field-level error too, matching how every other
        // form in the app shows validation, not just a banner.
        if (/current password is incorrect/i.test(result.message)) this.wrongOldPassword.set(true);
        return;
      }
      this.passwordChangeSucceeded.set(true);
      this.passwordChangeMessage.set('Your password has been updated. A confirmation has been sent to your email.');
      this.oldPassword.set('');
      this.newPassword.set('');
    });
  }

  openForgotPassword(): void {
    this.forgotPasswordModal?.show(this.user()?.email ?? '');
  }
}
