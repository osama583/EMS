import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { PublishedEventService } from './published-event.service';
import {
  NotificationPreference,
  SavedEventMutationResponse,
  SavedEventsApi,
  SavedEventsResponse,
} from './event-engagement.models';

interface PersistedEngagement {
  readonly savedByUser: Record<string, readonly string[]>;
  readonly preferencesByUser: Record<string, NotificationPreference>;
}

const STORAGE_KEY = 'apu-ems-event-engagement';
const DEFAULT_PREFERENCES: NotificationPreference = {
  registrationClosingReminder: true,
  eventStartingReminder: true,
  registrationClosingStatus: 'pending-api',
  eventStartingStatus: 'pending-api',
};

@Injectable({ providedIn: 'root' })
export class SavedEventsService implements SavedEventsApi {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly events = inject(PublishedEventService);
  private state = this.restore();

  readonly savedEventIds = signal<ReadonlySet<string>>(new Set());
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    effect(() => {
      const email = this.auth.user()?.email.trim().toLowerCase();
      this.savedEventIds.set(new Set(email ? this.state.savedByUser[email] ?? [] : []));
    });
  }

  isSaved(eventId: string): boolean { return this.savedEventIds().has(eventId); }

  getSavedEvents(userEmail: string): Observable<SavedEventsResponse> {
    const ids = new Set(this.state.savedByUser[this.key(userEmail)] ?? []);
    const items = this.events.events().filter((event) => ids.has(event.id));
    return of({ items, total: items.length }).pipe(delay(120));
  }

  saveEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    const email = this.key(userEmail);
    const ids = new Set(this.state.savedByUser[email] ?? []);
    ids.add(eventId);
    this.state = { ...this.state, savedByUser: { ...this.state.savedByUser, [email]: [...ids] } };
    this.persist();
    this.syncCurrentUser(email, ids);
    return of({ eventId, saved: true }).pipe(delay(100));
  }

  removeSavedEvent(userEmail: string, eventId: string): Observable<SavedEventMutationResponse> {
    const email = this.key(userEmail);
    const ids = new Set(this.state.savedByUser[email] ?? []);
    ids.delete(eventId);
    this.state = { ...this.state, savedByUser: { ...this.state.savedByUser, [email]: [...ids] } };
    this.persist();
    this.syncCurrentUser(email, ids);
    return of({ eventId, saved: false }).pipe(delay(100));
  }

  getNotificationPreferences(userEmail: string): Observable<NotificationPreference> {
    return of(this.state.preferencesByUser[this.key(userEmail)] ?? DEFAULT_PREFERENCES).pipe(delay(80));
  }

  updateNotificationPreferences(userEmail: string, preferences: NotificationPreference): Observable<NotificationPreference> {
    const email = this.key(userEmail);
    this.state = { ...this.state, preferencesByUser: { ...this.state.preferencesByUser, [email]: preferences } };
    this.persist();
    return of(preferences).pipe(delay(100));
  }

  refresh(): void {
    const user = this.auth.user();
    if (!user) { this.savedEventIds.set(new Set()); return; }
    this.savedEventIds.set(new Set(this.state.savedByUser[this.key(user.email)] ?? []));
  }

  private syncCurrentUser(email: string, ids: ReadonlySet<string>): void {
    if (this.key(this.auth.user()?.email ?? '') === email) this.savedEventIds.set(new Set(ids));
  }

  private key(email: string): string { return email.trim().toLowerCase(); }
  private restore(): PersistedEngagement {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) as PersistedEngagement : { savedByUser: {}, preferencesByUser: {} };
    } catch { return { savedByUser: {}, preferencesByUser: {} }; }
  }
  private persist(): void {
    try { this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* Storage may be unavailable. */ }
  }
}
