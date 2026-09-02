import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AiAccessDenial, AiAccessLogService } from '../../../../core/admin-directory/ai-access-log.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalSortChange, InternalSortState } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Audit trail of chat questions the AI assistant refused because Page Visibility does not grant the
// asker the pages that topic's data lives on (backend: app/ai/topic_access.py).
@Component({
  selector: 'app-ai-access-log',
  imports: [InternalDataPageComponent, FeedbackBannerComponent, ConfirmDialogComponent],
  templateUrl: './ai-access-log.html',
  styleUrl: './ai-access-log.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAccessLogComponent {
  private readonly service = inject(AiAccessLogService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<readonly AiAccessDenial[]>([]);
  readonly total = signal(0);
  readonly pageSize = signal(50);
  readonly page = signal(1);
  // Newest first: an access log is read from the most recent refusal backwards.
  readonly sort = signal<InternalSortState>({ key: 'when', order: 'desc' });
  readonly search = signal('');
  readonly outcomeFilter = signal('all');
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly clearOpen = signal(false);
  readonly clearing = signal(false);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly records = computed<readonly InternalDataRecord[]>(() => this.rows().map((row) => ({
    id: row.denialId,
    cells: {
      asker: { primary: row.userEmail ?? 'Guest (not signed in)', secondary: row.userId ? `User #${row.userId}` : 'No account' },
      topic: { primary: row.topicLabel ?? '—', secondary: row.topic ?? undefined, badge: true, tone: 'warning' },
      question: { primary: row.question },
      // "Why refused" replaces the old "Would need" column.
      outcome: {
        primary: this.outcomeLabel(row.outcome),
        secondary: row.requiredPages || row.reason || undefined,
        badge: true,
        tone: this.outcomeTone(row.outcome),
      },
      // Only a reviewer rejection has a generated answer to show; the pre-generation refusals
      // never produced one, so an em dash is the truth rather than a missing value.
      response: { primary: row.aiResponse ?? '—', secondary: row.userRoles ?? undefined },
      // What was being said just before. Judging "u do not know ?" without it is guesswork.
      context: { primary: row.conversationContext ?? 'Opening question', secondary: undefined },
      when: { primary: this.formatDate(row.createdAt) },
    },
    mobile: {
      eyebrow: this.outcomeLabel(row.outcome),
      status: row.topicLabel ?? this.outcomeLabel(row.outcome),
      title: row.question,
      identity: row.userEmail ?? 'Guest',
      details: [
        { icon: 'lock', text: row.requiredPages ? `Needs any of: ${row.requiredPages}` : (row.reason ?? 'No page would grant this') },
        ...(row.aiResponse ? [{ icon: 'smart_toy', text: row.aiResponse }] : []),
        ...(row.conversationContext ? [{ icon: 'forum', text: row.conversationContext }] : []),
        { icon: 'schedule', text: this.formatDate(row.createdAt) },
      ],
    },
  })));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'AI access denials',
    paginationLabel: 'Denial log pages',
    rowsPerPageLabel: 'Rows per page',
    mobileListLabel: 'Denial cards',
    header: {
      title: 'AI Access Log',
      description: 'Questions the AI assistant did not answer, and why. Three reasons mean it refused: out of user scope (they cannot have it — grant the page, or not), blocked as harmful (someone tried to break the assistant), and unrelated. The fourth, needs fixing, is not a refusal at all — the assistant meant to answer and broke. Each row carries the turns before it, because a question like “u do not know ?” cannot be judged on its own.',
      countLabel: `${this.total()} denial${this.total() === 1 ? '' : 's'}`,
      countIcon: 'gpp_maybe',
      primaryActionLabel: 'Clear log',
      primaryActionIcon: 'delete_sweep',
    },
    search: { ariaLabel: 'Search denials', placeholder: 'Search email, topic, or question' },
    columns: [
      { key: 'asker', label: 'Asked by' },
      { key: 'topic', label: 'Topic' },
      { key: 'question', label: 'Question' },
      { key: 'context', label: 'Conversation before' },
      { key: 'outcome', label: 'Why refused' },
      { key: 'response', label: 'Assistant said' },
      { key: 'when', label: 'When', sortKey: 'when' },
    ],
    actions: [],
    emptyTitle: 'Nothing logged',
    emptyDescription: 'The assistant has answered everything it was asked, or the log was cleared.',
    // Paging is server-side and fixed at the API's own page size (see AiAccessLogService), so the
    // rows-per-page selector offers only that one value rather than pretending to change it.

  }));

  /**
   * The category filter, offering exactly the outcomes the backend can write (see
   * api/ai_admin.VALID_OUTCOMES, which reads them off ai/topic_access.py).
   *
   * THREE REASONS A QUESTION WAS REFUSED, then a fourth that is not a refusal at all, and the
   * separator says so. `system_failure` means the assistant MEANT to answer and broke - a bug
   * list, not a permissions decision - and it is listed apart because mixing the two is what the
   * previous six categories did: 31 of the first 93 rows were crashes filed as refusals.
   */
  readonly filters = computed(() => [
    {
      key: 'outcome',
      ariaLabel: 'Filter by why the assistant refused',
      value: this.outcomeFilter(),
      options: [
        { value: 'all', label: 'All reasons' },
        { value: 'no_access', label: 'Out of user scope' },
        { value: 'harmful', label: 'Blocked as harmful' },
        { value: 'unrelated', label: 'Unrelated question' },
        { value: 'system_failure', label: 'Needs fixing (not a refusal)' },
      ],
    },
  ]);

  constructor() {
    this.load();
  }

  setOutcomeFilter(value: string): void {
    this.outcomeFilter.set(value);
    // Same reasoning as setSearch: a narrower result set makes the current offset an empty page.
    this.page.set(1);
    this.load();
  }

  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); this.load(); }

  setSort(change: InternalSortChange): void {
    this.sort.set({ key: change.key, order: change.order });
    this.page.set(1);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.service
      .list(this.page(), this.search(), this.outcomeFilter(), this.sort().order, this.pageSize())
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.rows.set(result.rows);
          this.total.set(result.total);
          this.pageSize.set(result.pageSize);
        },
        error: (error) => this.errorMessage.set(apiErrorMessage(error, 'Could not load the access log.')),
      });
  }

  setSearch(value: string): void {
    this.search.set(value);
    // Back to page 1: staying on page 4 of the old result set would show an empty page whenever
    // the new search matches fewer rows than the old offset.
    this.page.set(1);
    this.load();
  }

  setPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  reset(): void {
    this.search.set('');
    this.outcomeFilter.set('all');
    this.page.set(1);
    this.load();
  }

  openClear(): void {
    this.clearOpen.set(true);
  }

  closeClear(): void {
    this.clearOpen.set(false);
  }

  confirmClear(): void {
    this.clearing.set(true);
    this.service
      .clear()
      .pipe(finalize(() => this.clearing.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.toast.success(`Cleared ${result.removed} log entr${result.removed === 1 ? 'y' : 'ies'}.`);
          this.closeClear();
          this.page.set(1);
          this.load();
        },
        error: (error) => {
          this.closeClear();
          this.toast.error(apiErrorMessage(error, 'Could not clear the access log.'));
        },
      });
  }

  /**
   * Human wording for the backend's `outcome` (migration 026). The two "…denied" values are
   * permission problems an admin fixes by granting a page; the other two are capability gaps that
   * need a feature, not a grant. Falls back to the raw value so a new outcome added server-side
   * shows up as itself rather than silently rendering blank.
   */
  private outcomeLabel(outcome: string): string {
    switch (outcome) {
      case 'no_access': return 'Out of user scope';
      case 'harmful': return 'Blocked as harmful';
      case 'unrelated': return 'Unrelated question';
      case 'system_failure': return 'Needs fixing (not a refusal)';
      default: return outcome;
    }
  }

  /**
   * How loudly a row should read. `harmful` is the only one that means someone tried something -
   * the rest are the assistant declining correctly, which is routine and should not look alarming
   * enough to bury the one row that matters.
   */
  private outcomeTone(outcome: string): 'warning' | 'danger' | 'neutral' {
    if (outcome === 'harmful') return 'danger';
    // A crash is the row an admin can actually act on, so it reads louder than a correct refusal.
    if (outcome === 'system_failure') return 'warning';
    return 'neutral';
  }

  private formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
