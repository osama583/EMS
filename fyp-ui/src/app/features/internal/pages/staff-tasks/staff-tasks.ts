import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { StaffTask, StaffTaskRoutingKey, StaffTaskStatus } from '../../../../core/staff-tasks/staff-task.models';
import { StaffTaskService } from '../../../../core/staff-tasks/staff-task.service';
import { staffTaskRoutingKeyFor } from '../../../../core/staff-tasks/staff-task-routing';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent, InternalTableColumn } from '../../../../shared/components/internal-data-page/internal-data-page.models';

type PageMode = 'active' | 'history';
interface RolePresentation { noun: string; begin: string; complete: string; beginIcon: string; columns: readonly InternalTableColumn[]; }

const COMMON_END: readonly InternalTableColumn[] = [{ key: 'status', label: 'Status', width: '9rem' }, { key: 'actions', label: 'Actions', actions: true, width: '8rem' }];
// RBAC redesign: keyed by StaffTaskRoutingKey (unitCode for the 5 Service department-routed
// kinds, or the flat 'cafeteria-staff' role_code) instead of UserRole — see staff-task.models.ts.
// Unit codes below MUST match server/db.js's seeded unit codes exactly.
const ROLE_PRESENTATION: Readonly<Partial<Record<StaffTaskRoutingKey, RolePresentation>>> = {
  'cafeteria-staff': { noun: 'order', begin: 'Prepare Order', complete: 'Order Prepared', beginIcon: 'skillet', columns: [{ key: 'event', label: 'Event', width: '19rem' }, { key: 'request', label: 'Order', width: '15rem' }, { key: 'quantity', label: 'Quantity', width: '8rem' }, { key: 'detail', label: 'Dietary / Serving', width: '15rem' }, { key: 'schedule', label: 'Schedule & Venue', width: '17rem' }, ...COMMON_END] },
  logistics_and_facilities: { noun: 'preparation', begin: 'Start Preparation', complete: 'Preparation Completed', beginIcon: 'inventory_2', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Logistics Item', width: '15rem' }, { key: 'quantity', label: 'Requested / Available', width: '11rem' }, { key: 'schedule', label: 'Setup Schedule', width: '17rem' }, { key: 'location', label: 'Location', width: '12rem' }, ...COMMON_END] },
  student_services: { noun: 'campus tour', begin: 'Start Tour', complete: 'Tour Completed', beginIcon: 'tour', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Campus Tour', width: '15rem' }, { key: 'quantity', label: 'Visitors', width: '9rem' }, { key: 'detail', label: 'Tour Route', width: '18rem' }, { key: 'schedule', label: 'Tour Schedule', width: '17rem' }, { key: 'location', label: 'Starting Point', width: '12rem' }, ...COMMON_END] },
  a_v_services: { noun: 'setup', begin: 'Start Setup', complete: 'Setup Completed', beginIcon: 'settings_input_component', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'A/V Request', width: '15rem' }, { key: 'detail', label: 'Equipment', width: '20rem' }, { key: 'schedule', label: 'Setup Window', width: '17rem' }, { key: 'location', label: 'Venue', width: '12rem' }, ...COMMON_END] },
  photography_services: { noun: 'coverage', begin: 'Start Coverage', complete: 'Coverage Completed', beginIcon: 'photo_camera', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Coverage', width: '15rem' }, { key: 'detail', label: 'Personnel', width: '15rem' }, { key: 'schedule', label: 'Coverage Schedule', width: '17rem' }, { key: 'location', label: 'Venue', width: '12rem' }, ...COMMON_END] },
  transport_services: { noun: 'trip', begin: 'Start Trip', complete: 'Trip Completed', beginIcon: 'directions_bus', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Trip', width: '14rem' }, { key: 'detail', label: 'Passengers / Capacity', width: '15rem' }, { key: 'location', label: 'Route', width: '18rem' }, { key: 'schedule', label: 'Schedule', width: '17rem' }, ...COMMON_END] },
};

@Component({
  selector: 'app-staff-tasks',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent],
  templateUrl: './staff-tasks.html',
  styleUrl: './staff-tasks.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffTasksComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(StaffTaskService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly mode = this.route.snapshot.data['taskPage'] as PageMode;
  // RBAC redesign: the routing key sent to the backend (and used to look up this staff member's
  // task-page presentation) is their own unitCode for a Service department staff member, or the
  // flat 'cafeteria-staff' role_code for cafeteria staff — see staff-task-routing.ts (shared with
  // records-hub.ts's "does this viewer even have a Tasks tab" check, so both always agree).
  private readonly currentUser = this.auth.user()!;
  readonly role: StaffTaskRoutingKey = staffTaskRoutingKeyFor(this.currentUser) ?? '';
  readonly presentation = ROLE_PRESENTATION[this.role]!;
  readonly tasks = signal<readonly StaffTask[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly sort = signal('schedule');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly selected = signal<StaffTask | null>(null);
  readonly pendingStatus = signal<StaffTaskStatus | null>(null);
  readonly modalOpen = signal(false);
  readonly error = signal('');

  private readonly CLOSED_STATUSES: readonly StaffTaskStatus[] = ['completed', 'cancelled'];

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    const closed = this.CLOSED_STATUSES;
    const records = this.tasks().filter((task) => (this.mode === 'history' ? closed.includes(task.status) : !closed.includes(task.status))
      && (this.statusFilter() === 'all' || task.status === this.statusFilter())
      && (!query || `${task.eventCode} ${task.eventTitle} ${task.request} ${task.detail} ${task.location}`.toLowerCase().includes(query)));
    return [...records].sort((a, b) => this.sort() === 'event' ? a.eventTitle.localeCompare(b.eventTitle) : this.sort() === 'status' ? a.status.localeCompare(b.status) : a.schedule.localeCompare(b.schedule));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  readonly records = computed(() => this.filtered().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()).map((task) => this.toRecord(task)));
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.mode === 'history' ? 'Completed staff tasks' : 'Active staff tasks', paginationLabel: 'Task pages', rowsPerPageLabel: 'Tasks per page', mobileListLabel: 'Task cards',
    header: { title: this.mode === 'history' ? 'History' : 'My Tasks', description: this.mode === 'history' ? `Review completed ${this.presentation.noun}s assigned to you.` : `Manage active ${this.presentation.noun}s assigned to you.`, countLabel: `${this.filtered().length} task${this.filtered().length === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search tasks', placeholder: 'Search event, request, reference, or location' }, columns: this.presentation.columns,
    actions: this.mode === 'history'
      ? [{ key: 'view', label: 'View', icon: 'visibility' }]
      : [{ key: 'view', label: 'View details', icon: 'visibility' }, { key: 'begin', label: this.presentation.begin, icon: this.presentation.beginIcon }, { key: 'complete', label: this.presentation.complete, icon: 'task_alt' }],
    emptyTitle: this.mode === 'history' ? 'No completed tasks found' : 'No active tasks found', emptyDescription: this.mode === 'history' ? 'Completed tasks will appear here.' : 'There are no assigned tasks matching the current filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    { key: 'status', ariaLabel: 'Filter tasks by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, ...(this.mode === 'history' ? [{ value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }] : [{ value: 'assigned', label: 'Assigned' }, { value: 'preparing', label: 'Preparing' }])] },
    { key: 'sort', ariaLabel: 'Sort tasks', value: this.sort(), options: [{ value: 'schedule', label: 'Schedule' }, { value: 'event', label: 'Event A–Z' }, { value: 'status', label: 'Status' }] },
  ]);

  constructor() { this.service.list(this.role, this.auth.user()!.email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (tasks) => { this.tasks.set(tasks); this.loading.set(false); }, error: () => { this.error.set('Tasks could not be loaded.'); this.toast.error('Tasks could not be loaded', 'Please refresh and try again.'); this.loading.set(false); } }); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'status') this.statusFilter.set(change.value); if (change.key === 'sort') this.sort.set(change.value); this.page.set(1); }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.sort.set('schedule'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  handleAction(event: InternalRowActionEvent): void { const task = this.tasks().find((item) => item.rowKey === event.record.id); if (!task) return; this.selected.set(task); this.pendingStatus.set(event.action.key === 'begin' ? 'preparing' : event.action.key === 'complete' ? 'completed' : null); this.modalOpen.set(true); }
  // 'view' opens the same modal with pendingStatus left null, so it never mutates task status —
  // it's purely the lightweight "see more info" detail alongside begin/complete on active tasks.
  openRecord(record: InternalDataRecord): void { const task = this.tasks().find((item) => item.rowKey === record.id); if (task) { this.selected.set(task); this.pendingStatus.set(null); this.modalOpen.set(true); } }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  confirm(): void {
    const task = this.selected();
    const status = this.pendingStatus();
    if (!task || !status) { this.closeModal(); return; }
    this.saving.set(true);
    this.error.set('');
    this.service.updateStatus(task.id, status, this.auth.user()?.email ?? '').pipe(
      finalize(() => this.saving.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      // Every row sharing this request_task_id moves together — they are one task.
      next: (updated) => {
        this.tasks.update((items) => items.map((item) => item.id === updated.id ? { ...item, status: updated.status, completedAt: updated.completedAt } : item));
        this.modalOpen.set(false);
        if (status === 'completed') this.toast.success(this.presentation.complete, `${task.eventTitle} has moved to History.`);
        else this.toast.success(this.presentation.begin, `${task.eventTitle} is now in progress.`);
      },
      error: (err) => this.toast.error('The task status could not be updated', apiErrorMessage(err, 'Please try again.')),
    });
  }

  modalTitle(): string { const status = this.pendingStatus(); return status === 'preparing' ? this.presentation.begin : status === 'completed' ? this.presentation.complete : 'Task details'; }

  private toRecord(task: StaffTask): InternalDataRecord { const tone = task.status === 'completed' ? 'success' : task.status === 'cancelled' ? 'danger' : task.status === 'preparing' ? 'blue' : 'warning'; return { id: task.rowKey, actionKeys: this.mode === 'history' || task.status === 'cancelled' ? ['view'] : task.status === 'assigned' ? ['view', 'begin'] : ['view', 'complete'], cells: { event: { primary: task.eventTitle, secondary: task.eventCode }, request: { primary: task.request }, quantity: { primary: task.quantity ?? '—' }, detail: { primary: task.detail, secondary: task.detailLabel }, schedule: { primary: task.schedule, secondary: task.location }, location: { primary: task.location }, status: { primary: this.statusLabel(task.status), badge: true, tone }, actions: { primary: '' } }, mobile: { eyebrow: task.eventCode, status: this.statusLabel(task.status), title: task.eventTitle, identity: task.request, details: [{ icon: 'schedule', text: task.schedule }, { icon: 'location_on', text: task.location }, { icon: 'info', text: task.quantity ?? task.detail }] } }; }
  private statusLabel(status: StaffTaskStatus): string { return status[0].toUpperCase() + status.slice(1); }
}
