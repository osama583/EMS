import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { GuestRegistrationFlowService } from '../../../core/auth/external-registration.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthUser } from '../../../core/auth/auth.models';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { roleCanUseSavedEvents } from '../../../core/auth/role-navigation';
import { FormFieldComponent } from '../../../shared/components/form-controls/form-field';
import { GuestRegistrationModalComponent } from '../../../shared/components/guest-registration-modal/guest-registration-modal';

@Component({
  selector: 'app-login',
  imports: [FormFieldComponent, GuestRegistrationModalComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly guestFlow = inject(GuestRegistrationFlowService);
  private readonly savedEvents = inject(SavedEventsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private messageIndex = 0;
  private deleting = false;

  readonly messages = [
    'Take every event from idea to successful delivery.',
    'Coordinate approvals, services and responsibilities clearly.',
    'Keep event progress visible, accountable and on track.',
  ];
  readonly typedMessage = signal('');
  readonly reducedMotion = signal(false);
  readonly email = signal('');
  readonly password = signal('');
  readonly emailError = signal('');
  readonly passwordError = signal('');
  readonly loginError = signal('');
  readonly submitting = signal(false);
  readonly year = new Date().getFullYear();

  constructor() {
    const prefersReducedMotion = this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.reducedMotion.set(prefersReducedMotion);
    if (prefersReducedMotion) this.typedMessage.set(this.messages[0]);
    else this.timer = setTimeout(() => this.tickTypewriter(), 420);
  }

  setEmail(value: string): void { this.email.set(value); if (/^\S+@\S+\.\S+$/.test(value)) this.emailError.set(''); this.loginError.set(''); }
  setPassword(value: string): void { this.password.set(value); if (value) this.passwordError.set(''); this.loginError.set(''); }

  openRegister(): void { this.guestFlow.requestRegistration(); this.guestFlow.open.set(true); }

  submit(): void {
    const email = this.email().trim();
    const password = this.password();
    this.emailError.set(!email ? 'Email is required.' : !/^\S+@\S+\.\S+$/.test(email) ? 'Email must be a valid email address.' : '');
    this.passwordError.set(!password ? 'Password is required.' : '');
    if (this.emailError() || this.passwordError()) return;
    this.submitting.set(true);
    this.auth.login(email, password).subscribe({
      next: (result) => {
        this.submitting.set(false);
        if (!result.success) { this.loginError.set(result.message); return; }
        this.completeAuthentication(result.user);
      },
      error: () => {
        this.submitting.set(false);
        this.loginError.set('Something went wrong. Please try again.');
      },
    });
  }

  private completeAuthentication(user: AuthUser): void {
    const pendingEventId = this.guestFlow.pendingEventId();
    const requested = this.route.snapshot.queryParamMap.get('returnUrl');

    this.savedEvents.refresh();

    if (pendingEventId && roleCanUseSavedEvents(user)) {
      this.savedEvents.saveEvent(user.email, pendingEventId).subscribe();
    }

    this.guestFlow.close();

    const destination = requested && this.auth.canAccess(requested) ? requested : this.auth.defaultRoute();
    void this.router.navigateByUrl(destination, { replaceUrl: true });
  }

  private tickTypewriter(): void {
    const message = this.messages[this.messageIndex];
    const current = this.typedMessage();
    if (!this.deleting && current.length < message.length) {
      this.typedMessage.set(message.slice(0, current.length + 1));
      this.timer = setTimeout(() => this.tickTypewriter(), 58);
      return;
    }
    if (!this.deleting) { this.deleting = true; this.timer = setTimeout(() => this.tickTypewriter(), 2100); return; }
    if (current.length) { this.typedMessage.set(current.slice(0, -1)); this.timer = setTimeout(() => this.tickTypewriter(), 28); return; }
    this.deleting = false;
    this.messageIndex = (this.messageIndex + 1) % this.messages.length;
    this.timer = setTimeout(() => this.tickTypewriter(), 350);
  }

  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); }
}
