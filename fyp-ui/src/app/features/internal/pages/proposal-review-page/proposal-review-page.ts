import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AuthUser } from '../../../../core/auth/auth.models';
import { requestKindsForManager } from '../../../../core/departments/department-workflow.config';
import { hasRole } from '../../../../core/auth/role-access';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { proposalSectionForUser, userIsApplicantForProposal, userOwnsCurrentProposalAction } from '../../../../core/proposals/proposal-visibility';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { ProposalDepartmentViewComponent } from '../../../../shared/components/proposal-department-view/proposal-department-view';
import { ProposalReviewerViewComponent } from '../../../../shared/components/proposal-reviewer-view/proposal-reviewer-view';
import { SkeletonComponent } from '../../../../shared/components/skeleton/skeleton';

type ViewKind = 'applicant' | 'reviewer' | 'department' | null;

// Full-page proposal detail (replaces the old popup modal).
@Component({
  selector: 'app-proposal-review-page',
  imports: [SkeletonComponent, ProposalReviewerViewComponent, ProposalDepartmentViewComponent],
  templateUrl: './proposal-review-page.html',
  styleUrl: './proposal-review-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalReviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);

  // The route config (`proposals/review/:id`) is identical for every proposal, so Angular's default
  // RouteReuseStrategy reuses this same component instance when navigating from one proposal's detail
  // page to another (or back to the same id with different query params) - it does NOT
  // destroy/recreate the component, so anything read once from `route.snapshot` or
  // `router.getCurrentNavigation()`/`history.state` at construction time goes stale on every
  // subsequent in-place navigation (the symptom: the eye icon does nothing until the URL is edited by
  // hand, which forces a full reload).
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  readonly allowAssignment = computed(() => (this.queryParams().get('allowAssignment') ?? 'true') !== 'false');
  readonly routeReadOnly = computed(() => this.queryParams().get('readOnly') === 'true');
  readonly returnTo = computed(() => this.queryParams().get('returnTo'));

  readonly proposal = signal<ProposalReviewRecord | null>(null);
  readonly loading = signal(true);

  // RBAC redesign: proposal-department-view.ts takes the full AuthUser — the component derives
  // its unit's workflow config from user.roles[] directly (see department-workflow.config.ts).
  readonly currentUser = computed<AuthUser | null>(() => this.auth.user() ?? null);
  readonly readOnly = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return true;
    return this.routeReadOnly() || !userOwnsCurrentProposalAction(this.auth.user(), proposal);
  });
  readonly canView = computed(() => {
    const proposal = this.proposal();
    return !!proposal && proposalSectionForUser(this.auth.user(), proposal) !== null;
  });
  readonly applicantCanResubmit = computed(() => {
    const proposal = this.proposal();
    const user = this.auth.user();
    return !!proposal && userIsApplicantForProposal(user, proposal) && userOwnsCurrentProposalAction(user, proposal);
  });
  readonly viewKind = computed<ViewKind>(() => {
    const user = this.currentUser();
    const proposal = this.proposal();
    if (!user || !proposal) return null;
    if (userIsApplicantForProposal(user, proposal)) return 'applicant';
    // F&B's head-of-department is dual-purpose on the SAME proposal: the fmb-review WHOLE- PROPOSAL
    // reviewer stage (approve/reject/resubmit, same as HOS/HOD/CFO) happens before department-review,
    // where F&B becomes one of possibly several routed DEPARTMENTS picking cafeteria orders for its
    // own request kinds.
    if (proposal.workflow.stage === ProposalStage.FmbReview && hasRole(user, 'head-of-department', 'food_beverage_services')) return 'reviewer';
    // A department manager is a unit-scoped head-of-department/head-of-school who actually owns at
    // least one request kind.
    if (requestKindsForManager(user).length > 0 || hasRole(user, 'cafeteria-manager')) return 'department';
    return 'reviewer';
  });

  constructor() {
    // route.paramMap fires on every navigation to this route config, including when the component
    // instance is being REUSED for a different :id (see the note above) - unlike a one-shot
    // constructor read, this re-runs the whole load every time.
    this.route.paramMap.pipe(
      switchMap((params) => {
        this.loading.set(true);
        return this.workflow.getById(Number(params.get('id')));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((record) => {
      this.proposal.set(record ?? null);
      this.loading.set(false);
    });
  }

  // Every action a reviewer/department/applicant can take here (approve, reject, resubmit-to-
  // applicant, confirm-department, resubmit-department, F&B selection approve/resubmit, cancel) emits
  // actionComplete — once any of them completes, leave this proposal's detail view and land on Ongoing
  // rather than staying in place, so the actor doesn't have to navigate back manually to see it move
  // out of their Inbox.
  handleActionComplete(_id: number): void {
    void this.router.navigateByUrl('/app/ongoing/proposals');
  }

  goBack(): void {
    const returnTo = this.returnTo();
    if (returnTo) { void this.router.navigateByUrl(returnTo); return; }
    this.location.back();
  }

  resubmitAsApplicant(): void {
    const proposal = this.proposal();
    if (!proposal) return;
    void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: proposal.id } });
  }
}
