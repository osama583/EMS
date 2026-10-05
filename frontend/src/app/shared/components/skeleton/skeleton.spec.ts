import { TestBed } from '@angular/core/testing';
import { SkeletonComponent } from './skeleton';

describe('SkeletonComponent', () => {
  async function render(inputs: Record<string, unknown> = {}) {
    await TestBed.configureTestingModule({ imports: [SkeletonComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SkeletonComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture;
  }

  it('draws one row per count, each with the requested number of columns', async () => {
    const fixture = await render({ variant: 'table', count: 3, columns: 5 });
    const host: HTMLElement = fixture.nativeElement;

    // 3 body rows + 1 header row.
    expect(host.querySelectorAll('.skeleton__row').length).toBe(4);
    expect(host.querySelectorAll('.skeleton__row--head .skeleton__bone').length).toBe(5);
  });

  it('announces itself as busy so a screen reader knows the page is still loading', async () => {
    const fixture = await render({ variant: 'cards', label: 'Loading events…' });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.getAttribute('aria-label')).toBe('Loading events…');
  });

  it('hides the decorative bones from assistive tech', async () => {
    const fixture = await render({ variant: 'list', count: 2 });
    const wrapper = fixture.nativeElement.querySelector('.skeleton');

    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps line widths stable across renders so the shimmer does not flicker', async () => {
    const fixture = await render({ variant: 'text', count: 4 });
    const widths = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.skeleton__bone'),
      ).map((bone) => bone.style.width);

    const first = widths();
    fixture.detectChanges();

    expect(widths()).toEqual(first);
  });

  it('renders a card per count for the cards variant', async () => {
    const fixture = await render({ variant: 'cards', count: 6 });

    expect(fixture.nativeElement.querySelectorAll('.skeleton__card').length).toBe(6);
  });

  it('renders a poster per count for the events variant', async () => {
    const fixture = await render({ variant: 'events', count: 5 });

    expect(fixture.nativeElement.querySelectorAll('.skeleton__poster').length).toBe(5);
  });

  it('draws seven columns per week for the calendar variant', async () => {
    const fixture = await render({ variant: 'calendar', count: 6 });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.skeleton__weekdays .skeleton__bone').length).toBe(7);
    expect(host.querySelectorAll('.skeleton__day').length).toBe(42);
  });

  it('staggers the calendar chips so the month does not read as vertical stripes', async () => {
    const fixture = await render({ variant: 'calendar', count: 2 });
    const perDay = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.skeleton__day'),
    ).map((day) => day.querySelectorAll('.skeleton__bone--event').length);

    // Week two must not repeat week one column for column — that is what a cycle
    // length coprime with the seven-column grid buys.
    expect(perDay.slice(0, 7)).not.toEqual(perDay.slice(7, 14));
  });

  it('renders a label and a control for every field', async () => {
    const fixture = await render({ variant: 'fields', count: 3 });
    const host: HTMLElement = fixture.nativeElement;

    expect(host.querySelectorAll('.skeleton__field').length).toBe(3);
    expect(host.querySelectorAll('.skeleton__bone--control').length).toBe(3);
  });
});
