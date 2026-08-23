import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { AssignableCafeteriaUser, Cafeteria, CafeteriaAssignment, CafeteriaStaffRoleCode } from '../../../../core/cafeterias/cafeteria.models';
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

// Cafeteria Admin's dedicated user-assignment screen: pick a user, a cafeteria, and a role
// (Cafeteria Manager or Cafeteria Staff) — writes a real user_unit_roles row via
// CafeteriaService, the same mechanism the System Admin Assignments tab uses for every other
// role. Only users holding NO role yet are offered (see cafeterias.routes.js's
// GET /assignable-users) — this page never lists a user's other roles/units, matching "the data
// or user in cafeteria should not be showing even to the admin system" (System Admin's own
// Users/Assignments screens are unaffected — a separate, general-purpose view over the same rows).
@Component({
  selector: 'app-cafeteria-staff-assignments',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent, DeleteConfirmDialogComponent, SearchableDropdownComponent, FormFieldComponent, StatusToggleComponent],
  templateUrl: './cafeteria-staff-assignments.html',
  styleUrl: './cafeteria-staff-assignments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaStaffAssignmentsComponent {
  private readonly toast = inject(ToastService);
  private readonly service = inject(CafeteriaService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly assignments = signal<readonly CafeteriaAssignment[]>([]);
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
  readonly deleting = signal(false);

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
  // (excluding the one currently being edited, so re-saving a manager row onto the same
  // cafeteria isn't blocked by its own existing row). Mirrors the server-side guard in
  // cafeterias.routes.js exactly; this is a fast client-side check, the server still enforces it.
  readonly managerConflict = computed<CafeteriaAssignment | null>(() => {
    if (this.selectedRoleCode() !== 'cafeteria-manager' || !this.selectedCafeteriaCode()) return null;
    return this.assignments().find((a) =>
      a.assignmentId !== this.editingAssignmentId()
      && a.cafeteriaCode === this.selectedCafeteriaCode()
      && a.roleCode === 'cafeteria-manager',
    ) ?? null;
  });

  readonly filteredAssignments = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.assignments().filter((a) =>
      (this.roleFilter() === 'all' || a.roleCode === this.roleFilter())
      && (!search || `${a.displayName} ${a.email} ${a.cafeteriaName}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredAssignments().length / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.assignmentRecords());
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Cafeteria staff assignments', paginationLabel: 'Assignment pages', rowsPerPageLabel: 'Assignments per page', mobileListLabel: 'Assignment cards',
    header: {
      title: 'Staff Assignments',
      description: 'Assign a Cafeteria Manager or Cafeteria Staff member to a specific cafeteria.',
      countLabel: `${this.filteredAssignments().length} assignment${this.filteredAssignments().length === 1 ? '' : 's'}`,
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
    emptyTitle: 'No assignments found', emptyDescription: 'Add an assignment or change the current search.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    { key: 'role', ariaLabel: 'Filter by role', value: this.roleFilter(), options: [{ value: 'all', label: 'All roles' }, ...ROLE_OPTIONS] },
  ]);

  constructor() {
    combineLatest([this.service.assignments$, this.service.cafeterias$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ([assignments, cafeterias]) => { this.assignments.set(assignments); this.cafeterias.set(cafeterias); this.loading.set(false); },
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
    const assignment = this.assignments().find((a) => a.assignmentId === event.record.id);
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
  }
  cancelRemove(): void { if (!this.deleting()) this.deleteTarget.set(null); }
  confirmRemove(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleting.set(true);
    this.service.removeAssignment(target.assignmentId).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.deleteTarget.set(null); this.toast.success('Assignment removed'); },
      error: (err) => { this.deleteTarget.set(null); this.toast.error('The assignment could not be removed', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  private loadAssignableUsers(): void {
    this.service.getAssignableUsers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (users) => this.assignableUsers.set(users),
      error: () => this.errorMessage.set('Assignable users could not be loaded.'),
    });
  }
  private clearMessages(): void { this.errorMessage.set(''); }
  private pageSlice<T>(records: readonly T[]): readonly T[] { return records.slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()); }
  private assignmentRecords(): readonly InternalDataRecord[] {
    return this.pageSlice(this.filteredAssignments()).map((a) => ({
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
