import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, UserRole } from '../auth/auth.models';
import { roleCanAccess } from '../auth/role-navigation';
import { AdminUnitRecord, AdminUserRecord } from './admin-directory.models';
import { AdminDirectoryService } from './admin-directory.service';

const SEED_USERS: readonly AdminUserRecord[] = [
  {
    id: 'user-1', displayName: 'Cafeteria Admin', username: 'cafeteria.admin',
    email: 'cafeteria.admin@demo.apu.edu.my', role: UserRole.CafeteriaAdmin, roleLabel: 'Cafeteria Admin',
    unitId: 'unit-cafeteria-services', department: 'Cafeteria Services', active: true,
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
    httpMock.expectOne(`${environment.adminDirectoryApiUrl}/users`).flush(SEED_USERS);
    httpMock.expectOne(`${environment.adminDirectoryApiUrl}/units`).flush(SEED_UNITS);
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
      name: 'Student Experience',
      code: 'SE',
      description: 'Student experience operations.',
      active: true,
    }));
    const createdRecord: AdminUnitRecord = {
      id: 'unit-student-experience', name: 'Student Experience', code: 'SE',
      description: 'Student experience operations.', active: true, roleCodes: [],
    };
    httpMock.expectOne(`${environment.adminDirectoryApiUrl}/units`).flush(createdRecord);
    const created = await createdPromise;

    const unitsPromise = firstValueFrom(service.units$);
    httpMock.expectOne(`${environment.adminDirectoryApiUrl}/units`).flush([...SEED_UNITS, createdRecord]);
    const units = await unitsPromise;

    expect(created.name).toBe('Student Experience');
    expect(units.some((unit) => unit.id === created.id)).toBe(true);
  });

  it('keeps directory routes restricted to System Admin', () => {
    const asUser = (role: UserRole): AuthUser => ({
      email: `${role}@demo.apu.edu.my`, displayName: role, username: role, role,
      accountType: 'internal', roleLabel: role, department: '',
    });
    const unitScopedStudent: AuthUser = {
      email: 'student@demo.apu.edu.my', displayName: 'Student', username: 'student', role: 'student' as UserRole,
      accountType: 'internal', roleLabel: 'Student — School of Computing', department: 'School of Computing',
      functionLevel: 'student', unitId: 'school_of_computing', unitKind: 'school',
    };
    expect(roleCanAccess(asUser(UserRole.SystemAdmin), '/app/users')).toBe(true);
    expect(roleCanAccess(asUser(UserRole.SystemAdmin), '/app/units')).toBe(true);
    expect(roleCanAccess(asUser(UserRole.CafeteriaAdmin), '/app/users')).toBe(false);
    expect(roleCanAccess(unitScopedStudent, '/app/users')).toBe(false);
    expect(roleCanAccess(asUser(UserRole.CafeteriaManager), '/app/units')).toBe(false);
  });
});
