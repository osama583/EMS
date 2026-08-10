import { TestBed } from '@angular/core/testing';
import { StepIndicatorComponent } from './step-indicator';

describe('StepIndicatorComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StepIndicatorComponent] }).compileComponents();
  });

  it('shows visited invalid steps as warnings before submission', () => {
    const fixture = TestBed.createComponent(StepIndicatorComponent);
    fixture.componentRef.setInput('steps', [{ label: 'Applicant Info', icon: 'person' }]);
    fixture.componentRef.setInput('stepStatuses', [{ visited: true, valid: false, missingFields: [{ label: 'Email', target: 'email' }] }]);
    fixture.componentRef.setInput('currentStep', 2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.step--warning')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.missing-popup')?.textContent).toContain('Email');
  });

  it('escalates incomplete steps to red after submission', () => {
    const fixture = TestBed.createComponent(StepIndicatorComponent);
    fixture.componentRef.setInput('steps', [{ label: 'Applicant Info', icon: 'person' }]);
    fixture.componentRef.setInput('stepStatuses', [{ visited: true, valid: false, missingFields: [{ label: 'Email' }] }]);
    fixture.componentRef.setInput('submitAttempted', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.step--error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.missing-popup--error')).not.toBeNull();
  });

  it('emits the selected missing-field target', () => {
    const fixture = TestBed.createComponent(StepIndicatorComponent);
    const component = fixture.componentInstance;
    const field = { label: 'Email', target: 'applicant-email' };
    let selected: unknown;
    component.missingFieldClick.subscribe((event) => selected = event);
    component.selectMissingField(new Event('click'), 0, field);
    expect(selected).toEqual({ step: 1, field });
  });
});
