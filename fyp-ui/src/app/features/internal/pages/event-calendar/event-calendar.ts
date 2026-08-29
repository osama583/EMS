import { DOCUMENT, DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { EventCategoryService } from '../../../../core/event-catalog/event-catalog.service';
import {
  MasterCalendarDay,
  MasterCalendarDayOccurrence,
  MasterCalendarEventDetail,
  MasterCalendarOccurrence,
  MasterCalendarSummary,
} from '../../../../core/events/master-calendar.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { ExpandableSearchComponent } from '../../../../shared/components/expandable-search/expandable-search';
import { FilterButtonComponent } from '../../../../shared/components/filter-button/filter-button';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';

type CalendarView = 'month' | 'week' | 'day';

// Same slot count the landing calendar uses (_event-calendar.scss ships this many styled
// `--slot-N` colors). Categories are an admin-managed catalog with no color of their own, so a
// color is assigned by catalog POSITION, never by category name — see categoryClassFor().
const CATEGORY_COLOR_SLOT_COUNT = 7;

// The only string a redacted row displays. The server sends no label with it: the label is a
// constant, and repeating it once per redacted occurrence would be payload spent telling the
// client something it already knows.
const RESTRICTED_LABEL = 'Restricted Club Event';

// The search box drives a SERVER-side query (events.py filters on title, organiser, venue and
// category in SQL), so keystrokes are debounced rather than sent one per character.
const SEARCH_DEBOUNCE_MS = 250;

// Matches event-calendar.scss's `@media (width <= 48rem)`, below which the desktop month grid is
// replaced by the tap grid + day panel. That panel is the only month-view surface that renders a
// day's list rows, so above this width, focusing a date must NOT fetch a day nothing will draw.
const COMPACT_LAYOUT_QUERY = '(max-width: 48rem)';

/**
 * One session of one event on one date — the master calendar renders a multi-day event once on
 * each of its dates, and the server sends it already expanded that way. `occurrenceId` keeps
 * those siblings distinct for @for tracking while `eventId` points back at the one proposal.
 *
 * This is the GRID shape and it is deliberately thin: a chip draws a title, a start time and a
 * category colour. Venue and organiser arrive one tier down (CalendarDayEntry), and everything
 * the detail dialog shows arrives one tier below that, when the dialog opens.
 */
interface CalendarEntry {
  readonly occurrenceId: string;
  readonly eventId: string;
  readonly dateKey: string;
  readonly date: Date;
  /** Redacted rows carry no title, time or venue at all — only that the date is occupied. */
  readonly restricted: boolean;
  readonly title: string;
  /** Raw 'HH:MM' start, kept so the dialog can match this session inside the event's schedule. */
  readonly start: string;
  /** '9:00 AM – 11:00 AM'. Empty for a redacted row. */
  readonly time: string;
  /** Just the start, which is all a chip has room for. */
  readonly startLabel: string;
  readonly sortMinutes: number;
  readonly category: string;
  readonly categoryClass: string;
  /** True while the event is only at department_review — on the calendar but not fully approved. */
  readonly provisional: boolean;
}

/** A day's list rows add the two fields a row shows and a chip does not. */
interface CalendarDayEntry extends CalendarEntry {
  readonly venue: string;
  readonly organiser: string;
}

interface CalendarDay {
  readonly date: Date;
  readonly key: string;
  readonly dayNumber: number;
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly entries: readonly CalendarEntry[];
  /** Private events on this date — a count only; the server sends no detail for them. */
  readonly privateCount: number;
}

@Component({
  selector: 'app-master-event-calendar',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    ExpandableSearchComponent,
    FilterButtonComponent,
    FormModalComponent,
    LoadingStateComponent,
  ],
  templateUrl: './event-calendar.html',
  styleUrl: './event-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MasterEventCalendarComponent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly eventService = inject(PublishedEventService);
  private readonly categoryService = inject(EventCategoryService);
  private readonly today = this.startOfDay(new Date());

  // Full names, as on the landing calendar's header row; the mobile grid takes the first letter.
  readonly weekDayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  readonly weekDayFullLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  readonly viewMode = signal<CalendarView>('month');
  readonly currentMonth = signal(this.startOfMonth(this.today));
  readonly focusedDate = signal(this.today);
  readonly searchTerm = signal('');
  readonly filterOpen = signal(false);
  readonly appliedCategories = signal<readonly string[]>([]);
  readonly draftCategories = signal<readonly string[]>([]);

  // True below COMPACT_LAYOUT_QUERY, where the mobile tap grid + day panel replace the desktop
  // month grid. Drives whether a focused date needs its day fetched at all.
  private readonly compactLayout = signal(false);

  // --- tier 1: the visible range's grid rows ------------------------------
  private readonly rangeEntries = signal<readonly CalendarEntry[]>([]);
  private readonly rangePrivateCounts = signal<Readonly<Record<string, number>>>({});
  private readonly rangeLoading = signal(true);
  private readonly rangeError = signal('');

  // --- tier 2: the focused day's list rows --------------------------------
  private readonly dayEntries = signal<readonly CalendarDayEntry[]>([]);
  private readonly dayPrivateCount = signal(0);
  readonly dayLoading = signal(false);

  // --- tier 3: the open dialog's event -----------------------------------
  readonly selectedEntry = signal<CalendarEntry | null>(null);
  readonly selectedDetail = signal<MasterCalendarEventDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');

  // A day's rows are re-read every time the viewer taps back to a date they have already opened,
  // so they are remembered for as long as the search term they were fetched under holds. Bounded
  // by how many distinct dates one visit actually opens, and dropped whenever `q` changes.
  private readonly dayCache = new Map<string, MasterCalendarDay>();
  private dayCacheSearch = '';
  // Detail is fetched once per event and kept, so reopening the same dialog is instant.
  private readonly detailCache = new Map<string, MasterCalendarEventDetail>();

  // The search box narrows the calendar server-side, so it is debounced. `q` starts empty and
  // distinctUntilChanged swallows the source's first (identical) emission, which keeps the very
  // first page load immediate rather than SEARCH_DEBOUNCE_MS late.
  private readonly debouncedSearch = toSignal(
    toObservable(this.searchTerm).pipe(
      map((term) => term.trim()),
      debounceTime(SEARCH_DEBOUNCE_MS),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );

  private readonly categorySlotByName = computed<ReadonlyMap<string, number>>(() => {
    const map = new Map<string, number>();
    this.categoryService
      .entries()
      .forEach((entry, index) => map.set(entry.name, (index % CATEGORY_COLOR_SLOT_COUNT) + 1));
    return map;
  });

  private categoryClassFor(categoryName: string): string {
    return `slot-${this.categorySlotByName().get(categoryName) ?? 1}`;
  }

  /**
   * What the grid draws. Day view has no grid and no range — its single day IS the whole view,
   * so it is served by tier 2 alone rather than fetching the same date twice.
   */
  private readonly gridEntries = computed<readonly CalendarEntry[]>(() =>
    this.viewMode() === 'day' ? this.dayEntries() : this.rangeEntries(),
  );

  private readonly privateCounts = computed<Readonly<Record<string, number>>>(() =>
    this.viewMode() === 'day'
      ? { [this.dateKey(this.focusedDate())]: this.dayPrivateCount() }
      : this.rangePrivateCounts(),
  );

  readonly loading = computed(() => (this.viewMode() === 'day' ? this.dayLoading() : this.rangeLoading()));
  readonly loadError = computed(() => this.rangeError());

  // Categories present in the currently-loaded range, so the legend and filter list describe
  // what is actually on screen rather than the whole admin catalog.
  readonly categoryOptions = computed<readonly { readonly name: string; readonly categoryClass: string }[]>(() => {
    const byName = new Map<string, string>();
    for (const entry of this.gridEntries()) {
      if (!entry.restricted) byName.set(entry.category, entry.categoryClass);
    }
    return [...byName.entries()]
      .map(([name, categoryClass]) => ({ name, categoryClass }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly appliedFilterCount = computed(() => this.appliedCategories().length);
  readonly draftResultCount = computed(
    () => this.gridEntries().filter((entry) => this.entryMatches(entry, this.draftCategories())).length,
  );

  // The exact [start, end] the visible surface needs. Month view renders a fixed 6-week (42-day)
  // grid that spills into the neighbouring months, so the query must cover the whole grid or
  // those spillover days would render empty. Week needs only its own span. Day is null: it is
  // tier 2's job, and asking for a one-day range here as well would fetch the date twice.
  private readonly rangeQuery = computed<{ start: string; end: string; q: string } | null>(() => {
    const mode = this.viewMode();
    const q = this.debouncedSearch();
    if (mode === 'day') return null;
    if (mode === 'week') {
      const weekStart = this.startOfWeek(this.focusedDate());
      return { start: this.dateKey(weekStart), end: this.dateKey(this.addDays(weekStart, 6)), q };
    }
    const month = this.currentMonth();
    const firstGridDay = this.addDays(month, -month.getDay());
    return { start: this.dateKey(firstGridDay), end: this.dateKey(this.addDays(firstGridDay, 41)), q };
  });

  /**
   * Which day, if any, needs its list rows. ONLY the surfaces that actually render them ask:
   * the day view at any width, and the mobile month panel below the compact breakpoint. On a
   * desktop month grid, moving the focused date draws nothing that uses a venue or an organiser,
   * so nothing is fetched — which is the whole point of keeping them out of tier 1.
   */
  private readonly dayQuery = computed<{ date: string; q: string } | null>(() => {
    const mode = this.viewMode();
    if (mode === 'week') return null;
    if (mode === 'month' && !this.compactLayout()) return null;
    return { date: this.dateKey(this.focusedDate()), q: this.debouncedSearch() };
  });

  readonly monthDays = computed<readonly CalendarDay[]>(() => {
    const month = this.currentMonth();
    const firstGridDay = this.addDays(month, -month.getDay());
    return Array.from({ length: 42 }, (_, index) =>
      this.toCalendarDay(this.addDays(firstGridDay, index), month),
    );
  });

  readonly weekDays = computed<readonly CalendarDay[]>(() => {
    const weekStart = this.startOfWeek(this.focusedDate());
    const month = this.currentMonth();
    return Array.from({ length: 7 }, (_, index) =>
      this.toCalendarDay(this.addDays(weekStart, index), month),
    );
  });

  readonly focusedDay = computed<CalendarDay>(() =>
    this.toCalendarDay(this.focusedDate(), this.currentMonth()),
  );

  // The day view and the mobile day panel both list the focused day in full, so both read tier 2
  // rather than the grid — a grid entry has no venue or organiser to show.
  readonly selectedDayEntries = computed<readonly CalendarDayEntry[]>(() => {
    const categories = this.appliedCategories();
    return this.dayEntries()
      .filter((entry) => this.entryMatches(entry, categories))
      .sort((a, b) => a.sortMinutes - b.sortMinutes || a.title.localeCompare(b.title));
  });

  readonly totalVisibleCount = computed(() => {
    const mode = this.viewMode();
    if (mode === 'day') return this.selectedDayEntries().length;
    const days = mode === 'month' ? this.monthDays() : this.weekDays();
    return days.reduce((sum, day) => sum + day.entries.length, 0);
  });

  readonly totalPrivateCount = computed(() => {
    const mode = this.viewMode();
    if (mode === 'day') return this.focusedDay().privateCount;
    const days = mode === 'month' ? this.monthDays() : this.weekDays();
    return days.reduce((sum, day) => sum + day.privateCount, 0);
  });

  readonly displayTitle = computed(() => {
    const mode = this.viewMode();
    if (mode === 'day') return this.formatDate(this.focusedDate(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (mode === 'week') {
      const start = this.startOfWeek(this.focusedDate());
      const end = this.addDays(start, 6);
      return `${this.formatDate(start, { day: 'numeric', month: 'short' })} – ${this.formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return this.formatDate(this.currentMonth(), { month: 'long', year: 'numeric' });
  });

  // The session the viewer actually clicked, found inside the event's full schedule so the dialog
  // reports that date's venue and time rather than the event's first. A chip carries no venue at
  // all (tier 1), which is exactly why the dialog reads it from here instead of from the entry.
  readonly selectedSession = computed(() => {
    const entry = this.selectedEntry();
    const detail = this.selectedDetail();
    if (!entry || !detail) return null;
    const onDate = detail.schedule.filter((session) => session.date === entry.dateKey);
    return onDate.find((session) => session.start === entry.start) ?? onDate[0] ?? null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.document.body.classList.remove('calendar-dialog-open'));
    this.watchCompactLayout();

    // TIER 1. Re-fetched whenever the visible range or the debounced search changes. switchMap
    // cancels the in-flight request for a range the viewer has already navigated away from.
    //
    // catchError sits INSIDE the switchMap, on the request itself, and that placement is
    // load-bearing rather than stylistic - the same rule EventCatalogEntryService documents.
    // An error that reaches the outer subscriber terminates the whole subscription, so a single
    // failed range request (the API restarting, a session expiring, one blip on the wire) would
    // permanently kill this pipeline: from then on, navigating months, typing in the search box
    // and switching views would all change rangeQuery and fetch NOTHING, with only the stale
    // error left on screen. Handling it per-request keeps the stream alive, so the very next
    // navigation tries again.
    toObservable(this.rangeQuery)
      .pipe(
        switchMap((query) => {
          if (!query) return of(null);
          this.rangeLoading.set(true);
          return this.eventService.getMasterCalendarSummary(query.start, query.end, query.q).pipe(
            catchError(() => {
              this.rangeError.set('The event calendar could not be loaded.');
              this.rangeLoading.set(false);
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => this.applySummary(response));

    // TIER 2. Only fires for a day something on screen will actually list. Same per-request
    // catchError as tier 1, and for the same reason: one failed day must not stop every later
    // day from being fetched. A null reaches applyDay(), which empties the panel.
    toObservable(this.dayQuery)
      .pipe(
        switchMap((query) => {
          if (!query) return of(null);
          const cached = this.cachedDay(query.date, query.q);
          if (cached) return of(cached);
          this.dayLoading.set(true);
          return this.eventService.getMasterCalendarDay(query.date, query.q).pipe(
            map((response) => this.rememberDay(query.date, response)),
            catchError(() => of(null)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => this.applyDay(response));
  }

  // Angular renders the mobile month panel at every width (CSS hides it above the breakpoint), so
  // without this the desktop grid would fetch a day's rows nothing on screen displays.
  private watchCompactLayout(): void {
    const view = this.document.defaultView;
    if (!view?.matchMedia) return;
    const media = view.matchMedia(COMPACT_LAYOUT_QUERY);
    this.compactLayout.set(media.matches);
    const onChange = (event: MediaQueryListEvent) => this.compactLayout.set(event.matches);
    media.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
  }

  private applySummary(response: MasterCalendarSummary | null): void {
    if (!response) return;
    this.rangeEntries.set(response.occurrences.map((occurrence) => this.toEntry(occurrence)));
    this.rangePrivateCounts.set(response.privateCounts ?? {});
    this.rangeError.set('');
    this.rangeLoading.set(false);
  }

  private applyDay(response: MasterCalendarDay | null): void {
    if (!response) {
      this.dayEntries.set([]);
      this.dayPrivateCount.set(0);
      this.dayLoading.set(false);
      return;
    }
    this.dayEntries.set(response.occurrences.map((occurrence) => this.toDayEntry(occurrence)));
    this.dayPrivateCount.set(response.privateCount ?? 0);
    this.dayLoading.set(false);
  }

  // The cache holds one search term's worth of days; a new term invalidates every entry in it at
  // once, since `q` is part of what the server filtered on.
  private cachedDay(date: string, search: string): MasterCalendarDay | undefined {
    if (this.dayCacheSearch !== search) {
      this.dayCache.clear();
      this.dayCacheSearch = search;
    }
    return this.dayCache.get(date);
  }

  private rememberDay(date: string, response: MasterCalendarDay): MasterCalendarDay {
    this.dayCache.set(date, response);
    return response;
  }

  private toEntry(occurrence: MasterCalendarOccurrence): CalendarEntry {
    if (occurrence.restricted) {
      return {
        occurrenceId: occurrence.occurrenceId,
        eventId: '',
        dateKey: occurrence.date,
        date: this.parseDate(occurrence.date),
        restricted: true,
        title: RESTRICTED_LABEL,
        start: '',
        time: '',
        startLabel: '',
        sortMinutes: Number.MAX_SAFE_INTEGER,
        category: '',
        categoryClass: 'restricted',
        provisional: false,
      };
    }
    const category = occurrence.category || 'Uncategorised';
    return {
      occurrenceId: occurrence.occurrenceId,
      eventId: occurrence.eventId,
      dateKey: occurrence.date,
      date: this.parseDate(occurrence.date),
      restricted: false,
      title: occurrence.title,
      start: occurrence.start,
      time: this.timeRange(occurrence.start, occurrence.end),
      startLabel: this.formatTime(occurrence.start),
      sortMinutes: this.minutesOf(occurrence.start),
      category,
      categoryClass: this.categoryClassFor(category),
      provisional: occurrence.provisional,
    };
  }

  private toDayEntry(occurrence: MasterCalendarDayOccurrence): CalendarDayEntry {
    const entry = this.toEntry(occurrence);
    if (occurrence.restricted) return { ...entry, venue: '', organiser: '' };
    return { ...entry, venue: occurrence.venue || 'To be confirmed', organiser: occurrence.organiser };
  }

  private toCalendarDay(date: Date, month: Date): CalendarDay {
    const key = this.dateKey(date);
    return {
      date,
      key,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth(),
      isToday: key === this.dateKey(this.today),
      entries: this.entriesForKey(key),
      privateCount: this.privateCounts()[key] ?? 0,
    };
  }

  private entriesForKey(key: string): readonly CalendarEntry[] {
    const categories = this.appliedCategories();
    return this.gridEntries()
      .filter((entry) => entry.dateKey === key && this.entryMatches(entry, categories))
      .sort((a, b) => a.sortMinutes - b.sortMinutes || a.title.localeCompare(b.title));
  }

  // Text search is the server's job now (it narrows the query rather than the rendered result),
  // so all that is left here is the category filter, which runs over a payload that already
  // carries every category on screen and therefore needs no round trip of its own.
  private entryMatches(entry: CalendarEntry, categories: readonly string[]): boolean {
    // A redacted row has nothing to match on. It survives an empty filter (the date is genuinely
    // occupied) but is correctly excluded the moment the viewer narrows by category.
    if (entry.restricted) return categories.length === 0;
    return categories.length === 0 || categories.includes(entry.category);
  }

  // --- navigation ---------------------------------------------------------
  navigate(direction: -1 | 1): void {
    const mode = this.viewMode();
    if (mode === 'day') {
      const next = this.addDays(this.focusedDate(), direction);
      this.focusedDate.set(next);
      this.currentMonth.set(this.startOfMonth(next));
      return;
    }
    if (mode === 'week') {
      const next = this.addDays(this.focusedDate(), direction * 7);
      this.focusedDate.set(next);
      this.currentMonth.set(this.startOfMonth(next));
      return;
    }
    const month = this.currentMonth();
    const next = new Date(month.getFullYear(), month.getMonth() + direction, 1);
    this.currentMonth.set(next);
    this.focusedDate.set(next);
  }

  goToToday(): void {
    this.currentMonth.set(this.startOfMonth(this.today));
    this.focusedDate.set(this.today);
  }

  setView(mode: CalendarView): void {
    this.viewMode.set(mode);
  }

  changeView(event: Event): void {
    this.setView((event.target as HTMLSelectElement).value as CalendarView);
  }

  selectDate(day: CalendarDay): void {
    this.focusedDate.set(day.date);
  }

  /** Tapping a day on mobile focuses it AND opens the day view for full detail. */
  openDayView(day: CalendarDay): void {
    this.focusedDate.set(day.date);
    this.setView('day');
  }

  // --- search & filters ---------------------------------------------------
  onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  openFilters(): void {
    this.draftCategories.set([...this.appliedCategories()]);
    this.filterOpen.set(true);
  }

  closeFilters(): void {
    this.filterOpen.set(false);
  }

  toggleDraftCategory(category: string): void {
    this.draftCategories.update((categories) =>
      categories.includes(category)
        ? categories.filter((item) => item !== category)
        : [...categories, category],
    );
  }

  isDraftCategorySelected(category: string): boolean {
    return this.draftCategories().includes(category);
  }

  resetFilters(): void {
    this.draftCategories.set([]);
  }

  applyFilters(): void {
    this.appliedCategories.set([...this.draftCategories()]);
    this.closeFilters();
  }

  // --- detail dialog ------------------------------------------------------
  /** Opening an event is what pays for its detail — nothing above this tier has fetched any. */
  openEntry(entry: CalendarEntry): void {
    // A redacted row has no detail to show, so it is deliberately not clickable.
    if (entry.restricted) return;
    this.selectedEntry.set(entry);
    this.document.body.classList.add('calendar-dialog-open');
    this.loadDetail(entry.eventId);
  }

  private loadDetail(eventId: string): void {
    this.detailError.set('');
    const cached = this.detailCache.get(eventId);
    if (cached) {
      this.selectedDetail.set(cached);
      this.detailLoading.set(false);
      return;
    }
    this.selectedDetail.set(null);
    this.detailLoading.set(true);
    this.eventService
      .getMasterCalendarEvent(eventId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detailCache.set(eventId, detail);
          // A slow response for an event the viewer has already navigated past must not
          // overwrite the dialog they are looking at now.
          if (this.selectedEntry()?.eventId !== eventId) return;
          this.selectedDetail.set(detail);
          this.detailLoading.set(false);
        },
        error: () => {
          if (this.selectedEntry()?.eventId !== eventId) return;
          this.detailError.set('This event’s details could not be loaded.');
          this.detailLoading.set(false);
        },
      });
  }

  closeDialog(): void {
    this.selectedEntry.set(null);
    this.selectedDetail.set(null);
    this.detailLoading.set(false);
    this.detailError.set('');
    this.document.body.classList.remove('calendar-dialog-open');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.filterOpen()) this.closeFilters();
    else if (this.selectedEntry()) this.closeDialog();
  }

  // --- display helpers ----------------------------------------------------
  visibleEntries(day: CalendarDay): readonly CalendarEntry[] {
    return day.entries.slice(0, 3);
  }

  remainingCount(day: CalendarDay): number {
    return Math.max(0, day.entries.length - 3);
  }

  privateLabel(count: number): string {
    return `${count} Private Event${count === 1 ? '' : 's'}`;
  }

  formatFullDate(date: Date): string {
    return this.formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  registrationLabel(detail: MasterCalendarEventDetail): string {
    if (detail.registrationMode !== 'Automatic' && detail.registrationMode !== 'Manual') {
      return 'No registration required';
    }
    const mode = detail.registrationMode === 'Manual' ? 'Approval required' : 'Open registration';
    const capacity = detail.maxPax
      ? ` · ${detail.confirmedRegistrationCount}/${detail.maxPax} places filled`
      : ` · ${detail.confirmedRegistrationCount} registered`;
    return `${mode}${capacity}`;
  }

  costLabel(detail: MasterCalendarEventDetail): string {
    return detail.isFree || detail.cost === null ? 'Free' : `RM ${detail.cost.toFixed(2)}`;
  }

  // --- date utilities -----------------------------------------------------
  private parseDate(isoDate: string): Date {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private minutesOf(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  }

  private timeRange(start: string, end: string): string {
    return `${this.formatTime(start)} – ${this.formatTime(end)}`;
  }

  private formatTime(value: string): string {
    const [hours = '0', minutes = '00'] = value.split(':');
    const hour = Number(hours);
    return `${hour % 12 || 12}:${minutes} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private startOfWeek(date: Date): Date {
    return this.addDays(date, -date.getDay());
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return this.startOfDay(result);
  }

  private dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat('en-MY', options).format(date);
  }
}
