import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Observable, debounceTime, distinctUntilChanged, finalize, switchMap } from 'rxjs';
import { CafeteriaOrder, CafeteriaOrderStatus } from '../../../../core/cafeterias/cafeteria-order.models';
import { CafeteriaOrderService } from '../../../../core/cafeterias/cafeteria-order.service';
import { DeadlineReminderService, ReminderTask } from '../../../../core/reminders/deadline-reminder.service';
import { EventImageAsset } from '../../../../core/events/published-event.models';
import { CameraCaptureComponent } from '../../../../shared/components/camera-capture/camera-capture';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent, InternalTableColumn } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { TaskCalendarComponent, TaskDateSelection } from '../../../../shared/components/task-calendar/task-calendar';

type PageMode = 'active' | 'history';
// Same-day-start rule (per spec, Food Request is same-day-only like Transportation/Photo-Video/
// Campus Tour) is unconditional here — cafeteria isn't a DepartmentRequestKind so it doesn't read
// department-workflow.config.ts's requiresSameDayStart; this page enforces its own copy of it.

// new Date().toISOString() converts to UTC first — for anyone east of UTC (e.g. UTC+8), the first
// several hours of their local day still read back as "yesterday", so canStart()'s
// serveDate === today comparison silently failed on the actual scheduled day. serveDate is a
// timezone-naive SQL DATE (just "the day", no time component), so today must be built the same
// way: from the LOCAL calendar date, never a UTC conversion.
function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const COLUMNS: readonly InternalTableColumn[] = [
  { key: 'event', label: 'Event', width: '16rem' },
  { key: 'item', label: 'Order', width: '14rem' },
  { key: 'quantity', label: 'Qty', width: '6rem' },
  { key: 'schedule', label: 'Serve Time', width: '14rem' },
  { key: 'status', label: 'Status', width: '9rem' },
  { key: 'actions', label: 'Actions', actions: true, width: '10rem' },
];

// Every list control here (search, status filter, date range, page, page size) is a real server
// query param — GET /cafeteria-orders?mode=&status=&q=&dateStart=&dateEnd=&page=&pageSize= (see
// api/tasks.py's list_orders()) — same reactive pattern as staff-tasks.ts. Nothing is filtered or
// paginated client-side.
@Component({
  selector: 'app-cafeteria-staff-tasks',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent, TaskCalendarComponent, CameraCaptureComponent, ConfirmDialogComponent],
  templateUrl: './cafeteria-staff-tasks.html',
  styleUrl: './cafeteria-staff-tasks.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaStaffTasksComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(CafeteriaOrderService);
  private readonly reminders = inject(DeadlineReminderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly mode = this.route.snapshot.data['taskPage'] as PageMode;

  readonly items = signal<readonly CafeteriaOrder[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly statusFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  private readonly refreshTick = signal(0);

  private readonly today = localIsoDate(new Date());
  readonly dateFilter = signal<TaskDateSelection>({ start: this.today, end: null });
  readonly calendarOpen = signal(false);
  readonly taskDates = signal<readonly string[]>([]);

  readonly selected = signal<CafeteriaOrder | null>(null);
  readonly modalOpen = signal(false);
  readonly deliveryPhoto = signal<EventImageAsset | null>(null);

  // "Start Preparing" and "Done Preparing" are one tap on a shared, per-cafeteria queue — easy to
  // hit by accident while scanning the list, and claiming/advancing the wrong order affects a
  // teammate too. Confirm before either fires, same as "Delivered" already does via its own modal.
  readonly pendingAction = signal<{ order: CafeteriaOrder; kind: 'start' | 'ready' } | null>(null);
  readonly pendingActionCopy = computed(() => {
    const pending = this.pendingAction();
    if (!pending) return { title: '', message: '', confirmLabel: 'Confirm' };
    if (pending.kind === 'start') {
      return {
        title: 'Start preparing this order?',
        message: `You're about to start preparing "${pending.order.menuItemLabel}" for ${pending.order.eventTitle}. It will move out of the shared pool and into your in-progress list.`,
        confirmLabel: 'Start Preparing',
      };
    }
    return {
      title: 'Mark this order ready?',
      message: `You're about to mark "${pending.order.menuItemLabel}" for ${pending.order.eventTitle} as ready for delivery.`,
      confirmLabel: 'Done Preparing',
    };
  });

  // Every unclaimed ('approved') order the staff member can see, independent of whatever
  // page/filter the visible table is showing — reminders must fire for an urgent order even if
  // it's sitting on a page the staff member hasn't navigated to (see DeadlineReminderService).
  private readonly reminderCandidates = signal<readonly CafeteriaOrder[]>([]);
  readonly urgentIds = computed(() => this.reminders.urgentIds());

  /** Food Request is same-day-only: "Start Preparing" cannot be clicked before serveDate. */
  canStart(order: CafeteriaOrder): boolean {
    return order.serveDate === this.today;
  }

  readonly records = computed(() => this.items().map((order) => this.toRecord(order)));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.mode === 'history' ? 'Completed cafeteria orders' : 'Active cafeteria orders',
    paginationLabel: 'Order pages', rowsPerPageLabel: 'Orders per page', mobileListLabel: 'Order cards',
    header: {
      title: 'Tasks',
      description: this.mode === 'history' ? 'Review orders you have delivered.' : 'Claim and prepare orders from your cafeteria’s shared pool.',
      countLabel: `${this.total()} order${this.total() === 1 ? '' : 's'}`,
    },
    search: { ariaLabel: 'Search orders', placeholder: 'Search event, reference, or menu item' },
    columns: COLUMNS,
    actions: this.mode === 'history'
      ? [{ key: 'view', label: 'View', icon: 'visibility' }]
      : [
          { key: 'view', label: 'View details', icon: 'visibility' },
          { key: 'start', label: 'Start Preparing', icon: 'soup_kitchen' },
          { key: 'ready', label: 'Done Preparing', icon: 'task_alt' },
          { key: 'deliver', label: 'Delivered', icon: 'local_shipping' },
        ],
    emptyTitle: this.mode === 'history' ? 'No delivered orders found' : 'No active orders found',
    emptyDescription: this.mode === 'history' ? 'Orders you deliver will appear here.' : 'There are no orders in your cafeteria’s shared pool right now.',
    pageSizeOptions: [5, 10, 25],
  }));

  readonly filters = computed(() => [
    {
      key: 'status', ariaLabel: 'Filter orders by status', value: this.statusFilter(),
      options: [
        { value: 'all', label: 'All statuses' },
        ...(this.mode === 'history'
          ? [{ value: 'fulfilled', label: 'Delivered' }]
          : [{ value: 'approved', label: 'Unclaimed' }, { value: 'preparing', label: 'Preparing' }, { value: 'ready', label: 'Ready' }]),
      ],
    },
  ]);

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      status: this.statusFilter(),
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
          return this.service.myQueue({
            mode: this.mode,
            page: query.page,
            pageSize: query.pageSize,
            status: query.status === 'all' ? undefined : query.status,
            q: query.q || undefined,
            dateStart: query.date.start,
            dateEnd: query.date.end ?? undefined,
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
        error: () => { this.error.set('Orders could not be loaded.'); this.toast.error('Orders could not be loaded', 'Please refresh and try again.'); this.loading.set(false); },
      });

    this.loadDates();
    if (this.mode === 'active') this.loadReminderCandidates();

    this.reminders.startWatching(computed<readonly ReminderTask[]>(() =>
      this.reminderCandidates().map((order) => ({
        id: String(order.id),
        deadline: `${order.serveDate}T${order.serveTime}`,
        awaitingStart: true,
      })),
    ));
  }

  private loadDates(): void {
    this.service.myQueueDates(this.mode).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (dates) => this.taskDates.set(dates),
      error: () => this.taskDates.set([]),
    });
  }

  // Polled independently of the visible page so an urgent unclaimed order still triggers its
  // reminder even while the staff member is looking at a different page/filter.
  private loadReminderCandidates(): void {
    this.service.myQueue({ mode: 'active', status: 'approved', page: 1, pageSize: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.reminderCandidates.set(result.items),
        error: () => this.reminderCandidates.set([]),
      });
  }

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
  setFilter(change: InternalFilterChange): void { if (change.key === 'status') this.statusFilter.set(change.value); this.page.set(1); }
  setDateFilter(value: TaskDateSelection): void { this.dateFilter.set(value); this.page.set(1); }
  clearDateFilter(): void { this.dateFilter.set({ start: this.today, end: null }); this.page.set(1); }
  toggleCalendar(): void { this.calendarOpen.update((open) => !open); }
  reset(): void { this.search.set(''); this.debouncedSearch.set(''); this.statusFilter.set('all'); this.dateFilter.set({ start: this.today, end: null }); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const order = this.items().find((item) => String(item.id) === event.record.id);
    if (!order) return;
    this.selected.set(order);
    this.deliveryPhoto.set(null);
    if (event.action.key === 'view') { this.modalOpen.set(true); return; }
    if (event.action.key === 'start') { this.pendingAction.set({ order, kind: 'start' }); return; }
    if (event.action.key === 'ready') { this.pendingAction.set({ order, kind: 'ready' }); return; }
    if (event.action.key === 'deliver') { this.modalOpen.set(true); }
  }

  closePendingAction(): void { if (!this.saving()) this.pendingAction.set(null); }

  confirmPendingAction(): void {
    const pending = this.pendingAction();
    if (!pending) return;
    const { order, kind } = pending;
    if (kind === 'start') {
      this.act(order, () => this.service.startPreparing(order.id), 'Started preparing', `${order.eventTitle}'s order is now in progress.`);
    } else {
      this.act(order, () => this.service.markReady(order.id), 'Marked ready', `${order.eventTitle}'s order is ready for delivery.`);
    }
  }

  openRecord(record: InternalDataRecord): void {
    const order = this.items().find((item) => String(item.id) === record.id);
    if (order) { this.selected.set(order); this.deliveryPhoto.set(null); this.modalOpen.set(true); }
  }

  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }

  isDeliveryStep(): boolean {
    return this.selected()?.status === 'ready';
  }

  confirm(): void {
    const order = this.selected();
    if (!order) { this.closeModal(); return; }
    if (order.status !== 'ready') { this.closeModal(); return; }
    const photo = this.deliveryPhoto();
    if (!photo) return;
    this.act(order, () => this.service.markDelivered(order.id, photo.url), 'Delivered', `${order.eventTitle}'s order has moved to History.`);
  }

  private act(order: CafeteriaOrder, request: () => Observable<CafeteriaOrder>, successTitle: string, successMessage: string): void {
    this.saving.set(true);
    this.error.set('');
    request().pipe(
      finalize(() => this.saving.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.modalOpen.set(false);
        this.pendingAction.set(null);
        this.refreshTick.update((tick) => tick + 1);
        this.loadDates();
        if (this.mode === 'active') this.loadReminderCandidates();
        this.toast.success(successTitle, successMessage);
      },
      error: (err) => this.toast.error('The order could not be updated', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private toRecord(order: CafeteriaOrder): InternalDataRecord {
    const tone = order.status === 'fulfilled' ? 'success' : order.status === 'preparing' || order.status === 'ready' ? 'blue' : 'warning';
    const canStart = this.canStart(order);
    const actionKeys = this.mode === 'history'
      ? ['view']
      : order.status === 'approved'
        ? (canStart ? ['view', 'start'] : ['view'])
        : order.status === 'preparing'
          ? ['view', 'ready']
          : order.status === 'ready'
            ? ['view', 'deliver']
            : ['view'];
    return {
      id: String(order.id),
      actionKeys,
      emphasized: this.isUrgent(order),
      cells: {
        event: { primary: order.eventTitle, secondary: order.requestCode },
        item: { primary: order.menuItemLabel },
        quantity: { primary: String(order.quantity) },
        schedule: { primary: `${order.serveDate} · ${order.serveTime.slice(0, 5)}` },
        status: { primary: this.statusLabel(order.status), badge: true, tone },
        actions: { primary: '' },
      },
      mobile: {
        eyebrow: order.requestCode, status: this.statusLabel(order.status), title: order.eventTitle, identity: order.menuItemLabel,
        details: [
          { icon: 'schedule', text: `${order.serveDate} · ${order.serveTime.slice(0, 5)}` },
          { icon: 'storefront', text: order.cafeteriaName },
          { icon: 'inventory_2', text: `Qty ${order.quantity}` },
          ...(order.status === 'approved' && !canStart ? [{ icon: 'lock_clock', text: 'Starts on the scheduled day' }] : []),
          ...(this.isUrgent(order) ? [{ icon: 'notifications_active', text: 'Deadline approaching' }] : []),
        ],
      },
    };
  }

  private statusLabel(status: CafeteriaOrderStatus): string {
    if (status === 'approved') return 'Unclaimed';
    if (status === 'ready') return 'Ready';
    if (status === 'fulfilled') return 'Delivered';
    return status[0].toUpperCase() + status.slice(1);
  }

  isUrgent(order: CafeteriaOrder): boolean {
    return this.urgentIds().has(String(order.id));
  }
}
