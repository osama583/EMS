import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, finalize, Observable } from 'rxjs';
import { AdminDirectoryService } from '../../../../core/admin-directory/admin-directory.service';
import { Archived, AdminRoleRecord, AdminUnitDraft, AdminUnitRecord, AdminUserDraft, AdminUserRecord } from '../../../../core/admin-directory/admin-directory.models';
import { DeletionPreview } from '../../../../shared/models/deletion.models';

// Server-side derivation this mirrors exactly: services/unit-code.js's deriveUnitCode() —
// lowercase_with_underscores, no truncation. Kept in sync manually (no shared module reachable
// from both an Express CommonJS file and this Angular TS file without a build-tooling change).
function deriveUnitCode(description: string): string {
  return (description || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalCellClickEvent, InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { PopoverComponent } from '../../../../shared/components/popover/popover';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Matches the backend's own floor (_hash_new_password in api/cafeterias.py) and the identical
// constant in the cafeteria staff forms.
const PASSWORD_MIN_LENGTH = 8;

type AdminEntity = 'users' | 'units';
type AdminTab = 'active' | 'assignments' | 'deleted';

// One row per (unit, role) pair a user holds — the raw material for both the Assignments tab's
// per-user table row (grouped below) and its "Relationship"/popover text.
interface AssignmentRow {
  readonly assignmentId: string;
  readonly roleName: string;
  readonly unitDescription: string | null;
}

// The Assignments tab's actual table grain: one row per USER, carrying every (unit, role) pair
// they hold — grouped from AdminUserRecord.roles, the same array the Users tab's Role/Unit columns
// already read.
interface UserAssignmentGroup {
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
  readonly rows: readonly AssignmentRow[];
}

// Sentinel for the Add Assignment popup's Unit dropdown "no unit" option (flat roles only) — kept
// distinct from '' (nothing chosen yet) so the role list only loads once the admin actually picks
// one or the other.
const NO_UNIT = '__no_unit__';

// One (Unit, Role) draft row in the Add Assignment popup's table — the admin can queue up several
// of these for the same user before the modal's single submit saves them all in sequence.
let nextDraftRowId = 0;
interface AssignmentDraftRow {
  readonly id: number;
  unitCode: string;
  roleCode: string;
  roleOptions: readonly AdminRoleRecord[];
  roleOptionsLoading: boolean;
}

// RBAC redesign: the Users form only edits identity fields (Full Name/Username/Email/Active) per
// the design spec — role/unit assignment is managed on the Assignments tab instead, not this form.
// The deleted-items table names its first column differently per page (identity / name / label),
// so the confirmation reads whichever cell actually carries the record's display name.
function restoreLabelFor(record: InternalDataRecord): string {
  const named = Object.values(record.cells).find((cell) => !!cell?.primary);
  return named?.primary ? String(named.primary) : String(record.id);
}

@Component({
  selector: 'app-admin-directory',
  imports: [InternalDataPageComponent, FormModalComponent, FormFieldComponent, StatusToggleComponent, FeedbackBannerComponent, ConfirmDialogComponent, DeleteConfirmDialogComponent, SearchableDropdownComponent, PopoverComponent],
  templateUrl: './admin-directory.html',
  styleUrl: './admin-directory.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDirectoryComponent {
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(AdminDirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  readonly entity = this.route.snapshot.data['adminEntity'] as AdminEntity;
  readonly tab = signal<AdminTab>('active');
  readonly users = signal<readonly AdminUserRecord[]>([]);
  readonly units = signal<readonly AdminUnitRecord[]>([]);
  readonly roles = signal<readonly AdminRoleRecord[]>([]);
  readonly deletedUsers = signal<readonly Archived<AdminUserRecord>[]>([]);
  readonly deletedUnits = signal<readonly Archived<AdminUnitRecord>[]>([]);
  readonly deletedLoading = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly unitFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly modalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<Record<string, string | boolean | readonly string[]>>({});
  readonly errorMessage = signal('');

  // Delete-confirmation flow: the dependency preview is fetched as soon as the dialog opens (not
  // only after the admin confirms), so a blocking reason is visible before they can even try.
  readonly deleteTarget = signal<AdminUserRecord | AdminUnitRecord | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);
  readonly restoringId = signal<string | null>(null);

  // "Delete forever" (purge) — immediate and unrecoverable, alongside Restore in the Deleted tab.
  readonly purgeTargetId = signal<string | null>(null);
  readonly purgePreview = signal<DeletionPreview | null>(null);
  readonly checkingPurge = signal(false);
  readonly purgeTargetLabel = signal('');
  readonly purging = signal(false);

  // ---------------------------------------------------------------------------
  // Assignments tab (Users entity only) — one row per user, each carrying every (unit, role) pair
  // they hold. The "Add Assignment" modal is shared between two entry points: the toolbar button
  // (blank user picker, for a user with none yet) and a row's Edit action (user locked, existing
  // rows listed with individual remove, plus the same "Add" control to queue new ones).
  // ---------------------------------------------------------------------------
  readonly assignmentSearch = signal('');
  readonly assignmentPage = signal(1);
  readonly assignmentPageSize = signal(10);
  readonly assignmentModalOpen = signal(false);
  readonly editingAssignmentUserId = signal<string | null>(null);
  readonly addAssignmentUserId = signal('');
  readonly existingAssignmentRows = signal<readonly AssignmentRow[]>([]);
  readonly removingExistingAssignmentId = signal<string | null>(null);
  readonly assignmentDraftRows = signal<readonly AssignmentDraftRow[]>([]);
  readonly assigningRole = signal(false);
  // Read-only "Grants access to"-style popover, same component/behavior as Page Visibility's.
  readonly relationshipPopoverUserId = signal<string | null>(null);

  readonly userAssignmentGroups = computed<readonly UserAssignmentGroup[]>(() =>
    this.users()
      .filter((user) => user.roles.length > 0)
      .map((user) => ({
        userId: user.id,
        userName: user.displayName,
        userEmail: user.email,
        rows: user.roles.map((role) => ({ assignmentId: role.assignmentId, roleName: role.roleName, unitDescription: role.unitDescription })),
      })),
  );
  readonly filteredAssignmentGroups = computed(() => {
    const search = this.assignmentSearch().trim().toLowerCase();
    if (!search) return this.userAssignmentGroups();
    return this.userAssignmentGroups().filter((group) =>
      `${group.userName} ${group.userEmail} ${group.rows.map((r) => `${r.roleName} ${r.unitDescription ?? ''}`).join(' ')}`.toLowerCase().includes(search),
    );
  });
  readonly assignmentTotalPages = computed(() => Math.max(1, Math.ceil(this.filteredAssignmentGroups().length / this.assignmentPageSize())));
  readonly assignmentRecordsView = computed<readonly InternalDataRecord[]>(() => this.assignmentRecords());
  readonly assignmentsConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'User assignments', paginationLabel: 'Assignment pages', rowsPerPageLabel: 'Assignments per page', mobileListLabel: 'Assignment cards',
    header: {
      title: 'Assignments',
      description: 'Assign users to a unit and role, or a flat (no-unit) role. Only users without an existing unit assignment can be added fresh; edit an existing row to add or remove more.',
      countLabel: `${this.filteredAssignmentGroups().length} user${this.filteredAssignmentGroups().length === 1 ? '' : 's'} with assignments`,
      primaryActionLabel: 'Add assignment',
    },
    search: { ariaLabel: 'Search assignments', placeholder: 'Search user, role, or unit' },
    columns: [
      { key: 'user', label: 'User' },
      { key: 'relationship', label: 'Relationship' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [{ key: 'edit', label: 'Edit assignments', icon: 'edit' }],
    emptyTitle: 'No assignments found', emptyDescription: 'Add an assignment or change the current search.', pageSizeOptions: [5, 10, 25],
  }));
  readonly relationshipPopoverGroup = computed(() => this.userAssignmentGroups().find((g) => g.userId === this.relationshipPopoverUserId()) ?? null);
  readonly relationshipPopoverItems = computed<readonly string[]>(() => this.relationshipPopoverGroup()?.rows.map((r) => this.relationshipLabel(r)) ?? []);

  // Add popup: only users with no role at all are assignable — anyone already holding one is
  // managed through their row's Edit action instead. Note this counts flat roles (unitCode null)
  // too: a System Admin holds a real assignment, so listing them here would offer a second one.
  readonly assignableUserOptions = computed<readonly SelectOption[]>(() =>
    this.users()
      .filter((user) => user.roles.length === 0)
      .map((user) => ({ value: user.id, label: user.displayName, description: user.email })),
  );
  readonly editingAssignmentUserOption = computed<readonly SelectOption[]>(() => {
    const user = this.users().find((u) => u.id === this.editingAssignmentUserId());
    return user ? [{ value: user.id, label: user.displayName, description: user.email }] : [];
  });
  readonly addAssignmentUnitOptions = computed<readonly SelectOption[]>(() => [
    { value: NO_UNIT, label: 'No Unit', description: 'Flat role — not tied to any unit' },
    ...this.units().filter((unit) => unit.active).map((unit) => ({ value: unit.id, label: unit.name, description: unit.code })),
  ]);
  readonly assignmentFormValid = computed(() =>
    !!this.addAssignmentUserId()
    && (this.existingAssignmentRows().length > 0 || this.assignmentDraftRows().length > 0)
    && this.assignmentDraftRows().every((row) => !!row.unitCode && !!row.roleCode),
  );

  readonly unitOptions = computed<readonly SelectOption[]>(() => this.units().map((unit) => ({ value: unit.id, label: unit.name, description: unit.code })));
  // Add/Edit Unit's Role multi-select — every active role is always offered (a role already
  // linked to OTHER units is still selectable; only this unit's own current links start
  // pre-checked, handled by unitDraft()/roleCodes() below), per the spec's "does not need to be
  // Flat to be selected" requirement.
  readonly roleOptions = computed<readonly SelectOption[]>(() => this.roles().filter((role) => role.active).map((role) => ({ value: role.roleCode, label: role.roleName, description: role.description })));
  // Live-derived Unit Code preview for the Unit form — read-only, recomputed on every Unit Name
  // keystroke, using the exact same derivation as services/unit-code.js server-side.
  readonly derivedUnitCode = computed(() => deriveUnitCode(this.value('name')));
  readonly filteredUsers = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.users().filter((user) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === user.active)
      && (this.unitFilter() === 'all' || user.roles.some((r) => r.unitCode === this.unitFilter()))
      && (!search || `${user.displayName} ${user.email} ${user.roleLabel} ${user.department}`.toLowerCase().includes(search)),
    );
  });
  readonly filteredUnits = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.units().filter((unit) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === unit.active)
      && (!search || `${unit.name} ${unit.code} ${unit.description ?? ''}`.toLowerCase().includes(search)),
    );
  });
  readonly filteredCount = computed(() => this.entity === 'users' ? this.filteredUsers().length : this.filteredUnits().length);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredCount() / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.entity === 'users' ? this.userRecords() : this.unitRecords());
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.entity === 'users' ? 'System users' : 'System units', paginationLabel: `${this.entity} pages`, rowsPerPageLabel: `${this.entity} per page`, mobileListLabel: `${this.entity} cards`,
    header: {
      title: this.entity === 'users' ? 'Users' : 'Units',
      description: this.entity === 'users' ? 'Manage internal user accounts and access status. Role and unit assignment is managed separately.' : 'Manage the operational units and departments available for internal user assignment.',
      countLabel: `${this.filteredCount()} ${this.entity === 'users' ? 'user' : 'unit'}${this.filteredCount() === 1 ? '' : 's'}`,
      primaryActionLabel: this.entity === 'users' ? 'Add user' : 'Add unit',
    },
    search: { ariaLabel: `Search ${this.entity}`, placeholder: this.entity === 'users' ? 'Search name, email, role, or unit' : 'Search unit name, code, or description' },
    columns: this.entity === 'users'
      ? [{ key: 'identity', label: 'User' }, { key: 'relationship', label: 'Relationship' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }]
      : [{ key: 'unit', label: 'Unit' }, { key: 'code', label: 'Code' }, { key: 'members', label: 'Users' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'edit', label: `Edit ${this.entity === 'users' ? 'user' : 'unit'}`, icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'delete', label: `Delete ${this.entity === 'users' ? 'user' : 'unit'}`, icon: 'delete' },
    ],
    emptyTitle: `No ${this.entity} found`, emptyDescription: `Add a ${this.entity === 'users' ? 'user' : 'unit'} or change the current search and filters.`, pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    ...(this.entity === 'users' ? [
      { key: 'unit', ariaLabel: 'Filter users by unit', value: this.unitFilter(), options: [{ value: 'all', label: 'All units' }, ...this.unitOptions()] },
    ] : []),
    { key: 'status', ariaLabel: `Filter ${this.entity} by status`, value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]);
  // A password is set only at creation — the field itself is hidden entirely on edit (see the
  // template), so this hint only ever needs its create-time wording.
  readonly passwordHint = computed(() => 'Leave blank to create the account without a password.');
  readonly formValid = computed(() => {
    if (this.entity === 'users') {
      return ['displayName', 'email'].every((key) => String(this.draft()[key] ?? '').trim()) && !this.fieldError('email') && !this.fieldError('password');
    }
    // Unit Code is server-derived/read-only (see deriveUnitCode() above) — only Unit Name is a
    // real required input; `code` no longer needs its own presence check.
    return Boolean(this.value('name').trim()) && !this.fieldError('name');
  });

  // ---------------------------------------------------------------------------
  // Deleted tab — one row per soft-deleted record, with days-remaining + Restore.
  // ---------------------------------------------------------------------------
  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.entity === 'users' ? this.deletedUserRecords() : this.deletedUnitRecords());
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: `Deleted ${this.entity}`, paginationLabel: `Deleted ${this.entity} pages`, rowsPerPageLabel: `Rows per page`, mobileListLabel: `Deleted ${this.entity} cards`,
    header: {
      title: `Deleted ${this.entity === 'users' ? 'Users' : 'Units'}`,
      description: 'Soft-deleted records are kept for 7 days before being permanently removed. Restore a record any time within that window.',
      countLabel: `${(this.entity === 'users' ? this.deletedUsers() : this.deletedUnits()).length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: this.entity === 'users'
      ? [{ key: 'identity', label: 'User' }, { key: 'deletedAt', label: 'Deleted' }, { key: 'remaining', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }]
      : [{ key: 'unit', label: 'Unit' }, { key: 'deletedAt', label: 'Deleted' }, { key: 'remaining', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'restore', label: 'Restore', icon: 'restore_from_trash' },
      { key: 'purge', label: 'Delete forever', icon: 'delete_forever' },
    ],
    emptyTitle: `No deleted ${this.entity}`, emptyDescription: `Records you delete will appear here for 7 days before being permanently removed.`, pageSizeOptions: [5, 10, 25],
  }));

  constructor() {
    combineLatest([this.service.users$, this.service.units$, this.service.roles$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ([users, units, roles]) => { this.users.set(users); this.units.set(units); this.roles.set(roles); this.loading.set(false); },
      error: () => { this.errorMessage.set(`The ${this.entity} data could not be loaded.`); this.loading.set(false); },
    });
  }

  setTab(tab: AdminTab): void {
    this.tab.set(tab);
    this.clearMessages();
    if (tab === 'deleted') this.loadDeleted();
  }

  // ---------------------------------------------------------------------------
  // Assignments tab
  // ---------------------------------------------------------------------------
  setAssignmentSearch(value: string): void { this.assignmentSearch.set(value); this.assignmentPage.set(1); }
  setAssignmentPage(value: number): void { this.assignmentPage.set(Math.max(1, Math.min(value, this.assignmentTotalPages()))); }
  setAssignmentPageSize(value: number): void { this.assignmentPageSize.set(value); this.assignmentPage.set(1); }

  openAddAssignment(): void {
    this.editingAssignmentUserId.set(null);
    this.addAssignmentUserId.set('');
    this.existingAssignmentRows.set([]);
    this.assignmentDraftRows.set([this.newDraftRow()]);
    this.clearMessages();
    this.assignmentModalOpen.set(true);
  }
  openEditAssignment(group: UserAssignmentGroup): void {
    this.editingAssignmentUserId.set(group.userId);
    this.addAssignmentUserId.set(group.userId);
    this.existingAssignmentRows.set(group.rows);
    this.assignmentDraftRows.set([]);
    this.clearMessages();
    this.assignmentModalOpen.set(true);
  }
  closeAssignmentModal(): void { if (!this.assigningRole()) this.assignmentModalOpen.set(false); }

  selectAddAssignmentUser(userId: string | readonly string[]): void {
    this.addAssignmentUserId.set(Array.isArray(userId) ? userId[0] ?? '' : userId);
  }

  // Existing-row remove inside the modal, independent of the draft-row save flow below — removes
  // immediately (same DELETE the standalone table used before grouping), not deferred to submit.
  // Removing an assignment revokes that user's access immediately — confirmed first, like every
  // other action that changes what somebody can do.
  readonly removeAssignmentTarget = signal<AssignmentRow | null>(null);
  readonly removeAssignmentMessage = computed(() => {
    const target = this.removeAssignmentTarget();
    if (!target) return '';
    const scope = target.unitDescription ? ` in ${target.unitDescription}` : '';
    return `Remove the ${target.roleName} role${scope} from this user? They lose the access it grants straight away. This cannot be undone, but the role can be assigned again.`;
  });
  openRemoveAssignment(row: AssignmentRow): void { this.removeAssignmentTarget.set(row); }
  cancelRemoveAssignment(): void { if (!this.removingExistingAssignmentId()) this.removeAssignmentTarget.set(null); }
  confirmRemoveAssignment(): void {
    const target = this.removeAssignmentTarget();
    if (target) this.removeExistingAssignment(target.assignmentId);
  }

  removeExistingAssignment(assignmentId: string): void {
    const userId = this.editingAssignmentUserId();
    if (!userId) return;
    this.removingExistingAssignmentId.set(assignmentId);
    this.service.removeAssignment(userId, assignmentId)
      .pipe(finalize(() => this.removingExistingAssignmentId.set(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.existingAssignmentRows.update((rows) => rows.filter((row) => row.assignmentId !== assignmentId));
          this.removeAssignmentTarget.set(null);
          this.toast.success('Assignment removed', 'The user no longer holds that role.');
        },
        error: (err) => { this.removeAssignmentTarget.set(null); this.toast.error('The assignment could not be removed', apiErrorMessage(err, 'Please try again.')); },
      });
  }

  private newDraftRow(): AssignmentDraftRow {
    return { id: nextDraftRowId++, unitCode: '', roleCode: '', roleOptions: [], roleOptionsLoading: false };
  }
  addDraftRow(): void {
    this.assignmentDraftRows.update((rows) => [...rows, this.newDraftRow()]);
  }
  removeDraftRow(id: number): void {
    this.assignmentDraftRows.update((rows) => rows.length > 1 ? rows.filter((row) => row.id !== id) : rows);
  }
  roleOptionsFor(row: AssignmentDraftRow): readonly SelectOption[] {
    return row.roleOptions.map((role) => ({ value: role.roleCode, label: role.roleName, description: role.description }));
  }

  selectDraftRowUnit(id: number, unitCode: string | readonly string[]): void {
    const value = Array.isArray(unitCode) ? unitCode[0] ?? '' : unitCode;
    this.assignmentDraftRows.update((rows) => rows.map((row) =>
      row.id === id ? { ...row, unitCode: value, roleCode: '', roleOptions: [] } : row,
    ));
    if (!value) return;
    this.assignmentDraftRows.update((rows) => rows.map((row) => row.id === id ? { ...row, roleOptionsLoading: true } : row));
    const request = value === NO_UNIT ? this.service.getFlatRoles() : this.service.getEligibleRolesForUnit(value);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (roles) => this.assignmentDraftRows.update((rows) => rows.map((row) =>
        row.id === id ? { ...row, roleOptions: roles, roleOptionsLoading: false } : row,
      )),
      error: () => {
        this.errorMessage.set('Eligible roles could not be loaded for this unit.');
        this.assignmentDraftRows.update((rows) => rows.map((row) => row.id === id ? { ...row, roleOptionsLoading: false } : row));
      },
    });
  }

  selectDraftRowRole(id: number, roleCode: string | readonly string[]): void {
    const value = Array.isArray(roleCode) ? roleCode[0] ?? '' : roleCode;
    this.assignmentDraftRows.update((rows) => rows.map((row) => row.id === id ? { ...row, roleCode: value } : row));
  }

  // One POST per draft row, in sequence — the backend only ever validates/accepts a single
  // (roleCode, unitCode) pair per call. A row that fails (duplicate, head-role conflict, ...) is
  // reported by name; rows before it are already saved and rows after it still get attempted.
  // Existing-row removal already happened live (removeExistingAssignment above), so this only
  // ever needs to add the new draft rows — zero of them is valid in edit mode (admin only removed).
  saveAssignment(): void {
    if (!this.assignmentFormValid()) return;
    const userId = this.addAssignmentUserId();
    const rows = this.assignmentDraftRows();
    if (rows.length === 0) { this.assignmentModalOpen.set(false); this.toast.success('Assignments updated'); return; }
    this.assigningRole.set(true);
    this.clearMessages();
    this.submitDraftRow(userId, rows, 0, 0);
  }

  private submitDraftRow(userId: string, rows: readonly AssignmentDraftRow[], index: number, savedCount: number): void {
    if (index >= rows.length) {
      this.assigningRole.set(false);
      this.assignmentModalOpen.set(false);
      this.toast.success(`${savedCount} assignment${savedCount === 1 ? '' : 's'} added.`);
      return;
    }
    const row = rows[index];
    const unitCode = row.unitCode === NO_UNIT ? undefined : row.unitCode;
    this.service.assignRole(userId, row.roleCode, unitCode).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.submitDraftRow(userId, rows, index + 1, savedCount + 1),
      error: (err) => {
        this.assigningRole.set(false);
        const roleLabel = row.roleOptions.find((r) => r.roleCode === row.roleCode)?.roleName || row.roleCode;
        const detail = err?.error?.message || 'could not be added';
        this.toast.error(`${savedCount} assignment${savedCount === 1 ? '' : 's'} added before row ${index + 1} (${roleLabel}) failed: ${detail}`,);
      },
    });
  }

  handleAssignmentAction(event: InternalRowActionEvent): void {
    if (event.action.key !== 'edit') return;
    const group = this.filteredAssignmentGroups().find((item) => item.userId === String(event.record.id));
    if (group) this.openEditAssignment(group);
  }

  // Single relationship: clicking the badge opens Edit directly, same as a single-match grant
  // badge in Page Visibility. Several: opens the read-only popover listing every one.
  handleAssignmentCellClick(event: InternalCellClickEvent): void {
    if (event.columnKey !== 'relationship') return;
    const group = this.filteredAssignmentGroups().find((item) => item.userId === String(event.record.id));
    if (!group) return;
    if (group.rows.length <= 1) { this.openEditAssignment(group); return; }
    this.relationshipPopoverUserId.set(this.relationshipPopoverUserId() === group.userId ? null : group.userId);
  }
  closeRelationshipPopover(): void { this.relationshipPopoverUserId.set(null); }

  // Same phrasing convention as Page Visibility's "Grants access to" column (grantSummaryItems()):
  // "<role> in <unit>" for a unit-scoped assignment, "<role> · Flat role" for a no-unit one.
  private relationshipLabel(row: AssignmentRow): string {
    return row.unitDescription ? `${row.roleName} in ${row.unitDescription}` : `${row.roleName} · Flat role`;
  }
  private assignmentRecords(): readonly InternalDataRecord[] {
    const start = (this.assignmentPage() - 1) * this.assignmentPageSize();
    return this.filteredAssignmentGroups().slice(start, start + this.assignmentPageSize()).map((group) => {
      // Single relationship: show it directly, like any other single-match badge. Several: show a
      // count + share icon instead, clicking opens the read-only popover — same convention as
      // Page Visibility's "Grants access to" column (buildPermissionRecords()/grantSummaryItems()).
      const relationshipLabel = group.rows.length === 1
        ? this.relationshipLabel(group.rows[0])
        : `${group.rows.length} grants`;
      return {
        id: group.userId,
        cells: {
          user: { primary: group.userName, secondary: group.userEmail, avatar: this.initials(group.userName) },
          relationship: { primary: relationshipLabel, badge: true, tone: 'blue', clickable: group.rows.length > 1, badgeIcon: group.rows.length > 1 ? 'share' : undefined },
          actions: { primary: '' },
        },
        mobile: {
          eyebrow: group.rows.length === 1 ? 'Assignment' : `${group.rows.length} assignments`, status: '', title: group.userName, identity: group.userEmail, initials: this.initials(group.userName),
          details: group.rows.map((row) => ({ icon: 'admin_panel_settings', text: this.relationshipLabel(row) })),
        },
      };
    });
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    const request: Observable<readonly Archived<AdminUserRecord | AdminUnitRecord>[]> = this.entity === 'users' ? this.service.getDeletedUsers() : this.service.getDeletedUnits();
    request.pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (records) => { if (this.entity === 'users') this.deletedUsers.set(records as readonly Archived<AdminUserRecord>[]); else this.deletedUnits.set(records as readonly Archived<AdminUnitRecord>[]); },
      error: () => this.errorMessage.set(`The deleted ${this.entity} could not be loaded.`),
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'unit') this.unitFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.unitFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  openAdd(): void {
    this.editingId.set(null); this.clearMessages();
    this.draft.set(this.entity === 'users'
      ? { displayName: '', email: '', password: '', active: true }
      : { name: '', description: '', active: true, roleCodes: [] });
    this.modalOpen.set(true);
  }
  handleAction(event: InternalRowActionEvent): void {
    const record = this.entity === 'users' ? this.users().find((item) => item.id === event.record.id) : this.units().find((item) => item.id === event.record.id);
    if (!record) return;
    if (event.action.key === 'edit') {
      this.editingId.set(record.id);
      this.draft.set(this.entity === 'users'
        // No password field on edit — see the template — so nothing to seed here.
        ? { displayName: (record as AdminUserRecord).displayName, email: (record as AdminUserRecord).email, active: record.active }
        : { name: (record as AdminUnitRecord).name, description: (record as AdminUnitRecord).description ?? '', active: record.active, roleCodes: (record as AdminUnitRecord).roleCodes });
      this.modalOpen.set(true); this.clearMessages(); return;
    }
    if (event.action.key === 'delete') { this.requestDelete(record); return; }
    this.changeStatus(record);
  }
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'restore') { this.restoreTarget.set({ id: String(event.record.id), label: restoreLabelFor(event.record) }); return; }
    if (event.action.key === 'purge') this.requestPurge(String(event.record.id));
  }
  // Users tab's relationship badge: a single relationship already shows in full, so only a
  // multi-badge ("N grants") needs a click target — opens the same read-only popover as the
  // Assignments tab's identical badge.
  handleUserCellClick(event: InternalCellClickEvent): void {
    if (event.columnKey !== 'relationship') return;
    const user = this.users().find((item) => item.id === event.record.id);
    if (user && user.roles.length > 1) this.relationshipPopoverUserId.set(this.relationshipPopoverUserId() === user.id ? null : user.id);
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft(key: string, value: string | boolean | readonly string[]): void { this.draft.update((draft) => ({ ...draft, [key]: value })); }
  value(key: string): string { const value = this.draft()[key]; return typeof value === 'string' ? value : ''; }
  roleCodes(): readonly string[] { const value = this.draft()['roleCodes']; return Array.isArray(value) ? value : []; }
  fieldError(key: string): string {
    const value = this.value(key).trim().toLowerCase();
    const id = this.editingId();
    if (!value) return '';
    if (key === 'email' && !/^\S+@\S+\.\S+$/.test(value)) return 'Email must be a valid email address.';
    if (key === 'email' && this.users().some((user) => user.id !== id && user.email.toLowerCase() === value)) return 'Email is already assigned to another user.';
    if (key === 'password' && this.value('password').length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (key === 'name') {
      if (this.units().some((unit) => unit.id !== id && unit.name.toLowerCase() === value)) return 'Unit Name already exists.';
      // Unit Code is derived from Unit Name (read-only) — check the DERIVED code for a
      // collision here instead of a separate 'code' field check, since the user never types
      // the code directly any more.
      const derivedCode = this.derivedUnitCode().toLowerCase();
      if (this.units().some((unit) => unit.id !== id && unit.code.toLowerCase() === derivedCode)) return 'A unit with this derived code already exists — choose a different Unit Name.';
    }
    return '';
  }
  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearMessages();
    const id = this.editingId();
    const request: Observable<AdminUserRecord | AdminUnitRecord> = this.entity === 'users'
      ? (id ? this.service.updateUser(id, this.userDraft()) : this.service.createUser(this.userDraft()))
      : (id ? this.service.updateUnit(id, this.unitDraft()) : this.service.createUnit(this.unitDraft()));
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.modalOpen.set(false); this.toast.success(`${this.entity === 'users' ? 'User' : 'Unit'} ${id ? 'updated' : 'created'} successfully.`); },
      error: () => this.toast.error(`The ${this.entity === 'users' ? 'user' : 'unit'} could not be saved.`),
    });
  }

  // ---------------------------------------------------------------------------
  // Delete / restore
  // ---------------------------------------------------------------------------
  entityKindLabel(): string { return this.entity === 'users' ? 'User' : 'Unit'; }
  targetLabel(): string {
    const target = this.deleteTarget();
    if (!target) return '';
    return this.entity === 'users' ? `"${(target as AdminUserRecord).displayName}"` : `"${(target as AdminUnitRecord).name}"`;
  }
  requestDelete(record: AdminUserRecord | AdminUnitRecord): void {
    this.clearMessages();
    this.deleteTarget.set(record);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    const request = this.entity === 'users' ? this.service.checkUserDeletion(record.id) : this.service.checkUnitDeletion(record.id);
    request.pipe(finalize(() => this.checkingDeletion.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check whether this record can be deleted'),
    });
  }
  cancelDelete(): void { if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDelete(): void {
    const target = this.deleteTarget();
    const preview = this.deletePreview();
    if (!target || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    const request: Observable<AdminUserRecord | AdminUnitRecord> = this.entity === 'users' ? this.service.deleteUser(target.id) : this.service.deleteUnit(target.id);
    request.pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success(`${this.entityKindLabel()} deleted. It can be restored from the Deleted tab within 7 days.`);
      },
      error: (err) => this.toast.error(err?.error?.message || `The ${this.entity === 'users' ? 'user' : 'unit'} could not be deleted.`),
    });
  }
  // Restoring brings an archived record back into circulation immediately, so it is
  // confirmed first like every other state-changing action.
  readonly restoreTarget = signal<{ id: string; label: string } | null>(null);
  readonly restoreMessage = computed(() => {
    const target = this.restoreTarget();
    return target ? `Restore ${target.label}? It becomes active again straight away.` : '';
  });
  cancelRestore(): void { this.restoreTarget.set(null); }
  confirmRestore(): void {
    const target = this.restoreTarget();
    this.restoreTarget.set(null);
    if (target) this.restore(target.id);
  }

  restore(id: string): void {
    this.clearMessages();
    this.restoringId.set(id);
    const request: Observable<AdminUserRecord | AdminUnitRecord> = this.entity === 'users' ? this.service.restoreUser(id) : this.service.restoreUnit(id);
    request.pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(`${this.entityKindLabel()} restored.`);
        this.loadDeleted();
      },
      error: (err) => this.toast.error('The record could not be restored', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // "Delete forever" (purge) — immediate and unrecoverable, alongside Restore above.
  requestPurge(id: string): void {
    this.clearMessages();
    const record = this.entity === 'users' ? this.deletedUsers().find((u) => u.id === id) : this.deletedUnits().find((u) => u.id === id);
    this.purgeTargetLabel.set(record ? `"${this.entity === 'users' ? (record as Archived<AdminUserRecord>).displayName : (record as Archived<AdminUnitRecord>).name}"` : '');
    this.purgeTargetId.set(id);
    // Dependencies are re-checked server-side at purge time, so a record archived while unused
    // can still be blocked now. Ask first, the same way delete does.
    this.purgePreview.set(null);
    this.checkingPurge.set(true);
    const check = this.entity === 'users'
      ? this.service.checkUserDeletion(id)
      : this.service.checkUnitDeletion(id);
    check.pipe(
      finalize(() => this.checkingPurge.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.purgePreview.set(preview),
      error: () => this.toast.error('Could not check record', 'Please try again.'),
    });
  }
  cancelPurge(): void {
    if (!this.purging()) { this.purgeTargetId.set(null); this.purgePreview.set(null); }
  }
  confirmPurge(): void {
    const id = this.purgeTargetId();
    if (!id) return;
    this.purging.set(true);
    const request: Observable<void> = this.entity === 'users' ? this.service.purgeUser(id) : this.service.purgeUnit(id);
    request.pipe(finalize(() => this.purging.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.purgeTargetId.set(null);
        this.purgePreview.set(null);
        this.toast.success(`${this.entityKindLabel()} permanently deleted.`);
        this.loadDeleted();
      },
      error: (err) => this.toast.error('The record could not be permanently deleted', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private userDraft(): AdminUserDraft {
    return {
      displayName: this.value('displayName').trim(),
      email: this.value('email').trim().toLowerCase(),
      // A password is set only at creation — never sent on an edit, since the field doesn't even
      // render then (see the template) and the backend ignores it on update regardless.
      password: this.editingId() ? undefined : (this.value('password') || undefined),
      active: Boolean(this.draft()['active']),
    };
  }
  // Unit Code is never client-supplied — server/routes/admin.routes.js's POST /units derives it
  // from `description` itself and rejects any client-supplied `code` — so `code` isn't even
  // included in the draft sent to the backend on create. (PUT doesn't touch code either.)
  private unitDraft(): AdminUnitDraft { return { description: this.value('name').trim() || this.value('description').trim(), active: Boolean(this.draft()['active']), roleCodes: this.roleCodes() }; }
  private clearMessages(): void { this.errorMessage.set(''); }
  private changeStatus(record: AdminUserRecord | AdminUnitRecord): void {
    this.clearMessages();
    const request: Observable<AdminUserRecord | AdminUnitRecord> = this.entity === 'users'
      ? this.service.setUserActive(record.id, !record.active)
      : this.service.setUnitActive(record.id, !record.active);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`${this.entity === 'users' ? 'User' : 'Unit'} is now ${record.active ? 'inactive' : 'active'}.`),
      error: () => this.toast.error('The active status could not be changed'),
    });
  }
  private pageSlice<T>(records: readonly T[]): readonly T[] { return records.slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()); }
  // Same single-badge-vs-"N grants" convention as the Assignments tab's relationship column
  // (assignmentRecords() below) — Users just also carries the account-status columns alongside it.
  private userRecords(): readonly InternalDataRecord[] { return this.pageSlice(this.filteredUsers()).map((user) => {
    const relationshipLabel = user.roles.length === 0
      ? 'No access'
      : user.roles.length === 1
        ? this.relationshipLabel(user.roles[0])
        : `${user.roles.length} grants`;
    return { id: user.id,
    cells: {
      identity: { primary: user.displayName, secondary: user.email, avatar: this.initials(user.displayName) },
      relationship: { primary: relationshipLabel, badge: true, tone: user.roles.length ? 'blue' : 'warning', clickable: user.roles.length > 1, badgeIcon: user.roles.length > 1 ? 'share' : undefined },
      status: { primary: user.active ? 'Active' : 'Inactive', badge: true, tone: user.active ? 'success' : 'neutral' }, actions: { primary: '' } },
    mobile: { eyebrow: user.roleLabel, status: user.active ? 'Active' : 'Inactive', title: user.displayName, identity: user.email, initials: this.initials(user.displayName), details: [{ icon: 'alternate_email', text: user.email }, { icon: 'domain', text: user.department }] },
  }; }); }
  private unitRecords(): readonly InternalDataRecord[] { return this.pageSlice(this.filteredUnits()).map((unit) => {
    const count = this.users().filter((user) => user.roles.some((r) => r.unitCode === unit.id)).length;
    return { id: unit.id, cells: { unit: { primary: unit.name, secondary: unit.description }, code: { primary: unit.code }, members: { primary: `${count} user${count === 1 ? '' : 's'}` }, status: { primary: unit.active ? 'Active' : 'Inactive', badge: true, tone: unit.active ? 'success' : 'neutral' }, actions: { primary: '' } }, mobile: { eyebrow: unit.code, status: unit.active ? 'Active' : 'Inactive', title: unit.name, details: [{ icon: 'group', text: `${count} assigned user${count === 1 ? '' : 's'}` }, { icon: 'info', text: unit.description ?? 'No description' }] } };
  }); }
  private deletedUserRecords(): readonly InternalDataRecord[] { return this.deletedUsers().map((user) => ({
    id: user.id,
    actionKeys: ['restore', 'purge'],
    cells: {
      identity: { primary: user.displayName, secondary: user.email, avatar: this.initials(user.displayName) },
      deletedAt: { primary: this.formatDate(user.deletedAt) },
      remaining: { primary: user.daysRemaining > 0 ? `${user.daysRemaining} day${user.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: user.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${user.daysRemaining}d left`, title: user.displayName, identity: user.email, initials: this.initials(user.displayName), details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(user.deletedAt)}` }, { icon: 'delete_forever', text: `Permanently deleted ${this.formatDate(user.permanentDeletionAt)}` }] },
  })); }
  private deletedUnitRecords(): readonly InternalDataRecord[] { return this.deletedUnits().map((unit) => ({
    id: unit.id,
    actionKeys: ['restore', 'purge'],
    cells: {
      unit: { primary: unit.name, secondary: unit.description },
      deletedAt: { primary: this.formatDate(unit.deletedAt) },
      remaining: { primary: unit.daysRemaining > 0 ? `${unit.daysRemaining} day${unit.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: unit.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${unit.daysRemaining}d left`, title: unit.name, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(unit.deletedAt)}` }, { icon: 'delete_forever', text: `Permanently deleted ${this.formatDate(unit.permanentDeletionAt)}` }] },
  })); }
  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  private initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
}
