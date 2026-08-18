import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { isClubPresident } from '../../../../core/auth/role-navigation';
import { requestKindsForRole } from '../../../../core/departments/department-workflow.config';
import { staffTaskRoutingKeyFor } from '../../../../core/staff-tasks/staff-task-routing';
import { PublishedEventService } from '../../../../core/events/published-event.service';

export type RecordsHubBucket = 'inbox' | 'ongoing' | 'history';

// Single shell reused for the 3 unified nav entries (Inbox / Ongoing / History) — replaces the
// old separate InboxComponent, RecordsPageComponent's pending/history/request-ongoing/
// request-history kinds, and StaffTasksComponent's own top-level routes. Which tabs render is
// entirely driven by the logged-in viewer's own roles/data (see the show* computeds below) — the
// route/URL/label are the same for every user, only the tab strip and each tab's contents differ.
@Component({
  selector: 'app-records-hub',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './records-hub.html',
  styleUrl: './records-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordsHubComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly events = inject(PublishedEventService);
  private readonly destroyRef = inject(DestroyRef);

  readonly bucket = this.route.snapshot.data['bucket'] as RecordsHubBucket;

  // Proposals tab: every applicant-like user (their own proposals) and every reviewer/department
  // owner (proposals routed to them) has a place in this bucket — see proposal-visibility.ts.
  // Effectively everyone except a pure flat admin (system-admin/cafeteria-admin with no unit),
  // so this is left unconditional rather than re-deriving proposal-visibility's own logic here.
  readonly showProposalsTab = true;

  // Tasks tab: only for staff-task-routed roles (the 5 Service-department-routed unit staff plus
  // cafeteria-staff — see staff-task-routing.ts), and only for Inbox/History — tasks have no
  // separate "in progress but not actionable" state (StaffTasksComponent's own filtered() splits
  // strictly on status === 'completed' vs not), so there's nothing to show on Ongoing.
  readonly showTasksTab = computed(() => {
    const user = this.auth.user();
    return this.bucket !== 'ongoing' && !!user && staffTaskRoutingKeyFor(user) !== null;
  });

  // Requests tab: only for roles that own at least one department-request kind (reviewers/
  // department staff — see department-workflow.config.ts's requestKindsForRole).
  readonly showRequestsTab = computed(() => {
    const user = this.auth.user();
    return !!user && requestKindsForRole(user).length > 0;
  });

  // Registrations tab: Inbox only, and only once the viewer actually has registrations waiting
  // on them (manual-approval events they own). Resolved from the server rather than guessed from
  // roles — any account can own an event with registration_approval = 'manual'.
  readonly showRegistrationsTab = computed(() => this.bucket === 'inbox' && this.pendingRegistrationCount() > 0);
  private readonly pendingRegistrationCount = signal(0);

  readonly showClubRequestsTab = computed(() => {
    const user = this.auth.user();
    return this.bucket === 'inbox' && !!user && isClubPresident(user);
  });

  readonly title = this.bucket === 'inbox' ? 'Inbox' : this.bucket === 'ongoing' ? 'Ongoing' : 'History';

  constructor() {
    const email = this.auth.user()?.email;
    if (this.bucket !== 'inbox' || !email) return;
    this.events.getMyPendingRegistrations(email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => this.pendingRegistrationCount.set(rows.length),
      // A failed count simply hides the tab — the page it would open is reachable by URL anyway.
      error: () => this.pendingRegistrationCount.set(0),
    });
  }
}
