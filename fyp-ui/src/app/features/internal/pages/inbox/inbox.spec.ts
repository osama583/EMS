import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';
import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { InboxComponent } from './inbox';

function loginAs(role: UserRole, email: string, roleLabel: string, department: string): void {
  TestBed.inject(AuthService).establishSession({
    email, displayName: roleLabel, username: email.split('@')[0],
    role, accountType: 'internal', roleLabel, department,
  });
}

describe('InboxComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InboxComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushProposals(): void {
    httpMock.expectOne(environment.proposalWorkflowApiUrl).flush(PROPOSAL_REVIEW_RECORDS);
  }

  it('only shows proposals currently awaiting this reviewer\'s action', () => {
    loginAs(UserRole.HosHod, 'hoshod@demo.apu.edu.my', 'HOS / HOD', 'School Leadership');
    const fixture = TestBed.createComponent(InboxComponent);
    fixture.detectChanges();
    flushProposals();
    fixture.detectChanges();

    // Of the 8 seeded rows, only id 2 is at HosHodReview stage — CFO-stage, F&B-stage and
    // department-stage rows must not appear for a HOS/HOD reviewer.
    const items = fixture.componentInstance.filteredItems();
    expect(items.map((item) => item.id)).toEqual([2]);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('only shows proposals awaiting this department manager\'s confirmation', () => {
    loginAs(UserRole.LogisticsManager, 'logistics.manager@demo.apu.edu.my', 'Logistics Manager', 'Logistics and Facilities');
    const fixture = TestBed.createComponent(InboxComponent);
    fixture.detectChanges();
    flushProposals();
    fixture.detectChanges();

    // Only rows at DepartmentReview stage with an unconfirmed 'logistics' department task should
    // appear — reviewer-stage rows and other departments' rows must not.
    const items = fixture.componentInstance.filteredItems();
    expect(items.every((item) => item.workflow.departmentConfirmations.some((entry) => entry.department === 'logistics' && !entry.confirmed))).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows nothing for a role with no reviewer or department ownership', () => {
    loginAs(UserRole.Applicant, 'applicant@demo.apu.edu.my', 'Applicant', 'School of Computing');
    const fixture = TestBed.createComponent(InboxComponent);
    fixture.detectChanges();
    flushProposals();
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredItems()).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('.shared-page-state__empty')).not.toBeNull();
  });

  it('navigates to the full-page proposal review from the view action', () => {
    loginAs(UserRole.HosHod, 'hoshod@demo.apu.edu.my', 'HOS / HOD', 'School Leadership');
    const fixture = TestBed.createComponent(InboxComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    flushProposals();
    fixture.detectChanges();

    const firstViewButton = fixture.nativeElement.querySelector(
      'button[title="View proposal"]',
    ) as HTMLButtonElement;
    expect(firstViewButton).not.toBeNull();
    firstViewButton.click();
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const [commands, extras] = navigateSpy.mock.calls[0];
    expect(commands[0]).toBe('/app/proposals/review');
    expect((extras?.state as { proposal?: { id: number } })?.proposal).toBeDefined();
  });

  it('navigates to the full-page proposal review from a mobile card', () => {
    loginAs(UserRole.LogisticsManager, 'logistics.manager@demo.apu.edu.my', 'Logistics Manager', 'Logistics and Facilities');
    const fixture = TestBed.createComponent(InboxComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    flushProposals();
    fixture.detectChanges();

    const firstCard = fixture.nativeElement.querySelector('.shared-mobile-card') as HTMLElement;
    const openCard = firstCard.querySelector('.shared-mobile-card__open') as HTMLButtonElement;
    const overflowMenu = firstCard.querySelector('.shared-mobile-card__menu') as HTMLDetailsElement;

    expect(overflowMenu.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
    openCard.click();
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0][0][0]).toBe('/app/proposals/review');
  });
});
