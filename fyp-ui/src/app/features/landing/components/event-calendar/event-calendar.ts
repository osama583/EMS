import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ExpandableSearchComponent } from '../../../../shared/components/expandable-search/expandable-search';
import { FilterButtonComponent } from '../../../../shared/components/filter-button/filter-button';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';
import {
  ProposalEventSchedule,
  PublishedEvent,
  isEventVisibleTo,
} from '../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { AuthService } from '../../../../core/auth/auth.service';

type CalendarView = 'month' | 'week' | 'agenda';

interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly date: Date;
  readonly time: string;
  readonly venue: string;
  readonly category: string;
  readonly categoryClass: string;
  readonly description: string;
}

// Only these seven map to a styled `.calendar-event--*` / `.legend-dot--*` class in
// _event-calendar.scss; anything else (or a missing category) falls back to 'academic' — category
// names are now admin-managed/open-ended (Event Categories catalog), not a fixed compile-time set,
// so custom admin-added categories routinely hit that fallback.
const CATEGORY_CLASS_BY_NAME: Record<string, string> = {
  'Academic & Career': 'academic',
  'Workshops & Training': 'workshop',
  'Sports & Wellness': 'sports',
  'Culture & Community': 'culture',
  'Clubs & Societies': 'club',
  'Entertainment & Social': 'social',
  Volunteering: 'volunteer',
};

interface CalendarDay {
  readonly date: Date;
  readonly key: string;
  readonly dayNumber: number;
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly events: readonly CalendarEvent[];
}

interface AgendaDay {
  readonly date: Date;
  readonly key: string;
  readonly events: readonly CalendarEvent[];
}

@Component({
  selector: 'app-event-calendar',
  imports: [DatePipe, ExpandableSearchComponent, FilterButtonComponent, LoadingStateComponent],
  templateUrl: './event-calendar.html',
  styleUrl: './event-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCalendarComponent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly publishedEventService = inject(PublishedEventService);
  private readonly auth = inject(AuthService);
  private readonly today = this.startOfDay(new Date());

  @ViewChild('modalCloseButton') private modalCloseButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('calendarFilterClose') private filterCloseButton?: ElementRef<HTMLButtonElement>;

  readonly weekDayLabels = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  readonly viewMode = signal<CalendarView>('month');
  readonly currentMonth = signal(this.startOfMonth(this.today));
  readonly focusedDate = signal(this.today);
  readonly searchTerm = signal('');
  readonly calendarFilterOpen = signal(false);
  readonly appliedCategories = signal<readonly string[]>([]);
  readonly draftCategories = signal<readonly string[]>([]);
  readonly selectedEvent = signal<CalendarEvent | null>(null);
  readonly selectedDay = signal<AgendaDay | null>(null);

  readonly events = signal<readonly CalendarEvent[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');

  readonly categoryOptions = computed(() =>
    [...new Set(this.events().map((event) => event.category))].sort((a, b) => a.localeCompare(b)),
  );
  readonly appliedFilterCount = computed(() => this.appliedCategories().length);
  readonly draftResultCount = computed(
    () => this.events().filter((event) => this.eventMatches(event, this.draftCategories())).length,
  );

  readonly monthDays = computed<readonly CalendarDay[]>(() => {
    const month = this.currentMonth();
    const firstGridDay = this.addDays(month, -month.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = this.addDays(firstGridDay, index);
      return this.toCalendarDay(date, month);
    });
  });

  readonly mobileMonthDays = computed<readonly CalendarDay[]>(() => {
    const month = this.currentMonth();
    const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

    return Array.from({ length: dayCount }, (_, index) =>
      this.toCalendarDay(new Date(month.getFullYear(), month.getMonth(), index + 1), month),
    );
  });

  readonly mobileFocusedDay = computed<CalendarDay>(() => {
    const month = this.currentMonth();
    const focus = this.focusedDate();
    const focusIsVisible =
      focus.getFullYear() === month.getFullYear() && focus.getMonth() === month.getMonth();

    return this.toCalendarDay(focusIsVisible ? focus : month, month);
  });

  readonly weekDays = computed<readonly CalendarDay[]>(() => {
    const focus = this.focusedDate();
    const firstDay = this.addDays(focus, -focus.getDay());
    const month = this.currentMonth();
    return Array.from({ length: 7 }, (_, index) =>
      this.toCalendarDay(this.addDays(firstDay, index), month),
    );
  });

  readonly agendaDays = computed<readonly AgendaDay[]>(() => {
    const dates =
      this.viewMode() === 'week'
        ? this.weekDays().map((day) => day.date)
        : this.monthDays().map((day) => day.date);

    return dates
      .map((date) => ({
        date,
        key: this.dateKey(date),
        events: this.eventsForDate(date),
      }))
      .filter((day) => day.events.length > 0);
  });

  readonly displayTitle = computed(() => {
    if (this.viewMode() === 'week') {
      return `Week of ${this.formatDate(this.weekDays()[0]?.date ?? this.focusedDate(), {
        month: 'long',
        day: 'numeric',
      })}`;
    }

    return this.formatDate(this.currentMonth(), { month: 'long', year: 'numeric' });
  });

  readonly visibleRange = computed(() => {
    const days = this.viewMode() === 'week' ? this.weekDays() : this.monthDays();
    const first = days[0]?.date ?? this.currentMonth();
    const last = days[days.length - 1]?.date ?? this.currentMonth();
    return `${this.formatDate(first, { day: 'numeric', month: 'short' })} – ${this.formatDate(
      last,
      {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      },
    )}`;
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('calendar-dialog-open');
      this.document.body.classList.remove('calendar-filter-open');
    });
    this.loadPublishedEvents();
  }

  private loadPublishedEvents(): void {
    this.publishedEventService.getPublishedEvents().subscribe({
      next: (allEvents) => {
        const isAuthenticated = this.auth.authenticated();
        const visibleEvents = allEvents.filter((event) =>
          isEventVisibleTo(event.eventVisibility, isAuthenticated),
        );
        this.events.set(visibleEvents.flatMap((event) => this.toCalendarEvents(event)));
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Events could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  // One PublishedEvent can have multiple schedule entries (multi-day/session events); the
  // calendar shows one CalendarEvent per schedule entry so each date it occupies gets its own cell.
  private toCalendarEvents(event: PublishedEvent): readonly CalendarEvent[] {
    const category = event.categories[0];
    return event.schedule
      .filter((schedule) => schedule.date)
      .map((schedule, index) => ({
        id: `${event.id}-${index}`,
        title: event.eventTitle,
        date: this.parseDate(schedule.date),
        time: this.timeRangeFor(schedule),
        venue: schedule.location || 'To be confirmed',
        category: category ?? 'Academic & Career',
        categoryClass: category ? (CATEGORY_CLASS_BY_NAME[category] ?? 'academic') : 'academic',
        description: event.shortIntroduction,
      }));
  }

  private parseDate(isoDate: string): Date {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private timeRangeFor(schedule: ProposalEventSchedule): string {
    return `${this.formatTime(schedule.start)} – ${this.formatTime(schedule.end)}`;
  }

  private formatTime(value: string): string {
    const [hours = '0', minutes = '00'] = value.split(':');
    const hour = Number(hours);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${minutes} ${suffix}`;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.calendarFilterOpen()) {
      this.closeCalendarFilters();
    } else if (this.selectedEvent() || this.selectedDay()) {
      this.closeDialog();
    }
  }

  navigate(direction: -1 | 1): void {
    if (this.viewMode() === 'week') {
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

  selectMobileDate(day: CalendarDay): void {
    this.focusedDate.set(day.date);
  }

  changeView(event: Event): void {
    this.viewMode.set((event.target as HTMLSelectElement).value as CalendarView);
  }

  onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  openCalendarFilters(): void {
    this.draftCategories.set([...this.appliedCategories()]);
    this.calendarFilterOpen.set(true);
    this.document.body.classList.add('calendar-filter-open');
    queueMicrotask(() => this.filterCloseButton?.nativeElement.focus());
  }

  closeCalendarFilters(): void {
    this.calendarFilterOpen.set(false);
    this.document.body.classList.remove('calendar-filter-open');
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

  resetCalendarFilters(): void {
    this.draftCategories.set([]);
  }

  applyCalendarFilters(): void {
    this.appliedCategories.set([...this.draftCategories()]);
    this.closeCalendarFilters();
  }

  eventsForDate(date: Date): readonly CalendarEvent[] {
    const key = this.dateKey(date);
    const query = this.searchTerm().trim().toLocaleLowerCase();

    return this.events().filter((event) => {
      return (
        this.dateKey(event.date) === key &&
        this.eventMatches(event, this.appliedCategories(), query)
      );
    });
  }

  visibleEvents(day: CalendarDay): readonly CalendarEvent[] {
    return day.events.slice(0, 3);
  }

  remainingEventCount(day: CalendarDay): number {
    return Math.max(0, day.events.length - 3);
  }

  openEvent(event: CalendarEvent): void {
    this.selectedDay.set(null);
    this.selectedEvent.set(event);
    this.openDialog();
  }

  openDay(day: CalendarDay): void {
    this.selectedEvent.set(null);
    this.selectedDay.set({ date: day.date, key: day.key, events: day.events });
    this.openDialog();
  }

  closeDialog(): void {
    this.selectedEvent.set(null);
    this.selectedDay.set(null);
    this.document.body.classList.remove('calendar-dialog-open');
  }

  formatFullDate(date: Date): string {
    return this.formatDate(date, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  private openDialog(): void {
    this.document.body.classList.add('calendar-dialog-open');
    queueMicrotask(() => this.modalCloseButton?.nativeElement.focus());
  }

  private eventMatches(
    event: CalendarEvent,
    categories: readonly string[],
    query = this.searchTerm().trim().toLocaleLowerCase(),
  ): boolean {
    const searchable = `${event.title} ${event.category} ${event.venue}`.toLocaleLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (categories.length === 0 || categories.includes(event.category))
    );
  }

  private toCalendarDay(date: Date, month: Date): CalendarDay {
    return {
      date,
      key: this.dateKey(date),
      dayNumber: date.getDate(),
      isCurrentMonth:
        date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth(),
      isToday: this.dateKey(date) === this.dateKey(this.today),
      events: this.eventsForDate(date),
    };
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
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
