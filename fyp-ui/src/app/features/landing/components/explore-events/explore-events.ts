import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { PublishedEvent, RegistrationStatus } from '../../../../core/events/published-event.models';
import { SystemConfigService } from '../../../../core/config/system-config.service';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { EventFavouriteService } from '../../../../core/events/event-favourite.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { GuestRegistrationFlowService } from '../../../../core/auth/external-registration.service';
import { EventCardComponent } from '../../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../../shared/components/event-details-modal/event-details-modal';
import { InternalPaginationComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { ExpandableSearchComponent } from '../../../../shared/components/expandable-search/expandable-search';
import { FilterButtonComponent } from '../../../../shared/components/filter-button/filter-button';

type FilterKey =
  | 'visibility'
  | 'category'
  | 'school'
  | 'audience'
  | 'format'
  | 'date'
  | 'time'
  | 'registration'
  | 'cost';

type FilterSelection = Record<FilterKey, readonly string[]>;

interface ExploreEventDate {
  readonly iso: string;
  readonly display: string;
}

interface ExploreEvent {
  readonly id: number;
  readonly title: string;
  readonly category: string;
  readonly visibility: string;
  readonly school: string;
  readonly audience: readonly string[];
  readonly format: string;
  readonly timePeriod: string;
  readonly registration: string;
  readonly cost: string;
  readonly date: ExploreEventDate;
  readonly daysFromNow: number;
  readonly time: string;
  readonly venue: string;
  readonly image: string;
}

interface FilterGroup {
  readonly key: FilterKey;
  readonly label: string;
  readonly options: readonly string[];
  readonly wide?: boolean;
}

interface AppliedFilterChip {
  readonly group: FilterKey;
  readonly value: string;
}

const INITIAL_VISIBLE_EVENTS = 6;

@Component({
  selector: 'app-explore-events',
  imports: [
    EventDetailsModalComponent,
    EventCardComponent,
    InternalPaginationComponent,
    ExpandableSearchComponent,
    FilterButtonComponent,
  ],
  templateUrl: './explore-events.html',
  styleUrl: './explore-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExploreEventsComponent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly configService = inject(SystemConfigService);
  private readonly guestFlow = inject(GuestRegistrationFlowService);
  private readonly publishedEventService = inject(PublishedEventService);
  readonly favourites = inject(EventFavouriteService);
  readonly variant = input<'public' | 'internal'>('public');
  readonly registeringEventId = signal<string | null>(null);

  @ViewChild('filterCloseButton') private filterCloseButton?: ElementRef<HTMLButtonElement>;

  readonly events: readonly ExploreEvent[] = [
    {
      id: 1,
      title: 'Startup Pitch Night',
      category: 'Academic & Career',
      visibility: 'Public — Everyone',
      school: 'School of Technology',
      audience: ['All APU Community', 'Undergraduate Students', 'Postgraduate Students'],
      format: 'On Campus',
      timePeriod: 'Evening',
      registration: 'Registration Open',
      cost: 'Free',
      date: this.createEventDate(1),
      daysFromNow: 1,
      time: '6:30 PM – 9:00 PM',
      venue: 'APU Atrium',
      image: '/assets/events/startup-pitch-night.jpg',
    },
    {
      id: 2,
      title: 'Career Connect Fair',
      category: 'Academic & Career',
      visibility: 'Public — Everyone',
      school: 'School of Business',
      audience: ['All APU Community', 'Undergraduate Students', 'Postgraduate Students', 'Alumni'],
      format: 'On Campus',
      timePeriod: 'Morning',
      registration: 'No Registration Required',
      cost: 'Free',
      date: this.createEventDate(3),
      daysFromNow: 3,
      time: '10:00 AM – 4:00 PM',
      venue: 'Level 3 Expo Hall',
      image: '/assets/events/career-connect-fair.jpg',
    },
    {
      id: 3,
      title: 'Community Green Day',
      category: 'Volunteering',
      visibility: 'Public — Everyone',
      school: 'Student Affairs',
      audience: ['All APU Community', 'New Students', 'International Students'],
      format: 'Off Campus',
      timePeriod: 'Morning',
      registration: 'Registration Open',
      cost: 'Free',
      date: this.createEventDate(5),
      daysFromNow: 5,
      time: '8:00 AM – 12:00 PM',
      venue: 'Bukit Jalil Community Park',
      image: '/assets/events/community-green-day.jpg',
    },
    {
      id: 4,
      title: 'Future Forward: Tech Expo',
      category: 'Workshops & Training',
      visibility: 'Public — Everyone',
      school: 'School of Technology',
      audience: ['All APU Community', 'Undergraduate Students', 'Staff'],
      format: 'Hybrid',
      timePeriod: 'Afternoon',
      registration: 'Registration Open',
      cost: 'Free',
      date: this.createEventDate(7),
      daysFromNow: 7,
      time: '10:00 AM – 5:00 PM',
      venue: 'APU Atrium',
      image: '/assets/events/tech-expo.jpg',
    },
    {
      id: 5,
      title: 'One World Cultural Night',
      category: 'Culture & Community',
      visibility: 'Public — Everyone',
      school: 'Student Affairs',
      audience: ['All APU Community', 'International Students', 'Alumni'],
      format: 'On Campus',
      timePeriod: 'Evening',
      registration: 'Waitlist Available',
      cost: 'Free',
      date: this.createEventDate(9),
      daysFromNow: 9,
      time: '6:30 PM – 10:00 PM',
      venue: 'APU Auditorium',
      image: '/assets/events/cultural-night.jpg',
    },
    {
      id: 6,
      title: 'APU Esports Showdown',
      category: 'Entertainment & Social',
      visibility: 'Internal — APU Community',
      school: 'School of Computing',
      audience: ['All APU Community', 'Undergraduate Students'],
      format: 'On Campus',
      timePeriod: 'Afternoon',
      registration: 'Registration Open',
      cost: 'Free',
      date: this.createEventDate(12),
      daysFromNow: 12,
      time: '12:00 PM – 8:00 PM',
      venue: 'Level 4 Arena',
      image: '/assets/events/esports-showdown.jpg',
    },
    {
      id: 7,
      title: 'Campus After Dark',
      category: 'Entertainment & Social',
      visibility: 'Internal — APU Community',
      school: 'Student Affairs',
      audience: ['Undergraduate Students', 'Postgraduate Students', 'New Students'],
      format: 'On Campus',
      timePeriod: 'Evening',
      registration: 'No Registration Required',
      cost: 'Paid',
      date: this.createEventDate(16),
      daysFromNow: 16,
      time: '7:00 PM – 10:30 PM',
      venue: 'Campus Plaza',
      image: '/assets/events/campus-after-dark.jpg',
    },
    {
      id: 8,
      title: 'Wellness Run & Community Day',
      category: 'Sports & Wellness',
      visibility: 'Public — Everyone',
      school: 'School of Psychology',
      audience: ['All APU Community', 'Staff', 'Alumni'],
      format: 'Off Campus',
      timePeriod: 'Morning',
      registration: 'Registration Open',
      cost: 'Paid',
      date: this.createEventDate(22),
      daysFromNow: 22,
      time: '7:00 AM – 11:00 AM',
      venue: 'APU Main Entrance',
      image: '/assets/events/wellness-run.jpg',
    },
  ];

  readonly searchTerm = signal('');
  readonly selectedPublishedEvent = signal<PublishedEvent | null>(null);
  readonly filterOpen = signal(false);
  readonly appliedFilters = signal<FilterSelection>(this.emptyFilters());
  readonly draftFilters = signal<FilterSelection>(this.emptyFilters());
  readonly appliedCustomFrom = signal('');
  readonly appliedCustomTo = signal('');
  readonly draftCustomFrom = signal('');
  readonly draftCustomTo = signal('');
  readonly currentPage = signal(1);
  readonly pageSize = signal(9);

  private readonly publishedEventsById = signal<ReadonlyMap<string, PublishedEvent>>(new Map());
  private readonly registrationStatusByEventId = signal<ReadonlyMap<string, RegistrationStatus | null>>(new Map());

  registrationCount(id: number): number { return this.publishedEventsById().get(`evt-${id}`)?.confirmedRegistrationCount ?? 0; }
  publishedEvent(id: number): PublishedEvent | undefined { return this.publishedEventsById().get(`evt-${id}`); }
  openEvent(id: number): void { this.selectedPublishedEvent.set(this.publishedEventsById().get(`evt-${id}`) ?? null); }
  closeEvent(): void { this.selectedPublishedEvent.set(null); }

  readonly schoolOptions = computed(() =>
    [...new Set(this.events.map((event) => event.school))].sort((a, b) => a.localeCompare(b)),
  );

  readonly filterGroups = computed<readonly FilterGroup[]>(() => [
    {
      key: 'visibility',
      label: 'Event Visibility',
      options: ['Public — Everyone', 'Internal — APU Community'],
    },
    {
      key: 'category',
      label: 'Category',
      options: this.configService.eventCategories(),
      wide: true,
    },
    {
      key: 'school',
      label: 'School or Department',
      options: this.schoolOptions(),
      wide: true,
    },
    {
      key: 'audience',
      label: 'Audience',
      options: [
        'All APU Community',
        'Undergraduate Students',
        'Postgraduate Students',
        'Staff',
        'Alumni',
        'New Students',
        'International Students',
      ],
      wide: true,
    },
    {
      key: 'format',
      label: 'Event Format',
      options: ['On Campus', 'Online', 'Hybrid', 'Off Campus'],
    },
    {
      key: 'date',
      label: 'Date',
      options: ['Today', 'Tomorrow', 'This Week', 'This Weekend', 'This Month', 'Custom Date Range'],
      wide: true,
    },
    {
      key: 'time',
      label: 'Time',
      options: ['Morning', 'Afternoon', 'Evening'],
    },
    {
      key: 'registration',
      label: 'Registration',
      options: ['Registration Open', 'Waitlist Available', 'No Registration Required'],
    },
    {
      key: 'cost',
      label: 'Cost',
      options: ['Free', 'Paid'],
    },
  ]);

  readonly matchingEvents = computed(() =>
    this.getMatchingEvents(
      this.appliedFilters(),
      this.appliedCustomFrom(),
      this.appliedCustomTo(),
    ),
  );
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.matchingEvents().length / this.pageSize())));
  readonly pagedEvents = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.matchingEvents().slice(start, start + this.pageSize());
  });
  readonly draftResultCount = computed(
    () =>
      this.getMatchingEvents(
        this.draftFilters(),
        this.draftCustomFrom(),
        this.draftCustomTo(),
      ).length,
  );
  readonly appliedFilterChips = computed<readonly AppliedFilterChip[]>(() =>
    (Object.entries(this.appliedFilters()) as [FilterKey, readonly string[]][]).flatMap(
      ([group, values]) => values.map((value) => ({ group, value })),
    ),
  );
  readonly appliedFilterCount = computed(() => this.appliedFilterChips().length);

  constructor() {
    if (this.variant() === 'public') {
      this.pageSize.set(INITIAL_VISIBLE_EVENTS);
    }
    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('filters-open');
    });
    this.loadPublishedEvents();
  }

  private loadPublishedEvents(): void {
    this.publishedEventService.getPublishedEvents().subscribe({
      next: (events) => {
        this.publishedEventsById.set(new Map(events.map((event) => [event.id, event])));
        this.loadRegistrationStatuses(events);
      },
      error: () => this.publishedEventsById.set(new Map()),
    });
  }

  private loadRegistrationStatuses(events: readonly PublishedEvent[]): void {
    const email = this.auth.user()?.email;
    if (!email || events.length === 0) {
      this.registrationStatusByEventId.set(new Map());
      return;
    }
    forkJoin(
      events.map((event) =>
        this.publishedEventService.getMyRegistration(event.id, email),
      ),
    ).subscribe({
      next: (registrations) => {
        this.registrationStatusByEventId.set(
          new Map(events.map((event, index) => [event.id, registrations[index]?.status ?? null])),
        );
      },
      error: () => this.registrationStatusByEventId.set(new Map()),
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.filterOpen()) {
      this.closeFilters();
    }
  }

  onSearchTerm(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
  }

  goToPage(page: number): void { this.currentPage.set(page); }
  changePageSize(size: number): void { this.pageSize.set(size); this.currentPage.set(1); }

  openFilters(): void {
    this.draftFilters.set(this.cloneFilters(this.appliedFilters()));
    this.draftCustomFrom.set(this.appliedCustomFrom());
    this.draftCustomTo.set(this.appliedCustomTo());
    this.filterOpen.set(true);
    this.document.body.classList.add('filters-open');
    queueMicrotask(() => this.filterCloseButton?.nativeElement.focus());
  }

  closeFilters(): void {
    this.filterOpen.set(false);
    this.document.body.classList.remove('filters-open');
  }

  toggleDraftFilter(group: FilterKey, value: string): void {
    this.draftFilters.update((filters) => {
      const current = filters[group];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];

      return { ...filters, [group]: next };
    });
  }

  isDraftSelected(group: FilterKey, value: string): boolean {
    return this.draftFilters()[group].includes(value);
  }

  onCustomDate(event: Event, edge: 'from' | 'to'): void {
    const value = (event.target as HTMLInputElement).value;
    if (edge === 'from') {
      this.draftCustomFrom.set(value);
    } else {
      this.draftCustomTo.set(value);
    }
  }

  resetDraftFilters(): void {
    this.draftFilters.set(this.emptyFilters());
    this.draftCustomFrom.set('');
    this.draftCustomTo.set('');
  }

  applyFilters(): void {
    this.appliedFilters.set(this.cloneFilters(this.draftFilters()));
    this.appliedCustomFrom.set(this.draftCustomFrom());
    this.appliedCustomTo.set(this.draftCustomTo());
    this.currentPage.set(1);
    this.closeFilters();
  }

  removeAppliedFilter(group: FilterKey, value: string): void {
    const remove = (filters: FilterSelection): FilterSelection => ({
      ...filters,
      [group]: filters[group].filter((item) => item !== value),
    });

    this.appliedFilters.update(remove);
    this.draftFilters.update(remove);
    if (group === 'date' && value === 'Custom Date Range') {
      this.appliedCustomFrom.set('');
      this.appliedCustomTo.set('');
      this.draftCustomFrom.set('');
      this.draftCustomTo.set('');
    }
    this.currentPage.set(1);
  }

  clearAppliedFilters(): void {
    this.appliedFilters.set(this.emptyFilters());
    this.draftFilters.set(this.emptyFilters());
    this.appliedCustomFrom.set('');
    this.appliedCustomTo.set('');
    this.draftCustomFrom.set('');
    this.draftCustomTo.set('');
    this.currentPage.set(1);
  }

  toggleSaved(eventId: string): void { this.favourites.toggle(eventId); }
  isSaved(eventId: string): boolean { return this.favourites.isSaved(eventId); }

  registrationStatus(eventId: string): RegistrationStatus | null {
    return this.registrationStatusByEventId().get(eventId) ?? null;
  }

  registerForEvent(eventId: string): void {
    const user = this.auth.user();
    if (!user) {
      this.guestFlow.requestForEvent(eventId);
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    if (this.registeringEventId()) return;
    this.registeringEventId.set(eventId);
    this.publishedEventService.registerForEvent(eventId, user.email).subscribe({
      next: () => {
        this.registeringEventId.set(null);
        this.loadRegistrationStatuses([...this.publishedEventsById().values()]);
      },
      error: () => this.registeringEventId.set(null),
    });
  }

  private getMatchingEvents(
    filters: FilterSelection,
    customFrom: string,
    customTo: string,
  ): readonly ExploreEvent[] {
    const query = this.searchTerm().trim().toLocaleLowerCase();

    return this.events.filter((event) => {
      const searchable = [
        event.title,
        event.category,
        event.venue,
        event.school,
        event.format,
      ]
        .join(' ')
        .toLocaleLowerCase();

      return (
        (!query || searchable.includes(query)) &&
        this.matches(filters.visibility, event.visibility) &&
        this.matches(filters.category, event.category) &&
        this.matches(filters.school, event.school) &&
        this.matchesAny(filters.audience, event.audience) &&
        this.matches(filters.format, event.format) &&
        this.matchesDate(event, filters.date, customFrom, customTo) &&
        this.matches(filters.time, event.timePeriod) &&
        this.matches(filters.registration, event.registration) &&
        this.matches(filters.cost, event.cost)
      );
    });
  }

  private matches(selected: readonly string[], value: string): boolean {
    return selected.length === 0 || selected.includes(value);
  }

  private matchesAny(selected: readonly string[], values: readonly string[]): boolean {
    return selected.length === 0 || selected.some((value) => values.includes(value));
  }

  private matchesDate(
    event: ExploreEvent,
    selected: readonly string[],
    customFrom: string,
    customTo: string,
  ): boolean {
    if (selected.length === 0) {
      return true;
    }

    const eventDate = new Date(event.date.iso);
    const today = new Date();
    const isWeekend = eventDate.getDay() === 0 || eventDate.getDay() === 6;
    const isThisMonth =
      eventDate.getFullYear() === today.getFullYear() &&
      eventDate.getMonth() === today.getMonth();

    return selected.some((option) => {
      if (option === 'Today') return event.daysFromNow === 0;
      if (option === 'Tomorrow') return event.daysFromNow === 1;
      if (option === 'This Week') return event.daysFromNow >= 0 && event.daysFromNow <= 7;
      if (option === 'This Weekend') return event.daysFromNow <= 10 && isWeekend;
      if (option === 'This Month') return isThisMonth;
      if (option === 'Custom Date Range') {
        const eventTime = eventDate.getTime();
        const fromTime = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : -Infinity;
        const toTime = customTo ? new Date(`${customTo}T23:59:59`).getTime() : Infinity;
        return eventTime >= fromTime && eventTime <= toTime;
      }
      return false;
    });
  }

  private emptyFilters(): FilterSelection {
    return {
      visibility: [],
      category: [],
      school: [],
      audience: [],
      format: [],
      date: [],
      time: [],
      registration: [],
      cost: [],
    };
  }

  private cloneFilters(filters: FilterSelection): FilterSelection {
    return {
      visibility: [...filters.visibility],
      category: [...filters.category],
      school: [...filters.school],
      audience: [...filters.audience],
      format: [...filters.format],
      date: [...filters.date],
      time: [...filters.time],
      registration: [...filters.registration],
      cost: [...filters.cost],
    };
  }

  private createEventDate(daysFromNow: number): ExploreEventDate {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + daysFromNow);

    return {
      iso: date.toISOString(),
      display: new Intl.DateTimeFormat('en-MY', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(date),
    };
  }
}
