import { UserRole } from './auth.models';
import { ROLE_NAVIGATION, roleCanAccess, roleCanUseSavedEvents } from './role-navigation';

describe('role-navigation', () => {
  it('gives the merged Fmb role both proposal-review nav and dropdown settings', () => {
    const navigation = ROLE_NAVIGATION[UserRole.Fmb];
    const sectionKeys = navigation.sections.map((section) => section.key);
    expect(sectionKeys).toContain('proposals');
    expect(sectionKeys).toContain('dropdown-settings');
  });

  it('has no navigation entry left for the removed FmbWaterServicesStaff role', () => {
    expect((UserRole as Record<string, string>)['FmbWaterServicesStaff']).toBeUndefined();
  });

  it('lets the Fmb role manage the My Menu route', () => {
    expect(roleCanAccess(UserRole.Fmb, '/app/menu')).toBe(true);
  });

  it('includes Fmb in roles that can use saved events, and excludes department staff roles', () => {
    expect(roleCanUseSavedEvents(UserRole.Fmb)).toBe(true);
    expect(roleCanUseSavedEvents(UserRole.LogisticsStaff)).toBe(false);
  });
});
