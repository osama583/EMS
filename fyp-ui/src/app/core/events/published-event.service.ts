import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { EventRegistration, PublishedEvent, RegistrationResult } from './published-event.models';
import { EventRegistrationApi, RegisteredEventsResponse } from './event-engagement.models';

const REGISTRATIONS_STORAGE_KEY = 'apu-ems-event-registrations';

const inDays = (days: number): string => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const event = (id: string, eventTitle: string, category: PublishedEvent['categories'][number], days: number, start: string, end: string, location: string, image: string, confirmed: number, registrationMode: PublishedEvent['registrationMode'], shortIntroduction: string): PublishedEvent => ({
  id, eventTitle, shortIntroduction, goals: 'Create meaningful opportunities for learning, participation and connection across APU.', expectedBenefits: 'Stronger campus engagement and a valuable experience for the APU community.', categories: [category], eventVisibility: 'Public', promotionMethod: 'APU event channels and campus communications.', eventFormat: location.includes('Park') ? 'Off Campus' : 'On Campus', eventImage: { url: image, fileName: image.split('/').at(-1) ?? 'event-image.jpg', mimeType: 'image/jpeg', sizeBytes: 0, status: 'uploaded' }, schoolDepartment: 'Student Affairs', audience: ['APU Community'], schedule: [{ date: inDays(days), start, end, location }], totalExpectedPax: Math.max(confirmed + 40, 100), registrationMode, confirmedRegistrationCount: confirmed, pendingRegistrationCount: registrationMode === 'Approval Required' ? 7 : 0, isFree: true,
});

const MOCK_EVENTS: readonly PublishedEvent[] = [
  event('evt-1', 'Startup Pitch Night', 'Academic & Career', 1, '18:30', '21:00', 'APU Atrium', '/assets/events/startup-pitch-night.jpg', 42, 'Automatic', 'Student founders present new ideas and receive practical feedback from the APU community.'),
  event('evt-2', 'Career Connect Fair', 'Academic & Career', 3, '10:00', '16:00', 'Level 3 Expo Hall', '/assets/events/career-connect-fair.jpg', 118, 'Automatic', 'Meet employers and alumni while exploring internships, careers and professional pathways.'),
  event('evt-3', 'Community Green Day', 'Volunteering', 5, '08:00', '12:00', 'Bukit Jalil Community Park', '/assets/events/community-green-day.jpg', 36, 'Approval Required', 'Join a student-led community programme focused on sustainability and practical volunteering.'),
  event('evt-4', 'Future Forward: Tech Expo', 'Workshops & Training', 7, '10:00', '17:00', 'APU Atrium', '/assets/events/tech-expo.jpg', 94, 'Automatic', 'Discover student technology projects, demonstrations and conversations about what comes next.'),
  event('evt-5', 'One World Cultural Night', 'Culture & Community', 9, '18:30', '22:00', 'APU Auditorium', '/assets/events/cultural-night.jpg', 164, 'Approval Required', 'Celebrate APU’s international community through student performances, food and cultural showcases.'),
  event('evt-6', 'APU Esports Showdown', 'Entertainment & Social', 12, '12:00', '20:00', 'Level 4 Arena', '/assets/events/esports-showdown.jpg', 73, 'Automatic', 'Campus teams compete in a welcoming tournament for players, supporters and first-time spectators.'),
  event('evt-7', 'Campus After Dark', 'Entertainment & Social', 16, '19:00', '22:30', 'Campus Plaza', '/assets/events/campus-after-dark.jpg', 87, 'Approval Required', 'An evening of student performances and campus activities designed for connection and discovery.'),
  event('evt-8', 'Wellness Run & Community Day', 'Sports & Wellness', 22, '07:00', '11:00', 'APU Main Entrance', '/assets/events/wellness-run.jpg', 129, 'Automatic', 'Move with friends and take part in accessible wellness activities across the APU community.'),
];

@Injectable({ providedIn: 'root' })
export class PublishedEventService implements EventRegistrationApi {
  private readonly document = inject(DOCUMENT);
  readonly events = signal<readonly PublishedEvent[]>(MOCK_EVENTS);
  readonly registrations = signal<readonly EventRegistration[]>(this.restoreRegistrations());

  constructor() {
    effect(() => this.persistRegistrations(this.registrations()));
  }

  getPublishedEvents(): Observable<readonly PublishedEvent[]> { return of(this.events()).pipe(delay(80)); }
  getEventDetails(id: string): Observable<PublishedEvent | undefined> { return of(this.events().find((item) => item.id === id)).pipe(delay(60)); }
  getRegistrationCount(id: string): Observable<number> { return of(this.events().find((item) => item.id === id)?.confirmedRegistrationCount ?? 0); }
  getPendingRegistrations(id: string): Observable<readonly EventRegistration[]> { return of(this.registrations().filter((item) => item.eventId === id && item.status === 'pending')); }
  registrationStatus(eventId: string, email: string): EventRegistration['status'] | null {
    return this.registrations().find((item) => item.eventId === eventId && item.email === email.trim().toLowerCase())?.status ?? null;
  }
  registerForEvent(eventId: string, email: string): Observable<RegistrationResult> {
    const normalized = email.trim().toLowerCase(); const current = this.events().find((item) => item.id === eventId);
    if (!current) return of<RegistrationResult>({ status: 'rejected', message: 'This event is no longer available.' });
    if (this.registrations().some((item) => item.eventId === eventId && item.email === normalized && item.status !== 'rejected')) return of<RegistrationResult>({ status: 'duplicate', message: 'This email already has a registration for this event.' }).pipe(delay(180));
    if (normalized.includes('reject')) return of<RegistrationResult>({ status: 'rejected', message: 'This mock registration was rejected.' }).pipe(delay(180));
    const status = current.registrationMode === 'Automatic' ? 'confirmed' : 'pending';
    this.registrations.update((items) => [...items, { id: `reg-${Date.now()}`, eventId, email: normalized, status }]);
    this.events.update((items) => items.map((item) => item.id === eventId ? { ...item, confirmedRegistrationCount: item.confirmedRegistrationCount + (status === 'confirmed' ? 1 : 0), pendingRegistrationCount: item.pendingRegistrationCount + (status === 'pending' ? 1 : 0) } : item));
    return of<RegistrationResult>({ status, message: status === 'confirmed' ? 'Registration confirmed.' : 'Registration submitted for approval.' }).pipe(delay(220));
  }
  approveRegistration(id: string): Observable<EventRegistration | undefined> { return this.resolve(id, 'confirmed'); }
  rejectRegistration(id: string): Observable<EventRegistration | undefined> { return this.resolve(id, 'rejected'); }

  isEventEnded(item: PublishedEvent): boolean {
    const schedule = item.schedule[0];
    if (!schedule) return false;
    const end = new Date(`${schedule.date}T${schedule.end || '23:59'}:00`);
    return end.getTime() < Date.now();
  }

  getActiveRegistrations(userEmail: string): Observable<RegisteredEventsResponse> {
    return of(this.buildRegisteredEntries(userEmail, (event, status) => status !== 'rejected' && !this.isEventEnded(event))).pipe(delay(120));
  }

  getRegistrationHistory(userEmail: string): Observable<RegisteredEventsResponse> {
    return of(this.buildRegisteredEntries(userEmail, (event, status) => status !== 'rejected' && this.isEventEnded(event))).pipe(delay(120));
  }

  private buildRegisteredEntries(
    userEmail: string,
    include: (event: PublishedEvent, status: EventRegistration['status']) => boolean,
  ): RegisteredEventsResponse {
    const normalized = userEmail.trim().toLowerCase();
    const items = this.registrations()
      .filter((registration) => registration.email === normalized)
      .map((registration) => ({ registration, event: this.events().find((item) => item.id === registration.eventId) }))
      .filter((entry): entry is { registration: EventRegistration; event: PublishedEvent } => !!entry.event && include(entry.event, entry.registration.status))
      .map((entry) => ({ event: entry.event, status: entry.registration.status }));
    return { items, total: items.length };
  }

  private resolve(id: string, status: 'confirmed' | 'rejected'): Observable<EventRegistration | undefined> { const record = this.registrations().find((item) => item.id === id); if (!record) return of(undefined); const updated = { ...record, status }; this.registrations.update((items) => items.map((item) => item.id === id ? updated : item)); if (record.status === 'pending') this.events.update((items) => items.map((item) => item.id === record.eventId ? { ...item, pendingRegistrationCount: Math.max(0, item.pendingRegistrationCount - 1), confirmedRegistrationCount: item.confirmedRegistrationCount + (status === 'confirmed' ? 1 : 0) } : item)); return of(updated).pipe(delay(180)); }

  private restoreRegistrations(): readonly EventRegistration[] {
    try {
      const raw = this.document?.defaultView?.localStorage.getItem(REGISTRATIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) as readonly EventRegistration[] : [];
    } catch { return []; }
  }

  private persistRegistrations(value: readonly EventRegistration[]): void {
    try { this.document.defaultView?.localStorage.setItem(REGISTRATIONS_STORAGE_KEY, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
  }
}
