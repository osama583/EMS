import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SharedLibraryComponent } from './shared-library';

describe('SharedLibraryComponent', () => {
  let fixture: ComponentFixture<SharedLibraryComponent>;
  let component: SharedLibraryComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SharedLibraryComponent] }).compileComponents();
    fixture = TestBed.createComponent(SharedLibraryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the private shared component registry', () => {
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Shared Components Library');
    expect(fixture.nativeElement.querySelectorAll('.library-card').length).toBe(component.entries.length);
  });

  it('filters entries by searchable component metadata', () => {
    const input = fixture.debugElement.query(By.css('input[type="search"]'));
    input.triggerEventHandler('input', { target: { value: 'pagination' } });
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.library-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Pagination');
  });
});
