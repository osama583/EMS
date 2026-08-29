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
  @ViewChild('oldPasswordField') private readonly oldPasswordField?: FormFieldComponent;
  @ViewChild('newPasswordField') private readonly newPasswordField?: FormFieldComponent;
  private readonly auth = inject(AuthService);
  readonly user = this.auth.user;
  readonly details = computed(() => {
    const user = this.user();
    if (!user) return [];
    return [{ label: 'Email', value: user.email }];
  });
  // Every (role, unit) pair this account holds, shown as its own tile — someone with more than one
  // role (e.g.
  readonly roleDetails = computed(() => {
    const user = this.user();
    if (!user || user.roles.length === 0) return [{ role: 'Unassigned', unit: null as string | null }];
    return user.roles.map((r) => ({ role: r.roleName, unit: r.unitDescription }));
  });

  readonly oldPassword = signal('');
  readonly newPassword = signal('');
  readonly changingPassword = signal(false);
  readonly passwordChangeMessage = signal('');
  readonly passwordChangeSucceeded = signal(false);
  private readonly wrongOldPassword = signal(false);

  readonly oldPasswordError = computed(() => this.wrongOldPassword() ? 'Your current password is incorrect.' : '');
  readonly newPasswordError = computed(() => {
    const newPassword = this.newPassword();
    if (!newPassword) return '';
    if (newPassword.length < 8) return 'Password must contain at least 8 characters.';
    if (newPassword === this.oldPassword()) return 'New password must be different from your current password.';
    return '';
  });
  readonly passwordFormValid = computed(() =>
    !!this.oldPassword() &&
    this.newPassword().length >= 8 &&
    this.newPassword() !== this.oldPassword(),
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
      // Clearing the signals empties the fields; without this they'd re-validate
      // against "required" using their own stale touched/submitted state and
      // show an error immediately after a successful update.
      this.oldPasswordField?.resetInteractionState();
      this.newPasswordField?.resetInteractionState();
    });
  }

  openForgotPassword(): void {
    this.forgotPasswordModal?.show(this.user()?.email ?? '', { lockEmail: true });
  }
}
