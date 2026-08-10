import { MOCK_AUTH_USERS } from '../auth/mock-users';
import { AdminUnitRecord, AdminUserRecord } from './admin-directory.models';

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const unitNames = [...new Set(MOCK_AUTH_USERS.map((user) => user.department))];

export const MOCK_ADMIN_UNITS: readonly AdminUnitRecord[] = unitNames.map((name) => ({
  id: `unit-${slug(name)}`,
  name,
  code: name.split(/\s+/).map((part) => part[0]).join('').toUpperCase().slice(0, 6),
  description: `Internal users and services assigned to ${name}.`,
  active: true,
}));

export const MOCK_ADMIN_USERS: readonly AdminUserRecord[] = MOCK_AUTH_USERS.map((user, index) => ({
  id: `user-${index + 1}`,
  displayName: user.displayName,
  username: user.username,
  email: user.email,
  role: user.role,
  roleLabel: user.roleLabel,
  unitId: `unit-${slug(user.department)}`,
  department: user.department,
  active: true,
}));

