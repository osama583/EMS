import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RecordsPageComponent } from './records-page';

describe('RecordsPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordsPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the shared data-page system with configurable draft records', () => {
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-internal-data-page')).not.toBeNull();
    expect(element.querySelector('h1')?.textContent).toContain('Drafts');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(element.querySelectorAll('.shared-mobile-card')).toHaveLength(5);
  });

  it('filters shared records dynamically', () => {
    const fixture = TestBed.createComponent(RecordsPageComponent);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'International Food Festival';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredRecords()).toHaveLength(1);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')).toHaveLength(1);
  });
});
