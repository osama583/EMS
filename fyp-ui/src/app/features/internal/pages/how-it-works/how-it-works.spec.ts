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
      '/app/proposals/pending',
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

  it('shows the full timeline without animation when observers are unavailable', () => {
    expect(component.timelineProgress()).toBe(100);
    expect(
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.process-step')).every(
        (step) => step.classList.contains('process-step--active'),
      ),
    ).toBe(true);
  });
});
