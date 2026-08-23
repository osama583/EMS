import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { testNavPage, testRole, testTokens, testUser } from '../../../../core/auth/auth.test-fixtures';
import { environment } from '../../../../../environments/environment';
import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { ProposalReviewPageComponent } from './proposal-review-page';

function activatedRouteStub(id: string, queryParams: Record<string, string> = {}) {
  const paramMap = convertToParamMap({ id });
  const queryParamMap = convertToParamMap(queryParams);
  return {
    snapshot: { paramMap, queryParamMap },
    // The component reads the live paramMap/queryParamMap observables (not just snapshot) so it
    // reacts correctly when Angular reuses this component instance for a different :id — see
    // proposal-review-page.ts's constructor comment. of(...) mirrors a route that never changes
    // again after this initial navigation, which is all these tests exercise.
    paramMap: of(paramMap),
    queryParamMap: of(queryParamMap),
  };
}

// Reused across a "navigate to a different proposal without recreating the component" test —
// a BehaviorSubject lets the test push a second paramMap emission the way Angular's Router does
// when it reuses this component instance for a new :id (same route config every time).
function reusableActivatedRouteStub(id: string, queryParams: Record<string, string> = {}) {
  const paramMap$ = new BehaviorSubject(convertToParamMap({ id }));
  const queryParamMap$ = new BehaviorSubject(convertToParamMap(queryParams));
  return {
    stub: {
      snapshot: { paramMap: paramMap$.value, queryParamMap: queryParamMap$.value },
      paramMap: paramMap$,
      queryParamMap: queryParamMap$,
    },
    navigateTo: (nextId: string) => paramMap$.next(convertToParamMap({ id: nextId })),
  };
}

// app-proposal-reviewer-view fetches GET /proposals/{id}/conversations reactively (an effect() on
// its `proposal` input) the moment a proposal is set — every test below that populates `proposal`
// must flush this alongside the other expected requests or HttpTestingController.verify() fails.
function flushConversations(httpMock: HttpTestingController, id: number): void {
  httpMock.match((request) => request.url === `${environment.apiBaseUrl}/proposals/${id}/conversations`).forEach((request) => request.flush([]));
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
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo',
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
    flushConversations(httpMock, pendingProposal.id);
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
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo',
    }), testTokens());

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    fixture.detectChanges();

    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/999999`).flush(null);

    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Proposal not found');
  });

  // Regression test for: clicking the eye icon to view a second proposal (after already having
  // viewed one) showed nothing and fired no API call, but editing the URL and pressing Enter
  // worked. Root cause: Angular reuses this component instance across navigations to the same
  // route config (`proposals/review/:id`), so anything captured once from `route.snapshot` or
  // `history.state` at construction time went stale on every subsequent in-place navigation. A
  // manual URL edit "worked" only because it forces a full reload, which destroys and recreates
  // the component. This test proves the fix by emitting a SECOND paramMap on the SAME component
  // instance (fixture never recreated) and checking the proposal actually updates.
  it('loads a new proposal when navigated to a different id while the component is reused', async () => {
    const first = PROPOSAL_REVIEW_RECORDS.find((record) => record.workflow.stage === ProposalStage.HosHodReview)!;
    const second = PROPOSAL_REVIEW_RECORDS.find((record) => record.id !== first.id)!;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const { stub, navigateTo } = reusableActivatedRouteStub(String(first.id));
    await TestBed.configureTestingModule({
      imports: [ProposalReviewPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'app/ongoing/proposals', children: [] }]),
        { provide: ActivatedRoute, useValue: stub },
      ],
    }).compileComponents();
    TestBed.inject(AuthService).establishSession(testUser([testRole('head-of-school', 'school_of_computing', 'School of Computing')], {
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo',
    }), testTokens());

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/${first.id}`).flush(first);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/catalog/config`).flush({ paxReviewerThreshold: 50, cancellationDaysLimit: 3, eventCategories: [] });
    flushConversations(httpMock, first.id);
    fixture.detectChanges();
    expect(fixture.componentInstance.proposal()?.id).toBe(first.id);

    // Same component instance — this mirrors clicking the eye icon on a different row, which
    // navigates to the same route config with a new :id rather than creating a new component.
    navigateTo(String(second.id));
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/${second.id}`).flush(second);
    fixture.detectChanges();
    flushConversations(httpMock, second.id);
    fixture.detectChanges();

    expect(fixture.componentInstance.proposal()?.id).toBe(second.id);
  });

  // Regression test for: clicking the eye icon in Inbox/Ongoing/History called no API at all and
  // showed a blank page. Root cause: this component used to skip its own fetch whenever router
  // state carried a proposal matching the id, trusting the list page's row as a substitute. But
  // hub-proposals.ts's rows come from GET /proposals (include_children=False on the server), which
  // never carries requestRows/requests/coOwners/organizers/agenda/etc. - exactly what the detail
  // view needs to render. The fix always fetches the full record by id and no longer reads router
  // state at all, so every navigation here — eye icon click or otherwise — calls the API.
  it('always fetches the full proposal by id on every navigation', async () => {
    const listRow = PROPOSAL_REVIEW_RECORDS.find((record) => record.workflow.stage === ProposalStage.HosHodReview)!;
    expect(listRow).toBeDefined();

    await configureWithRoute(String(listRow.id));
    TestBed.inject(AuthService).establishSession(testUser([testRole('head-of-school', 'school_of_computing', 'School of Computing')], {
      email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo',
    }), testTokens());

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/${listRow.id}`).flush(listRow);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/catalog/config`).flush({ paxReviewerThreshold: 50, cancellationDaysLimit: 3, eventCategories: [] });
    flushConversations(httpMock, listRow.id);
    fixture.detectChanges();

    expect(fixture.componentInstance.proposal()?.id).toBe(listRow.id);
  });

  // Regression test for: F&B's head-of-department, viewing a proposal still at the fmb-review
  // REVIEWER stage (approve/reject/resubmit the whole proposal — same as HOS/HOD/CFO), was shown
  // the DEPARTMENT view instead (order-picking + "Assign Department Work"), because viewKind()
  // used to decide purely from requestKindsForManager(user).length > 0 — which is unconditionally
  // non-empty for F&B's head-of-department regardless of what stage the proposal is actually at.
  // F&B only becomes a department owner once the proposal reaches department-review; at
  // fmb-review it must render exactly like HOS/HOD/CFO's reviewer view.
  it('shows F&B the reviewer view (not the department view) while the proposal is still at fmb-review', async () => {
    const atFmbReview = PROPOSAL_REVIEW_RECORDS.find((record) => record.workflow.stage === ProposalStage.FmbReview)!;
    expect(atFmbReview).toBeDefined();

    await configureWithRoute(String(atFmbReview.id));
    TestBed.inject(AuthService).establishSession(testUser([testRole('head-of-department', 'food_beverage_services', 'Food & Beverage Services')], {
      email: 'fmb@demo.apu.edu.my', displayName: 'F&B Demo',
    }), testTokens());

    const fixture = TestBed.createComponent(ProposalReviewPageComponent);
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/proposals/${atFmbReview.id}`).flush(atFmbReview);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiBaseUrl}/catalog/config`).flush({ paxReviewerThreshold: 50, cancellationDaysLimit: 3, eventCategories: [] });
    flushConversations(httpMock, atFmbReview.id);
    fixture.detectChanges();

    expect(fixture.componentInstance.viewKind()).toBe('reviewer');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-proposal-reviewer-view')).not.toBeNull();
    expect(element.querySelector('app-proposal-department-view')).toBeNull();
  });
});
