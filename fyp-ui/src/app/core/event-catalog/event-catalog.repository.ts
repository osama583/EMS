import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DeletionPreview } from '../../shared/models/deletion.models';
import { ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogEntry } from './event-catalog.models';

export type EventCatalogResource = 'categories' | 'formats';

// Shared HTTP layer for both Event Categories and Event Formats — the two REST surfaces
// (/api/event-catalog/categories/... and /api/event-catalog/formats/...) are byte-for-byte
// identical in shape, so one parameterized repository avoids duplicating this boilerplate twice.
@Injectable({ providedIn: 'root' })
export class EventCatalogRepositoryImpl {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.eventCatalogApiUrl;

  private urlFor(resource: EventCatalogResource, path = ''): string {
    return `${this.baseUrl}/${resource}${path}`;
  }

  getEntries(resource: EventCatalogResource, activeOnly?: boolean): Observable<readonly EventCatalogEntry[]> {
    let params = new HttpParams();
    if (activeOnly) params = params.set('active', 'true');
    return this.http.get<readonly EventCatalogEntry[]>(this.urlFor(resource), { params });
  }
  createEntry(resource: EventCatalogResource, draft: EventCatalogDraft): Observable<EventCatalogEntry> {
    return this.http.post<EventCatalogEntry>(this.urlFor(resource), draft);
  }
  updateEntry(resource: EventCatalogResource, id: string, draft: EventCatalogDraft): Observable<EventCatalogEntry> {
    return this.http.put<EventCatalogEntry>(this.urlFor(resource, `/${encodeURIComponent(id)}`), draft);
  }
  setEntryActive(resource: EventCatalogResource, id: string, active: boolean): Observable<EventCatalogEntry> {
    return this.http.patch<EventCatalogEntry>(this.urlFor(resource, `/${encodeURIComponent(id)}/status`), { active });
  }
  checkEntryDeletion(resource: EventCatalogResource, id: string): Observable<DeletionPreview> {
    return this.http.get<DeletionPreview>(this.urlFor(resource, `/${encodeURIComponent(id)}/deletion-check`));
  }
  deleteEntry(resource: EventCatalogResource, id: string): Observable<EventCatalogEntry> {
    return this.http.delete<EventCatalogEntry>(this.urlFor(resource, `/${encodeURIComponent(id)}`));
  }
  restoreEntry(resource: EventCatalogResource, id: string): Observable<EventCatalogEntry> {
    return this.http.post<EventCatalogEntry>(this.urlFor(resource, `/${encodeURIComponent(id)}/restore`), {});
  }
  purgeEntry(resource: EventCatalogResource, id: string): Observable<void> {
    return this.http.delete<void>(this.urlFor(resource, `/${encodeURIComponent(id)}/purge`));
  }
  getDeletedEntries(resource: EventCatalogResource): Observable<readonly ArchivedEventCatalogEntry[]> {
    return this.http.get<readonly ArchivedEventCatalogEntry[]>(this.urlFor(resource, '/deleted'));
  }
}
