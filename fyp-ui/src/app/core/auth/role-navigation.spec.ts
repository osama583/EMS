import { AuthUser, UserRole } from './auth.models';
import { navigationFor, roleCanAccess, roleCanUseSavedEvents, unitNavigationFor } from './role-navigation';

// Unit + Level model fixtures — F&B is now unit-scoped (functionLevel='manager' on the
// 'food_beverage_services' Service department unit) rather than its own UserRole.
const fmbManager: AuthUser = {
  email: 'fmb@demo.apu.edu.my', displayName: 'F&B Demo', username: 'fmb', role: 'manager' as UserRole,
  accountType: 'internal', roleLabel: 'Food & Beverage Services Manager', department: 'Food & Beverage Services',
  functionLevel: 'manager', unitId: 'food_beverage_services', unitKind: 'service_department',
};
const logisticsStaff: AuthUser = {
  email: 'logistics.staff@demo.apu.edu.my', displayName: 'Ahmad', username: 'logistics.staff', role: 'staff' as UserRole,
  accountType: 'internal', roleLabel: 'Logistics and Facilities Staff', department: 'Logistics and Facilities',
  functionLevel: 'staff', unitId: 'logistics_and_facilities', unitKind: 'service_department',
};
const cafeteriaManager: AuthUser = {
  email: 'cafeteria.manager@demo.apu.edu.my', displayName: 'Cafeteria Manager', username: 'cafeteria.manager', role: UserRole.CafeteriaManager,
  accountType: 'internal', roleLabel: 'Cafeteria Manager', department: 'Cafeteria Services',
};

describe('role-navigation', () => {
  it('gives the unit-scoped F&B manager both proposal-review nav and dropdown settings', () => {
    const navigation = unitNavigationFor(fmbManager)!;
    const sectionKeys = navigation.sections.map((section) => section.key);
    expect(sectionKeys).toContain('proposals');
    expect(sectionKeys).toContain('dropdown-settings');
  });

  it('has no navigation entry left for the removed FmbWaterServicesStaff role', () => {
    expect((UserRole as Record<string, string>)['FmbWaterServicesStaff']).toBeUndefined();
  });

  it('has no navigation entry left for the removed per-department UserRole members', () => {
    expect((UserRole as Record<string, string>)['LogisticsManager']).toBeUndefined();
    expect((UserRole as Record<string, string>)['HosHod']).toBeUndefined();
    expect((UserRole as Record<string, string>)['Fmb']).toBeUndefined();
  });

  it('lets CafeteriaManager manage the My Menu route', () => {
    expect(roleCanAccess(cafeteriaManager, '/app/menu')).toBe(true);
  });

  it('includes the unit-scoped F&B manager in users who can use saved events, and excludes nobody unit-scoped', () => {
    expect(roleCanUseSavedEvents(fmbManager)).toBe(true);
    expect(roleCanUseSavedEvents(logisticsStaff)).toBe(true);
  });

  it('builds nav for a unit-scoped Service department staff member as a tasks-only page', () => {
    const navigation = navigationFor(logisticsStaff);
    expect(navigation.defaultRoute).toBe('/app/tasks');
  });
});
