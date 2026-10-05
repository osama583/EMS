import { TestBed } from '@angular/core/testing';
import { InternalPaginationComponent } from './internal-data-page-parts';
import { PAGE_SIZE_OPTIONS } from './internal-data-page.models';

/**
 * The page-size control must always read the size the table is actually using.
 *
 * Two separate defects produced the same visible symptom - the control saying "5 per page"
 * beside a table of 8 or 10 rows:
 *   1. [value] bound on the <select>, applied before @for had created any <option>, so the
 *      browser discarded it and fell back to the first option.
 *   2. A page size that is not one of PAGE_SIZE_OPTIONS (the registrants modal opens at 8,
 *      explore-events at 6/9, the AI access log at 50), so no <option> matched.
 * Both left selectedIndex at 0. Only a manual change resynced the control.
 */
describe('InternalPaginationComponent page-size control', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InternalPaginationComponent],
    }).compileComponents();
  });

  const render = (pageSize: number) => {
    const fixture = TestBed.createComponent(InternalPaginationComponent);
    fixture.componentRef.setInput('totalPages', 13);
    fixture.componentRef.setInput('pageSize', pageSize);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('select') as HTMLSelectElement;
  };

  // Every page size any page in the system starts at, in-list and out-of-list alike.
  for (const size of [...PAGE_SIZE_OPTIONS, 6, 8, 9, 50]) {
    it(`shows ${size} when the table is paging by ${size}`, () => {
      expect(render(size).value).toBe(String(size));
    });
  }

  it('offers an out-of-list size in numeric order without dropping the standard ones', () => {
    const select = render(8);
    const offered = Array.from(select.options).map((option) => Number(option.value));
    expect(offered).toEqual([5, 8, 10, 15, 25]);
  });

  it('does not duplicate a size already in the list', () => {
    const select = render(10);
    const offered = Array.from(select.options).map((option) => Number(option.value));
    expect(offered).toEqual([...PAGE_SIZE_OPTIONS]);
  });

  it('emits the chosen size and reflects it back', () => {
    const fixture = TestBed.createComponent(InternalPaginationComponent);
    fixture.componentRef.setInput('totalPages', 13);
    fixture.componentRef.setInput('pageSize', 8);
    let emitted = 0;
    fixture.componentInstance.pageSizeChange.subscribe((value) => (emitted = value));
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = '25';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted).toBe(25);

    fixture.componentRef.setInput('pageSize', 25);
    fixture.detectChanges();
    expect(select.value).toBe('25');
  });
});
