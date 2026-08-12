import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GuestRegistrationFlowService } from '../../../core/auth/external-registration.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthUser, UserRole } from '../../../core/auth/auth.models';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import type { MockAuthRecord } from '../../../core/auth/mock-users';
import { roleCanUseSavedEvents } from '../../../core/auth/role-navigation';
import { FormFieldComponent } from '../../../shared/components/form-controls/form-field';
import { GuestRegistrationModalComponent } from '../../../shared/components/guest-registration-modal/guest-registration-modal';
import { environment } from '../../../../environments/environment';

interface DemoUserGroup { readonly label: string; readonly users: readonly MockAuthRecord[]; }

// Fixed display order (per request): students, then school/lecturer staff, then department
// staff, then HOS/HOD unit heads, then department/service managers, then their frontline staff.
// Roles not explicitly bucketed (Applicant, ClubPresident, ExternalUser, SystemAdmin) fall into
// "Other" at the end rather than being silently dropped.
const DEMO_GROUP_ORDER: readonly { label: string; roles: readonly UserRole[] }[] = [
  { label: 'Students', roles: [UserRole.Student] },
  { label: 'School Staff / Lecturers', roles: [UserRole.Lecturer] },
  { label: 'Department Staff', roles: [UserRole.Staff] },
  { label: 'HOS / HOD', roles: [UserRole.HosHod] },
  {
    label: 'Department Managers', roles: [
      UserRole.Cfo, UserRole.Fmb, UserRole.CafeteriaManager, UserRole.LogisticsManager,
      UserRole.StudentServicesManager, UserRole.AvManager, UserRole.PhotographyManager, UserRole.TransportManager,
    ],
  },
  {
    label: 'Service Unit Staff', roles: [
      UserRole.CafeteriaStaff, UserRole.CafeteriaAdmin, UserRole.LogisticsStaff,
      UserRole.StudentServicesMember, UserRole.AvTechnician, UserRole.PhotographyStaff, UserRole.TransportStaff,
    ],
  },
];

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
  readonly selectedDemoEmail = signal<string | null>(null);
  readonly demoAuthEnabled = environment.enableMockAuth;
  readonly demoUsers = environment.mockUsers;
  readonly demoSearch = signal('');
  readonly year = new Date().getFullYear();

  readonly demoGroups = computed<readonly DemoUserGroup[]>(() => {
    const query = this.demoSearch().trim().toLowerCase();
    const matches = (user: MockAuthRecord): boolean => !query
      || user.displayName.toLowerCase().includes(query)
      || user.email.toLowerCase().includes(query)
      || user.roleLabel.toLowerCase().includes(query)
      || user.department.toLowerCase().includes(query);

    const filtered = this.demoUsers.filter(matches);
    const bucketed = new Set<string>();
    const groups: DemoUserGroup[] = [];
    for (const { label, roles } of DEMO_GROUP_ORDER) {
      const users = filtered.filter((user) => roles.includes(user.role));
      users.forEach((user) => bucketed.add(user.email));
      if (users.length) groups.push({ label, users });
    }
    const other = filtered.filter((user) => !bucketed.has(user.email));
    if (other.length) groups.push({ label: 'Other', users: other });
    return groups;
  });

  setDemoSearch(value: string): void { this.demoSearch.set(value); }

  constructor() {
    const prefersReducedMotion = this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.reducedMotion.set(prefersReducedMotion);
    if (prefersReducedMotion) this.typedMessage.set(this.messages[0]);
    else this.timer = setTimeout(() => this.tickTypewriter(), 420);
  }

  setEmail(value: string): void { this.email.set(value); if (/^\S+@\S+\.\S+$/.test(value)) this.emailError.set(''); this.loginError.set(''); }
  setPassword(value: string): void { this.password.set(value); if (value) this.passwordError.set(''); this.loginError.set(''); }

  openRegister(): void { this.guestFlow.requestRegistration(); this.guestFlow.open.set(true); }

  selectDemoUser(user: MockAuthRecord): void {
    this.selectedDemoEmail.set(user.email);
    this.email.set(user.email);
    this.password.set(user.password);
    this.emailError.set('');
    this.passwordError.set('');
    this.loginError.set('');
  }

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

    if (pendingEventId && roleCanUseSavedEvents(user.role)) {
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
