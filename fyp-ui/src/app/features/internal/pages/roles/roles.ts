import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, finalize, Observable } from 'rxjs';
import { AdminDirectoryService } from '../../../../core/admin-directory/admin-directory.service';
import { Archived, AdminRoleDraft, AdminRoleRecord, AdminUnitRecord } from '../../../../core/admin-directory/admin-directory.models';
import { DeletionPreview } from '../../../../shared/models/deletion.models';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Server-side derivation this mirrors exactly: services/unit-code.js's deriveRoleCode(), also
// used server-side to auto-slug roleName -> role_code (admin.routes.js POST /roles). Hyphenated
// (not underscored like unit codes) to match the seeded protected roles' convention (e.g.
// head-of-department, cafeteria-admin).
function deriveRoleCode(roleName: string): string {
  return (roleName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

type RolesTab = 'active' | 'deleted';

// The deleted-items table names its first column differently per page (identity / name / label),
// so the confirmation reads whichever cell actually carries the record's display name.
function restoreLabelFor(record: InternalDataRecord): string {
  const named = Object.values(record.cells).find((cell) => !!cell?.primary);
  return named?.primary ? String(named.primary) : String(record.id);
}

@Component({
  selector: 'app-roles',
  imports: [InternalDataPageComponent, FormModalComponent, FormFieldComponent, StatusToggleComponent, FeedbackBannerComponent, ConfirmDialogComponent, DeleteConfirmDialogComponent, SearchableDropdownComponent],
  templateUrl: './roles.html',
  styleUrl: './roles.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolesComponent {
  private readonly toast = inject(ToastService);
  private readonly service = inject(AdminDirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  readonly tab = signal<RolesTab>('active');
  readonly roles = signal<readonly AdminRoleRecord[]>([]);
  readonly units = signal<readonly AdminUnitRecord[]>([]);
  readonly deletedRoles = signal<readonly Archived<AdminRoleRecord>[]>([]);
  readonly deletedLoading = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly kindFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly modalOpen = signal(false);
  readonly editingCode = signal<string | null>(null);
  readonly draft = signal<Record<string, string | boolean | readonly string[]>>({});
  readonly errorMessage = signal('');

  readonly deleteTarget = signal<AdminRoleRecord | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);
  readonly restoringCode = signal<string | null>(null);

  // "Delete forever" (purge) — immediate and unrecoverable, alongside Restore in the Deleted tab.
  readonly purgeTargetCode = signal<string | null>(null);
  readonly purgePreview = signal<DeletionPreview | null>(null);
  readonly checkingPurge = signal(false);
  readonly purging = signal(false);

  readonly editingRole = computed(() => this.roles().find((role) => role.roleCode === this.editingCode()) ?? null);
  readonly editingProtected = computed(() => this.editingRole()?.isProtected ?? false);
  readonly derivedRoleCode = computed(() => deriveRoleCode(this.value('roleName')));

  readonly filteredRoles = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.roles().filter((role) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === role.active)
      && (this.kindFilter() === 'all' || (this.kindFilter() === 'protected') === role.isProtected)
      && (!search || `${role.roleName} ${role.roleCode} ${role.description}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredRoles().length / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.roleRecords());
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'System roles', paginationLabel: 'Role pages', rowsPerPageLabel: 'Roles per page', mobileListLabel: 'Role cards',
    header: {
      title: 'Roles',
      description: 'Manage the roles available for assignment across the system. Protected roles keep their scoping rules fixed.',
      countLabel: `${this.filteredRoles().length} role${this.filteredRoles().length === 1 ? '' : 's'}`,
      primaryActionLabel: 'Add role',
    },
    search: { ariaLabel: 'Search roles', placeholder: 'Search role name, code, or description' },
    columns: [
      { key: 'identity', label: 'Role' },
      { key: 'scope', label: 'Scope' },
      { key: 'kind', label: 'Kind' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [{ key: 'edit', label: 'Edit role', icon: 'edit' }, { key: 'status', label: 'Change active status', icon: 'power_settings_new' }, { key: 'delete', label: 'Delete role', icon: 'delete' }],
    emptyTitle: 'No roles found', emptyDescription: 'Add a role or change the current search and filters.',
  }));
  readonly filters = computed(() => [
    { key: 'kind', ariaLabel: 'Filter roles by kind', value: this.kindFilter(), options: [{ value: 'all', label: 'All kinds' }, { value: 'protected', label: 'Protected' }, { value: 'custom', label: 'Custom' }] },
    { key: 'status', ariaLabel: 'Filter roles by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]);
  readonly unitOptions = computed<readonly SelectOption[]>(() => this.units().filter((unit) => unit.active).map((unit) => ({ value: unit.id, label: unit.name, description: unit.code })));
  readonly formValid = computed(() => Boolean(this.value('roleName').trim()) && !this.fieldError('roleName'));

  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.deletedRoles().map((role) => ({
    id: role.roleCode,
    actionKeys: ['restore', 'purge'],
    cells: {
      identity: { primary: role.roleName, secondary: role.description || role.roleCode },
      deletedAt: { primary: this.formatDate(role.deletedAt) },
      remaining: { primary: role.daysRemaining > 0 ? `${role.daysRemaining} day${role.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: role.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${role.daysRemaining}d left`, title: role.roleName, identity: role.roleCode, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(role.deletedAt)}` }, { icon: 'delete_forever', text: `Permanently deleted ${this.formatDate(role.permanentDeletionAt)}` }] },
  })));
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Deleted roles', paginationLabel: 'Deleted role pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted role cards',
    header: {
      title: 'Deleted Roles',
      description: 'Soft-deleted roles are kept for 7 days before being permanently removed. Restore a role any time within that window.',
      countLabel: `${this.deletedRoles().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'identity', label: 'Role' }, { key: 'deletedAt', label: 'Deleted' }, { key: 'remaining', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'restore', label: 'Restore', icon: 'restore_from_trash' },
      { key: 'purge', label: 'Delete forever', icon: 'delete_forever' },
    ],
    emptyTitle: 'No deleted roles', emptyDescription: 'Roles you delete will appear here for 7 days before being permanently removed.',
  }));

  constructor() {
    combineLatest([this.service.roles$, this.service.units$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ([roles, units]) => { this.roles.set(roles); this.units.set(units); this.loading.set(false); },
      error: () => { this.errorMessage.set('The roles data could not be loaded.'); this.loading.set(false); },
    });
  }

  setTab(tab: RolesTab): void {
    this.tab.set(tab);
    this.clearMessages();
    if (tab === 'deleted') this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.service.getDeletedRoles().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (roles) => this.deletedRoles.set(roles),
      error: () => this.errorMessage.set('The deleted roles could not be loaded.'),
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'kind') this.kindFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.kindFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  openAdd(): void {
    this.editingCode.set(null); this.clearMessages();
    this.draft.set({ roleName: '', description: '', unitCodes: [], active: true });
    this.modalOpen.set(true);
  }
  handleAction(event: InternalRowActionEvent): void {
    const role = this.roles().find((item) => item.roleCode === event.record.id);
    if (!role) return;
    if (event.action.key === 'edit') {
      this.editingCode.set(role.roleCode);
      this.draft.set({ roleName: role.roleName, description: role.description, unitCodes: role.unitCodes, active: role.active });
      this.modalOpen.set(true); this.clearMessages();
      return;
    }
    if (event.action.key === 'delete') { this.requestDelete(role); return; }
    this.changeStatus(role);
  }
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'restore') { this.restoreTarget.set({ id: String(event.record.id), label: restoreLabelFor(event.record) }); return; }
    if (event.action.key === 'purge') this.requestPurge(String(event.record.id));
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft(key: string, value: string | boolean | readonly string[]): void { this.draft.update((draft) => ({ ...draft, [key]: value })); }
  value(key: string): string { const value = this.draft()[key]; return typeof value === 'string' ? value : ''; }
  unitCodes(): readonly string[] { const value = this.draft()['unitCodes']; return Array.isArray(value) ? value : []; }
  fieldError(key: string): string {
    if (key !== 'roleName') return '';
    const value = this.value('roleName').trim();
    if (!value) return '';
    const code = this.editingProtected() ? this.editingCode() : deriveRoleCode(value);
    if (!this.editingProtected() && this.roles().some((role) => role.roleCode !== this.editingCode() && role.roleCode === code)) {
      return 'A role with this derived code already exists — choose a different Role Name.';
    }
    return '';
  }
  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearMessages();
    const code = this.editingCode();
    const request: Observable<AdminRoleRecord> = code
      ? this.service.updateRole(code, this.roleDraft())
      : this.service.createRole(this.roleDraft() as AdminRoleDraft);
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.modalOpen.set(false); this.toast.success(`Role ${code ? 'updated' : 'created'} successfully.`); },
      error: (err) => this.toast.error('The role could not be saved', apiErrorMessage(err, 'Please try again.')),
    });
  }
  private roleDraft(): Partial<AdminRoleDraft> {
    const base: Partial<AdminRoleDraft> = { roleName: this.value('roleName').trim(), description: this.value('description').trim(), active: Boolean(this.draft()['active']) };
    if (this.editingProtected()) return base;
    return { ...base, unitCodes: this.unitCodes() };
  }
  private clearMessages(): void { this.errorMessage.set(''); }
  private changeStatus(role: AdminRoleRecord): void {
    this.clearMessages();
    this.service.updateRole(role.roleCode, { active: !role.active }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`Role is now ${role.active ? 'inactive' : 'active'}.`),
      error: (err) => this.toast.error('The active status could not be changed', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // ---------------------------------------------------------------------------
  // Delete / restore
  // ---------------------------------------------------------------------------
  targetLabel(): string {
    const target = this.deleteTarget();
    return target ? `"${target.roleName}"` : '';
  }
  requestDelete(role: AdminRoleRecord): void {
    this.clearMessages();
    this.deleteTarget.set(role);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.service.checkRoleDeletion(role.roleCode).pipe(finalize(() => this.checkingDeletion.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check whether this role can be deleted'),
    });
  }
  cancelDelete(): void { if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDelete(): void {
    const target = this.deleteTarget();
    const preview = this.deletePreview();
    if (!target || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    this.service.deleteRole(target.roleCode).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success('Role deleted', 'It can be restored from the Deleted tab within 7 days.');
      },
      error: (err) => this.toast.error('The role could not be deleted', apiErrorMessage(err, 'Please try again.')),
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

  restore(code: string): void {
    this.clearMessages();
    this.restoringCode.set(code);
    this.service.restoreRole(code).pipe(finalize(() => this.restoringCode.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Role restored'); this.loadDeleted(); },
      error: (err) => this.toast.error('The role could not be restored', apiErrorMessage(err, 'Please try again.')),
    });
  }

  purgeTargetLabel(): string {
    const code = this.purgeTargetCode();
    const role = code ? this.deletedRoles().find((r) => r.roleCode === code) : null;
    return role ? `"${role.roleName}"` : '';
  }
  requestPurge(code: string): void {
    this.clearMessages();
    this.purgeTargetCode.set(code);
    // The server re-checks dependencies at purge time, so a role archived while unused can
    // still be blocked now. Ask, rather than letting the click fail with a bare toast.
    this.purgePreview.set(null);
    this.checkingPurge.set(true);
    this.service.checkRoleDeletion(code).pipe(
      finalize(() => this.checkingPurge.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.purgePreview.set(preview),
      error: () => this.toast.error('Could not check role', 'Please try again.'),
    });
  }
  cancelPurge(): void {
    if (!this.purging()) { this.purgeTargetCode.set(null); this.purgePreview.set(null); }
  }
  confirmPurge(): void {
    const code = this.purgeTargetCode();
    if (!code) return;
    this.purging.set(true);
    this.service.purgeRole(code).pipe(finalize(() => this.purging.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.purgeTargetCode.set(null); this.purgePreview.set(null); this.toast.success('Role permanently deleted'); this.loadDeleted(); },
      error: (err) => this.toast.error('The role could not be permanently deleted', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private pageSlice<T>(records: readonly T[]): readonly T[] { return records.slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()); }
  private roleRecords(): readonly InternalDataRecord[] { return this.pageSlice(this.filteredRoles()).map((role) => ({
    id: role.roleCode,
    actionKeys: role.isProtected ? ['edit', 'status'] : ['edit', 'status', 'delete'],
    cells: {
      identity: { primary: role.roleName, secondary: role.description || role.roleCode },
      scope: { primary: this.scopeLabel(role) },
      kind: { primary: role.isProtected ? 'Protected' : 'Custom', badge: true, tone: role.isProtected ? 'blue' : 'neutral' },
      status: { primary: role.active ? 'Active' : 'Inactive', badge: true, tone: role.active ? 'success' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: role.isProtected ? 'Protected' : 'Custom', status: role.active ? 'Active' : 'Inactive', title: role.roleName, identity: role.roleCode,
      details: [
        { icon: 'badge', text: this.scopeLabel(role) },
        { icon: 'info', text: role.description || 'No description' },
      ],
    },
  })); }
  private scopeLabel(role: AdminRoleRecord): string {
    if (role.unitCodes.length === 0) return 'Flat role';
    if (role.unitCodes.length === 1) return this.unitName(role.unitCodes[0]);
    return `${role.unitCodes.length} units`;
  }
  private unitName(unitCode: string): string { return this.units().find((unit) => unit.id === unitCode)?.name ?? unitCode; }
  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
}
