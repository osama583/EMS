import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { testNavPage, testRole, testUser } from '../auth/auth.test-fixtures';
import { roleCanAccess } from '../auth/role-navigation';
import { AdminUnitRecord, AdminUserRecord } from './admin-directory.models';
import { AdminDirectoryService } from './admin-directory.service';

const SEED_USERS: readonly AdminUserRecord[] = [
  {
    id: 'user-1', displayName: 'Cafeteria Admin',
    email: 'cafeteria.admin@demo.apu.edu.my', roles: [{ assignmentId: '1', roleCode: 'cafeteria-admin', roleName: 'Cafeteria Admin', unitCode: null, unitDescription: null }],
    roleLabel: 'Cafeteria Admin', department: 'Cafeteria Services', active: true,
  },
];

const SEED_UNITS: readonly AdminUnitRecord[] = [
  { id: 'unit-cafeteria-services', name: 'Cafeteria Services', code: 'CS', description: 'Cafeteria Services unit.', active: true, roleCodes: [] },
];

describe('AdminDirectoryService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('hydrates Users and Units from the existing authentication data', async () => {
    const service = TestBed.inject(AdminDirectoryService);
    const httpMock = TestBed.inject(HttpTestingController);

    const usersPromise = firstValueFrom(service.users$);
    const unitsPromise = firstValueFrom(service.units$);
    httpMock.expectOne(`${`${environment.apiBaseUrl}/admin`}/users`).flush(SEED_USERS);
    httpMock.expectOne(`${`${environment.apiBaseUrl}/admin`}/units`).flush(SEED_UNITS);
    const [users, units] = await Promise.all([usersPromise, unitsPromise]);

    expect(users.length).toBeGreaterThan(0);
    expect(users.some((user) => user.email === 'cafeteria.admin@demo.apu.edu.my')).toBe(true);
    expect(units.some((unit) => unit.name === 'Cafeteria Services')).toBe(true);
    expect('password' in users[0]).toBe(false);
  });

  it('creates a unit through the repository contract used by the future POST API', async () => {
    const service = TestBed.inject(AdminDirectoryService);
    const httpMock = TestBed.inject(HttpTestingController);

    const createdPromise = firstValueFrom(service.createUnit({
      description: 'Student experience operations.',
      active: true,
      roleCodes: [],
    }));
    const createdRecord: AdminUnitRecord = {
      id: 'unit-student-experience', name: 'Student Experience', code: 'SE',
      description: 'Student experience operations.', active: true, roleCodes: [],
    };
    httpMock.expectOne(`${`${environment.apiBaseUrl}/admin`}/units`).flush(createdRecord);
    const created = await createdPromise;

    const unitsPromise = firstValueFrom(service.units$);
    httpMock.expectOne(`${`${environment.apiBaseUrl}/admin`}/units`).flush([...SEED_UNITS, createdRecord]);
    const units = await unitsPromise;

    expect(created.name).toBe('Student Experience');
    expect(units.some((unit) => unit.id === created.id)).toBe(true);
  });

  it('keeps directory routes restricted to System Admin', () => {
    // Access is decided by the server-supplied nav tree, so each identity is built with exactly
    // the pages that role would really be granted.
    const adminUser = testUser([testRole('system-admin')], { nav: [testNavPage('users'), testNavPage('units')] });
    const cafeteriaAdmin = testUser([testRole('cafeteria-admin')], { nav: [testNavPage('cafeterias')] });
    const cafeteriaManager = testUser([testRole('cafeteria-manager', 'cafeteria__atrium_cafeteria', 'Atrium Cafeteria')], { nav: [testNavPage('menu')] });
    const student = testUser([testRole('student', 'school_of_computing', 'School of Computing')], { nav: [testNavPage('dashboard')] });

    expect(roleCanAccess(adminUser, '/app/users')).toBe(true);
    expect(roleCanAccess(adminUser, '/app/units')).toBe(true);
    expect(roleCanAccess(cafeteriaAdmin, '/app/users')).toBe(false);
    expect(roleCanAccess(student, '/app/users')).toBe(false);
    expect(roleCanAccess(cafeteriaManager, '/app/units')).toBe(false);
  });
});
