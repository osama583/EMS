import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaStaffRequest } from '../../../../core/cafeterias/cafeteria-staff-request.models';
import { CafeteriaStaffRequestService } from '../../../../core/cafeterias/cafeteria-staff-request.service';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalCellTone, InternalDataPageConfig, InternalDataRecord } from '../../../../shared/components/internal-data-page/internal-data-page.models';

const ACTION_LABELS: Record<CafeteriaStaffRequest['action'], string> = { add: 'Add staff', edit: 'Edit staff', remove: 'Remove staff' };
const STATUS_TONE: Record<CafeteriaStaffRequest['status'], InternalCellTone> = { pending: 'warning', approved: 'success', rejected: 'danger' };
const STATUS_LABEL: Record<CafeteriaStaffRequest['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

// Read-only history of the Cafeteria Manager's own My Staff requests (any status) — powers
// visibility into what Cafeteria Admin has approved/rejected. See CafeteriaStaffRequestService.
@Component({
  selector: 'app-cafeteria-my-staff-history',
  imports: [InternalDataPageComponent],
  templateUrl: './cafeteria-my-staff-history.html',
  styleUrl: './cafeteria-my-staff-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaMyStaffHistoryComponent {
  private readonly auth = inject(AuthService);
  private readonly requests = inject(CafeteriaStaffRequestService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<readonly CafeteriaStaffRequest[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly filteredItems = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.items().filter((r) => !search || `${r.displayName} ${r.email}`.toLowerCase().includes(search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredItems().length / this.pageSize())));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'My Staff request history', paginationLabel: 'History pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'History cards',
    header: {
      title: 'History',
      description: 'Every My Staff request you have sent, and its outcome.',
      countLabel: `${this.filteredItems().length} request${this.filteredItems().length === 1 ? '' : 's'}`,
    },
    search: { ariaLabel: 'Search requests', placeholder: 'Search name or email' },
    columns: [
      { key: 'user', label: 'Staff member' },
      { key: 'action', label: 'Request' },
      { key: 'status', label: 'Status' },
      { key: 'resolved', label: 'Resolved' },
    ],
    actions: [],
    emptyTitle: 'No requests yet', emptyDescription: 'Requests you send from My Staff will appear here.', pageSizeOptions: [5, 10, 25],
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() =>
    this.filteredItems().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()).map((r) => ({
      id: r.id,
      cells: {
        user: { primary: r.displayName, secondary: r.email },
        action: { primary: ACTION_LABELS[r.action] },
        status: { primary: STATUS_LABEL[r.status], badge: true, tone: STATUS_TONE[r.status] },
        resolved: { primary: r.resolvedAt ? this.formatDate(r.resolvedAt) : '—', secondary: r.resolvedByName },
      },
      mobile: {
        eyebrow: ACTION_LABELS[r.action], status: STATUS_LABEL[r.status], title: r.displayName, identity: r.email,
        details: r.comment ? [{ icon: 'chat_bubble', text: r.comment }] : [],
      },
    })),
  );

  constructor() {
    const userId = this.auth.user()?.id;
    if (!userId) { this.loading.set(false); return; }
    this.requests.mine(userId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => { this.items.set(items); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  reset(): void { this.search.set(''); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
}
