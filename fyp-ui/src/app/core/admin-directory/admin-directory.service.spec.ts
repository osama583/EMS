import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { UserRole } from '../auth/auth.models';
import { roleCanAccess } from '../auth/role-navigation';
import { AdminDirectoryService } from './admin-directory.service';

describe('AdminDirectoryService', () => {
  it('hydrates Users and Units from the existing authentication data', async () => {
    const service = TestBed.inject(AdminDirectoryService);
    const [users, units] = await Promise.all([
      firstValueFrom(service.users$),
      firstValueFrom(service.units$),
    ]);

    expect(users.length).toBeGreaterThan(0);
    expect(users.some((user) => user.email === 'cafeteria.admin@demo.apu.edu.my')).toBe(true);
    expect(units.some((unit) => unit.name === 'Cafeteria Services')).toBe(true);
    expect('password' in users[0]).toBe(false);
  });

  it('creates a unit through the repository contract used by the future POST API', async () => {
    const service = TestBed.inject(AdminDirectoryService);
    const created = await firstValueFrom(service.createUnit({
      name: 'Student Experience',
      code: 'SE',
      description: 'Student experience operations.',
      active: true,
    }));
    const units = await firstValueFrom(service.units$);

    expect(created.name).toBe('Student Experience');
    expect(units.some((unit) => unit.id === created.id)).toBe(true);
  });

  it('keeps Cafeteria Admin directory routes role-restricted', () => {
    expect(roleCanAccess(UserRole.CafeteriaAdmin, '/app/users')).toBe(true);
    expect(roleCanAccess(UserRole.CafeteriaAdmin, '/app/units')).toBe(true);
    expect(roleCanAccess(UserRole.Applicant, '/app/users')).toBe(false);
    expect(roleCanAccess(UserRole.CafeteriaManager, '/app/units')).toBe(false);
  });
});
