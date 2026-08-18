import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { LoginComponent } from './login';

describe('LoginComponent demo picker (TESTING ONLY feature)', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('apu-ems-auth-user');
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(LoginComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushDevUsers(users: unknown[]): void {
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/dev-users`).flush(users);
  }

  it('renders no picker section when the backend has no demo users', () => {
    fixture.detectChanges();
    flushDevUsers([]);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.login-demo-users');
    expect(section).toBeNull();
  });

  it('renders the picker and fills both fields when a demo user is clicked', () => {
    fixture.detectChanges();
    flushDevUsers([
      { id: '1', displayName: 'Jane Tan', email: 'jane.tan@apu.edu.my', roleLabel: 'Lecturer', department: 'School of Computing', password: 'Demo-test123' },
    ]);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.login-demo-users');
    expect(section).not.toBeNull();

    const button = fixture.nativeElement.querySelector('.login-demo-user') as HTMLButtonElement;
    expect(button.textContent).toContain('Jane Tan');
    button.click();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.email()).toBe('jane.tan@apu.edu.my');
    expect(component.password()).toBe('Demo-test123');
  });

  it('filters the list by the search box', () => {
    fixture.detectChanges();
    flushDevUsers([
      { id: '1', displayName: 'Jane Tan', email: 'jane.tan@apu.edu.my', roleLabel: 'Lecturer', department: 'School of Computing', password: 'Demo-test123' },
      { id: '2', displayName: 'Ali Rahman', email: 'ali.rahman@apu.edu.my', roleLabel: 'Student', department: 'School of Computing', password: 'Demo-test123' },
    ]);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.login-demo-users__search input') as HTMLInputElement;
    input.value = 'Ali';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.login-demo-user');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Ali Rahman');
  });
});
