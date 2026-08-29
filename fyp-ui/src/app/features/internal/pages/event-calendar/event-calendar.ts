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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { EventCategoryService } from '../../../../core/event-catalog/event-catalog.service';
import {
  MasterCalendarEvent,
  MasterCalendarResponse,
  isVisibleEvent,
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

// Requirement: the master calendar renders one entry per schedule row, so a multi-day event
// occupies each of its dates. `occurrenceId` keeps those siblings distinct for @for tracking while
// `eventId` still points back at the one underlying proposal.
interface CalendarEntry {
  readonly occurrenceId: string;
  readonly eventId: string;
  readonly dateKey: string;
  readonly date: Date;
  /** Redacted rows carry no title/time/venue at all — only the fact that the date is occupied. */
  readonly restricted: boolean;
  readonly title: string;
  readonly time: string;
  readonly sortMinutes: number;
  readonly venue: string;
  readonly organiser: string;
  readonly category: string;
  readonly categoryClass: string;
  readonly description: string;
  readonly visibility: string;
  readonly clubs: readonly string[];
  /** True while the event is only at department_review — on the calendar but not fully approved. */
  readonly provisional: boolean;
  readonly format: string;
  readonly totalExpectedPax: number;
  readonly registrationMode: string;
  readonly confirmedRegistrationCount: number;
  readonly maxPax: number | null;
  readonly cost: number | null;
  readonly isFree: boolean;
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

  readonly weekDayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly weekDayFullLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  readonly viewMode = signal<CalendarView>('month');
  readonly currentMonth = signal(this.startOfMonth(this.today));
  readonly focusedDate = signal(this.today);
  readonly searchTerm = signal('');
  readonly filterOpen = signal(false);
  readonly appliedCategories = signal<readonly string[]>([]);
  readonly draftCategories = signal<readonly string[]>([]);
  readonly selectedEntry = signal<CalendarEntry | null>(null);

  readonly entries = signal<readonly CalendarEntry[]>([]);
  readonly privateCounts = signal<Readonly<Record<string, number>>>({});
  readonly loading = signal(true);
  readonly loadError = signal('');

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

  // Categories present in the currently-loaded range, so the legend and filter list describe
  // what is actually on screen rather than the whole admin catalog.
  readonly categoryOptions = computed<readonly { readonly name: string; readonly categoryClass: string }[]>(() => {
    const byName = new Map<string, string>();
    for (const entry of this.entries()) {
      if (!entry.restricted) byName.set(entry.category, entry.categoryClass);
    }
    return [...byName.entries()]
      .map(([name, categoryClass]) => ({ name, categoryClass }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly appliedFilterCount = computed(() => this.appliedCategories().length);
  readonly draftResultCount = computed(
    () => this.entries().filter((entry) => this.entryMatches(entry, this.draftCategories())).length,
  );

  // The exact [start, end] the visible surface needs. Month view renders a fixed 6-week (42-day)
  // grid that spills into the neighbouring months, so the query must cover the whole grid or
  // those spillover days would render empty. Week/day need only their own span.
  readonly queryRange = computed<{ start: string; end: string }>(() => {
    const mode = this.viewMode();
    if (mode === 'day') {
      const key = this.dateKey(this.focusedDate());
      return { start: key, end: key };
    }
    if (mode === 'week') {
      const weekStart = this.startOfWeek(this.focusedDate());
      return { start: this.dateKey(weekStart), end: this.dateKey(this.addDays(weekStart, 6)) };
    }
    const month = this.currentMonth();
    const firstGridDay = this.addDays(month, -month.getDay());
    return { start: this.dateKey(firstGridDay), end: this.dateKey(this.addDays(firstGridDay, 41)) };
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

  // Mobile: the whole month stays visible as a compact grid (requirement §6 — users must still be
  // able to see the entire month), and tapping a date fills the day panel below it.
  readonly selectedDayEntries = computed<readonly CalendarEntry[]>(() => this.focusedDay().entries);

  readonly totalVisibleCount = computed(() => {
    const days = this.viewMode() === 'month' ? this.monthDays() : this.viewMode() === 'week' ? this.weekDays() : [this.focusedDay()];
    return days.reduce((sum, day) => sum + day.entries.length, 0);
  });

  readonly totalPrivateCount = computed(() => {
    const days = this.viewMode() === 'month' ? this.monthDays() : this.viewMode() === 'week' ? this.weekDays() : [this.focusedDay()];
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

  constructor() {
    this.destroyRef.onDestroy(() => this.document.body.classList.remove('calendar-dialog-open'));

    // Re-fetch whenever the visible range changes. switchMap cancels the in-flight request for a
    // range the viewer has already navigated away from.
    toObservable(this.queryRange)
      .pipe(
        switchMap((range) => {
          this.loading.set(true);
          return this.eventService.getMasterCalendar(range.start, range.end);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (response) => this.applyResponse(response),
        error: () => {
          this.loadError.set('The event calendar could not be loaded.');
          this.loading.set(false);
        },
      });
  }

  private applyResponse(response: MasterCalendarResponse): void {
    this.entries.set(response.events.flatMap((event) => this.toEntries(event)));
    this.privateCounts.set(response.privateCounts ?? {});
    this.loadError.set('');
    this.loading.set(false);
  }

  // One entry per schedule row. A redacted row still produces entries (so the date reads as
  // occupied) but carries none of the detail fields.
  private toEntries(event: MasterCalendarEvent): readonly CalendarEntry[] {
    if (!isVisibleEvent(event)) {
      return event.schedule
        .filter((schedule) => schedule.date)
        .map((schedule, index) => ({
          occurrenceId: `${event.id}-${index}`,
          eventId: event.id,
          dateKey: schedule.date,
          date: this.parseDate(schedule.date),
          restricted: true,
          title: event.restrictedLabel,
          time: '',
          sortMinutes: Number.MAX_SAFE_INTEGER,
          venue: '',
          organiser: '',
          category: '',
          categoryClass: 'restricted',
          description: '',
          visibility: event.eventVisibility,
          clubs: [],
          provisional: false,
          format: '',
          totalExpectedPax: 0,
          registrationMode: '',
          confirmedRegistrationCount: 0,
          maxPax: null,
          cost: null,
          isFree: false,
        }));
    }

    const category = event.categories[0] ?? 'Uncategorised';
    return event.schedule
      .filter((schedule) => schedule.date)
      .map((schedule, index) => ({
        occurrenceId: `${event.id}-${index}`,
        eventId: event.id,
        dateKey: schedule.date,
        date: this.parseDate(schedule.date),
        restricted: false,
        title: event.eventTitle,
        time: this.timeRange(schedule.start, schedule.end),
        sortMinutes: this.minutesOf(schedule.start),
        venue: schedule.location || 'To be confirmed',
        organiser: event.organiser,
        category,
        categoryClass: this.categoryClassFor(category),
        description: event.shortIntroduction,
        visibility: event.eventVisibility,
        clubs: event.clubs ?? [],
        provisional: event.proposalStatus === 'department_review',
        format: event.eventFormat,
        totalExpectedPax: event.totalExpectedPax,
        registrationMode: event.registrationMode,
        confirmedRegistrationCount: event.confirmedRegistrationCount,
        maxPax: event.maxPax,
        cost: event.cost,
        isFree: event.isFree,
      }));
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
    const query = this.searchTerm().trim().toLocaleLowerCase();
    const categories = this.appliedCategories();
    return this.entries()
      .filter((entry) => entry.dateKey === key && this.entryMatches(entry, categories, query))
      .sort((a, b) => a.sortMinutes - b.sortMinutes || a.title.localeCompare(b.title));
  }

  private entryMatches(
    entry: CalendarEntry,
    categories: readonly string[],
    query = this.searchTerm().trim().toLocaleLowerCase(),
  ): boolean {
    // A redacted row has nothing to match on. It survives an empty filter (the date is genuinely
    // occupied) but is correctly excluded the moment the viewer narrows by text or category,
    // since it cannot be said to match either.
    if (entry.restricted) return !query && categories.length === 0;
    const searchable = `${entry.title} ${entry.category} ${entry.venue} ${entry.organiser}`.toLocaleLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (categories.length === 0 || categories.includes(entry.category))
    );
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
  openEntry(entry: CalendarEntry): void {
    // A redacted row has no detail to show, so it is deliberately not clickable.
    if (entry.restricted) return;
    this.selectedEntry.set(entry);
    this.document.body.classList.add('calendar-dialog-open');
  }

  closeDialog(): void {
    this.selectedEntry.set(null);
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

  registrationLabel(entry: CalendarEntry): string {
    if (entry.registrationMode !== 'Automatic' && entry.registrationMode !== 'Manual') {
      return 'No registration required';
    }
    const mode = entry.registrationMode === 'Manual' ? 'Approval required' : 'Open registration';
    const capacity = entry.maxPax ? ` · ${entry.confirmedRegistrationCount}/${entry.maxPax} places filled` : ` · ${entry.confirmedRegistrationCount} registered`;
    return `${mode}${capacity}`;
  }

  costLabel(entry: CalendarEntry): string {
    return entry.isFree || entry.cost === null ? 'Free' : `RM ${entry.cost.toFixed(2)}`;
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
