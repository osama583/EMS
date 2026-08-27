import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ExternalRegistrationService, GuestRegistrationFlowService } from '../auth/external-registration.service';
import { AuthUser } from '../auth/auth.models';
import { testNavPage, testRole, testUser } from '../auth/auth.test-fixtures';
import { SavedEventsService } from './saved-events.service';

const APPLICANT_USER: AuthUser = testUser(
  [testRole('student', 'school_of_computing', 'School of Computing')],
  {
    email: 'applicant@demo.apu.edu.my',
    displayName: 'Demo Applicant',
    nav: [testNavPage('dashboard', 'Dashboard')],
  },
);

function loginViaMock(auth: AuthService, httpMock: HttpTestingController): void {
  auth.login('applicant@demo.apu.edu.my', 'Demo@123').subscribe();
  httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`).flush(sessionEnvelope(APPLICANT_USER));
}


/** Login, refresh and register all return the user wrapped with a token pair. */
function sessionEnvelope(user: unknown) {
  return { user, accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 3600 };
}

describe('event engagement mock services', () => {
  beforeEach(() => {
    localStorage.removeItem('apu-ems-auth-user');
    localStorage.removeItem('apu-ems-external-accounts');
    localStorage.removeItem('apu-ems-event-engagement');
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('saves and removes proposal-backed events for the authenticated user', async () => {
    const auth = TestBed.inject(AuthService);
    const httpMock = TestBed.inject(HttpTestingController);
    const saved = TestBed.inject(SavedEventsService);
    loginViaMock(auth, httpMock);

    const savePromise = firstValueFrom(saved.saveEvent(auth.user()!.email, 'evt-1'));
    httpMock.expectOne((req) => req.method === 'PUT' && req.url === `${`${environment.apiBaseUrl}/events/me`}/saved/evt-1`)
      .flush({ eventId: 'evt-1', saved: true });
    await savePromise;
    expect(saved.isSaved('evt-1')).toBe(true);

    const savedEventsPromise = firstValueFrom(saved.getSavedEvents(auth.user()!.email));
    httpMock.expectOne((req) => req.method === 'GET' && req.url === `${`${environment.apiBaseUrl}/events/me`}/saved`)
      .flush({ items: [{ id: 'evt-1' }, { id: 'evt-2' }], total: 2 });
    expect((await savedEventsPromise).items[0]?.id).toBe('evt-1');

    const removePromise = firstValueFrom(saved.removeSavedEvent(auth.user()!.email, 'evt-1'));
    httpMock.expectOne((req) => req.method === 'DELETE' && req.url === `${`${environment.apiBaseUrl}/events/me`}/saved/evt-1`)
      .flush({ eventId: 'evt-1', saved: false });
    await removePromise;
    expect(saved.isSaved('evt-1')).toBe(false);
  });

  it('creates an external session only after the emailed OTP is verified', async () => {
    const auth = TestBed.inject(AuthService);
    const registration = TestBed.inject(ExternalRegistrationService);
    const httpMock = TestBed.inject(HttpTestingController);

    const challengePromise = firstValueFrom(registration.registerExternalUser({
      email: 'guest@example.com', firstName: 'Guest', lastName: 'User', age: 21, gender: 'Prefer not to say', password: 'Password1',
    }));
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/register/start`).flush({
      challengeId: '1', status: 'otp-required', maskedEmail: 'gu***@example.com',
    });
    const challenge = await challengePromise;

    expect(auth.authenticated()).toBe(false);
    // Verifying the OTP (emailed by the backend, never exposed to the client)
    // is what actually creates the account.
    const resultPromise = firstValueFrom(registration.verifyOtp({ challengeId: challenge.challengeId, otp: '123456' }));
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/register/verify`).flush({
      status: 'verified',
      message: 'Your account has been verified.',
      ...sessionEnvelope(testUser([testRole('external-user')], {
        email: 'guest@example.com', displayName: 'Guest User', accountType: 'external',
      })),
    });
    const result = await resultPromise;
    expect(result.status).toBe('verified');
    expect(auth.user()?.roles.some((role) => role.roleCode === 'external-user')).toBe(true);
    expect(auth.user()?.accountType).toBe('external');
    expect(localStorage.getItem('apu-ems-auth-user')).toContain('guest@example.com');
  });

  it('restores the saved account type and permissions after the application is recreated', () => {
    const auth = TestBed.inject(AuthService);
    const httpMock = TestBed.inject(HttpTestingController);
    let success = false;
    auth.login('applicant@demo.apu.edu.my', 'Demo@123').subscribe((result) => { success = result.success; });
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`).flush(sessionEnvelope(APPLICANT_USER));
    expect(success).toBe(true);

    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const restored = TestBed.inject(AuthService);

    expect(restored.authenticated()).toBe(true);
    expect(restored.isInternalUser()).toBe(true);
    expect(restored.user()?.roles.some((role) => role.roleCode === 'student' && role.unitCode === 'school_of_computing')).toBe(true);
    expect(restored.defaultRoute()).toBe('/app/dashboard');
  });

  it('keeps the event that initiated guest registration in the flow context', () => {
    const flow = TestBed.inject(GuestRegistrationFlowService);
    flow.requestForEvent('evt-3');
    expect(flow.open()).toBe(false);
    expect(flow.pendingEventId()).toBe('evt-3');
  });
});
