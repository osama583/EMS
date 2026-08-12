import { AuthUser, UserRole } from './auth.models';

export interface MockAuthRecord extends AuthUser { readonly password: string; }

const roleDetails: Readonly<Record<UserRole, { label: string; department: string }>> = {
  [UserRole.ExternalUser]: { label: 'Registered External User', department: 'External Community' },
  [UserRole.Applicant]: { label: 'Applicant', department: 'APU Community' },
  [UserRole.ClubPresident]: { label: 'Club President', department: 'Student Clubs and Societies' },
  [UserRole.Student]: { label: 'Student', department: 'APU Community' },
  [UserRole.Lecturer]: { label: 'Lecturer', department: 'Academic Staff' },
  [UserRole.Staff]: { label: 'Staff', department: 'General Staff' },
  [UserRole.HosHod]: { label: 'HOS / HOD', department: 'School Leadership' },
  [UserRole.Cfo]: { label: 'CFO', department: 'Finance Office' },
  [UserRole.Fmb]: { label: 'F&B', department: 'Food & Beverage Services' },
  [UserRole.CafeteriaManager]: { label: 'Cafeteria Manager', department: 'Cafeteria Services' },
  [UserRole.CafeteriaStaff]: { label: 'Cafeteria Staff', department: 'Cafeteria Services' },
  [UserRole.CafeteriaAdmin]: { label: 'Cafeteria Admin', department: 'System Administration' },
  [UserRole.LogisticsManager]: { label: 'Logistics Manager', department: 'Logistics and Facilities' },
  [UserRole.LogisticsStaff]: { label: 'Logistics Staff', department: 'Logistics and Facilities' },
  [UserRole.StudentServicesManager]: { label: 'Student Services Manager', department: 'Student Services' },
  [UserRole.StudentServicesMember]: { label: 'Student Services Member', department: 'Student Services' },
  [UserRole.AvManager]: { label: 'A/V Manager', department: 'A/V Services' },
  [UserRole.AvTechnician]: { label: 'A/V Technician', department: 'A/V Services' },
  [UserRole.PhotographyManager]: { label: 'Photography Manager', department: 'Photography Services' },
  [UserRole.PhotographyStaff]: { label: 'Photography Staff', department: 'Photography Services' },
  [UserRole.TransportManager]: { label: 'Transport Manager', department: 'Transport Services' },
  [UserRole.TransportStaff]: { label: 'Transport Driver / Staff', department: 'Transport Services' },
  [UserRole.SystemAdmin]: { label: 'System Admin', department: 'System Administration' },
};

const account = (email: string, displayName: string, role: UserRole, options?: { department?: string; cafeteriaId?: number }): MockAuthRecord => ({
  email,
  displayName,
  username: email.split('@', 1)[0],
  role,
  accountType: 'internal',
  roleLabel: roleDetails[role].label,
  department: options?.department ?? roleDetails[role].department,
  password: 'Demo@123',
  ...(options?.cafeteriaId !== undefined ? { cafeteriaId: options.cafeteriaId } : {}),
});

export const MOCK_AUTH_USERS: readonly MockAuthRecord[] = [
  account('applicant@demo.apu.edu.my', 'Applicant Demo', UserRole.Applicant),
  account('club.president@demo.apu.edu.my', 'Club President Demo', UserRole.ClubPresident),
  account('cfo@demo.apu.edu.my', 'CFO Demo', UserRole.Cfo),
  account('fmb@demo.apu.edu.my', 'F&B Demo', UserRole.Fmb),
  account('cafeteria.manager@demo.apu.edu.my', 'Cafeteria Manager', UserRole.CafeteriaManager, { cafeteriaId: 1 }),
  account('cafeteria.staff@demo.apu.edu.my', 'Cafeteria Staff', UserRole.CafeteriaStaff),
  account('cafeteria.admin@demo.apu.edu.my', 'Cafeteria Admin', UserRole.CafeteriaAdmin),
  account('logistics.manager@demo.apu.edu.my', 'Logistics Manager', UserRole.LogisticsManager),
  account('logistics.staff@demo.apu.edu.my', 'Ahmad (Logistics Staff)', UserRole.LogisticsStaff),
  account('logistics.staff2@demo.apu.edu.my', 'David Tan (Logistics Tech)', UserRole.LogisticsStaff),
  account('logistics.staff3@demo.apu.edu.my', 'Sarah Lee (Logistics Assistant)', UserRole.LogisticsStaff),
  account('student.services.manager@demo.apu.edu.my', 'Student Services Manager', UserRole.StudentServicesManager),
  account('student.services.member@demo.apu.edu.my', 'Priyah (Student Services Member)', UserRole.StudentServicesMember),
  account('student.services.member2@demo.apu.edu.my', 'Jason Lim (Campus Tour Guide)', UserRole.StudentServicesMember),
  account('student.services.member3@demo.apu.edu.my', 'Chloe Tan (Student Ambassador)', UserRole.StudentServicesMember),
  account('av.manager@demo.apu.edu.my', 'A/V Manager', UserRole.AvManager),
  account('av.technician@demo.apu.edu.my', 'Marcus Vance (Senior A/V Tech)', UserRole.AvTechnician),
  account('av.technician2@demo.apu.edu.my', 'Ethan Wong (Sound Engineer)', UserRole.AvTechnician),
  account('av.technician3@demo.apu.edu.my', 'Nurul Huda (Lighting Specialist)', UserRole.AvTechnician),
  account('photography.manager@demo.apu.edu.my', 'Photography Manager', UserRole.PhotographyManager),
  account('photographer@demo.apu.edu.my', 'Alex Rivera (Photographer)', UserRole.PhotographyStaff),
  account('photographer2@demo.apu.edu.my', 'Samantha Ong (Videographer)', UserRole.PhotographyStaff),
  account('transport.manager@demo.apu.edu.my', 'Transport Manager', UserRole.TransportManager),
  account('transport.staff@demo.apu.edu.my', 'Captain Bob (Transport Driver)', UserRole.TransportStaff),
  account('transport.staff2@demo.apu.edu.my', 'Harish Kumar (Fleet Coordinator)', UserRole.TransportStaff),
  account('system.admin@demo.apu.edu.my', 'System Admin', UserRole.SystemAdmin),

  // Academic hierarchy demo: 2 schools, each with its own HOS reviewing only its own
  // students'/lecturers' proposals (unit-scoped — see workflow.service.js's isHosHodOfUnit).
  account('hos.computing@demo.apu.edu.my', 'Dr. Wei Chen (HOS, School of Computing)', UserRole.HosHod, { department: 'School of Computing' }),
  account('student.computing@demo.apu.edu.my', 'Aina Rahman (Computing Student)', UserRole.Student, { department: 'School of Computing' }),
  account('student.computing2@demo.apu.edu.my', 'Mei Ling Tan (Computing Student)', UserRole.Student, { department: 'School of Computing' }),
  account('lecturer.computing@demo.apu.edu.my', 'Dr. Kumar Selvam (Computing Lecturer)', UserRole.Lecturer, { department: 'School of Computing' }),

  account('hos.business@demo.apu.edu.my', 'Dr. Farah Aziz (HOS, School of Business)', UserRole.HosHod, { department: 'School of Business' }),
  account('student.business@demo.apu.edu.my', 'Daniel Wong (Business Student)', UserRole.Student, { department: 'School of Business' }),
  account('lecturer.business@demo.apu.edu.my', 'Dr. Siti Nurhaliza (Business Lecturer)', UserRole.Lecturer, { department: 'School of Business' }),

  // Non-academic hierarchy demo: 2 departments, each with its own HOD reviewing only its own
  // staff's proposals (same unit-scoped mechanism as the schools above).
  account('hod.marketing@demo.apu.edu.my', 'Encik Razif Hassan (HOD, Marketing)', UserRole.HosHod, { department: 'Marketing' }),
  account('staff.marketing@demo.apu.edu.my', 'Nurul Huda (Marketing Staff)', UserRole.Staff, { department: 'Marketing' }),
  account('staff.marketing2@demo.apu.edu.my', 'Jordan Lee (Marketing Staff)', UserRole.Staff, { department: 'Marketing' }),

  account('hod.finance@demo.apu.edu.my', 'Puan Aishah Karim (HOD, Finance)', UserRole.HosHod, { department: 'Finance' }),
  account('staff.finance@demo.apu.edu.my', 'Farah Izzati (Finance Staff)', UserRole.Staff, { department: 'Finance' }),
];
