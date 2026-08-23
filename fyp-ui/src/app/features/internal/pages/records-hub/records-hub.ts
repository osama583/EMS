import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AuthUser } from '../../../../core/auth/auth.models';
import { hasRole } from '../../../../core/auth/role-access';
import { isClubPresident } from '../../../../core/auth/role-navigation';
import { requestKindsForRole } from '../../../../core/departments/department-workflow.config';
import { staffTaskRoutingKeyFor } from '../../../../core/staff-tasks/staff-task-routing';

// Whether the viewer holds the 'club-admin' role specifically, not merely AuthUser.isClubAdmin
// (which is also true for a System Admin — is_admin OR has_role('club-admin') server-side). A
// Club Admin never reviews event proposals, so their Proposals tab is hidden in favour of
// President Change Requests below; a System Admin keeps both, since they administer everything.
function isClubAdminRole(user: AuthUser | null): boolean {
  return !!user && hasRole(user, 'club-admin');
}

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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly bucket = this.route.snapshot.data['bucket'] as RecordsHubBucket;

  // Cafeteria staff (the 'cafeteria-staff' role, not the manager) run the shared-pool food-order
  // queue only — they never author proposals, own a department-request kind, organise events, or
  // review club join requests, so every OTHER tab is hidden for them regardless of what its own
  // rule would otherwise compute (F&B's request-kind resolution would otherwise leak a Requests
  // tab in, for instance). Their Inbox/History show Tasks + Events only; Ongoing shows Events only.
  private readonly isCafeteriaStaffOnly = computed(() => {
    const user = this.auth.user();
    return !!user && hasRole(user, 'cafeteria-staff');
  });

  // Proposals tab: every applicant-like user (their own proposals) and every reviewer/department
  // owner (proposals routed to them) has a place in this bucket — see proposal-visibility.ts.
  // Effectively everyone except a pure flat admin (system-admin/cafeteria-admin with no unit),
  // so this is left unconditional rather than re-deriving proposal-visibility's own logic here.
  // Club Admin is the other exception: they never review event proposals, only club business, so
  // Proposals is hidden for them in favour of President Change Requests below (System Admin keeps
  // both tabs — isClubAdminRole checks the specific role, not AuthUser.isClubAdmin, which is also
  // true for a System Admin).
  readonly showProposalsTab = computed(() => !this.isCafeteriaStaffOnly() && !isClubAdminRole(this.auth.user()));

  // Tasks tab: only for staff-task-routed roles (the 5 Service-department-routed unit staff plus
  // cafeteria-staff — see staff-task-routing.ts), and only for Inbox/History — tasks have no
  // separate "in progress but not actionable" state (StaffTasksComponent's own filtered() splits
  // strictly on status === 'completed' vs not), so there's nothing to show on Ongoing.
  readonly showTasksTab = computed(() => {
    const user = this.auth.user();
    return this.bucket !== 'ongoing' && !!user && staffTaskRoutingKeyFor(user) !== null;
  });

  // Cafeteria staff have their own queue page (row-level assignment's shared-pool model doesn't
  // apply to them — see cafeteria-staff-tasks/) — the Tasks tab must point at that route instead
  // of the 5-department StaffTasksComponent route for them specifically.
  readonly tasksRoute = computed(() => {
    const user = this.auth.user();
    return user && staffTaskRoutingKeyFor(user) === 'cafeteria-staff' ? 'cafeteria-tasks' : 'tasks';
  });

  // Requests tab: only for roles that own at least one department-request kind (reviewers/
  // department staff — see department-workflow.config.ts's requestKindsForRole). Excluded for
  // cafeteria-staff specifically: F&B's unit-level requestKinds would otherwise resolve for them
  // even though they work the Tasks queue, not this tab.
  readonly showRequestsTab = computed(() => {
    const user = this.auth.user();
    if (this.isCafeteriaStaffOnly()) return false;
    return !!user && requestKindsForRole(user).length > 0;
  });

  // Registrations tab: Inbox only, and for anyone who could plausibly BE an event organiser —
  // i.e. anyone the admin's Page Visibility settings grant access to the proposal form itself
  // ('/app/forms/event-proposal'), the same "who can be an applicant" eligibility rule
  // proposals.py's /proposals/collaborator-candidates already uses server-side (see its
  // _PROPOSAL_FORM_PAGE_CODE / users_with_page_access() comment). Previously this only showed once
  // the viewer already had ≥1 pending registration waiting — which hid the tab entirely for anyone
  // who hadn't yet had someone register for one of their events, even though they were fully
  // entitled to organise a manual-approval event and would need this tab the moment someone did.
  // roleCanAccess() reads purely off the already-loaded AuthUser.nav tree, so this needs no extra
  // network round trip the way the old pendingRegistrationCount() fetch did.
  readonly showRegistrationsTab = computed(() =>
    this.bucket === 'inbox' && !this.isCafeteriaStaffOnly() && this.auth.canAccess('/app/forms/event-proposal'));

  readonly showClubRequestsTab = computed(() => {
    const user = this.auth.user();
    return this.bucket === 'inbox' && !this.isCafeteriaStaffOnly() && !!user && isClubPresident(user);
  });

  // President Change Requests: Inbox/History only (Ongoing has no analogue — a pending request
  // isn't something the President tracks progress on the way an ongoing club/event request is).
  // Visible to whoever the tab actually serves: a Club Admin/System Admin decides requests here,
  // and a sitting club President can see their own submitted request and its history (see
  // hub-president-change-requests.ts's isClubAdmin/canDecide computeds for the per-role content).
  readonly showPresidentChangeTab = computed(() => {
    const user = this.auth.user();
    if (this.bucket === 'ongoing' || !user) return false;
    return isClubAdminRole(user) || hasRole(user, 'system-admin') || isClubPresident(user);
  });

  // Ongoing/History → Clubs and Events: any authenticated internal user can request to join a
  // club or register for a manual-approval event, so — unlike the Inbox-only organiser/President
  // tabs above — these are open to everyone, same as Proposals. Requests still awaiting the
  // VIEWER's own decision (as President/organiser) stay in Inbox only; these two tabs track the
  // viewer's own OUTGOING requests (Ongoing) and every resolved decision either direction
  // (History) — see hub-ongoing-clubs/hub-history-clubs/hub-history-events for the split.
  // Cafeteria managers (identified by cafeteriaCode, same convention as request-option-management
  // and proposal-department-view) run a single cafeteria and never join clubs — Clubs is dropped
  // for them, and for cafeteria-staff too, so the tab strip only shows what's relevant to their role.
  readonly showClubsTab = computed(() =>
    (this.bucket === 'ongoing' || this.bucket === 'history')
    && !!this.auth.user() && this.auth.user()?.cafeteriaCode === undefined
    && !this.isCafeteriaStaffOnly());
  readonly showEventsTab = computed(() => (this.bucket === 'ongoing' || this.bucket === 'history') && !!this.auth.user());

  readonly title = this.bucket === 'inbox' ? 'Inbox' : this.bucket === 'ongoing' ? 'Ongoing' : 'History';

  constructor() {
    // Every bucket's empty child path (app.routes.ts) redirects to 'proposals' as a fixed
    // default — fine for the vast majority of roles, since showProposalsTab() is unconditionally
    // true for them, but a wrong landing page for a viewer it's hidden from (cafeteria-staff).
    // Rather than making the redirect itself role-aware in the route table, correct course here
    // once the tab visibility is known: if this viewer's URL settled on 'proposals' (via the
    // empty-path redirect, or a stale/typed-in link) and Proposals isn't actually visible to them,
    // hop to their first real tab instead of leaving them stranded with no way back except the
    // sidebar. NavigationEnd (not an effect() reading router.url) because the empty-path redirect
    // resolves asynchronously, after this component is already constructed — an effect's first run
    // would read the URL before the redirect lands and never re-fire since router.url isn't a signal.
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
