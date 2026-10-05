import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HowItWorksComponent } from './how-it-works';

describe('HowItWorksComponent', () => {
  let fixture: ComponentFixture<HowItWorksComponent>;
  let component: HowItWorksComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HowItWorksComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HowItWorksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('renders the proposal introduction and all five process steps', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain(
      'Create and Submit Your Event Proposal',
    );
    expect(element.querySelectorAll('.process-step')).toHaveLength(5);
    expect(element.textContent).toContain('HOS/HOD Approval');
    expect(element.textContent).toContain('up to 13 working days');
  });

  it('links the four actions to their existing internal routes', () => {
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.how-button'),
    );

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/app/forms/event-proposal',
      '/app/events/explore-events',
      '/app/ongoing',
      '/app/inbox',
    ]);
  });

  it('uses one continuous route for both the grey pipe and blue progress', () => {
    const element = fixture.nativeElement as HTMLElement;
    const basePath = element.querySelector<SVGPathElement>('.process-route__base');
    const progressPath = element.querySelector<SVGPathElement>('.process-route__progress');

    expect(element.querySelectorAll('.process-route__base')).toHaveLength(1);
    expect(element.querySelectorAll('.process-route__progress')).toHaveLength(1);
    expect(basePath?.getAttribute('d')).toBeTruthy();
    expect(progressPath?.getAttribute('d')).toBe(basePath?.getAttribute('d'));
    expect(progressPath?.getAttribute('stroke-dasharray')).not.toBeNull();
    expect(progressPath?.getAttribute('stroke-dashoffset')).not.toBeNull();
    expect(element.querySelector('.process-step__path')).toBeNull();
  });

  // The serpentine route spends far more length on step 1 (one long run across,
  // a bend, then a full run back) than on the steps that follow, so an even
  // 1/5-per-step split of scroll progress does not track the drawn line.
  // Measured in Chrome at 1600x1000: 29.7% / 17.3% / 17.3% / 17.3% / 18.2%.
  const MEASURED_BANDS = [
    { start: 0, end: 0.297 },
    { start: 0.297, end: 0.47 },
    { start: 0.47, end: 0.643 },
    { start: 0.643, end: 0.816 },
    { start: 0.816, end: 1 },
  ] as const;

  it('keeps the highlighted step on the segment the drawn line is actually in', () => {
    component.stepBoundaries.set(MEASURED_BANDS);

    // A quarter of the way down, the line is still two thirds through step 1.
    component.timelineProgress.set(25);
    expect(component.activeStepIndex()).toBe(0);

    // Just past the real hand-off, and not before it.
    component.timelineProgress.set(29);
    expect(component.activeStepIndex()).toBe(0);
    component.timelineProgress.set(30);
    expect(component.activeStepIndex()).toBe(1);
  });

  it('measures step progress against that step own share of the route', () => {
    component.stepBoundaries.set(MEASURED_BANDS);
    component.timelineProgress.set(25);

    expect(component.stepProgress(0)).toBeCloseTo(0.842, 2);
    expect(component.stepProgress(1)).toBe(0);
  });

  it('falls back to an even split before the route has been measured', () => {
    component.stepBoundaries.set([]);
    component.timelineProgress.set(50);

    expect(component.activeStepIndex()).toBe(2);
    expect(component.stepProgress(2)).toBeCloseTo(0.5, 5);
  });

  it('shows the full timeline without animation when observers are unavailable', () => {
    expect(component.timelineProgress()).toBe(100);
    expect(
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.process-step')).every(
        (step) => step.classList.contains('process-step--active'),
      ),
    ).toBe(true);
  });
});
