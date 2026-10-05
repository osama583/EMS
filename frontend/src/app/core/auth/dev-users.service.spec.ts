import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DevUsersService } from './dev-users.service';

describe('DevUsersService (TESTING ONLY feature)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('returns the demo user list when the backend flag is enabled', async () => {
    const service = TestBed.inject(DevUsersService);
    const httpMock = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(service.list());
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/dev-users`).flush([
      { id: '1', displayName: 'Jane Tan', email: 'jane.tan@apu.edu.my', roleLabel: 'Lecturer', department: 'School of Computing', password: 'Demo-test123' },
    ]);

    const result = await promise;
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('jane.tan@apu.edu.my');
  });

  it('resolves to an empty list when the backend flag is disabled (404)', async () => {
    const service = TestBed.inject(DevUsersService);
    const httpMock = TestBed.inject(HttpTestingController);

    const promise = firstValueFrom(service.list());
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/dev-users`).flush('not found', { status: 404, statusText: 'Not Found' });

    expect(await promise).toEqual([]);
  });
});
