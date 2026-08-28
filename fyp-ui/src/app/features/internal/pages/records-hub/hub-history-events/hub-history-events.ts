import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, switchMap } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { PublishedEventService } from '../../../../../core/events/published-event.service';
import { RegistrationHistoryRow } from '../../../../../core/events/event-engagement.models';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent, InternalFilterControlsComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { ViewToggleComponent } from '../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';
// Filter dimension for 'other' rows: who actually clicked approve/reject — the viewer themself
// (as the event's Owner or a co-owner) or a DIFFERENT co-owner. Independent of `requester`: 'me'
// rows (the viewer's own registration) never carry this, since nobody decided FOR them via this
// axis. Options are only offered to users who can plausibly organise an event at all — see
// showDecidedByFilter below — since a viewer who can only attend, never organise, can never be
// party to a decided-by-me/co-owner split.
type DecidedByFilter = 'all' | 'me' | 'co-owner';

// History → Events: every resolved event registration decision — events the viewer registered for
// that reached a final outcome, and registrations to the viewer's own events that the viewer
// approved/rejected as organiser. Rows are keyed by requester identity (me vs. someone else), not
// by who took the action, so the same person's request never appears twice. Saved events and
// confirmed-and-upcoming registrations are NOT here — see /app/events/my-events for those, this
// tab is only for resolved manual-approval decisions.
//
// The merge/re-bucketing/de-duplication this page used to do client-side (fetching up to 200
// history rows plus the ENTIRE unpaginated decided-registrations list, every request) now happens
// in one query server-side — see events.py's registration_history()/_HISTORY_UNION_SQL. Search,
// the requester filter, and the decided-by filter are real query params; only the current page's
// rows ever reach the browser.
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

  // The current page of results, exactly as the server returned them — no client-side
  // filtering/slicing left to do.
  readonly visibleEntries = signal<readonly RegistrationHistoryRow[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly detailsTarget = signal<RegistrationHistoryRow | null>(null);
  readonly viewMode = signal<ViewMode>('card');
  readonly search = signal('');
  readonly requesterFilter = signal<'all' | 'me' | 'other'>('all');
  readonly decidedByFilter = signal<DecidedByFilter>('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  // The decided-by-me/co-owner split only means anything for someone who could plausibly BE an
  // organiser at all — same "who can be an applicant" eligibility rule records-hub.ts's own
  // showRegistrationsTab uses (auth.canAccess reads the already-loaded Page Visibility nav tree,
  // no extra request). A pure attendee, who can never organise an event or decide someone else's
  // registration, would see an option that always returns zero rows for them.
  readonly showDecidedByFilter = computed(() => this.auth.canAccess('/app/forms/event-proposal'));

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Events',
    description: 'Resolved event registrations — the ones you made, and the ones you decided as organiser.',
    countLabel: `${this.total()} registration${this.total() === 1 ? '' : 's'}`,
  }));

  readonly filters = computed<readonly { key: string; ariaLabel: string; value: string; options: readonly { value: string; label: string }[] }[]>(() => [
    {
      key: 'requester', ariaLabel: 'Filter by requester', value: this.requesterFilter(),
      options: [
        { value: 'all', label: 'All' },
        { value: 'me', label: 'My Requests' },
        { value: 'other', label: 'Other people' },
      ],
    },
    ...(this.showDecidedByFilter() ? [{
      key: 'decidedBy', ariaLabel: 'Filter by who decided', value: this.decidedByFilter(),
      options: [
        { value: 'all', label: 'All decisions' },
        { value: 'me', label: 'Decided by Me' },
        { value: 'co-owner', label: 'Decided by Co-owner' },
      ],
    }] : []),
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

  requesterLabel(entry: RegistrationHistoryRow): string {
    const name = entry.requester === 'me'
      ? (this.auth.user()?.displayName || entry.registrantName || entry.registrantEmail || 'You')
      : (entry.registrantName || entry.registrantEmail || 'Someone else');
    return entry.requester === 'me' ? `${name} (You)` : name;
  }

  // Refetch whenever search/requester/decidedBy/page/pageSize change — the same predicate this
  // page used to apply in the browser over the full merged set is now sent to the server instead.
  private readonly query$ = toObservable(computed(() => ({
    page: this.page(), pageSize: this.pageSize(), q: this.search().trim(),
    requester: this.requesterFilter(),
    decidedBy: this.showDecidedByFilter() ? this.decidedByFilter() : 'all',
  })));

  constructor() {
    this.query$.pipe(
      debounceTime(200),
      switchMap((q) => {
        this.loading.set(true);
        return this.events.getRegistrationHistoryPage({
          page: q.page, pageSize: q.pageSize, q: q.q || undefined,
          requester: q.requester === 'me' || q.requester === 'other' ? q.requester : undefined,
          decidedBy: q.decidedBy === 'me' || q.decidedBy === 'co-owner' ? q.decidedBy : undefined,
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => { this.visibleEntries.set(result.items); this.total.set(result.total); this.loading.set(false); },
      error: () => { this.errorMessage.set('Your registration history could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'requester') this.requesterFilter.set(change.value as 'all' | 'me' | 'other');
    if (change.key === 'decidedBy') this.decidedByFilter.set(change.value as DecidedByFilter);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.requesterFilter.set('all'); this.decidedByFilter.set('all'); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const entry = this.visibleEntries().find((item) => item.key === event.record.id);
    if (entry) this.openDetails(entry);
  }

  openDetails(entry: RegistrationHistoryRow): void { this.detailsTarget.set(entry); }
  closeDetails(): void { this.detailsTarget.set(null); }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
