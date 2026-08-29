import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { CafeteriaName } from '../../../../core/cafeterias/cafeteria.models';
import {
  CafeteriaStaffAuditAction,
  CafeteriaStaffAuditActorRole,
  CafeteriaStaffAuditEntry,
  CafeteriaStaffAuditSortKey,
} from '../../../../core/cafeterias/cafeteria-audit-log.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalSortChange,
  InternalSortState,
} from '../../../../shared/components/internal-data-page/internal-data-page.models';

const ACTION_LABELS: Record<CafeteriaStaffAuditAction, string> = {
  create: 'Created', edit: 'Edited', suspend: 'Suspended', restore: 'Restored', remove: 'Removed',
};
const ACTION_TONES: Record<CafeteriaStaffAuditAction, InternalCellTone> = {
  create: 'success', edit: 'blue', suspend: 'warning', restore: 'blue', remove: 'danger',
};

// Audit log of every cafeteria staff create/edit/suspend/restore/remove — GET
// /catalog/cafeterias/staff-requests-history (see backend/app/api/cafeterias.py).
@Component({
  selector: 'app-cafeteria-staff-requests-history',
  imports: [InternalDataPageComponent],
  templateUrl: './cafeteria-staff-requests-history.html',
  styleUrl: './cafeteria-staff-requests-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaStaffRequestsHistoryComponent {
  private readonly service = inject(CafeteriaService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // Only an Admin manages more than one cafeteria, so the cafeteria filter is only meaningful
  // (and only shown) for them — a Manager's rows are already scoped to their one outlet by the
  // server. cafeteriaCode is set only for a 'cafeteria-manager' role holder (auth.models.ts).
  readonly isCafeteriaAdmin = computed(() => this.auth.user()?.cafeteriaCode === undefined);

  readonly cafeterias = signal<readonly CafeteriaName[]>([]);
  readonly entries = signal<readonly CafeteriaStaffAuditEntry[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly cafeteriaFilter = signal('all');
  readonly actionFilter = signal('all');
  readonly actorRoleFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'createdAt', order: 'desc' });

  readonly records = computed<readonly InternalDataRecord[]>(() =>
    this.entries().map((entry) => ({
      id: entry.id,
      cells: {
        action: { primary: ACTION_LABELS[entry.action], badge: true, tone: ACTION_TONES[entry.action] },
        target: { primary: entry.targetDisplayName, secondary: entry.targetEmail },
        cafeteria: { primary: entry.cafeteriaName },
        actor: { primary: entry.actorDisplayName, secondary: this.actorRoleLabel(entry) },
        when: { primary: this.formatWhen(entry.createdAt) },
      },
      mobile: {
        eyebrow: ACTION_LABELS[entry.action],
        status: entry.cafeteriaName,
        title: entry.targetDisplayName,
        identity: entry.targetEmail,
        details: [
          { icon: 'person', text: `By ${entry.actorDisplayName}` },
          { icon: 'schedule', text: this.formatWhen(entry.createdAt) },
        ],
      },
    })),
  );

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Cafeteria staff action history', paginationLabel: 'History pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'History cards',
    header: {
      title: 'Staff Action History',
      description: this.isCafeteriaAdmin()
        ? 'Every staff create, edit, suspend, restore, or remove action across the cafeterias you manage.'
        : 'Every staff create, edit, suspend, restore, or remove action at your cafeteria.',
      countLabel: `${this.total()} action${this.total() === 1 ? '' : 's'}`,
    },
    search: { ariaLabel: 'Search history', placeholder: 'Search staff name, email, or cafeteria' },
    columns: [
      { key: 'target', label: 'Staff Member', width: '17rem' },
      { key: 'action', label: 'Action', width: '9rem' },
      { key: 'cafeteria', label: 'Cafeteria', width: '14rem' },
      { key: 'actor', label: 'Performed By', width: '15rem' },
      { key: 'when', label: 'Date & Time', width: '13rem', sortKey: 'createdAt' },
    ],
    actions: [],
    emptyTitle: 'No history found', emptyDescription: 'Staff actions will appear here as they happen.',
  }));

  readonly filters = computed(() => {
    const filters = [
      {
        key: 'action', ariaLabel: 'Filter by action', value: this.actionFilter(),
        options: [
          { value: 'all', label: 'All actions' },
          { value: 'create', label: 'Created' },
          { value: 'edit', label: 'Edited' },
          { value: 'suspend', label: 'Suspended' },
          { value: 'restore', label: 'Restored' },
          { value: 'remove', label: 'Removed' },
        ],
      },
      {
        key: 'actorRole', ariaLabel: 'Filter by who performed the action', value: this.actorRoleFilter(),
        options: [
          { value: 'all', label: 'Performed by anyone' },
          { value: 'cafeteria-manager', label: 'Cafeteria Manager' },
          { value: 'cafeteria-admin', label: 'Cafeteria Admin' },
        ],
      },
    ];
    if (this.isCafeteriaAdmin()) {
      filters.unshift({
        key: 'cafeteria', ariaLabel: 'Filter by cafeteria', value: this.cafeteriaFilter(),
        options: [{ value: 'all', label: 'All cafeterias' }, ...this.cafeterias().map((c) => ({ value: c.code, label: c.name }))],
      });
    }
    return filters;
  });

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    this.service.listNames().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cafeterias) => this.cafeterias.set(cafeterias));

    toObservable(computed(() => ({
      q: this.debouncedSearch(),
      cafeteria: this.cafeteriaFilter(),
      action: this.actionFilter(),
      actorRole: this.actorRoleFilter(),
      sort: this.sort(),
      page: this.page(),
      pageSize: this.pageSize(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.service.staffAuditLog({
            page: query.page,
            pageSize: query.pageSize,
            q: query.q || undefined,
            cafeteriaCode: query.cafeteria === 'all' ? undefined : query.cafeteria,
            action: query.action === 'all' ? undefined : (query.action as CafeteriaStaffAuditAction),
            actorRole: query.actorRole === 'all' ? undefined : (query.actorRole as CafeteriaStaffAuditActorRole),
            sort: query.sort.key as CafeteriaStaffAuditSortKey,
            order: query.sort.order,
          }).pipe(
            // Caught HERE, inside switchMap: an error reaching subscribe()'s error callback ends
            // the outer subscription permanently, so every later filter/sort/page change would
            // silently stop doing anything.
            catchError(() => {
              this.loading.set(false);
              return of(null);
            }),
          );
        }),
      )
      .subscribe((result) => {
        if (!result) return;
        this.entries.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
        this.loading.set(false);
      });
  }

  setSearch(value: string): void { this.search.set(value); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'cafeteria') this.cafeteriaFilter.set(change.value);
    if (change.key === 'action') this.actionFilter.set(change.value);
    if (change.key === 'actorRole') this.actorRoleFilter.set(change.value);
    this.page.set(1);
  }
  setSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  reset(): void {
    this.search.set(''); this.debouncedSearch.set('');
    this.cafeteriaFilter.set('all'); this.actionFilter.set('all'); this.actorRoleFilter.set('all');
    this.sort.set({ key: 'createdAt', order: 'desc' });
    this.page.set(1);
  }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  private actorRoleLabel(entry: CafeteriaStaffAuditEntry): string {
    if (entry.actorRole === 'system-admin') return 'System Admin';
    if (entry.actorRole === 'cafeteria-admin') return 'Cafeteria Admin';
    return 'Cafeteria Manager';
  }

  private formatWhen(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
