import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AuthUser } from '../../../../core/auth/auth.models';
import { hasRole, isHeadOfAnyUnit } from '../../../../core/auth/role-access';
import { isClubPresident } from '../../../../core/auth/role-navigation';
import { requestKindsForRole } from '../../../../core/departments/department-workflow.config';
import { staffTaskRoutingKeyFor } from '../../../../core/staff-tasks/staff-task-routing';

// Whether the viewer holds the 'club-admin' role specifically, not merely AuthUser.isClubAdmin (which
// is also true for a System Admin — is_admin OR has_role('club-admin') server-side).
function isClubAdminRole(user: AuthUser | null): boolean {
  return !!user && hasRole(user, 'club-admin');
}

export type RecordsHubBucket = 'inbox' | 'ongoing' | 'history';

// Single shell reused for the 3 unified nav entries (Inbox / Ongoing / History) — replaces the old
// separate InboxComponent, RecordsPageComponent's pending/history/request-ongoing/ request-history
// kinds, and StaffTasksComponent's own top-level routes.
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly bucket = this.route.snapshot.data['bucket'] as RecordsHubBucket;

  // Cafeteria staff (the 'cafeteria-staff' role, not the manager) run the shared-pool food-order queue
  // only — they never author proposals, own a department-request kind, organise events, or review club
  // join requests, so every OTHER tab is hidden for them regardless of what its own rule would
  // otherwise compute (F&B's request-kind resolution would otherwise leak a Requests tab in, for
  // instance).
  private readonly isCafeteriaStaffOnly = computed(() => {
    const user = this.auth.user();
    return !!user && hasRole(user, 'cafeteria-staff');
  });

  // Proposals tab: every applicant-like user (their own proposals) and every reviewer/department owner
  // (proposals routed to them) has a place in this bucket — see proposal-visibility.ts.
  readonly showProposalsTab = computed(() => !this.isCafeteriaStaffOnly() && !isClubAdminRole(this.auth.user()));

  // Tasks tab: only for staff-task-routed roles (the 5 Service-department-routed unit staff plus
  // cafeteria-staff — see staff-task-routing.ts), and only for Inbox/History — tasks have no separate
  // "in progress but not actionable" state (StaffTasksComponent's own filtered() splits strictly on
  // status === 'completed' vs not), so there's nothing to show on Ongoing.
  readonly showTasksTab = computed(() => {
    const user = this.auth.user();
    return this.bucket !== 'ongoing' && !!user && staffTaskRoutingKeyFor(user) !== null && !isHeadOfAnyUnit(user);
  });

  // Cafeteria staff have their own queue page (row-level assignment's shared-pool model doesn't
  // apply to them — see cafeteria-staff-tasks/) — the Tasks tab must point at that route instead
  // of the 5-department StaffTasksComponent route for them specifically.
  readonly tasksRoute = computed(() => {
    const user = this.auth.user();
    return user && staffTaskRoutingKeyFor(user) === 'cafeteria-staff' ? 'cafeteria-tasks' : 'tasks';
  });

  // Requests tab: only for roles that own at least one department-request kind (reviewers/ department
  // staff — see department-workflow.config.ts's requestKindsForRole).
  readonly showRequestsTab = computed(() => {
    const user = this.auth.user();
    if (this.isCafeteriaStaffOnly()) return false;
    return !!user && requestKindsForRole(user).length > 0;
  });

  // Registrations tab: Inbox only, and for anyone who could plausibly BE an event organiser — i.e.
  readonly showRegistrationsTab = computed(() =>
    this.bucket === 'inbox' && !this.isCafeteriaStaffOnly() && this.auth.canAccess('/app/forms/event-proposal'));

  // Club presidency is student-only (see clubs.py's eligible_presidents()) — hasRole check kept
  // alongside isClubPresident() so a non-student can never see this tab even from stale
  // presidentOfClubIds data.
  readonly showClubRequestsTab = computed(() => {
    const user = this.auth.user();
    return this.bucket === 'inbox' && !this.isCafeteriaStaffOnly() && !!user && hasRole(user, 'student') && isClubPresident(user);
  });

  // President Change Requests splits by role, not just by bucket, because "pending" means something
  // different for each side of this workflow: - Club Admin / System Admin actually DECIDE these —
  // Inbox (their pending queue, actionable right now) / History (everything they've decided).
  private readonly isPresidentChangeAdmin = computed(() => {
    const user = this.auth.user();
    return !!user && (isClubAdminRole(user) || hasRole(user, 'system-admin'));
  });
  readonly showPresidentChangeTab = computed(() => {
    const user = this.auth.user();
    if (!user) return false;
    if (this.isPresidentChangeAdmin()) return this.bucket === 'inbox' || this.bucket === 'history';
    return isClubPresident(user) && (this.bucket === 'ongoing' || this.bucket === 'history');
  });

  // Ongoing/History → Clubs and Events: any authenticated internal user can request to join a club or
  // register for a manual-approval event, so — unlike the Inbox-only organiser/President tabs above —
  // these are open to everyone, same as Proposals.
  readonly showClubsTab = computed(() => {
    const user = this.auth.user();
    return (this.bucket === 'ongoing' || this.bucket === 'history')
      && !!user && hasRole(user, 'student');
  });
  readonly showEventsTab = computed(() => (this.bucket === 'ongoing' || this.bucket === 'history') && !!this.auth.user());

  readonly title = this.bucket === 'inbox' ? 'Inbox' : this.bucket === 'ongoing' ? 'Ongoing' : 'History';

  constructor() {
    // Every bucket's empty child path (app.routes.ts) redirects to 'proposals' as a fixed default —
    // fine for the vast majority of roles, since showProposalsTab() is unconditionally true for them,
    // but a wrong landing page for a viewer it's hidden from (cafeteria-staff).
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.redirectFromHiddenDefault());
    this.redirectFromHiddenDefault();
  }

  private redirectFromHiddenDefault(): void {
    if (this.showProposalsTab()) return;
    if (!this.router.url.endsWith('/proposals')) return;
    const fallback = this.showPresidentChangeTab() ? 'president-change-request'
      : this.showTasksTab() ? this.tasksRoute()
      : this.showEventsTab() ? 'events' : null;
    if (fallback) this.router.navigate([fallback], { relativeTo: this.route, replaceUrl: true });
  }
}
