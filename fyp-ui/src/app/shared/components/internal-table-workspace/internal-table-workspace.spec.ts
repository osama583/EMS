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
