import { TestBed } from '@angular/core/testing';
import { InternalTableWorkspaceComponent } from './internal-table-workspace';

describe('InternalTableWorkspaceComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InternalTableWorkspaceComponent],
    }).compileComponents();
  });

  it('renders the four reusable visual levels', () => {
    const fixture = TestBed.createComponent(InternalTableWorkspaceComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.internal-table-workspace__header')).not.toBeNull();
    expect(element.querySelector('.internal-table-workspace__controls')).not.toBeNull();
    expect(element.querySelector('.internal-table-workspace__table-card')).not.toBeNull();
    expect(element.querySelector('.internal-table-workspace__pagination')).not.toBeNull();
  });

  it('updates pages through the reusable pagination controls', () => {
    const fixture = TestBed.createComponent(InternalTableWorkspaceComponent);
    fixture.componentRef.setInput('totalPages', 16);
    fixture.componentRef.setInput('page', 7);
    fixture.detectChanges();

    const nextButton = fixture.nativeElement.querySelector(
      'button[aria-label="Next page"]',
    ) as HTMLButtonElement;
    nextButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.page()).toBe(8);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[aria-current="page"]')?.textContent,
    ).toContain('8');
    expect(fixture.nativeElement.querySelectorAll('.workspace-pagination__ellipsis')).toHaveLength(
      2,
    );
  });

  it('updates the row count and returns to the first page', () => {
    const fixture = TestBed.createComponent(InternalTableWorkspaceComponent);
    fixture.componentRef.setInput('totalPages', 8);
    fixture.componentRef.setInput('page', 4);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = '25';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.pageSize()).toBe(25);
    expect(fixture.componentInstance.page()).toBe(1);
  });
});

describe('InternalTableWorkspaceComponent pagination selector sync', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InternalTableWorkspaceComponent],
    }).compileComponents();
  });

  // Regression: the selector used to bind [value] on the <select>, which is applied before @for
  // has created any <option>. A value matching no existing option is discarded by the browser,
  // leaving selectedIndex at 0 - so the control read "5 per page" (the first option) while the
  // page was really loading 10 rows. Only a manual 5 -> 10 -> 5 resynced it.
  it('shows the real page size on the first render, not the first option', () => {
    const fixture = TestBed.createComponent(InternalTableWorkspaceComponent);
    fixture.componentRef.setInput('totalPages', 4);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(fixture.componentInstance.pageSize()).toBe(10);
    expect(select.value).toBe('10');
  });

  it('keeps the selector in step with a page size set from outside', () => {
    const fixture = TestBed.createComponent(InternalTableWorkspaceComponent);
    fixture.componentRef.setInput('totalPages', 4);
    fixture.componentRef.setInput('pageSize', 25);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('25');
  });

  it('still round-trips a change in both directions', () => {
    const fixture = TestBed.createComponent(InternalTableWorkspaceComponent);
    fixture.componentRef.setInput('totalPages', 4);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    select.value = '5';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.pageSize()).toBe(5);
    expect(select.value).toBe('5');

    select.value = '10';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.pageSize()).toBe(10);
    expect(select.value).toBe('10');
  });
});
