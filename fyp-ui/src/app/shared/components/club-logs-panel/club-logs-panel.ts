import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, switchMap } from 'rxjs';
import { ClubLogCategory, ClubLogEntry } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';

interface LogTab {
  readonly key: ClubLogCategory;
  readonly label: string;
  readonly icon: string;
  readonly emptyText: string;
}

// Three tabs, chosen to match what the club's data can actually answer rather than an invented
// taxonomy: who is in the club, what the club has proposed, and what the club has been asked.
const TABS: readonly LogTab[] = [
  {
    key: 'member',
    label: 'Members',
    icon: 'group',
    emptyText: 'No membership changes recorded yet.',
  },
  {
    key: 'event',
    label: 'Events',
    icon: 'event',
    emptyText: 'No event proposals have been addressed to this club.',
  },
  {
    key: 'request',
    label: 'Requests',
    icon: 'inbox',
    emptyText: 'This club has not received any requests yet.',
  },
];

// action -> what to print. The server sends the raw action so the client can label it without a
// second round trip, and an unrecognised one falls through to a readable form of itself rather
// than to a blank cell — a log that silently drops entries it does not recognise is worse than
// one that prints 'event_pending_review'.
const ACTION_LABELS: Record<string, string> = {
  joined: 'Joined',
  left: 'Left',
  removed: 'Removed',
  president_assigned: 'Became President',
  president_stepped_down: 'Stepped down as President',
  join_pending: 'Requested to join',
  join_approved: 'Join request approved',
  join_rejected: 'Join request rejected',
  president_change_pending: 'President change requested',
  president_change_approved: 'President change approved',
  president_change_rejected: 'President change rejected',
};

/**
 * The President's club log — the Members / Events / Requests tabs inside the club pop-up.
 *
 * Scoped to the club, never to the reader: a new President sees everything their predecessors did,
 * including the handover that gave them the role. Search and paging are server query params
 * (clubs.py's club_logs()), so a club with years of history still sends one page at a time.
 */
@Component({
  selector: 'app-club-logs-panel',
  imports: [],
  templateUrl: './club-logs-panel.html',
  styleUrl: './club-logs-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubLogsPanelComponent {
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);

  readonly clubId = input.required<string>();
  /** The panel only fetches while it is the visible tab — an unopened log costs no request. */
  readonly active = input(false);

  readonly tabs = TABS;
  readonly category = signal<ClubLogCategory>('member');
  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = 10;

  readonly entries = signal<readonly ClubLogEntry[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(false);
  readonly errorMessage = signal('');

  readonly activeTab = computed(() => TABS.find((tab) => tab.key === this.category()) ?? TABS[0]);
  readonly showsReference = computed(() => this.category() === 'event');

  constructor() {
    // Switching tabs resets the reader's place: page 4 of the member log is not page 4 of the
    // event log, and carrying the number across lands on an empty page more often than not.
    effect(() => {
      this.category();
      this.page.set(1);
    });

    toObservable(computed(() => ({
      active: this.active(),
      clubId: this.clubId(),
      category: this.category(),
      q: this.search().trim(),
      page: this.page(),
    }))).pipe(
      debounceTime(200),
      switchMap((query) => {
        if (!query.active || !query.clubId) return of(null);
        this.loading.set(true);
        this.errorMessage.set('');
        return this.clubService.getClubLogs(query.clubId, {
          category: query.category,
          q: query.q || undefined,
          page: query.page,
          pageSize: this.pageSize,
        }).pipe(catchError(() => {
          this.errorMessage.set('This club’s log could not be loaded. Please try again.');
          return of(null);
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((result) => {
      if (result) {
        this.entries.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
      }
      this.loading.set(false);
    });
  }

  setCategory(category: ClubLogCategory): void { this.category.set(category); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  previousPage(): void { this.page.update((page) => Math.max(1, page - 1)); }
  nextPage(): void { this.page.update((page) => Math.min(this.totalPages(), page + 1)); }

  actionLabel(entry: ClubLogEntry): string {
    if (ACTION_LABELS[entry.action]) return ACTION_LABELS[entry.action];
    // Event rows carry the proposal's own status, which has its own vocabulary and grows over
    // time — read it rather than enumerate it.
    const readable = entry.action.replace(/^event_/, '').replace(/_/g, ' ');
    return readable.charAt(0).toUpperCase() + readable.slice(1);
  }

  /** Who did it, shown only when that is someone other than the person it happened to. */
  actorLabel(entry: ClubLogEntry): string {
    return entry.actorName && entry.actorName !== entry.subjectName ? `by ${entry.actorName}` : '';
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
