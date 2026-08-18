import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ExternalRegistrationService, GuestRegistrationFlowService } from '../../../core/auth/external-registration.service';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { FormFieldComponent } from '../form-controls/form-field';
import { FormModalComponent } from '../form-modal/form-modal';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthUser } from '../../../core/auth/auth.models';
import { roleCanUseSavedEvents } from '../../../core/auth/role-navigation';

@Component({
  selector: 'app-guest-registration-modal',
  imports: [FormModalComponent, FormFieldComponent],
  template: `
    <app-form-modal
      [open]="flow.open()"
      [title]="stage() === 'login' ? 'Sign in to APU Events' : stage() === 'details' ? 'Create your event account' : 'Verify your email'"
      [primaryLabel]="stage() === 'login' ? 'Sign In' : stage() === 'details' ? 'Continue' : 'Verify & Continue'"
      [loading]="loading()"
      [disabled]="stage() === 'login' ? false : !formValid()"
      (close)="close()"
      (cancel)="close()"
      (submit)="submit()"
    >
      @if (stage() === 'login') {
        <div class="guest-registration-form">
          <p class="guest-registration-form__intro">Sign in to save events, manage registrations and keep your reminders.</p>
          <div class="guest-registration-form__grid guest-registration-form__grid--single">
            <app-form-field controlId="guest-login-email" label="Email" type="email" autocomplete="email" [required]="true" [value]="email()" [error]="emailError()" (valueChange)="setEmail($event)" />
            <app-form-field controlId="guest-login-password" label="Password" type="password" autocomplete="current-password" [required]="true" [value]="password()" [error]="passwordError()" (valueChange)="setPassword($event)" />
          </div>
          @if (serviceError()) { <p class="guest-registration-form__error" role="alert">{{ serviceError() }}</p> }
          <div class="guest-registration-form__switch">
            <span>New to APU Events?</span>
            <button type="button" (click)="openRegistration()">Register</button>
          </div>
        </div>
      } @else if (stage() === 'details') {
        <div class="guest-registration-form">
          <p class="guest-registration-form__intro">Create a free account to save events and return to them later.</p>
          <div class="guest-registration-form__grid">
            <app-form-field controlId="external-email" label="Email" type="email" autocomplete="email" [required]="true" [value]="email()" (valueChange)="email.set($event)" />
            <app-form-field controlId="external-first-name" label="First name" autocomplete="given-name" [required]="true" [value]="firstName()" (valueChange)="firstName.set($event)" />
            <app-form-field controlId="external-last-name" label="Last name" autocomplete="family-name" [required]="true" [value]="lastName()" (valueChange)="lastName.set($event)" />
            <app-form-field controlId="external-age" label="Age" type="number" min="13" [required]="true" [value]="age()" [error]="ageError()" (valueChange)="age.set($event)" />
            <app-form-field controlId="external-gender" label="Gender" [required]="true" [value]="gender()" [options]="genderOptions" (valueChange)="gender.set($event)" />
            <app-form-field class="guest-registration-form__wide" controlId="external-password" label="Password" type="password" autocomplete="new-password" [required]="true" [value]="password()" [error]="passwordError()" hint="Use at least 8 characters." (valueChange)="password.set($event)" />
          </div>
          <div class="guest-registration-form__switch">
            <span>Already registered?</span>
            <button type="button" (click)="openSignIn()">Sign in</button>
          </div>
        </div>
      } @else {
        <div class="guest-registration-form guest-registration-form--otp">
          <p>Enter the verification code for <strong>{{ maskedEmail() }}</strong>.</p>
          @if (developmentOtp()) {
            <aside class="guest-registration-form__development" role="note">
              <span>Development OTP</span>
              <strong>{{ developmentOtp() }}</strong>
            </aside>
          }
          <app-form-field controlId="external-otp" label="Verification code" inputmode="numeric" [required]="true" [value]="otp()" [maxLength]="6" [error]="otpError()" (valueChange)="setOtp($event)" />
          @if (serviceError()) { <p class="guest-registration-form__error" role="alert">{{ serviceError() }}</p> }
        </div>
      }
    </app-form-modal>
  `,
  styleUrl: './guest-registration-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestRegistrationModalComponent {
  readonly flow = inject(GuestRegistrationFlowService);
  private readonly auth = inject(AuthService);
  private readonly registration = inject(ExternalRegistrationService);
  private readonly savedEvents = inject(SavedEventsService);
  private readonly router = inject(Router);

  readonly stage = signal<'login' | 'details' | 'otp'>('login');
  readonly email = signal('');
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly age = signal('');
  readonly gender = signal('');
  readonly password = signal('');
  readonly otp = signal('');
  readonly challengeId = signal('');
  readonly maskedEmail = signal('');
  readonly developmentOtp = signal('');
  readonly serviceError = signal('');
  readonly emailError = signal('');
  readonly loginPasswordError = signal('');
  readonly loading = signal(false);
  readonly genderOptions = [
    { value: 'Female', label: 'Female' },
    { value: 'Male', label: 'Male' },
    { value: 'Non-binary', label: 'Non-binary' },
    { value: 'Prefer not to say', label: 'Prefer not to say' },
  ];

  readonly ageError = computed(() => this.age() && Number(this.age()) < 13 ? 'Age must be at least 13.' : '');
  readonly passwordError = computed(() => this.stage() === 'login'
    ? this.loginPasswordError()
    : this.password() && this.password().length < 8 ? 'Password must contain at least 8 characters.' : '');
  readonly otpError = computed(() => this.otp() && !/^\d{6}$/.test(this.otp()) ? 'Verification code must contain 6 digits.' : '');
  readonly formValid = computed(() => this.stage() === 'details'
    ? /^\S+@\S+\.\S+$/.test(this.email().trim()) && !!this.firstName().trim() && !!this.lastName().trim() && Number(this.age()) >= 13 && !!this.gender() && this.password().length >= 8
    : /^\d{6}$/.test(this.otp()));

  constructor() {
    effect(() => {
      if (this.flow.open()) this.stage.set(this.flow.initialView() === 'register' ? 'details' : 'login');
    });
  }

  submit(): void {
    this.serviceError.set('');
    if (this.stage() === 'login') { this.signIn(); return; }
    if (this.stage() === 'details') { this.startVerification(); return; }
    this.verify();
  }

  setOtp(value: string): void { this.otp.set(value.replace(/\D/g, '').slice(0, 6)); this.serviceError.set(''); }
  setEmail(value: string): void { this.email.set(value); if (/^\S+@\S+\.\S+$/.test(value)) this.emailError.set(''); this.serviceError.set(''); }
  setPassword(value: string): void { this.password.set(value); if (value) this.loginPasswordError.set(''); this.serviceError.set(''); }
  openRegistration(): void { this.stage.set('details'); this.clearValidation(); }
  openSignIn(): void { this.stage.set('login'); this.clearValidation(); }

  close(): void { this.flow.close(); this.reset(); }

  private startVerification(): void {
    this.loading.set(true);
    this.registration.registerExternalUser({
      email: this.email(), firstName: this.firstName(), lastName: this.lastName(), age: Number(this.age()), gender: this.gender(), password: this.password(),
    }).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.challengeId.set(response.challengeId);
        this.maskedEmail.set(response.maskedEmail);
        this.developmentOtp.set(response.developmentOtp ?? '');
        this.stage.set('otp');
      },
      error: () => { this.loading.set(false); this.serviceError.set('Registration could not be started. Please try again.'); },
    });
  }

  private signIn(): void {
    const email = this.email().trim();
    const password = this.password();
    this.emailError.set(!email ? 'Email is required.' : !/^\S+@\S+\.\S+$/.test(email) ? 'Email must be a valid email address.' : '');
    this.loginPasswordError.set(!password ? 'Password is required.' : '');
    if (this.emailError() || this.loginPasswordError()) return;
    this.loading.set(true);
    this.auth.login(email, password).subscribe({
      next: (result) => {
        this.loading.set(false);
        if (!result.success) { this.serviceError.set(result.message); return; }
        this.completeAuthentication(result.user);
      },
      error: () => {
        this.loading.set(false);
        this.serviceError.set('Something went wrong. Please try again.');
      },
    });
  }

  private verify(): void {
    this.loading.set(true);
    this.registration.verifyOtp({ challengeId: this.challengeId(), otp: this.otp() }).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.status !== 'verified' || !response.user) { this.serviceError.set(response.message); return; }
        this.completeAuthentication(response.user);
      },
      error: () => { this.loading.set(false); this.serviceError.set('Verification could not be completed.'); },
    });
  }

  private reset(): void {
    this.stage.set('login'); this.email.set(''); this.firstName.set(''); this.lastName.set(''); this.age.set(''); this.gender.set('');
    this.password.set(''); this.otp.set(''); this.challengeId.set(''); this.maskedEmail.set(''); this.developmentOtp.set('');
    this.serviceError.set(''); this.loading.set(false);
    this.emailError.set(''); this.loginPasswordError.set('');
  }

  private clearValidation(): void { this.emailError.set(''); this.loginPasswordError.set(''); this.serviceError.set(''); }
  private completeAuthentication(user: AuthUser): void {
    const eventId = this.flow.pendingEventId();
    const requestedUrl = this.flow.returnUrl();
    this.savedEvents.refresh();
    if (eventId && roleCanUseSavedEvents(user)) this.savedEvents.saveEvent(user.email, eventId).subscribe();
    this.flow.close();
    this.reset();
    const destination = user.accountType === 'internal'
      ? this.auth.defaultRoute()
      : requestedUrl && requestedUrl.startsWith('/my-events') ? requestedUrl : '/';
    void this.router.navigateByUrl(destination, { replaceUrl: true });
  }
}
