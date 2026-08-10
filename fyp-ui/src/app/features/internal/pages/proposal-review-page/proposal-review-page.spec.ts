import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';
import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { ProposalReviewPageComponent } from './proposal-review-page';

function activatedRouteStub(id: string, queryParams: Record<string, string> = {}) {
  return {
    snapshot: {
      paramMap: convertToParamMap({ id }),
      queryParamMap: convertToParamMap(queryParams),
    },
  };
}

async function configureWithRoute(id: string): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [ProposalReviewPageComponent],
    providers: [{ provide: ActivatedRoute, useValue: activatedRouteStub(id) }],
  }).compileComponents();
}

describe('ProposalReviewPageComponent', () => {
  it('renders the reviewer view for a HOS/HOD user and approves the proposal', async () => {
    const pendingProposal = PROPOSAL_REVIEW_RECORDS.find((record) => record.workflow.stage === ProposalStage.HosHodReview)!;
    expect(pendingProposal).toBeDefined();

    await configureWithRoute(String(pendingProposal.id));
    TestBed.inject(AuthService).establishSession({
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', username: 'hoshod',
      role: UserRole.HosHod, accountType: 'internal', roleLabel: 'HOS / HOD', department: 'School Leadership',
    });

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    fixture.componentInstance.proposal.set(pendingProposal);
    fixture.detectChanges();

    const approveButton = fixture.nativeElement.querySelector(
      'app-proposal-reviewer-view .prv-btn--approve',
    ) as HTMLButtonElement;
    expect(approveButton).not.toBeNull();
    approveButton.click();

    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(fixture.componentInstance.proposal()?.workflow.stage).not.toBe(ProposalStage.HosHodReview);
  });

  it('shows a not-found state when the proposal cannot be resolved', async () => {
    await configureWithRoute('999999');
    TestBed.inject(AuthService).establishSession({
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', username: 'hoshod',
      role: UserRole.HosHod, accountType: 'internal', roleLabel: 'HOS / HOD', department: 'School Leadership',
    });

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Proposal not found');
  });
});
