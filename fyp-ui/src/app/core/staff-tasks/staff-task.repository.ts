import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable, delay, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskStatus } from './staff-task.models';

const STAFF_EMAIL: Readonly<Partial<Record<UserRole, string>>> = {
  [UserRole.CafeteriaStaff]: 'cafeteria.staff@demo.apu.edu.my',
  [UserRole.LogisticsStaff]: 'logistics.staff@demo.apu.edu.my',
  [UserRole.StudentServicesMember]: 'student.services.member@demo.apu.edu.my',
  [UserRole.AvTechnician]: 'av.technician@demo.apu.edu.my',
  [UserRole.PhotographyStaff]: 'photographer@demo.apu.edu.my',
  [UserRole.TransportStaff]: 'transport.staff@demo.apu.edu.my',
};
const task = (id: string, role: UserRole, eventCode: string, eventTitle: string, request: string, detailLabel: string, detail: string, schedule: string, location: string, status: StaffTaskStatus = 'assigned', quantity?: string): StaffTask =>
  ({ id, role, assignedToEmail: STAFF_EMAIL[role] ?? '', eventCode, eventTitle, request, detailLabel, detail, schedule, location, status, quantity, ...(status === 'completed' ? { completedAt: '2 Aug 2026, 5:30 PM' } : {}) });

const MOCK_TASKS: readonly StaffTask[] = [
  task('student-1', UserRole.StudentServicesMember, 'EVT-260142', 'APU Cultural Night 2026', 'Campus overview tour', 'Tour route', 'Main Lobby to innovation labs and student spaces', '8 Aug 2026 - 3:00 PM-4:00 PM', 'Main Lobby', 'assigned', '30 visitors'),
  task('student-h1', UserRole.StudentServicesMember, 'EVT-260074', 'Clubs and Societies Fair', 'Student-life campus tour', 'Tour route', 'Main Lobby to the Spine', '18 Jul 2026 - 9:00 AM-10:00 AM', 'Main Lobby', 'completed', '22 visitors'),
  task('water-1', UserRole.CafeteriaStaff, 'EVT-260142', 'APU Cultural Night 2026', 'Mineral Water with APU Logo', 'Delivery requirement', 'Prepare and deliver before registration', '8 Aug 2026 - by 3:00 PM', 'Atrium', 'assigned', '180 bottles'),
  task('water-2', UserRole.CafeteriaStaff, 'EVT-260137', 'Future Tech Showcase', 'Mineral Water Normal', 'Delivery requirement', 'Place at exhibitor stations', '12 Aug 2026 - by 9:30 AM', 'Design Studio', 'preparing', '96 bottles'),
  task('water-h1', UserRole.CafeteriaStaff, 'EVT-260082', 'Graduate Networking Evening', 'Mineral Water Normal', 'Delivery requirement', 'Delivered to guest tables', '23 Jul 2026 - 4:00 PM', 'Auditorium 2', 'completed', '120 bottles'),
  task('caf-1', UserRole.CafeteriaStaff, 'EVT-260142', 'APU Cultural Night 2026', 'International buffet service', 'Dietary information', 'Vegetarian and halal selections', '8 Aug 2026 · 4:00 PM–9:00 PM', 'Atrium', 'assigned', '180 meals'),
  task('caf-2', UserRole.CafeteriaStaff, 'EVT-260118', 'Graduate Networking Evening', 'Refreshment order', 'Serving unit', 'Individual packs', '6 Aug 2026 · 5:00 PM–7:30 PM', 'Auditorium 2', 'preparing', '90 packs'),
  task('caf-h1', UserRole.CafeteriaStaff, 'EVT-260082', 'Research Showcase', 'Lunch service', 'Dietary information', 'Mixed menu', '23 Jul 2026 · 11:00 AM–2:00 PM', 'Atrium', 'completed', '120 meals'),
  task('log-1', UserRole.LogisticsStaff, 'EVT-260142', 'APU Cultural Night 2026', 'Banquet chair setup', 'Inventory item', 'Banquet chairs', '8 Aug 2026 · 1:00 PM–3:30 PM', 'Atrium', 'assigned', '180 / 200 chairs'),
  task('log-2', UserRole.LogisticsStaff, 'EVT-260131', 'Entrepreneurship Bootcamp', 'Registration desk setup', 'Inventory item', 'Folding tables', '7 Aug 2026 · 8:00 AM–9:00 AM', 'Design Studio', 'preparing', '8 / 12 tables'),
  task('log-h1', UserRole.LogisticsStaff, 'EVT-260090', 'Student Club Fair', 'Booth setup', 'Inventory item', 'Display booths', '25 Jul 2026 · 8:00 AM–10:00 AM', 'Spine', 'completed', '24 booths'),
  task('av-1', UserRole.AvTechnician, 'EVT-260142', 'APU Cultural Night 2026', 'Main-stage sound and lighting', 'Equipment', 'Digital mixer, stage wash and wireless microphones', '8 Aug 2026 · 2:00 PM–10:00 PM', 'Atrium', 'assigned'),
  task('av-2', UserRole.AvTechnician, 'EVT-260118', 'Graduate Networking Evening', 'Presentation setup', 'Equipment', 'Projector, lectern microphone and confidence monitor', '6 Aug 2026 · 3:30 PM–8:00 PM', 'Auditorium 2', 'preparing'),
  task('av-h1', UserRole.AvTechnician, 'EVT-260084', 'Industry Talk', 'Lecture capture setup', 'Equipment', 'Camera feed and microphones', '22 Jul 2026 · 9:00 AM–12:00 PM', 'Auditorium 1', 'completed'),
  task('photo-1', UserRole.PhotographyStaff, 'EVT-260142', 'APU Cultural Night 2026', 'Photo and video coverage', 'Personnel', '2 photographers and 1 videographer', '8 Aug 2026 · 4:00 PM–10:00 PM', 'Atrium', 'assigned'),
  task('photo-2', UserRole.PhotographyStaff, 'EVT-260118', 'Graduate Networking Evening', 'Event photography', 'Personnel', '1 photographer', '6 Aug 2026 · 5:00 PM–8:00 PM', 'Auditorium 2', 'preparing'),
  task('photo-h1', UserRole.PhotographyStaff, 'EVT-260080', 'Awards Ceremony', 'Event photography', 'Personnel', '2 photographers', '20 Jul 2026 · 6:00 PM–9:00 PM', 'Atrium', 'completed'),
  task('transport-1', UserRole.TransportStaff, 'EVT-260139', 'Industry Visit', 'Campus shuttle trip', 'Passengers', '28 pax · 40-seat bus', '9 Aug 2026 · 7:30 AM–5:00 PM', 'APU → Cyberjaya → APU', 'assigned'),
  task('transport-2', UserRole.TransportStaff, 'EVT-260126', 'Airport Welcome Programme', 'Airport transfer', 'Passengers', '12 pax · 15-seat van', '5 Aug 2026 · 9:00 AM–12:30 PM', 'KLIA → APU Residence', 'preparing'),
  task('transport-h1', UserRole.TransportStaff, 'EVT-260078', 'Community Outreach', 'Return shuttle', 'Passengers', '32 pax · 40-seat bus', '19 Jul 2026 · 8:00 AM–6:00 PM', 'APU → Klang → APU', 'completed'),
];

@Injectable({ providedIn: 'root' })
export class MockStaffTaskRepository implements StaffTaskRepository {
  private readonly tasks = new BehaviorSubject<readonly StaffTask[]>(MOCK_TASKS);
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.tasks.pipe(map((items) => items.filter((item) => item.role === role && item.assignedToEmail.toLowerCase() === assignedToEmail.toLowerCase()))); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> {
    const duplicate = this.tasks.value.find((item) => item.eventCode === draft.eventCode && item.request === draft.request && item.assignedToEmail === draft.assignedToEmail);
    if (duplicate) return of(duplicate);
    const created: StaffTask = { ...draft, id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, status: 'assigned' };
    return of(created).pipe(delay(180), tap((saved) => this.tasks.next([...this.tasks.value, saved])));
  }
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask> {
    const current = this.tasks.value.find((item) => item.id === id);
    if (!current) return throwError(() => new Error('Task not found.'));
    const updated: StaffTask = { ...current, status, ...(status === 'completed' ? { completedAt: new Date().toLocaleString('en-MY') } : {}) };
    return of(updated).pipe(delay(180), tap((saved) => this.tasks.next(this.tasks.value.map((item) => item.id === id ? saved : item))));
  }
}

@Injectable({ providedIn: 'root' })
export class ApiStaffTaskRepository implements StaffTaskRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.staffTasksApiUrl;
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.http.get<readonly StaffTask[]>(this.baseUrl, { params: { role, assignedToEmail } }); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> { return this.http.post<StaffTask>(`${this.baseUrl}/assignments`, draft); }
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask> { return this.http.patch<StaffTask>(`${this.baseUrl}/${encodeURIComponent(id)}/status`, { status }); }
}

export const STAFF_TASK_REPOSITORY = new InjectionToken<StaffTaskRepository>('STAFF_TASK_REPOSITORY', {
  providedIn: 'root', factory: () => environment.useMockStaffTasks ? inject(MockStaffTaskRepository) : inject(ApiStaffTaskRepository),
});
