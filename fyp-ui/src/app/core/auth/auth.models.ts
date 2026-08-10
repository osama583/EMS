export enum UserRole {
  ExternalUser = 'external-user',
  Applicant = 'applicant',
  ClubPresident = 'club-president',
  HosHod = 'hos-hod',
  Cfo = 'cfo',
  Fmb = 'fmb',
  CafeteriaManager = 'cafeteria-manager',
  CafeteriaStaff = 'cafeteria-staff',
  CafeteriaAdmin = 'cafeteria-admin',
  LogisticsManager = 'logistics-manager',
  LogisticsStaff = 'logistics-staff',
  StudentServicesManager = 'student-services-manager',
  StudentServicesMember = 'student-services-member',
  AvManager = 'av-manager',
  AvTechnician = 'av-technician',
  PhotographyManager = 'photography-manager',
  PhotographyStaff = 'photography-staff',
  TransportManager = 'transport-manager',
  TransportStaff = 'transport-staff',
  SystemAdmin = 'system-admin',
}

export type UserAccountType = 'internal' | 'external';

export const EXTERNAL_ACCOUNTS_STORAGE_KEY = 'apu-ems-external-accounts';

export interface AuthUser {
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  readonly role: UserRole;
  readonly accountType: UserAccountType;
  readonly roleLabel: string;
  readonly department: string;
  readonly photoUrl?: string;
}

export interface PersistedExternalAccount {
  readonly user: AuthUser;
  readonly password: string;
}

export interface AuthNavigationItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
}

export interface AuthNavigationSection {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly items: readonly AuthNavigationItem[];
}

export interface RoleNavigation {
  readonly defaultRoute: string;
  readonly primary: readonly AuthNavigationItem[];
  readonly sections: readonly AuthNavigationSection[];
}
