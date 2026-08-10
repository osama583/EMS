import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { RequestOption } from '../../../../core/request-options/request-option.models';
import { EventProposalComponent } from './event-proposal';

const CATALOG_SEED: readonly RequestOption[] = [
  { id: 'log-registration-table', kind: 'logistics', label: 'Registration table', availableQuantity: 1, quantityUnit: 'table', active: true },
  { id: 'log-chairs', kind: 'logistics', label: 'Chairs', availableQuantity: 200, quantityUnit: 'chair', active: true },
  { id: 'fund-main-supplies', kind: 'fundingMain', label: 'Event supplies', financeCode: 'SUP', active: true },
  { id: 'fund-main-honorarium', kind: 'fundingMain', label: 'Honorarium', financeCode: 'HON', active: true },
  { id: 'fund-sub-kits', kind: 'fundingSub', label: 'Participant kits', parentId: 'fund-main-supplies', active: true },
  { id: 'fund-sub-speaker', kind: 'fundingSub', label: 'Guest speaker', parentId: 'fund-main-honorarium', active: true },
];

function createComponent(): ComponentFixture<EventProposalComponent> {
  const fixture = TestBed.createComponent(EventProposalComponent);
  const httpMock = TestBed.inject(HttpTestingController);
  httpMock.expectOne((request) => request.url === environment.requestOptionsApiUrl).flush(CATALOG_SEED);
  return fixture;
}

describe('EventProposalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventProposalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('starts with the complete six-step proposal flow', () => {
    const fixture = createComponent();
    fixture.detectChanges();
    expect(fixture.componentInstance.steps.map((step) => step.label)).toEqual([
      'Applicant Info', 'General Event Info', 'Required for Event', 'Request Details', 'Detailed Event Info', 'Final Actions',
    ]);
    expect(fixture.nativeElement.querySelectorAll('app-step-indicator .step').length).toBe(6);
  });

  it('allows navigation between steps while incomplete and records the departed step for validation', () => {
    const component = createComponent().componentInstance;
    component.next();
    expect(component.currentStep()).toBe(1);
    expect(component.checkedSteps()).toContain(0);
    expect(component.errors()['0.applicantName']).toBe('Applicant Name is required.');
    component.goToStep(5);
    expect(component.currentStep()).toBe(5);
    component.previous();
    expect(component.currentStep()).toBe(4);
  });

  it('requires at least one event requirement after leaving the section and clears the error immediately after selection', () => {
    const component = createComponent().componentInstance;
    component.goToStep(2);
    component.goToStep(3);
    expect(component.errors()['2.requirements']).toBe('Select at least one department or requirement.');

    component.toggleRequirement('logistics', true);
    expect(component.errors()['2.requirements']).toBeUndefined();
  });

  it('validates the requirements step during final submission even when an earlier step is invalid', () => {
    const component = createComponent().componentInstance;
    component.submit();
    expect(component.errors()['0.applicantName']).toBeDefined();
    expect(component.errors()['2.requirements']).toBe('Select at least one department or requirement.');
  });

  it('calculates total pax from guest counts and populated important people', () => {
    const component = createComponent().componentInstance;
    component.guests.set([{ id: 1, guestType: 'Students', count: 24, notes: '' }]);
    component.importantPeople.set([{ id: 2, name: 'Guest', type: 'VIP', organization: 'APU', designation: '' }]);
    expect(component.totalPax()).toBe(25);
  });

  it('requires an agenda for an overnight session longer than two hours', () => {
    const component = createComponent().componentInstance;
    component.schedule.set([{ id: 1, date: '2026-08-10', start: '22:00', end: '01:30', location: 'Atrium' }]);
    expect(component.agendaRequired()).toBe(true);
    expect(component.agendaReasons()).toContain('an event session is longer than two hours');
  });

  it('calculates funding and purchase costs live without exposing Special Request', () => {
    const component = createComponent().componentInstance;
    component.setRequestRows('fundingPurchase', [{ id: 1, mainItem: 'Event supplies', subItem: 'Participant kits', quantity: 12, unit: 4.5, notes: '' }]);
    expect(component.totalCost()).toBe(54);
    expect(component.requirements.some((item) => item.label === 'Special Request')).toBe(false);
  });

  it('prefills new service requests from the first schedule row without changing edited rows', () => {
    const component = createComponent().componentInstance;
    const logistics = component.requirements.find((item) => item.key === 'logistics')!;
    component.schedule.set([{ id: 1, date: '2026-08-10', start: '09:00', end: '11:00', location: 'Atrium' }]);
    component.openRequestEditor(logistics);
    expect(component.requestDraft()).toMatchObject({ date: '2026-08-10', start: '09:00', end: '11:00', location: 'Atrium' });

    component.setRequestRows('logistics', [{ id: 8, item: 'Chairs', quantity: 20, date: '2026-08-11', start: '12:00', end: '13:00', location: 'Auditorium', notes: '' }]);
    component.editRequestRow(logistics, 0);
    expect(component.requestDraft()).toMatchObject({ date: '2026-08-11', start: '12:00', end: '13:00', location: 'Auditorium' });
  });

  it('shows logistics availability without blocking over-availability requests', () => {
    const component = createComponent().componentInstance;
    const logistics = component.requirements.find((item) => item.key === 'logistics')!;
    component.openRequestEditor(logistics);
    component.setRequestDraftValue('item', 'Registration table');
    component.setRequestDraftValue('quantity', '2');
    expect(component.logisticsAvailableQuantity()).toBe(1);
    expect(component.logisticsExceedsAvailability()).toBe(true);
  });

  it('clears a funding sub-item when the selected main item changes', () => {
    const component = createComponent().componentInstance;
    const funding = component.requirements.find((item) => item.key === 'fundingPurchase')!;
    component.openRequestEditor(funding);
    component.setRequestDraftValue('mainItem', 'Event supplies');
    component.setRequestDraftValue('subItem', 'Participant kits');
    component.setRequestDraftValue('mainItem', 'Honorarium');
    expect(component.requestDraftValue('subItem')).toBe('');
    expect(component.requestFieldOptions(funding.columns.find((column) => column.key === 'subItem')!).map((item) => item.label)).toContain('Guest speaker');
  });

  it('validates requested transportation pax against total expected pax', () => {
    const component = createComponent().componentInstance;
    const transportation = component.requirements.find((item) => item.key === 'transportation')!;
    const requestedPax = transportation.columns.find((column) => column.key === 'requestedPax')!;
    component.guests.set([{ id: 1, guestType: 'Students', count: 10, notes: '' }]);
    component.openRequestEditor(transportation);
    component.setRequestDraftValue('requestedPax', '11');
    expect(component.requestFieldError(requestedPax)).toContain('cannot exceed Total Expected Pax (10)');
  });

  it('does not use an unset zero total pax as a maximum', () => {
    const component = createComponent().componentInstance;
    const transportation = component.requirements.find((item) => item.key === 'transportation')!;
    const requestedPax = transportation.columns.find((column) => column.key === 'requestedPax')!;
    component.requestModalDefinition.set(transportation);
    component.requestDraft.set({ requestedPax: 4 });

    expect(component.totalPax()).toBe(0);
    expect(component.requestFieldError(requestedPax)).toBe('');
  });

  it('hides publicity from the page when the event is not public', () => {
    const fixture = createComponent();
    fixture.componentInstance.currentStep.set(4);
    fixture.componentInstance.isPublic.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#publicity')).toBeNull();
  });

  it('hides event categories until visibility is public', () => {
    const fixture = createComponent();
    fixture.componentInstance.currentStep.set(4);
    fixture.componentInstance.eventVisibility.set('Private');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#event-categories')).toBeNull();

    fixture.componentInstance.eventVisibility.set('Public');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#event-categories')).not.toBeNull();
  });
});
