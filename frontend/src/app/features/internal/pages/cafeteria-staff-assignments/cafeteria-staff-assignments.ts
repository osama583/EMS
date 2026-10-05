import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, debounceTime, finalize, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { AssignableCafeteriaUser, Cafeteria, CafeteriaAssignment, CafeteriaStaffRoleCode } from '../../../../core/cafeterias/cafeteria.models';
import { DeletionMetadata, DeletionPreview } from '../../../../shared/models/deletion.models';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';

const PASSWORD_MIN_LENGTH = 8;

const ROLE_OPTIONS: readonly SelectOption[] = [
  { value: 'cafeteria-manager', label: 'Cafeteria Manager' },
  { value: 'cafeteria-staff', label: 'Cafeteria Staff' },
];

// Cafeteria Admin's dedicated user-assignment screen: pick a user, a cafeteria, and a role (Cafeteria
// Manager or Cafeteria Staff) — writes a real user_unit_roles row via CafeteriaService, the same
// mechanism the System Admin Assignments tab uses for every other role.
@Component({
  selector: 'app-cafeteria-staff-assignments',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent, DeleteConfirmDialogComponent, ConfirmDialogComponent, SearchableDropdownComponent, FormFieldComponent, StatusToggleComponent],
  templateUrl: './cafeteria-staff-assignments.html',
  styleUrl: './cafeteria-staff-assignments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaStaffAssignmentsComponent {
  private readonly toast = inject(ToastService);
  private readonly service = inject(CafeteriaService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // Full, unpaginated, role-scoped list — needed as-is for the manager-conflict check below,
  // which must see every assignment, not just the page currently on screen.
  readonly assignments = signal<readonly CafeteriaAssignment[]>([]);
  // The current page of the server-side search — what the table actually renders.
  readonly pageAssignments = signal<readonly CafeteriaAssignment[]>([]);
  readonly total = signal(0);
  readonly cafeterias = signal<readonly Cafeteria[]>([]);
  readonly assignableUsers = signal<readonly AssignableCafeteriaUser[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly roleFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly modalOpen = signal(false);
  readonly saving = signal(false);
  // Set only when editing an existing assignment — save() then PUTs the edited cafeteria/role
  // onto this assignment instead of POSTing a new one. The user is locked in edit mode (see
  // CafeteriaAssignmentDraft's comment — reassigning to a different user is remove + add).
  readonly editingAssignmentId = signal<string | null>(null);
  readonly selectedUserId = signal('');
  readonly selectedUserLabel = signal('');
  readonly selectedCafeteriaCode = signal('');
  readonly selectedRoleCode = signal<CafeteriaStaffRoleCode | ''>('');
  readonly errorMessage = signal('');

  readonly deleteTarget = signal<CafeteriaAssignment | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);

  // Deleted tab — same page-level section switch as club-management.ts, only fetched the first
  // time it's opened so a viewer who never looks at it never pays for the call.
  readonly showDeleted = signal(false);
  readonly deletedAssignments = signal<readonly (CafeteriaAssignment & DeletionMetadata)[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringId = signal<string | null>(null);
  readonly restoreTarget = signal<CafeteriaAssignment | null>(null);

  // The account this posting is for — created with it when adding, amended when editing.
  readonly draft = signal<Record<string, string | boolean>>({});

  readonly userOptions = computed<readonly SelectOption[]>(() => this.assignableUsers().map((u) => ({ value: u.id, label: u.displayName, description: u.email })));
  readonly cafeteriaOptions = computed<readonly SelectOption[]>(() => this.cafeterias().filter((c) => c.active).map((c) => ({ value: c.code, label: c.name })));
  readonly roleOptions = ROLE_OPTIONS;
  readonly passwordHint = computed(() => {
    const password = String(this.draft()['password'] ?? '');
    if (password && password.length < PASSWORD_MIN_LENGTH) return `At least ${PASSWORD_MIN_LENGTH} characters.`;
    return this.editingAssignmentId()
      ? 'Leave blank to keep the current password.'
      : 'Leave blank to create the account without a password.';
  });
  readonly formValid = computed(() => {
    const d = this.draft();
    const name = String(d['displayName'] ?? '').trim();
    const email = String(d['email'] ?? '').trim();
    const password = String(d['password'] ?? '');
    if (password && password.length < PASSWORD_MIN_LENGTH) return false;
    return name.length > 0
      && /^\S+@\S+\.\S+$/.test(email)
      && !!this.selectedCafeteriaCode()
      && !!this.selectedRoleCode()
      && !this.managerConflict();
  });
  // A cafeteria may have at most one Cafeteria Manager — checked against every OTHER assignment
  // (excluding the one currently being edited, so re-saving a manager row onto the same cafeteria
  // isn't blocked by its own existing row).
  readonly managerConflict = computed<CafeteriaAssignment | null>(() => {
    if (this.selectedRoleCode() !== 'cafeteria-manager' || !this.selectedCafeteriaCode()) return null;
    return this.assignments().find((a) =>
      a.assignmentId !== this.editingAssignmentId()
      && a.cafeteriaCode === this.selectedCafeteriaCode()
      && a.roleCode === 'cafeteria-manager',
    ) ?? null;
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.assignmentRecords());
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Cafeteria staff assignments', paginationLabel: 'Assignment pages', rowsPerPageLabel: 'Assignments per page', mobileListLabel: 'Assignment cards',
    header: {
      title: 'Staff Assignments',
      description: 'Assign a Cafeteria Manager or Cafeteria Staff member to a specific cafeteria.',
      countLabel: `${this.total()} assignment${this.total() === 1 ? '' : 's'}`,
      primaryActionLabel: 'Add assignment',
    },
    search: { ariaLabel: 'Search assignments', placeholder: 'Search name, email, or cafeteria' },
    columns: [
      { key: 'user', label: 'User' },
      { key: 'role', label: 'Role' },
      { key: 'cafeteria', label: 'Cafeteria' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'edit', label: 'Edit assignment', icon: 'edit' },
      { key: 'status', label: 'Suspend / restore', icon: 'toggle_on' },
      { key: 'remove', label: 'Remove assignment', icon: 'delete' },
    ],
    emptyTitle: 'No assignments found', emptyDescription: 'Add an assignment or change the current search.',
  }));
  readonly filters = computed(() => [
    { key: 'role', ariaLabel: 'Filter by role', value: this.roleFilter(), options: [{ value: 'all', label: 'All roles' }, ...ROLE_OPTIONS] },
  ]);
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Deleted staff assignments', paginationLabel: 'Deleted assignment pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted assignment cards',
    header: {
      title: 'Deleted Assignments',
      description: 'Soft-deleted assignments are kept for 7 days before being permanently removed. Restore one any time within that window.',
      countLabel: `${this.deletedAssignments().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'user', label: 'User' }, { key: 'cafeteria', label: 'Cafeteria' }, { key: 'created', label: 'Deleted' }, { key: 'status', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'restore', label: 'Restore', icon: 'restore_from_trash' }],
    emptyTitle: 'No deleted assignments', emptyDescription: 'Assignments you remove will appear here for 7 days before being permanently removed.',
  }));
  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.deletedAssignments().map((a) => ({
    id: a.assignmentId,
    actionKeys: ['restore'],
    cells: {
      user: { primary: a.displayName, secondary: a.email },
      cafeteria: { primary: a.cafeteriaName },
      created: { primary: `Deleted ${this.formatDate(a.deletedAt)}` },
      status: { primary: a.daysRemaining > 0 ? `${a.daysRemaining} day${a.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: a.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${a.daysRemaining}d left`, title: a.displayName, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(a.deletedAt)}` }] },
  })));

  // Drives the table: search/role/page/pageSize, refetched from the server on every change or whenever
  // the service signals a mutation (create/update/remove/restore) via refreshed$ - the same query
  // params the page used to compute in the browser (filteredAssignments/pageSlice) are now sent to the
  // server instead.
  private readonly query$ = toObservable(computed(() => ({
    page: this.page(), pageSize: this.pageSize(), q: this.search().trim(), role: this.roleFilter(),
  })));

  constructor() {
    combineLatest([this.service.assignments$, this.service.cafeterias$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ([assignments, cafeterias]) => { this.assignments.set(assignments); this.cafeterias.set(cafeterias); },
      error: () => this.errorMessage.set('The staff assignments could not be loaded.'),
    });

    combineLatest([this.query$, this.service.refreshed$]).pipe(
      debounceTime(200),
      switchMap(([q]) => {
        this.loading.set(true);
        return this.service.searchAssignments({
          page: q.page, pageSize: q.pageSize, q: q.q || undefined,
          role: q.role === 'cafeteria-manager' || q.role === 'cafeteria-staff' ? q.role : undefined,
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => { this.pageAssignments.set(result.items); this.total.set(result.total); this.loading.set(false); },
      error: () => { this.errorMessage.set('The staff assignments could not be loaded.'); this.loading.set(false); },
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'role') this.roleFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.roleFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  openAdd(): void {
    this.clearMessages();
    this.editingAssignmentId.set(null);
    this.selectedUserId.set(''); this.selectedUserLabel.set(''); this.selectedCafeteriaCode.set(''); this.selectedRoleCode.set('');
    this.draft.set({ displayName: '', email: '', password: '', userActive: true });
    this.modalOpen.set(true);
  }
  openEdit(assignment: CafeteriaAssignment): void {
    this.clearMessages();
    this.editingAssignmentId.set(assignment.assignmentId);
    this.selectedUserId.set(assignment.userId);
    this.selectedUserLabel.set(assignment.displayName);
    this.selectedCafeteriaCode.set(assignment.cafeteriaCode);
    this.selectedRoleCode.set(assignment.roleCode);
    this.draft.set({
      displayName: assignment.displayName,
      email: assignment.email,
      // Blank means "leave it alone" — the stored value is a hash, so there is nothing to show.
      password: '',
      userActive: assignment.userActive !== false,
    });
    this.modalOpen.set(true);
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft(key: string, value: string | boolean): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }
  value(key: string): string { return String(this.draft()[key] ?? ''); }
  selectUser(value: string | readonly string[]): void { this.selectedUserId.set(Array.isArray(value) ? value[0] ?? '' : value); }
  selectCafeteria(value: string | readonly string[]): void { this.selectedCafeteriaCode.set(Array.isArray(value) ? value[0] ?? '' : value); }
  selectRole(value: string | readonly string[]): void { this.selectedRoleCode.set((Array.isArray(value) ? value[0] ?? '' : value) as CafeteriaStaffRoleCode | ''); }

  // The editing user, locked into a single-option dropdown (same read-only-picker convention as
  // Admin Directory's Edit Assignment modal) — reassigning to a different user is remove + add.
  readonly editingUserOption = computed<readonly SelectOption[]>(() => {
    const id = this.selectedUserId();
    return id && this.editingAssignmentId() ? [{ value: id, label: this.selectedUserLabel() }] : [];
  });

  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearMessages();
    const editingId = this.editingAssignmentId();
    const d = this.draft();
    const account = {
      displayName: String(d['displayName']).trim(),
      email: String(d['email']).trim(),
      password: String(d['password'] ?? '') || undefined,
    };
    const request = editingId
      ? this.service.updateAssignment(editingId, {
          cafeteriaCode: this.selectedCafeteriaCode(),
          roleCode: this.selectedRoleCode() as CafeteriaStaffRoleCode,
          ...account,
          userActive: d['userActive'] !== false,
        })
      : this.service.assignNewAccount({
          ...account,
          displayName: account.displayName,
          email: account.email,
          active: d['userActive'] !== false,
          cafeteriaCode: this.selectedCafeteriaCode(),
          roleCode: this.selectedRoleCode() as CafeteriaStaffRoleCode,
        });
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.modalOpen.set(false); this.toast.success(editingId ? 'Assignment updated.' : 'Assignment added.'); },
      error: (err) => this.toast.error(err?.error?.message || `The assignment could not be ${editingId ? 'updated' : 'added'}.`),
    });
  }

  handleAction(event: InternalRowActionEvent): void {
    const assignment = this.pageAssignments().find((a) => a.assignmentId === event.record.id);
    if (!assignment) return;
    if (event.action.key === 'edit') { this.openEdit(assignment); return; }
    if (event.action.key === 'status') { this.toggleAssignmentActive(assignment); return; }
    this.requestRemove(assignment);
  }
  targetLabel(): string {
    const target = this.deleteTarget();
    return target ? `"${target.displayName} · ${target.cafeteriaName}"` : '';
  }
  // Suspending stops someone's cafeteria access without discarding the posting, so a spell of
  // leave keeps its history instead of becoming a delete-and-re-add.
  private toggleAssignmentActive(assignment: CafeteriaAssignment): void {
    const next = assignment.active === false;
    this.clearMessages();
    this.service.setAssignmentActive(assignment.assignmentId, next).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`${assignment.displayName} is now ${next ? 'active' : 'suspended'}.`),
      error: (err) => this.toast.error('The assignment status could not be changed', apiErrorMessage(err, 'Please try again.')),
    });
  }

  requestRemove(assignment: CafeteriaAssignment): void {
    this.clearMessages();
    this.deleteTarget.set(assignment);
    // A posting with no dependents of its own can still belong to someone who has claimed
    // orders or been assigned tasks at this outlet — that's what this checks, not the
    // assignment row itself. See CafeteriaService.checkAssignmentDeletion().
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.service.checkAssignmentDeletion(assignment.assignmentId).pipe(
      finalize(() => this.checkingDeletion.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check assignment', 'Please try again.'),
    });
  }
  cancelRemove(): void {
    if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); }
  }
  confirmRemove(): void {
    const target = this.deleteTarget();
    const preview = this.deletePreview();
    if (!target || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    this.service.removeAssignment(target.assignmentId).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null);
        this.deletePreview.set(null);
        this.toast.success('Assignment removed');
      },
      error: (err) => {
        this.deleteTarget.set(null);
        this.deletePreview.set(null);
        this.toast.error('The assignment could not be removed', apiErrorMessage(err, 'Please try again.'));
      },
    });
  }

  // Deleted tab — mirrors club-management.ts's identical section exactly.
  setDeletedTab(deleted: boolean): void {
    if (this.showDeleted() === deleted) return;
    this.showDeleted.set(deleted);
    this.clearMessages();
    if (deleted) this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.service.getDeletedAssignments().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (assignments) => this.deletedAssignments.set(assignments),
      error: () => this.errorMessage.set('The deleted assignments could not be loaded.'),
    });
  }
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key !== 'restore') return;
    const assignment = this.deletedAssignments().find((item) => item.assignmentId === event.record.id);
    if (assignment) this.restoreTarget.set(assignment);
  }
  readonly restoreMessage = computed(() => {
    const target = this.restoreTarget();
    return target ? `Restore "${target.displayName} · ${target.cafeteriaName}"? It comes back suspended, so it stays off the active roster until you switch it active again.` : '';
  });
  cancelRestore(): void { this.restoreTarget.set(null); }
  confirmRestore(): void {
    const target = this.restoreTarget();
    this.restoreTarget.set(null);
    if (target) this.restoreAssignment(target.assignmentId);
  }
  private restoreAssignment(id: string): void {
    this.restoringId.set(id);
    this.service.restoreAssignment(id).pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Assignment restored'); this.loadDeleted(); },
      error: (err) => this.toast.error('Could not restore assignment', apiErrorMessage(err, 'Please try again.')),
    });
  }
  private formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  private loadAssignableUsers(): void {
    this.service.getAssignableUsers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (users) => this.assignableUsers.set(users),
      error: () => this.errorMessage.set('Assignable users could not be loaded.'),
    });
  }
  private clearMessages(): void { this.errorMessage.set(''); }
  private assignmentRecords(): readonly InternalDataRecord[] {
    return this.pageAssignments().map((a) => ({
      id: a.assignmentId,
      actionKeys: ['edit', 'status', 'remove'],
      cells: {
        user: { primary: a.displayName, secondary: a.email },
        role: { primary: a.roleLabel, badge: true, tone: a.roleCode === 'cafeteria-manager' ? 'blue' : 'neutral' },
        cafeteria: { primary: a.cafeteriaName },
        status: {
          primary: a.active === false ? 'Suspended' : 'Active',
          badge: true,
          tone: a.active === false ? 'warning' : 'success',
        },
        actions: { primary: '' },
      },
      mobile: {
        eyebrow: a.roleLabel,
        status: a.active === false ? 'Suspended' : 'Active',
        title: a.displayName, identity: a.email,
        details: [{ icon: 'storefront', text: a.cafeteriaName }],
      },
    }));
  }
}
