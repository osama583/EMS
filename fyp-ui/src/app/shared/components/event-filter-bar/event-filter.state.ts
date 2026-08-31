import { DOCUMENT } from '@angular/common';
import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { isSchoolStudentOrLecturer } from '../../../core/auth/role-access';
import { EventCatalogRepositoryImpl } from '../../../core/event-catalog/event-catalog.repository';
import { EventSearchParams, EventVisibility } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';

export type EventFilterKey =
  | 'visibility'
  | 'category'
  | 'school'
  | 'format'
  | 'date'
  | 'time'
  | 'registration'
  | 'cost'
  | 'club';

export type EventFilterSelection = Record<EventFilterKey, readonly string[]>;

export interface EventFilterGroup {
  readonly key: EventFilterKey;
  readonly label: string;
  readonly options: readonly string[];
  readonly wide?: boolean;
}

export interface EventFilterChip {
  readonly group: EventFilterKey;
  readonly value: string;
}

/** What a consumer needs to re-run its own query: the search box plus the applied selection. */
export interface EventFilterQuery {
  readonly q: string;
  readonly filters: EventFilterSelection;
  readonly customFrom: string;
  readonly customTo: string;
}

const FILTER_KEYS: readonly EventFilterKey[] = [
  'visibility', 'category', 'school', 'format', 'date', 'time', 'registration', 'cost', 'club',
];

function emptySelection(): EventFilterSelection {
  return {
    visibility: [], category: [], school: [], format: [],
    date: [], time: [], registration: [], cost: [], club: [],
  };
}

function cloneSelection(selection: EventFilterSelection): EventFilterSelection {
  return {
    visibility: [...selection.visibility],
    category: [...selection.category],
    school: [...selection.school],
    format: [...selection.format],
    date: [...selection.date],
    time: [...selection.time],
    registration: [...selection.registration],
    cost: [...selection.cost],
    club: [...selection.club],
  };
}

/**
 * The search term + filter selection behind an event list, shared by Explore Events and every
 * My Events tab so the two can never drift into offering different filters, different labels or
 * a different draft/apply flow.
 *
 * Owned by the consuming component (`readonly filters = new EventFilterState()` in a field
 * initializer, which runs in an injection context) and handed to `<app-event-filter-bar>` /
 * `<app-event-filter-dialog>` to render. It holds no results: the consumer turns `query()` into
 * whichever request its own list is built from, which is what keeps the filtering server-side
 * rather than a re-filter of the page already on screen.
 */
export class EventFilterState {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly catalog = inject(EventCatalogRepositoryImpl);
  private readonly events = inject(PublishedEventService);

  readonly searchTerm = signal('');
  readonly filterOpen = signal(false);
  readonly appliedFilters = signal<EventFilterSelection>(emptySelection());
  readonly draftFilters = signal<EventFilterSelection>(emptySelection());
  readonly appliedCustomFrom = signal('');
  readonly appliedCustomTo = signal('');
  readonly draftCustomFrom = signal('');
  readonly draftCustomTo = signal('');

  /** Emits on every draft edit, for the dialog's debounced "Show N Results" preview. */
  readonly draftChanges = new Subject<void>();

  /**
   * The dialog's live "Show N Results" count, written by whichever consumer owns the count
   * request (the query differs per list). Held here, not in the consumer, so opening the dialog
   * clears it in one place — a count left over from the previous session would otherwise sit on
   * the button describing a selection that is no longer on screen.
   */
  readonly draftPreviewCount = signal<number | null>(null);

  private readonly schools = signal<readonly string[]>([]);
  private readonly categories = signal<readonly string[]>([]);
  private readonly formats = signal<readonly string[]>([]);
  private optionsRequested = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.document.body.classList.remove('filters-open'));
  }

  /** Everything the list is currently narrowed by — read this to drive the data load. */
  readonly query = computed<EventFilterQuery>(() => ({
    q: this.searchTerm().trim(),
    filters: this.appliedFilters(),
    customFrom: this.appliedCustomFrom(),
    customTo: this.appliedCustomTo(),
  }));

  readonly draftQuery = computed<EventFilterQuery>(() => ({
    q: this.searchTerm().trim(),
    filters: this.draftFilters(),
    customFrom: this.draftCustomFrom(),
    customTo: this.draftCustomTo(),
  }));

  readonly appliedChips = computed<readonly EventFilterChip[]>(() =>
    FILTER_KEYS.flatMap((group) => this.appliedFilters()[group].map((value) => ({ group, value }))),
  );
  readonly appliedCount = computed(() => this.appliedChips().length);

  // Only Students and Lecturers can ever be part of a club (as a member or as President — see
  // AuthUser.presidentOfClubIds, a data fact, not a role), so offering "Club Only" to any other
  // role would be misleading UI rather than a filter that simply returns nothing.
  private readonly canSeeClubOnly = computed(() => {
    const user = this.auth.user();
    return !!user && isSchoolStudentOrLecturer(user);
  });

  private readonly canFilterByMyClubs = computed(() => {
    const user = this.auth.user();
    if (!user) return false;
    return isSchoolStudentOrLecturer(user) || (user.presidentOfClubIds?.length ?? 0) > 0;
  });

  // Events can carry a null/blank schoolDepartment, and a null here used to throw
  // (null.localeCompare) from inside a computed, which aborts the whole change-detection pass.
  private readonly schoolOptions = computed(() =>
    [...this.schools()].filter((name): name is string => !!name).sort((a, b) => a.localeCompare(b)),
  );

  readonly groups = computed<readonly EventFilterGroup[]>(() => [
    {
      key: 'visibility' as const,
      label: 'Event Visibility',
      options: this.canSeeClubOnly() ? ['Public', 'Internal', 'Club Only'] : ['Public', 'Internal'],
    },
    { key: 'category', label: 'Category', options: this.categories(), wide: true },
    { key: 'school', label: 'School or Department', options: this.schoolOptions(), wide: true },
    { key: 'format', label: 'Event Format', options: this.formats() },
    {
      key: 'date',
      label: 'Date',
      options: ['Today', 'Tomorrow', 'This Week', 'This Weekend', 'This Month', 'Custom Date Range'],
      wide: true,
    },
    { key: 'time', label: 'Time', options: ['Morning', 'Afternoon', 'Evening'] },
    {
      key: 'registration',
      label: 'Registration',
      options: ['No Registration Required', 'Registration Required'],
    },
    { key: 'cost', label: 'Cost', options: ['Free', 'Paid'] },
    // Only shown to someone who could actually have club events to narrow to — for everyone else
    // the filter could only ever return nothing, which reads as broken rather than empty.
    ...(this.canFilterByMyClubs()
      ? [{ key: 'club' as const, label: 'Club', options: ['My Clubs'] }]
      : []),
  ]);

  /**
   * Loads the category/format/school option lists. Called on first open rather than on
   * construction, so a list whose filter dialog is never opened costs no requests.
   */
  loadOptions(): void {
    if (this.optionsRequested) return;
    this.optionsRequested = true;
    // Active-only, straight from the catalog — not EventCategoryService/EventFormatService's
    // entries(), which deliberately include archived rows for admin management.
    this.catalog.getEntries('categories', true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (entries) => this.categories.set(entries.map((entry) => entry.name)),
      error: () => this.categories.set([]),
    });
    this.catalog.getEntries('formats', true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (entries) => this.formats.set(entries.map((entry) => entry.name)),
      error: () => this.formats.set([]),
    });
    this.events.getEventSchools().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (schools) => this.schools.set(schools),
      error: () => this.schools.set([]),
    });
  }

  setSearchTerm(value: string): void { this.searchTerm.set(value); }

  open(): void {
    this.loadOptions();
    this.draftPreviewCount.set(null);
    this.draftFilters.set(cloneSelection(this.appliedFilters()));
    this.draftCustomFrom.set(this.appliedCustomFrom());
    this.draftCustomTo.set(this.appliedCustomTo());
    this.filterOpen.set(true);
    this.document.body.classList.add('filters-open');
  }

  close(): void {
    this.filterOpen.set(false);
    this.document.body.classList.remove('filters-open');
  }

  toggleDraft(group: EventFilterKey, value: string): void {
    this.draftFilters.update((filters) => {
      const current = filters[group];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...filters, [group]: next };
    });
    this.draftChanges.next();
  }

  isDraftSelected(group: EventFilterKey, value: string): boolean {
    return this.draftFilters()[group].includes(value);
  }

  setCustomDate(edge: 'from' | 'to', value: string): void {
    if (edge === 'from') this.draftCustomFrom.set(value);
    else this.draftCustomTo.set(value);
    this.draftChanges.next();
  }

  resetDraft(): void {
    this.draftFilters.set(emptySelection());
    this.draftCustomFrom.set('');
    this.draftCustomTo.set('');
    this.draftChanges.next();
  }

  apply(): void {
    this.appliedFilters.set(cloneSelection(this.draftFilters()));
    this.appliedCustomFrom.set(this.draftCustomFrom());
    this.appliedCustomTo.set(this.draftCustomTo());
    this.close();
  }

  removeApplied(group: EventFilterKey, value: string): void {
    const without = (filters: EventFilterSelection): EventFilterSelection => ({
      ...filters,
      [group]: filters[group].filter((item) => item !== value),
    });
    this.appliedFilters.update(without);
    this.draftFilters.update(without);
    if (group === 'date' && value === 'Custom Date Range') {
      this.appliedCustomFrom.set('');
      this.appliedCustomTo.set('');
      this.draftCustomFrom.set('');
      this.draftCustomTo.set('');
    }
  }

  clearApplied(): void {
    this.appliedFilters.set(emptySelection());
    this.draftFilters.set(emptySelection());
    this.appliedCustomFrom.set('');
    this.appliedCustomTo.set('');
    this.draftCustomFrom.set('');
    this.draftCustomTo.set('');
  }
}

/**
 * One filter selection as the query params every event-list endpoint understands — Explore's
 * /events/search, /events/me/saved/search and /events/me/registrations all parse them with the
 * same server-side builder (events.py's _list_events_filters).
 */
export function toEventSearchParams(
  query: EventFilterQuery,
  page: number,
  pageSize: number,
): EventSearchParams {
  const usesCustomRange = query.filters.date.includes('Custom Date Range');
  return {
    q: query.q || undefined,
    visibility: query.filters.visibility as readonly EventVisibility[],
    category: query.filters.category,
    school: query.filters.school,
    format: query.filters.format,
    time: query.filters.time as EventSearchParams['time'],
    registration: query.filters.registration as EventSearchParams['registration'],
    cost: query.filters.cost as EventSearchParams['cost'],
    club: query.filters.club,
    date: query.filters.date,
    dateFrom: usesCustomRange ? query.customFrom || undefined : undefined,
    dateTo: usesCustomRange ? query.customTo || undefined : undefined,
    page,
    pageSize,
  };
}
