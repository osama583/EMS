import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EventRegistration, PublishedEvent, RegistrationResult } from './published-event.models';
import { EventRegistrationApi, RegisteredEventsResponse } from './event-engagement.models';

@Injectable({ providedIn: 'root' })
export class PublishedEventService implements EventRegistrationApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.eventsApiUrl;

  getPublishedEvents(): Observable<readonly PublishedEvent[]> { return this.http.get<readonly PublishedEvent[]>(this.baseUrl); }
  getEventDetails(id: string): Observable<PublishedEvent | undefined> { return this.http.get<PublishedEvent>(`${this.baseUrl}/${encodeURIComponent(id)}`); }
  getRegistrationCount(id: string): Observable<number> { return this.http.get<{ count: number }>(`${this.baseUrl}/${encodeURIComponent(id)}/registration-count`).pipe(map((response) => response.count)); }
  getPendingRegistrations(id: string): Observable<readonly EventRegistration[]> { return this.http.get<readonly EventRegistration[]>(`${this.baseUrl}/${encodeURIComponent(id)}/registrations`, { params: { status: 'pending' } }); }

  getMyRegistration(eventId: string, email: string): Observable<EventRegistration | null> {
    return this.http.get<EventRegistration | null>(`${this.baseUrl}/${encodeURIComponent(eventId)}/registrations/mine`, { params: { email: email.trim().toLowerCase() } });
  }

  registerForEvent(eventId: string, email: string): Observable<RegistrationResult> {
    return this.http.post<RegistrationResult>(`${this.baseUrl}/${encodeURIComponent(eventId)}/register`, { email: email.trim().toLowerCase() });
  }
  approveRegistration(id: string): Observable<EventRegistration | undefined> { return this.http.post<EventRegistration>(`${this.baseUrl}/registrations/${encodeURIComponent(id)}/approve`, {}); }
  rejectRegistration(id: string): Observable<EventRegistration | undefined> { return this.http.post<EventRegistration>(`${this.baseUrl}/registrations/${encodeURIComponent(id)}/reject`, {}); }

  isEventEnded(item: PublishedEvent): boolean {
    const schedule = item.schedule[0];
    if (!schedule) return false;
    const end = new Date(`${schedule.date}T${schedule.end || '23:59'}:00`);
    return end.getTime() < Date.now();
  }

  getActiveRegistrations(userEmail: string): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/my-registrations`, { params: { email: userEmail.trim().toLowerCase(), scope: 'active' } });
  }

  getRegistrationHistory(userEmail: string): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/my-registrations`, { params: { email: userEmail.trim().toLowerCase(), scope: 'history' } });
  }
}
