import { Observable } from 'rxjs';
import { DeletionMetadata, DeletionPreview } from '../../shared/models/deletion.models';

// Event Categories & Event Formats — two structurally-identical, id-backed admin-managed
// catalogs (System Configuration -> Event Categories / Event Formats, server/routes/
// event-catalog.routes.js). `code` is server-derived from `name` (deriveUnitCode(), same slug
// convention as unit.code/role.role_code/nav_page.page_code) and immutable once created — never
// sent by the client on create/update.
export interface EventCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly active: boolean;
}

export interface EventCatalogDraft {
  readonly name: string;
  readonly active: boolean;
}

export type ArchivedEventCatalogEntry = EventCatalogEntry & DeletionMetadata;

export interface EventCatalogRepository {
  getEntries(activeOnly?: boolean): Observable<readonly EventCatalogEntry[]>;
  createEntry(draft: EventCatalogDraft): Observable<EventCatalogEntry>;
  updateEntry(id: string, draft: EventCatalogDraft): Observable<EventCatalogEntry>;
  setEntryActive(id: string, active: boolean): Observable<EventCatalogEntry>;
  checkEntryDeletion(id: string): Observable<DeletionPreview>;
  deleteEntry(id: string): Observable<EventCatalogEntry>;
  restoreEntry(id: string): Observable<EventCatalogEntry>;
  purgeEntry(id: string): Observable<void>;
  getDeletedEntries(): Observable<readonly ArchivedEventCatalogEntry[]>;
}
