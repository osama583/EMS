import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AiAccessDenial, AiAccessLogService } from '../../../../core/admin-directory/ai-access-log.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Audit trail of chat questions the AI assistant refused because Page Visibility does not grant
// the asker the pages that topic's data lives on (backend: app/ai/topic_access.py). Read-only, plus
// a manual "Clear log" - this table has no automatic retention sweep, so emptying it is always a
// deliberate admin action.
//
// Unlike most internal data pages, paging and search are SERVER-side (the log only grows, so
// fetching every row to filter in the browser would get slower indefinitely): each search or page
// change re-requests from the API rather than re-slicing a local array.
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
  readonly search = signal('');
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
      // "Why refused" replaces the old "Would need" column. A required-pages list only ever made
      // sense for an access refusal, and the log now also records questions the assistant does not
      // support at all (no topic, no pages). The pages/reason stay as the secondary line, so the
      // detail is demoted rather than lost.
      outcome: {
        primary: this.outcomeLabel(row.outcome),
        secondary: row.requiredPages || row.reason || undefined,
        badge: true,
        tone: row.outcome === 'page_denied' || row.outcome === 'how_to_page_denied' ? 'warning' : 'neutral',
      },
      when: { primary: this.formatDate(row.createdAt) },
    },
    mobile: {
      eyebrow: this.outcomeLabel(row.outcome),
      status: row.topicLabel ?? this.outcomeLabel(row.outcome),
      title: row.question,
      identity: row.userEmail ?? 'Guest',
      details: [
        { icon: 'lock', text: row.requiredPages ? `Needs any of: ${row.requiredPages}` : (row.reason ?? 'No page would grant this') },
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
      description: 'Questions the AI assistant did not answer, and why. Either Page Visibility does not grant that person the pages the answer would come from — grant the page — or the assistant does not support the question yet, which is a capability gap rather than a permissions one.',
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
      { key: 'outcome', label: 'Why refused' },
      { key: 'when', label: 'When' },
    ],
    actions: [],
    emptyTitle: 'Nothing logged',
    emptyDescription: 'The assistant has answered everything it was asked, or the log was cleared.',
    // Paging is server-side and fixed at the API's own page size (see AiAccessLogService), so the
    // rows-per-page selector offers only that one value rather than pretending to change it.
    pageSizeOptions: [this.pageSize()],
  }));

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.service
      .list(this.page(), this.search())
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
      case 'page_denied': return 'No access to that page';
      case 'how_to_page_denied': return 'No access to that action';
      case 'out_of_scope': return 'Outside scope';
      case 'unsupported': return 'Not supported yet';
      default: return outcome;
    }
  }

  private formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
