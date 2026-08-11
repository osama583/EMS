import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';
import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { RecordsPageComponent } from './records-page';

const DRAFT_APPLICANT_EMAIL = 'jordan.lee@student.apu.edu.my';

const DRAFT_PROPOSALS: readonly ProposalReviewRecord[] = [
  { ...PROPOSAL_REVIEW_RECORDS[0], id: 901, proposalId: 'DRF-901', eventTitle: 'Draft: Alumni Homecoming', applicant: 'Jordan Lee', applicantEmail: DRAFT_APPLICANT_EMAIL, status: 'Draft', workflow: { ...PROPOSAL_REVIEW_RECORDS[0].workflow, stage: 'draft' as ProposalReviewRecord['workflow']['stage'] } },
  { ...PROPOSAL_REVIEW_RECORDS[1], id: 902, proposalId: 'DRF-902', eventTitle: 'Draft: Winter Charity Drive', applicant: 'Jordan Lee', applicantEmail: DRAFT_APPLICANT_EMAIL, status: 'Draft', workflow: { ...PROPOSAL_REVIEW_RECORDS[1].workflow, stage: 'draft' as ProposalReviewRecord['workflow']['stage'] } },
];

function loginAsDraftOwner(): void {
  TestBed.inject(AuthService).establishSession({
    email: DRAFT_APPLICANT_EMAIL, displayName: 'Jordan Lee', username: 'jordan.lee',
    role: UserRole.Staff, accountType: 'internal', roleLabel: 'Staff', department: 'Student Affairs',
  });
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

  it('renders the shared data-page system with real draft records for the logged-in applicant', () => {
    loginAsDraftOwner();
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    httpMock.expectOne(environment.proposalWorkflowApiUrl).flush(DRAFT_PROPOSALS);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-internal-data-page')).not.toBeNull();
    expect(element.querySelector('h1')?.textContent).toContain('Drafts');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(element.querySelectorAll('.shared-mobile-card')).toHaveLength(2);
  });

  it('filters shared records dynamically', () => {
    loginAsDraftOwner();
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    httpMock.expectOne(environment.proposalWorkflowApiUrl).flush(DRAFT_PROPOSALS);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'Winter Charity Drive';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredRecords()).toHaveLength(1);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('excludes drafts that belong to a different applicant', () => {
    TestBed.inject(AuthService).establishSession({
      email: 'someone.else@student.apu.edu.my', displayName: 'Someone Else', username: 'someone.else',
      role: UserRole.Staff, accountType: 'internal', roleLabel: 'Staff', department: 'Student Affairs',
    });
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    httpMock.expectOne(environment.proposalWorkflowApiUrl).flush(DRAFT_PROPOSALS);
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredRecords()).toHaveLength(0);
  });
});
