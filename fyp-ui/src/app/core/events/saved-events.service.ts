import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import {
  NotificationPreference,
  SavedEventMutationResponse,
  SavedEventsApi,
  SavedEventsResponse,
} from './event-engagement.models';

@Injectable({ providedIn: 'root' })
export class SavedEventsService implements SavedEventsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = `${environment.apiBaseUrl}/events/me`;

  private readonly savedIdsState = signal<ReadonlySet<string>>(new Set());
  readonly savedEventIds = computed(() => this.savedIdsState());
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    this.refresh();
  }

  isSaved(eventId: string): boolean { return this.savedIdsState().has(eventId); }

  getSavedEvents(userEmail: string): Observable<SavedEventsResponse> {
    return this.http.get<SavedEventsResponse>(`${this.baseUrl}/saved`, { params: { email: userEmail.trim().toLowerCase() } });
  }

  saveEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    return this.http.post<SavedEventMutationResponse>(`${this.baseUrl}/saved`, { email: userEmail.trim().toLowerCase(), eventId }).pipe(
      tap(() => this.savedIdsState.update((ids) => new Set([...ids, eventId]))),
    );
  }

  removeSavedEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    return this.http.delete<SavedEventMutationResponse>(`${this.baseUrl}/saved/${encodeURIComponent(eventId)}`, { params: { email: userEmail.trim().toLowerCase() } }).pipe(
      tap(() => this.savedIdsState.update((ids) => { const next = new Set(ids); next.delete(eventId); return next; })),
    );
  }

  getNotificationPreferences(userEmail: string): Observable<NotificationPreference> {
    return this.http.get<NotificationPreference>(`${this.baseUrl}/notification-preferences`, { params: { email: userEmail.trim().toLowerCase() } });
  }

  updateNotificationPreferences(userEmail: string, preferences: NotificationPreference): Observable<NotificationPreference> {
    return this.http.put<NotificationPreference>(`${this.baseUrl}/notification-preferences`, { email: userEmail.trim().toLowerCase(), ...preferences });
  }

  refresh(): void {
    const user = this.auth.user();
    if (!user) { this.savedIdsState.set(new Set()); return; }
    this.loading.set(true);
    this.error.set('');
    this.getSavedEvents(user.email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { this.savedIdsState.set(new Set(response.items.map((item) => item.id))); this.loading.set(false); },
      error: () => { this.error.set('Could not load saved events.'); this.loading.set(false); },
    });
  }
}
