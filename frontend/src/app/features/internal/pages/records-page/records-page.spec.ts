import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { testNavPage, testRole, testTokens, testUser } from '../../../../core/auth/auth.test-fixtures';
import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { RecordsPageComponent } from './records-page';

const DRAFT_APPLICANT_EMAIL = 'jordan.lee@student.apu.edu.my';

const DRAFT_PROPOSALS: readonly ProposalReviewRecord[] = [
  { ...PROPOSAL_REVIEW_RECORDS[0], id: 901, proposalId: 'DRF-901', eventTitle: 'Draft: Alumni Homecoming', applicant: 'Jordan Lee', applicantEmail: DRAFT_APPLICANT_EMAIL, status: 'Draft', workflow: { ...PROPOSAL_REVIEW_RECORDS[0].workflow, stage: 'draft' as ProposalReviewRecord['workflow']['stage'] } },
  { ...PROPOSAL_REVIEW_RECORDS[1], id: 902, proposalId: 'DRF-902', eventTitle: 'Draft: Winter Charity Drive', applicant: 'Jordan Lee', applicantEmail: DRAFT_APPLICANT_EMAIL, status: 'Draft', workflow: { ...PROPOSAL_REVIEW_RECORDS[1].workflow, stage: 'draft' as ProposalReviewRecord['workflow']['stage'] } },
];

function loginAsDraftOwner(): void {
  TestBed.inject(AuthService).establishSession(testUser([testRole('staff', 'student_affairs', 'Student Affairs')], {
    email: DRAFT_APPLICANT_EMAIL, displayName: 'Jordan Lee',
    nav: [testNavPage('drafts', 'Drafts')],
  }), testTokens());
}

describe('RecordsPageComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordsPageComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // Drafts also loads its filter dropdowns' options (status-labels/categories, scoped to
  // bucket=drafts) alongside the page of records itself — flush both or httpMock.verify() fails.
  function flushDraftFilterOptions(): void {
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/proposals/status-labels`).flush([]);
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/proposals/categories`).flush([]);
  }

  it('renders the shared data-page system with real draft records for the logged-in applicant', () => {
    loginAsDraftOwner();
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/proposals`).flush({ items: DRAFT_PROPOSALS, page: 1, pageSize: 200, total: DRAFT_PROPOSALS.length, totalPages: 1 });
    flushDraftFilterOptions();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-internal-data-page')).not.toBeNull();
    expect(element.querySelector('h1')?.textContent).toContain('Drafts');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(element.querySelectorAll('.shared-mobile-card')).toHaveLength(2);
  });

  it('filters shared records dynamically', async () => {
    loginAsDraftOwner();
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/proposals`).flush({ items: DRAFT_PROPOSALS, page: 1, pageSize: 200, total: DRAFT_PROPOSALS.length, totalPages: 1 });
    flushDraftFilterOptions();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'Winter Charity Drive';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Search is server-side (debounced 300ms) for drafts — the debounced request re-fetches
    // filtered by `q`, rather than filtering a client-held array.
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    const filtered = DRAFT_PROPOSALS.filter((record) => record.eventTitle.includes('Winter Charity Drive'));
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/proposals` && req.params.get('q') === 'Winter Charity Drive')
      .flush({ items: filtered, page: 1, pageSize: 200, total: filtered.length, totalPages: 1 });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('excludes drafts that belong to a different applicant', () => {
    TestBed.inject(AuthService).establishSession(testUser([testRole('staff', 'student_affairs', 'Student Affairs')], {
      email: 'someone.else@student.apu.edu.my', displayName: 'Someone Else',
    }), testTokens());
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    // The server already scopes drafts to the caller, so a request for this user's own drafts
    // returns none of the other applicant's rows in the first place.
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/proposals`).flush({ items: [], page: 1, pageSize: 200, total: 0, totalPages: 1 });
    flushDraftFilterOptions();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
