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

type CalendarView = 'month' | 'week' | 'agenda';

interface CalendarEvent {
  readonly id: number;
  readonly title: string;
  readonly date: Date;
  readonly time: string;
  readonly venue: string;
  readonly category: string;
  readonly categoryClass: string;
  readonly description: string;
}

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
  imports: [DatePipe, ExpandableSearchComponent, FilterButtonComponent],
  templateUrl: './event-calendar.html',
  styleUrl: './event-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCalendarComponent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly today = this.startOfDay(new Date());
  private generatedEventId = 0;

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

  readonly events: readonly CalendarEvent[] = [
    this.createEvent(
      0,
      'Future Forward: Tech Expo',
      '10:00 AM',
      'APU Atrium',
      'Workshops & Training',
      'workshop',
      'Meet the student innovators building what comes next through technology, design and creative experimentation.',
    ),
    this.createEvent(
      1,
      'Startup Pitch Night',
      '6:30 PM',
      'APU Atrium',
      'Academic & Career',
      'academic',
      'Watch emerging founders pitch bold ideas and connect with mentors from across the APU community.',
    ),
    this.createEvent(
      3,
      'Career Connect Fair',
      '10:00 AM',
      'Level 3 Expo Hall',
      'Academic & Career',
      'academic',
      'Meet employers, explore career paths and build meaningful professional connections.',
    ),
    this.createEvent(
      3,
      'Design Thinking Sprint',
      '12:30 PM',
      'Design Studio 2',
      'Workshops & Training',
      'workshop',
      'Solve a real campus challenge through a fast, collaborative design-thinking workshop.',
    ),
    this.createEvent(
      3,
      'Societies Welcome Mixer',
      '4:00 PM',
      'Campus Plaza',
      'Clubs & Societies',
      'club',
      'Meet student clubs, discover new interests and find a community that feels like yours.',
    ),
    this.createEvent(
      3,
      'Research Exchange Forum',
      '6:00 PM',
      'Auditorium 2',
      'Academic & Career',
      'academic',
      'Share ideas with postgraduate researchers and hear short talks on work happening across APU.',
    ),
    this.createEvent(
      5,
      'Community Green Day',
      '8:00 AM',
      'Bukit Jalil Community Park',
      'Volunteering',
      'volunteer',
      'Spend a morning creating greener shared spaces alongside students, staff and community partners.',
    ),
    this.createEvent(
      7,
      'AI Builders Workshop',
      '2:00 PM',
      'Innovation Lab',
      'Workshops & Training',
      'workshop',
      'Build a practical AI prototype with guidance from student mentors and industry practitioners.',
    ),
    this.createEvent(
      9,
      'One World Cultural Night',
      '6:30 PM',
      'APU Auditorium',
      'Culture & Community',
      'culture',
      'Celebrate the performances, flavours and traditions that make the APU community truly global.',
    ),
    this.createEvent(
      12,
      'APU Esports Showdown',
      '12:00 PM',
      'Level 4 Arena',
      'Entertainment & Social',
      'social',
      'Cheer on campus teams in an energetic tournament welcoming players, fans and first-timers.',
    ),
    this.createEvent(
      16,
      'Campus After Dark',
      '7:00 PM',
      'Campus Plaza',
      'Entertainment & Social',
      'social',
      'Experience live student music and an open-air campus evening designed for connection.',
    ),
    this.createEvent(
      18,
      'Global Alumni Conversation',
      '5:30 PM',
      'Online',
      'Academic & Career',
      'academic',
      'Hear practical career lessons from APU graduates working across technology and business.',
    ),
    this.createEvent(
      22,
      'Wellness Run & Community Day',
      '7:00 AM',
      'APU Main Entrance',
      'Sports & Wellness',
      'sports',
      'Start the day moving together, then stay for games, wellbeing activities and community time.',
    ),
  ];

  readonly categoryOptions = computed(() =>
    [...new Set(this.events.map((event) => event.category))].sort((a, b) => a.localeCompare(b)),
  );
  readonly appliedFilterCount = computed(() => this.appliedCategories().length);
  readonly draftResultCount = computed(
    () => this.events.filter((event) => this.eventMatches(event, this.draftCategories())).length,
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

    return this.events.filter((event) => {
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

  private createEvent(
    daysFromNow: number,
    title: string,
    time: string,
    venue: string,
    category: string,
    categoryClass: string,
    description: string,
  ): CalendarEvent {
    return {
      id: this.nextEventId(),
      title,
      date: this.addDays(this.today, daysFromNow),
      time,
      venue,
      category,
      categoryClass,
      description,
    };
  }

  private nextEventId(): number {
    this.generatedEventId += 1;
    return this.generatedEventId;
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
