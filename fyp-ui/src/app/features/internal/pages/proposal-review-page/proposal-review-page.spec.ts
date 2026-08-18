import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { testNavPage, testRole, testTokens, testUser } from '../../../../core/auth/auth.test-fixtures';
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
      // Approving/rejecting/resubmitting navigates to /app/proposals/pending on completion
      // (handleActionComplete) — a real route table is needed so that navigation resolves
      // instead of throwing NG04002.
      provideRouter([{ path: 'app/ongoing/proposals', children: [] }]),
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
    TestBed.inject(AuthService).establishSession(testUser([testRole('head-of-school', 'school_of_computing', 'School of Computing')], {
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', username: 'hoshod',
    }), testTokens());

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    // No router state is passed in this test, so the component constructor always issues its
    // own getById fetch (mirrors production: only a state-carrying navigation skips it).
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/${pendingProposal.id}`).flush(pendingProposal);
    fixture.componentInstance.proposal.set(pendingProposal);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/catalog/config`).flush({
      paxReviewerThreshold: 50,
      cancellationDaysLimit: 3,
      eventCategories: [],
    });
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
    // Approving no longer re-fetches the proposal by id — handleActionComplete navigates the
    // user away to Ongoing once the approve call resolves (see proposal-review-page.ts), rather
    // than staying on this page and refreshing its data.
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/${pendingProposal.id}/decision`).flush(approvedProposal);

    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/app/ongoing/proposals');
  });

  it('shows a not-found state when the proposal cannot be resolved', async () => {
    await configureWithRoute('999999');
    TestBed.inject(AuthService).establishSession(testUser([testRole('head-of-school', 'school_of_computing', 'School of Computing')], {
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', username: 'hoshod',
    }), testTokens());

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    fixture.detectChanges();

    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/999999`).flush(null);

    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Proposal not found');
  });
});
