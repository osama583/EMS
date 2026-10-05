import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { debounceTime, distinctUntilChanged, finalize, switchMap } from 'rxjs';
import { DepartmentRequestKind, requiresSameDayStart } from '../../../../core/departments/department-workflow.config';
import { MyRowAssignment, RowAssignmentStatus } from '../../../../core/row-assignments/row-assignment.models';
import { RowAssignmentService } from '../../../../core/row-assignments/row-assignment.service';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent, InternalTableColumn, InternalSortChange, InternalSortState } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { TaskCalendarComponent, TaskDateSelection } from '../../../../shared/components/task-calendar/task-calendar';

type PageMode = 'active' | 'history';
interface RolePresentation { noun: string; begin: string; complete: string; beginIcon: string; columns: readonly InternalTableColumn[]; }

// new Date().toISOString() converts to UTC first — for anyone east of UTC (e.g.
function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 'Assigned To' shows who ELSE is on this same row (see RowAssignment's partners) — e.g.
const COMMON_END: readonly InternalTableColumn[] = [{ key: 'assignedTo', label: 'Assigned To', width: '12rem' }, { key: 'status', label: 'Status', width: '9rem' }, { key: 'actions', label: 'Actions', actions: true, width: '8rem' }];
// Row-level assignment (see migration 012 / RowAssignmentService) covers exactly these five
// requirement kinds — F&B/cafeteria-staff use their own queue page (cafeteria-staff-tasks),
// routed separately by records-hub.ts's tasksRoute computed.
const ROLE_PRESENTATION: Readonly<Partial<Record<DepartmentRequestKind, RolePresentation>>> = {
  logistics: { noun: 'preparation', begin: 'Start Preparation', complete: 'Preparation Completed', beginIcon: 'inventory_2', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Logistics Item', width: '15rem' }, { key: 'quantity', label: 'Requested', width: '11rem' }, { key: 'schedule', label: 'Setup Schedule', width: '17rem', sortKey: 'schedule' }, { key: 'location', label: 'Location', width: '12rem' }, ...COMMON_END] },
  campusTour: { noun: 'campus tour', begin: 'Start Tour', complete: 'Tour Completed', beginIcon: 'tour', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Campus Tour', width: '15rem' }, { key: 'quantity', label: 'Visitors', width: '9rem' }, { key: 'schedule', label: 'Tour Schedule', width: '17rem', sortKey: 'schedule' }, { key: 'location', label: 'Starting Point', width: '12rem' }, ...COMMON_END] },
  soundLight: { noun: 'setup', begin: 'Start Setup', complete: 'Setup Completed', beginIcon: 'settings_input_component', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'A/V Request', width: '15rem' }, { key: 'schedule', label: 'Setup Window', width: '17rem', sortKey: 'schedule' }, { key: 'location', label: 'Venue', width: '12rem' }, ...COMMON_END] },
  photoVideo: { noun: 'coverage', begin: 'Start Coverage', complete: 'Coverage Completed', beginIcon: 'photo_camera', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Coverage', width: '15rem' }, { key: 'schedule', label: 'Coverage Schedule', width: '17rem', sortKey: 'schedule' }, { key: 'location', label: 'Venue', width: '12rem' }, ...COMMON_END] },
  transportation: { noun: 'trip', begin: 'Start Trip', complete: 'Trip Completed', beginIcon: 'directions_bus', columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Trip', width: '14rem' }, { key: 'quantity', label: 'Pax', width: '9rem' }, { key: 'location', label: 'Route', width: '18rem' }, { key: 'schedule', label: 'Schedule', width: '17rem', sortKey: 'schedule' }, ...COMMON_END] },
};

const DEFAULT_PRESENTATION: RolePresentation = {
  noun: 'task', begin: 'Start', complete: 'Complete', beginIcon: 'task_alt',
  columns: [{ key: 'event', label: 'Event', width: '18rem' }, { key: 'request', label: 'Request', width: '15rem' }, { key: 'schedule', label: 'Schedule', width: '17rem', sortKey: 'schedule' }, { key: 'location', label: 'Location', width: '12rem' }, ...COMMON_END],
};

// Every list control here (search, status filter, date range, page, page size) is a real server query
// param — GET /tasks/my-row-assignments?mode=&status=&q=&dateStart=&dateEnd=&page=&pageSize= (see
// api/tasks.py's list_my_row_assignments()) — replicating hub-proposals.ts's pattern.
@Component({
  selector: 'app-staff-tasks',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent, TaskCalendarComponent],
  templateUrl: './staff-tasks.html',
  styleUrl: './staff-tasks.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffTasksComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(RowAssignmentService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly mode = this.route.snapshot.data['taskPage'] as PageMode;

  readonly items = signal<readonly MyRowAssignment[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly statusFilter = signal('all');
  // Schedule is the only sortable column - it is the only date one. Soonest
  // first, because a task list is worked in the order the work falls due.
  readonly sort = signal<InternalSortState>({ key: 'schedule', order: 'asc' });
  readonly page = signal(1);
  readonly pageSize = signal(10);

  private readonly today = localIsoDate(new Date());
  readonly dateFilter = signal<TaskDateSelection>({ start: this.today, end: null });
  readonly calendarOpen = signal(false);
  readonly taskDates = signal<readonly string[]>([]);
  // Bumped after a status change (see confirm()) to force a refetch of the current page — a
  // completed task must actually leave the Active tab's list (it now belongs to `mode: 'history'`
  // server-side), not just have its status text patched in place.
  private readonly refreshTick = signal(0);

  readonly selected = signal<MyRowAssignment | null>(null);
  readonly pendingStatus = signal<RowAssignmentStatus | null>(null);
  readonly modalOpen = signal(false);

  // Presentation is per-ROW now (each assignment carries its own requirementName), not fixed for
  // the whole page — a Logistics staff member only ever gets 'logistics' rows in practice, but the
  // lookup stays per-row so the page never mis-labels a mixed result.
  private presentationFor(kind: DepartmentRequestKind): RolePresentation {
    return ROLE_PRESENTATION[kind] ?? DEFAULT_PRESENTATION;
  }
  readonly headerPresentation = computed(() => this.presentationFor(this.items()[0]?.requirementName ?? 'logistics'));

  // Same-day-start gate: Transportation/Photo-Video/Campus Tour can only be started on their
  // scheduled day; Logistics/Sound & Light stay unrestricted (see requiresSameDayStart).
  canStart(task: MyRowAssignment): boolean {
    if (!requiresSameDayStart(task.requirementName)) return true;
    return task.deadline.slice(0, 10) === this.today;
  }

  readonly records = computed(() => this.items().map((task) => this.toRecord(task)));

  readonly config = computed<InternalDataPageConfig>(() => {
    const presentation = this.headerPresentation();
    return {
      ariaLabel: this.mode === 'history' ? 'Completed staff tasks' : 'Active staff tasks', paginationLabel: 'Task pages', rowsPerPageLabel: 'Tasks per page', mobileListLabel: 'Task cards',
      header: { title: 'Tasks', description: this.mode === 'history' ? `Review completed ${presentation.noun}s assigned to you.` : `Manage active ${presentation.noun}s assigned to you.`, countLabel: `${this.total()} task${this.total() === 1 ? '' : 's'}` },
      search: { ariaLabel: 'Search tasks', placeholder: 'Search event, request, reference, or location' }, columns: presentation.columns,
      actions: this.mode === 'history'
        ? [{ key: 'view', label: 'View', icon: 'visibility' }]
        : [{ key: 'view', label: 'View details', icon: 'visibility' }, { key: 'begin', label: presentation.begin, icon: presentation.beginIcon }, { key: 'complete', label: presentation.complete, icon: 'task_alt' }],
      emptyTitle: this.mode === 'history' ? 'No completed tasks found' : 'No active tasks found',
      emptyDescription: this.mode === 'history' ? 'Completed tasks will appear here.' : 'There are no assigned tasks matching the current filters.',
    };
  });
  readonly filters = computed(() => [
    { key: 'status', ariaLabel: 'Filter tasks by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, ...(this.mode === 'history' ? [{ value: 'completed', label: 'Completed' }] : [{ value: 'assigned', label: 'Assigned' }, { value: 'preparing', label: 'Preparing' }])] },
  ]);

  constructor() {
    // Debounces the search box only — every other control (filter/sort/date/page/pageSize)
    // already changes at a human pace and should refetch immediately.
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      status: this.statusFilter(),
      sort: this.sort(),
      q: this.debouncedSearch(),
      date: this.dateFilter(),
      page: this.page(),
      pageSize: this.pageSize(),
      tick: this.refreshTick(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.service.myRowAssignments({
            mode: this.mode,
            page: query.page,
            pageSize: query.pageSize,
            status: query.status === 'all' ? undefined : query.status,
            q: query.q || undefined,
            dateStart: query.date.start,
            dateEnd: query.date.end ?? undefined,
            sort: query.sort.key as 'schedule',
            order: query.sort.order,
          });
        }),
      )
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
          this.total.set(result.total);
          this.totalPages.set(result.totalPages);
          this.loading.set(false);
          this.error.set('');
        },
        error: () => { this.error.set('Tasks could not be loaded.'); this.toast.error('Tasks could not be loaded', 'Please refresh and try again.'); this.loading.set(false); },
      });

    this.loadDates();
  }

  // The calendar's dot indicator reflects EVERY day with a task, independent of the current
  // page/filter/search — fetched separately from the main list (see GET /tasks/my-row-
  // assignments/dates) rather than derived from the current page's items, which would only ever show
  // dots for whatever happens to be on screen.
  private loadDates(): void {
    this.service.myRowAssignmentDates(this.mode).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (dates) => this.taskDates.set(dates),
      error: () => this.taskDates.set([]),
    });
  }

  // Whether the date filter is still at its default (today only) — drives the toggle button's
  // active-state dot and whether a "Clear date filter" affordance is offered.
  isDefaultDateFilter(): boolean {
    const { start, end } = this.dateFilter();
    return start === this.today && end === null;
  }
  calendarButtonLabel(): string {
    const { start, end } = this.dateFilter();
    if (!end) return start === this.today ? 'Today' : this.formatDay(start);
    return `${this.formatDay(start)} – ${this.formatDay(end)}`;
  }
  private formatDay(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.calendarOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.calendarOpen.set(false);
    }
  }
  @HostListener('document:keydown.escape')
  onEscape(): void { this.calendarOpen.set(false); }

  setSearch(value: string): void { this.search.set(value); }
  setSort(change: InternalSortChange): void {
    this.sort.set({ key: change.key, order: change.order });
    this.page.set(1);
  }
  setFilter(change: InternalFilterChange): void { if (change.key === 'status') this.statusFilter.set(change.value); this.page.set(1); }
  setDateFilter(value: TaskDateSelection): void { this.dateFilter.set(value); this.page.set(1); }
  clearDateFilter(): void { this.dateFilter.set({ start: this.today, end: null }); this.page.set(1); }
  toggleCalendar(): void { this.calendarOpen.update((open) => !open); }
  reset(): void { this.search.set(''); this.debouncedSearch.set(''); this.statusFilter.set('all'); this.sort.set({ key: 'schedule', order: 'asc' }); this.dateFilter.set({ start: this.today, end: null }); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  handleAction(event: InternalRowActionEvent): void { const task = this.items().find((item) => String(item.id) === event.record.id); if (!task) return; this.selected.set(task); this.pendingStatus.set(event.action.key === 'begin' ? 'preparing' : event.action.key === 'complete' ? 'completed' : null); this.modalOpen.set(true); }
  // 'view' opens the same modal with pendingStatus left null, so it never mutates task status —
  // it's purely the lightweight "see more info" detail alongside begin/complete on active tasks.
  openRecord(record: InternalDataRecord): void { const task = this.items().find((item) => String(item.id) === record.id); if (task) { this.selected.set(task); this.pendingStatus.set(null); this.modalOpen.set(true); } }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  confirm(): void {
    const task = this.selected();
    const status = this.pendingStatus();
    if (!task || !status) { this.closeModal(); return; }
    this.saving.set(true);
    this.error.set('');
    const presentation = this.presentationFor(task.requirementName);
    this.service.updateRowStatus(task.id, status).pipe(
      finalize(() => this.saving.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.modalOpen.set(false);
        this.refreshTick.update((tick) => tick + 1);
        this.loadDates();
        if (status === 'completed') this.toast.success(presentation.complete, `${task.eventTitle} has moved to History.`);
        else this.toast.success(presentation.begin, `${task.eventTitle} is now in progress.`);
      },
      error: (err) => this.toast.error('The task status could not be updated', apiErrorMessage(err, 'Please try again.')),
    });
  }

  modalTitle(): string {
    const status = this.pendingStatus();
    const presentation = this.presentationFor(this.selected()?.requirementName ?? 'logistics');
    return status === 'preparing' ? presentation.begin : status === 'completed' ? presentation.complete : 'Task details';
  }

  private toRecord(task: MyRowAssignment): InternalDataRecord {
    const tone = task.status === 'completed' ? 'success' : task.status === 'preparing' ? 'blue' : 'warning';
    const canStart = this.canStart(task);
    const actionKeys = this.mode === 'history'
      ? ['view']
      : task.status === 'assigned'
        ? (canStart ? ['view', 'begin'] : ['view'])
        : ['view', 'complete'];
    return {
      id: String(task.id),
      actionKeys,
      cells: {
        event: { primary: task.eventTitle, secondary: task.proposalId },
        request: { primary: task.item },
        quantity: { primary: task.quantity || '—' },
        schedule: { primary: task.schedule, secondary: task.location },
        location: { primary: task.location },
        assignedTo: { primary: task.partners.length ? task.partners.join(', ') : 'Just you' },
        status: { primary: this.statusLabel(task.status), badge: true, tone },
        actions: { primary: '' },
      },
      mobile: {
        eyebrow: task.proposalId, status: this.statusLabel(task.status), title: task.eventTitle, identity: task.item,
        details: [
          { icon: 'schedule', text: task.schedule },
          { icon: 'location_on', text: task.location },
          { icon: 'info', text: task.quantity || task.notes },
          ...(task.partners.length ? [{ icon: 'group', text: `With ${task.partners.join(', ')}` }] : []),
          ...(task.status === 'assigned' && !canStart ? [{ icon: 'lock_clock', text: 'Starts on the scheduled day' }] : []),
        ],
      },
    };
  }
  private statusLabel(status: RowAssignmentStatus): string { return status[0].toUpperCase() + status.slice(1); }
}
