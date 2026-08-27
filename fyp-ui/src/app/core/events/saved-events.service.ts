import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
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

  // Server-side paginated counterpart to getSavedEvents() above, for the /my-events/saved list
  // view - getSavedEvents() itself stays unpaginated because it also drives the app-wide "is this
  // saved" heart-icon state (SavedEventsService.refresh()), which needs the complete id set.
  searchSavedEvents(page: number, pageSize: number): Observable<SavedEventsResponse> {
    return this.http.get<SavedEventsResponse>(`${this.baseUrl}/saved/search`, { params: { page: String(page), pageSize: String(pageSize) } });
  }

  // Optimistic: the heart flips the instant you click it, not after the PUT/DELETE round-trips —
  // that's what "click and it updates" means. Flip first, then fire the request; roll the signal
  // back only if the server actually rejects it, so a slow network never reads as "did nothing".
  saveEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    this.savedIdsState.update((ids) => new Set([...ids, eventId]));
    this.error.set('');
    return this.http.put<SavedEventMutationResponse>(`${this.baseUrl}/saved/${encodeURIComponent(eventId)}`, {}).pipe(
      catchError((error) => {
        this.savedIdsState.update((ids) => { const next = new Set(ids); next.delete(eventId); return next; });
        this.error.set('Could not save this event.');
        return throwError(() => error);
      }),
    );
  }

  removeSavedEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    this.savedIdsState.update((ids) => { const next = new Set(ids); next.delete(eventId); return next; });
    this.error.set('');
    return this.http.delete<SavedEventMutationResponse>(`${this.baseUrl}/saved/${encodeURIComponent(eventId)}`, { params: { email: userEmail.trim().toLowerCase() } }).pipe(
      catchError((error) => {
        this.savedIdsState.update((ids) => new Set([...ids, eventId]));
        this.error.set('Could not remove this event.');
        return throwError(() => error);
      }),
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
