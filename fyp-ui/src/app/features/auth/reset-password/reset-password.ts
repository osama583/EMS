import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { FormFieldComponent } from '../../../shared/components/form-controls/form-field';

type Stage = 'form' | 'success' | 'invalid';

@Component({
  selector: 'app-reset-password',
  imports: [FormFieldComponent],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly token = signal('');
  readonly stage = signal<Stage>('form');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly submitting = signal(false);
  readonly serverMessage = signal('');

  readonly passwordError = computed(() =>
    this.password() && this.password().length < 8 ? 'Password must contain at least 8 characters.' : '',
  );
  readonly confirmError = computed(() =>
    this.confirmPassword() && this.confirmPassword() !== this.password() ? 'Passwords do not match.' : '',
  );
  readonly formValid = computed(() =>
    this.password().length >= 8 && this.confirmPassword() === this.password(),
  );
  readonly year = new Date().getFullYear();

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.stage.set('invalid');
      this.serverMessage.set('This reset link is missing its verification code. Please request a new one.');
      return;
    }
    this.token.set(token);
  }

  submit(): void {
    if (!this.formValid()) return;
    this.submitting.set(true);
    this.auth.confirmPasswordReset(this.token(), this.password()).subscribe((result) => {
      this.submitting.set(false);
      this.serverMessage.set(result.message);
      this.stage.set(result.status === 'reset' ? 'success' : 'invalid');
    });
  }

  goToLogin(): void {
    void this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
