import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';
import { environment } from '../../../../../environments/environment';
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
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: activatedRouteStub(id) },
    ],
  }).compileComponents();
}

describe('ProposalReviewPageComponent', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('renders the reviewer view for a HOS/HOD user and approves the proposal', async () => {
    const pendingProposal = PROPOSAL_REVIEW_RECORDS.find((record) => record.workflow.stage === ProposalStage.HosHodReview)!;
    expect(pendingProposal).toBeDefined();

    await configureWithRoute(String(pendingProposal.id));
    TestBed.inject(AuthService).establishSession({
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', username: 'hoshod',
      role: UserRole.HosHod, accountType: 'internal', roleLabel: 'HOS / HOD', department: 'School Leadership',
    });

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    // No router state is passed in this test, so the component constructor always issues its
    // own getById fetch (mirrors production: only a state-carrying navigation skips it).
    httpMock.expectOne(`${environment.proposalWorkflowApiUrl}/${pendingProposal.id}`).flush(pendingProposal);
    fixture.componentInstance.proposal.set(pendingProposal);
    fixture.detectChanges();

    const approveButton = fixture.nativeElement.querySelector(
      'app-proposal-reviewer-view .prv-btn--approve',
    ) as HTMLButtonElement;
    expect(approveButton).not.toBeNull();
    approveButton.click();
    fixture.detectChanges();

    // Clicking Approve opens a confirmation modal (app-form-modal); the actual
    // approveAsReviewer HTTP call only fires once its primary button is clicked.
    const confirmButton = fixture.nativeElement.querySelector(
      'app-form-modal .table-control--primary',
    ) as HTMLButtonElement;
    expect(confirmButton).not.toBeNull();
    confirmButton.click();

    const approvedProposal = {
      ...pendingProposal,
      workflow: { ...pendingProposal.workflow, stage: ProposalStage.FmbReview },
    };
    httpMock.expectOne(`${environment.proposalWorkflowApiUrl}/${pendingProposal.id}/approve`).flush(approvedProposal);
    httpMock.expectOne(`${environment.proposalWorkflowApiUrl}/${pendingProposal.id}`).flush(approvedProposal);

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

    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(`${environment.proposalWorkflowApiUrl}/999999`).flush(null);

    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Proposal not found');
  });
});
