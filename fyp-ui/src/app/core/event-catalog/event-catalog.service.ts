import { Injectable, computed, inject, signal } from '@angular/core';
import { BehaviorSubject, Observable, catchError, finalize, of, shareReplay, switchMap, tap } from 'rxjs';
import { DeletionPreview } from '../../shared/models/deletion.models';
import { ArchivedEventCatalogEntry, EventCatalogDraft, EventCatalogEntry } from './event-catalog.models';
import { EventCatalogRepositoryImpl, EventCatalogResource } from './event-catalog.repository';

// Base class shared by EventCategoryService/EventFormatService below — each subclass just fixes
// `resource` to 'categories' or 'formats' against the identical REST surface.
export abstract class EventCatalogEntryService {
  private readonly repository = inject(EventCatalogRepositoryImpl);
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);

  // catchError inside the switchMap (not around the whole pipe) is load-bearing: shareReplay replays a
  // completed/errored source verbatim to every future subscriber, including ones that arrive after a
  // later refresh() — so if getEntries() ever errors even once (a transient network blip), the shared
  // stream would die permanently and no subsequent create/update/ refresh() would ever repopulate
  // entriesSignal again (create/update themselves still succeed against the API; only the list view
  // would stay stuck empty).
  private readonly entries$: Observable<readonly EventCatalogEntry[]> = this.refreshRequests.pipe(
    switchMap(() => this.repository.getEntries(this.resource).pipe(catchError(() => of([] as readonly EventCatalogEntry[])))),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  private readonly entriesSignal = signal<readonly EventCatalogEntry[]>([]);
  readonly loading = signal(true);
  readonly entries = computed(() => this.entriesSignal());
  readonly activeEntries = computed(() => this.entriesSignal().filter((e) => e.active));

  readonly deletedEntries = signal<readonly ArchivedEventCatalogEntry[]>([]);
  readonly deletedLoading = signal(false);

  // `resource` is read by the constructor below (via entries$'s first subscription, which fires
  // synchronously since refreshRequests is a BehaviorSubject) — it must therefore be passed in through
  // this constructor parameter rather than left as a subclass field initializer.
  constructor(protected readonly resource: EventCatalogResource) {
    this.entries$.subscribe({
      next: (entries) => { this.entriesSignal.set(entries); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private refresh(): void { this.refreshRequests.next(); }

  loadDeleted(): void {
    this.deletedLoading.set(true);
    this.repository.getDeletedEntries(this.resource).pipe(finalize(() => this.deletedLoading.set(false))).subscribe({
      next: (entries) => this.deletedEntries.set(entries),
      error: () => this.deletedEntries.set([]),
    });
  }

  create(draft: EventCatalogDraft): Observable<EventCatalogEntry> { return this.repository.createEntry(this.resource, draft).pipe(tap(() => this.refresh())); }
  update(id: string, draft: EventCatalogDraft): Observable<EventCatalogEntry> { return this.repository.updateEntry(this.resource, id, draft).pipe(tap(() => this.refresh())); }
  setActive(id: string, active: boolean): Observable<EventCatalogEntry> { return this.repository.setEntryActive(this.resource, id, active).pipe(tap(() => this.refresh())); }
  checkDeletion(id: string): Observable<DeletionPreview> { return this.repository.checkEntryDeletion(this.resource, id); }
  delete(id: string): Observable<EventCatalogEntry> { return this.repository.deleteEntry(this.resource, id).pipe(tap(() => this.refresh())); }
  restore(id: string): Observable<EventCatalogEntry> { return this.repository.restoreEntry(this.resource, id).pipe(tap(() => { this.refresh(); this.loadDeleted(); })); }
  purge(id: string): Observable<void> { return this.repository.purgeEntry(this.resource, id).pipe(tap(() => this.loadDeleted())); }
}

@Injectable({ providedIn: 'root' })
export class EventCategoryService extends EventCatalogEntryService {
  constructor() { super('categories'); }
}

@Injectable({ providedIn: 'root' })
export class EventFormatService extends EventCatalogEntryService {
  constructor() { super('formats'); }
}
