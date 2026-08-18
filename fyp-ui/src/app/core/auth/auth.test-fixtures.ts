import { AuthNavNode, AuthUser, AuthUserRole } from './auth.models';
import { AuthTokens } from './token-store';

// Shared AuthUser builder for specs. Before this existed every spec hand-wrote its own literal
// against the PRE-RBAC-redesign shape (`role`, `functionLevel`, `unitId`, `unitKind`, the deleted
// `UserRole` enum), so the whole test suite stopped compiling the moment identity became
// `roles: AuthUserRole[]`. One builder means the next identity change touches one file.

export interface TestUserOptions {
  readonly email?: string;
  readonly displayName?: string;
  readonly username?: string;
  readonly accountType?: 'internal' | 'external';
  readonly roleLabel?: string;
  readonly department?: string;
  readonly nav?: readonly AuthNavNode[];
  readonly cafeteriaCode?: string;
  readonly isClubAdmin?: boolean;
  readonly presidentOfClubIds?: readonly string[];
  readonly id?: string;
}

/** One (roleCode, unitCode?) assignment. Omit unitCode for a flat role (cfo, system-admin, …). */
export function testRole(roleCode: string, unitCode?: string, unitDescription?: string): AuthUserRole {
  return {
    roleCode,
    roleName: roleCode.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    unitCode: unitCode ?? null,
    unitDescription: unitDescription ?? (unitCode ? unitCode.replace(/_/g, ' ') : null),
  };
}

/** A page entry in the server-computed nav tree, so specs can assert on real nav shapes. */
export function testNavPage(pageCode: string, label = pageCode): AuthNavNode {
  return { pageCode, label, entryType: 'page', icon: null, routePath: `/app/${pageCode}`, children: [] };
}

export function testUser(roles: readonly AuthUserRole[], options: TestUserOptions = {}): AuthUser {
  const primary = roles[0];
  return {
    id: options.id ?? '1',
    email: options.email ?? 'test.user@demo.apu.edu.my',
    displayName: options.displayName ?? 'Test User',
    username: options.username ?? 'test.user',
    accountType: options.accountType ?? (roles.some((r) => r.roleCode === 'external-user') ? 'external' : 'internal'),
    roles,
    roleLabel: options.roleLabel ?? (primary ? (primary.unitDescription ? `${primary.roleName} — ${primary.unitDescription}` : primary.roleName) : 'Unassigned'),
    department: options.department ?? primary?.unitDescription ?? 'APU Community',
    nav: options.nav ?? [],
    ...(options.cafeteriaCode !== undefined ? { cafeteriaCode: options.cafeteriaCode } : {}),
    ...(options.isClubAdmin !== undefined ? { isClubAdmin: options.isClubAdmin } : {}),
    ...(options.presidentOfClubIds !== undefined ? { presidentOfClubIds: options.presidentOfClubIds } : {}),
  };
}

// Ready-made identities the specs reach for repeatedly.
export const TEST_STUDENT = testUser([testRole('student', 'school_of_computing', 'School of Computing')], {
  email: 'applicant@demo.apu.edu.my', displayName: 'Demo Applicant', username: 'applicant',
});
export const TEST_HEAD_OF_SCHOOL = testUser([testRole('head-of-school', 'school_of_computing', 'School of Computing')], {
  email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', username: 'hoshod',
});
export const TEST_FMB_HEAD = testUser([testRole('head-of-department', 'food_beverage_services', 'Food & Beverage Services')], {
  email: 'fmb@demo.apu.edu.my', displayName: 'F&B Demo', username: 'fmb',
});
export const TEST_LOGISTICS_STAFF = testUser([testRole('staff', 'logistics_and_facilities', 'Logistics and Facilities')], {
  email: 'logistics.staff@demo.apu.edu.my', displayName: 'Ahmad', username: 'logistics.staff',
});
export const TEST_CAFETERIA_MANAGER = testUser([testRole('cafeteria-manager', 'cafeteria__atrium_cafeteria', 'Atrium Cafeteria')], {
  email: 'cafeteria.manager@demo.apu.edu.my', displayName: 'Cafeteria Manager', username: 'cafeteria.manager',
  cafeteriaCode: 'cafeteria__atrium_cafeteria',
});
export const TEST_CFO = testUser([testRole('cfo')], {
  email: 'cfo@demo.apu.edu.my', displayName: 'CFO Demo', username: 'cfo',
});
export const TEST_SYSTEM_ADMIN = testUser([testRole('system-admin')], {
  email: 'system.admin@demo.apu.edu.my', displayName: 'System Admin', username: 'system.admin',
});
export const TEST_EXTERNAL_USER = testUser([testRole('external-user')], {
  email: 'guest@example.com', displayName: 'Guest User', username: 'guest',
});


/**
 * A token set for specs. `authenticated` requires a session, so a spec that
 * only sets a user would render as logged out. Expiry is far enough ahead that
 * no test triggers a refresh.
 */
export function testTokens(): AuthTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}
