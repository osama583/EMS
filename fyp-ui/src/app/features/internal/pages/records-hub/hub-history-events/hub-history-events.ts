import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { PublishedEventService } from '../../../../../core/events/published-event.service';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent, InternalFilterControlsComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { ViewToggleComponent } from '../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';
type Requester = 'me' | 'other';
type Outcome = 'confirmed' | 'rejected';

interface RegistrationHistoryEntry {
  readonly key: string;
  // Who the registration was for, not who resolved it — 'me' when the viewer is the person who
  // asked to attend (their own registration), 'other' when the viewer decided someone else's
  // request as organiser. A viewer who registered for and approved their own event collapses to
  // one 'me' row instead of two, since it is the same real-world request either way.
  readonly requester: Requester;
  readonly eventTitle: string;
  readonly eventCode: string;
  readonly outcome: Outcome;
  readonly registeredAt: string;
  readonly registrantName?: string;
  readonly registrantEmail?: string;
  readonly reason?: string;
}

// History → Events: every resolved event registration decision — events the viewer registered for
// that reached a final outcome, and registrations to the viewer's own events that the viewer
// approved/rejected as organiser. Rows are keyed by requester identity (me vs. someone else), not
// by who took the action, so the same person's request never appears twice. Saved events and
// confirmed-and-upcoming registrations are NOT here — see /app/events/my-events for those, this
// tab is only for resolved manual-approval decisions.
@Component({
  selector: 'app-hub-history-events',
  imports: [ViewToggleComponent, FeedbackBannerComponent, InternalPageHeaderComponent, InternalDataPageComponent, FormModalComponent, InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent],
  templateUrl: './hub-history-events.html',
  styleUrl: './hub-history-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubHistoryEventsComponent {
  private readonly events = inject(PublishedEventService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly entries = signal<readonly RegistrationHistoryEntry[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly detailsTarget = signal<RegistrationHistoryEntry | null>(null);
  readonly viewMode = signal<ViewMode>('card');
  readonly search = signal('');
  readonly requesterFilter = signal<'all' | Requester>('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly resolvedEntries = computed(() => {
    const search = this.search().trim().toLowerCase();
    const requester = this.requesterFilter();
    return this.entries()
      .filter((entry) => requester === 'all' || entry.requester === requester)
      .filter((entry) => !search || entry.eventTitle.toLowerCase().includes(search))
      .sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.resolvedEntries().length / this.pageSize())));
  readonly visibleEntries = computed(() => this.resolvedEntries().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Events',
    description: 'Resolved event registrations — the ones you made, and the ones you decided as organiser.',
    countLabel: `${this.resolvedEntries().length} registration${this.resolvedEntries().length === 1 ? '' : 's'}`,
  }));

  readonly filters = computed<readonly { key: string; ariaLabel: string; value: string; options: readonly { value: string; label: string }[] }[]>(() => [
    {
      key: 'requester', ariaLabel: 'Filter by requester', value: this.requesterFilter(),
      options: [
        { value: 'all', label: 'All' },
        { value: 'me', label: 'Me' },
        { value: 'other', label: 'Other people' },
      ],
    },
  ]);

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Event registration history', paginationLabel: 'Registration pages', rowsPerPageLabel: 'Registrations per page', mobileListLabel: 'Registration cards',
    header: { title: this.headerConfig().title, description: this.headerConfig().description, countLabel: this.headerConfig().countLabel },
    search: { ariaLabel: 'Search events', placeholder: 'Search event title' },
    columns: [{ key: 'event', label: 'Event' }, { key: 'requester', label: 'Requester' }, { key: 'outcome', label: 'Outcome' }, { key: 'date', label: 'Date' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'view', label: 'View details', icon: 'visibility' }],
    emptyTitle: 'No resolved registrations yet', emptyDescription: 'Resolved event registrations — yours or ones you decided as organiser — will show up here.', pageSizeOptions: [5, 10, 25],
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleEntries().map((entry) => ({
    id: entry.key,
    cells: {
      event: { primary: entry.eventTitle, secondary: entry.eventCode },
      requester: { primary: this.requesterLabel(entry), badge: true, tone: entry.requester === 'me' ? 'blue' : 'neutral' },
      outcome: { primary: entry.outcome === 'confirmed' ? 'Confirmed' : 'Rejected', badge: true, tone: entry.outcome === 'confirmed' ? 'success' : 'danger' },
      date: { primary: this.formatDate(entry.registeredAt) },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: this.requesterLabel(entry),
      status: entry.outcome === 'confirmed' ? 'Confirmed' : 'Rejected',
      title: entry.eventTitle,
      details: [{ icon: 'schedule', text: this.formatDate(entry.registeredAt) }],
    },
  })));

  requesterLabel(entry: RegistrationHistoryEntry): string {
    const name = entry.requester === 'me'
      ? (this.auth.user()?.displayName || entry.registrantName || entry.registrantEmail || 'You')
      : (entry.registrantName || entry.registrantEmail || 'Someone else');
    return entry.requester === 'me' ? `${name} (You)` : name;
  }

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const viewerEmail = this.auth.user()?.email?.trim().toLowerCase() ?? '';
    forkJoin({
      history: this.events.getRegistrationHistory(),
      decided: this.events.getDecidedRegistrations(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ history, decided }) => {
        const registered: RegistrationHistoryEntry[] = history.items
          .filter((item) => item.status === 'confirmed' || item.status === 'rejected')
          .map((item) => ({
            key: `me:${item.event.id}`,
            requester: 'me' as const,
            eventTitle: item.event.eventTitle,
            eventCode: '',
            outcome: item.status as Outcome,
            registeredAt: item.event.schedule[0]?.date ?? '',
          }));
        const registeredEventIds = new Set(registered.map((entry) => entry.key));
        // A "decided" row where the registrant IS the viewer (they organised and registered for
        // their own event) is the same real-world request as its "registered" counterpart above —
        // skip it here so it doesn't produce a second row for the same person's request.
        const decidedEntries: RegistrationHistoryEntry[] = decided
          .filter((item) => (item.email ?? '').trim().toLowerCase() !== viewerEmail || !registeredEventIds.has(`me:${item.eventId}`))
          .map((item) => {
            const isViewer = (item.email ?? '').trim().toLowerCase() === viewerEmail;
            return {
              key: `decided:${item.id}`,
              requester: (isViewer ? 'me' : 'other') as Requester,
              eventTitle: item.eventTitle,
              eventCode: item.eventCode,
              outcome: item.status === 'confirmed' ? 'confirmed' as const : 'rejected' as const,
              registeredAt: item.registeredAt,
              registrantName: item.name,
              registrantEmail: item.email,
              reason: item.reason,
            };
          });
        this.entries.set([...registered, ...decidedEntries]);
        this.loading.set(false);
      },
      error: () => { this.errorMessage.set('Your registration history could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'requester') this.requesterFilter.set(change.value as 'all' | Requester); this.page.set(1); }
  reset(): void { this.search.set(''); this.requesterFilter.set('all'); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const entry = this.resolvedEntries().find((item) => item.key === event.record.id);
    if (entry) this.openDetails(entry);
  }

  openDetails(entry: RegistrationHistoryEntry): void { this.detailsTarget.set(entry); }
  closeDetails(): void { this.detailsTarget.set(null); }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
