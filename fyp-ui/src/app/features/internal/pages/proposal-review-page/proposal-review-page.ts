import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';
import { DEPARTMENT_WORKFLOWS } from '../../../../core/departments/department-workflow.config';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { proposalSectionForUser, userIsApplicantForProposal, userOwnsCurrentProposalAction } from '../../../../core/proposals/proposal-visibility';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { ProposalDepartmentViewComponent } from '../../../../shared/components/proposal-department-view/proposal-department-view';
import { ProposalReviewerViewComponent } from '../../../../shared/components/proposal-reviewer-view/proposal-reviewer-view';

type ViewKind = 'applicant' | 'reviewer' | 'department' | null;

// Full-page proposal detail (replaces the old popup modal). The caller (Inbox / Records Page)
// navigates here with the already-known ProposalReviewRecord passed via router state — this
// avoids needing every synthetic/demo row to be independently fetchable by id. A direct visit
// or refresh (no state, e.g. a bookmarked/shared link) falls back to loading by id from the
// workflow service, which only resolves proposals that are actually tracked there.
@Component({
  selector: 'app-proposal-review-page',
  imports: [ProposalReviewerViewComponent, ProposalDepartmentViewComponent],
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

  readonly allowAssignment = (this.route.snapshot.queryParamMap.get('allowAssignment') ?? 'true') !== 'false';
  readonly routeReadOnly = this.route.snapshot.queryParamMap.get('readOnly') === 'true';
  readonly returnTo = this.route.snapshot.queryParamMap.get('returnTo');

  private readonly stateProposal = (this.router.getCurrentNavigation()?.extras.state?.['proposal']
    ?? history.state?.proposal ?? null) as ProposalReviewRecord | null;

  readonly proposal = signal<ProposalReviewRecord | null>(this.stateProposal);
  readonly loading = signal(!this.stateProposal);

  readonly role = computed<UserRole | null>(() => this.auth.user()?.role ?? null);
  readonly readOnly = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return true;
    return this.routeReadOnly || !userOwnsCurrentProposalAction(this.auth.user(), proposal);
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
    const role = this.role();
    const proposal = this.proposal();
    const user = this.auth.user();
    if (!role || !proposal) return null;
    if (userIsApplicantForProposal(user, proposal)) return 'applicant';
    if (DEPARTMENT_WORKFLOWS.some((entry) => entry.managerRole === role)) return 'department';
    return 'reviewer';
  });

  constructor() {
    if (!this.stateProposal) {
      const id = Number(this.route.snapshot.paramMap.get('id'));
      this.workflow.getById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((record) => {
        this.proposal.set(record ?? null);
        this.loading.set(false);
      });
    }
  }

  handleActionComplete(id: number): void {
    this.workflow.getById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((updated) => {
      if (updated) this.proposal.set(updated);
    });
  }

  goBack(): void {
    if (this.returnTo) { void this.router.navigateByUrl(this.returnTo); return; }
    this.location.back();
  }

  resubmitAsApplicant(): void {
    const proposal = this.proposal();
    if (!proposal) return;
    void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: proposal.id } });
  }
}
