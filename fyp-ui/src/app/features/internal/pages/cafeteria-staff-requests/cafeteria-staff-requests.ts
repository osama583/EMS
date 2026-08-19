import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaStaffRequest, CafeteriaStaffRequestAction } from '../../../../core/cafeterias/cafeteria-staff-request.models';
import { CafeteriaStaffRequestService } from '../../../../core/cafeterias/cafeteria-staff-request.service';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { ProposalCommentDialogComponent } from '../../../../shared/components/proposal-comment-dialog/proposal-comment-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalPageHeaderComponent, InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalCellTone, InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ViewToggleComponent } from '../../../../shared/components/view-toggle/view-toggle';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

export const REJECTION_COMMENT_MIN_LENGTH = 20;

export const ACTION_LABELS: Readonly<Record<CafeteriaStaffRequestAction, string>> = {
  add: 'Add staff', edit: 'Edit details', remove: 'Remove staff',
  suspend: 'Suspend staff', restore: 'Restore staff',
};

// Tone carries the weight of the change: removing is destructive, adding grants access, the rest
// are reversible adjustments.
const ACTION_TONE: Readonly<Record<CafeteriaStaffRequestAction, InternalCellTone>> = {
  add: 'success', edit: 'blue', remove: 'danger', suspend: 'warning', restore: 'success',
};

const ACTION_ICON: Readonly<Record<CafeteriaStaffRequestAction, string>> = {
  add: 'person_add', edit: 'edit', remove: 'person_remove',
  suspend: 'pause_circle', restore: 'play_circle',
};

// Cafeteria Admin's queue of roster changes Managers have asked for. Its own page rather than a
// panel on Staff Assignments: this is the Admin's actual inbox, and it needs the search, filter,
// paging and card/table views every other list surface has. Decided requests move to the History
// page — this one only ever shows work outstanding.
@Component({
  selector: 'app-cafeteria-staff-requests',
  imports: [
    InternalDataPageComponent, FeedbackBannerComponent, ConfirmDialogComponent, ProposalCommentDialogComponent,
    InternalPageHeaderComponent, InternalSearchFieldComponent, InternalFilterControlsComponent,
    InternalResetButtonComponent, ViewToggleComponent, LoadingStateComponent,
  ],
  templateUrl: './cafeteria-staff-requests.html',
  styleUrl: './cafeteria-staff-requests.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaStaffRequestsComponent {
  private readonly auth = inject(AuthService);
  private readonly service = inject(CafeteriaStaffRequestService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly rejectionCommentMinLength = REJECTION_COMMENT_MIN_LENGTH;

  readonly requests = signal<readonly CafeteriaStaffRequest[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly actionFilter = signal('all');
  readonly cafeteriaFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly viewMode = signal<'table' | 'card'>('card');

  readonly processingId = signal<string | null>(null);
  readonly approveTarget = signal<CafeteriaStaffRequest | null>(null);
  readonly rejectTarget = signal<CafeteriaStaffRequest | null>(null);
  readonly rejecting = signal(false);

  readonly cafeteriaOptions = computed(() => {
    const names = new Map<string, string>();
    for (const request of this.requests()) names.set(request.cafeteriaCode, request.cafeteriaName);
    return [...names].map(([value, label]) => ({ value, label }));
  });

  readonly filtered = computed(() => {
    const search = this.search().trim().toLowerCase();
    const action = this.actionFilter();
    const cafeteria = this.cafeteriaFilter();
    return this.requests().filter((r) =>
      (action === 'all' || r.action === action)
      && (cafeteria === 'all' || r.cafeteriaCode === cafeteria)
      && (!search || `${r.displayName} ${r.email} ${r.cafeteriaName} ${r.requestedByName}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  private readonly pageSlice = computed(() =>
    this.filtered().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()),
  );

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Staff Requests',
    description: 'Pending My Staff requests from Cafeteria Managers. Approving applies the change immediately.',
    countLabel: `${this.filtered().length} pending`,
  }));

  readonly filters = computed(() => [
    {
      key: 'action', ariaLabel: 'Filter by request type', value: this.actionFilter(),
      options: [{ value: 'all', label: 'All types' }, ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))],
    },
    {
      key: 'cafeteria', ariaLabel: 'Filter by cafeteria', value: this.cafeteriaFilter(),
      options: [{ value: 'all', label: 'All cafeterias' }, ...this.cafeteriaOptions()],
    },
  ]);

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Pending staff requests', paginationLabel: 'Request pages', rowsPerPageLabel: 'Requests per page', mobileListLabel: 'Request cards',
    header: this.headerConfig(),
    search: { ariaLabel: 'Search requests', placeholder: 'Search name, email, cafeteria, or manager' },
    columns: [
      { key: 'request', label: 'Request' },
      { key: 'staff', label: 'Staff Member' },
      { key: 'cafeteria', label: 'Cafeteria' },
      { key: 'changes', label: 'What Changes' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'approve', label: 'Approve', icon: 'check_circle' },
      { key: 'reject', label: 'Reject', icon: 'cancel' },
    ],
    emptyTitle: 'No pending requests',
    emptyDescription: 'Requests from Cafeteria Managers appear here for a decision.',
    pageSizeOptions: [5, 10, 25],
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() => this.pageSlice().map((r) => ({
    id: r.id,
    actionKeys: ['approve', 'reject'],
    cells: {
      request: { primary: ACTION_LABELS[r.action], secondary: `by ${r.requestedByName}`, badge: true, tone: ACTION_TONE[r.action] },
      staff: { primary: this.subjectOf(r), secondary: r.email },
      cafeteria: { primary: r.cafeteriaName },
      changes: { primary: this.changesFor(r).join(' · ') },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: ACTION_LABELS[r.action], status: r.cafeteriaName,
      title: this.subjectOf(r), identity: r.email,
      details: this.changesFor(r).map((text) => ({ icon: 'edit_note', text })),
    },
  })));

  // The card view renders the same rows; the page slice is shared so paging behaves identically
  // whichever view is showing.
  readonly cards = computed(() => this.pageSlice());

  constructor() {
    this.service.inbox$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (requests) => { this.requests.set(requests); this.loading.set(false); },
      error: () => { this.errorMessage.set('Staff requests could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  actionLabel(action: CafeteriaStaffRequestAction): string { return ACTION_LABELS[action] ?? action; }
  actionIcon(action: CafeteriaStaffRequestAction): string { return ACTION_ICON[action] ?? 'help'; }
  actionTone(action: CafeteriaStaffRequestAction): string { return ACTION_TONE[action] ?? 'neutral'; }

  subjectOf(request: CafeteriaStaffRequest): string {
    return request.displayName || request.email || 'Unnamed staff member';
  }

  // What approving would actually change, so the decision is made on the diff rather than on the
  // action name — "Edit details" alone does not say which detail.
  changesFor(request: CafeteriaStaffRequest): readonly string[] {
    if (request.action === 'add') {
      return [
        `Creates an account for ${request.email}`,
        request.setsPassword ? 'Password set by the manager' : 'No password — sign-in needs a reset',
        request.proposedActive === false ? 'Created inactive' : 'Created active',
      ];
    }
    if (request.action === 'suspend') return ['Keeps the assignment but removes cafeteria access'];
    if (request.action === 'restore') return ['Returns cafeteria access'];
    if (request.action === 'remove') return ['Deletes the assignment'];

    const changes: string[] = [];
    const diff = (label: string, before?: string | null, after?: string | null) => {
      if (after && before !== after) changes.push(`${label}: ${before || '—'} → ${after}`);
    };
    diff('Name', request.currentDisplayName, request.displayName);
    diff('Username', request.currentUsername, request.username);
    diff('Email', request.currentEmail, request.email);
    if (request.proposedActive != null && request.proposedActive !== request.currentActive) {
      changes.push(`Account: ${request.currentActive ? 'active' : 'inactive'} → ${request.proposedActive ? 'active' : 'inactive'}`);
    }
    if (request.setsPassword) changes.push('Password: replaced');
    return changes.length ? changes : ['No changes — the details match what is already stored'];
  }

  setViewMode(mode: 'table' | 'card'): void { this.viewMode.set(mode); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'action') this.actionFilter.set(change.value);
    if (change.key === 'cafeteria') this.cafeteriaFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.actionFilter.set('all'); this.cafeteriaFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const request = this.requests().find((r) => r.id === event.record.id);
    if (!request) return;
    if (event.action.key === 'approve') { this.approveTarget.set(request); return; }
    if (event.action.key === 'reject') this.rejectTarget.set(request);
  }

  openApprove(request: CafeteriaStaffRequest): void { this.approveTarget.set(request); }
  closeApprove(): void { if (!this.processingId()) this.approveTarget.set(null); }
  confirmApprove(): void {
    const request = this.approveTarget();
    if (request) this.approve(request);
  }

  approve(request: CafeteriaStaffRequest): void {
    this.processingId.set(request.id);
    this.service.approve(request.id, this.currentUserId).pipe(
      finalize(() => this.processingId.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.approveTarget.set(null);
        this.toast.success('Request approved', `${this.subjectOf(request)} — ${request.cafeteriaName}.`);
      },
      error: (err) => {
        this.approveTarget.set(null);
        this.toast.error('Could not approve request', apiErrorMessage(err, 'Please try again.'));
      },
    });
  }

  openReject(request: CafeteriaStaffRequest): void { this.rejectTarget.set(request); }
  closeReject(): void { if (!this.rejecting()) this.rejectTarget.set(null); }
  confirmReject(comment: string): void {
    const request = this.rejectTarget();
    if (!request) return;
    this.rejecting.set(true);
    this.service.reject(request.id, this.currentUserId, comment).pipe(
      finalize(() => this.rejecting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.rejectTarget.set(null);
        this.toast.info('Request rejected', `${this.subjectOf(request)} — ${request.cafeteriaName}.`);
      },
      error: (err) => this.toast.error('Could not reject request', apiErrorMessage(err, 'Please try again.')),
    });
  }
}
