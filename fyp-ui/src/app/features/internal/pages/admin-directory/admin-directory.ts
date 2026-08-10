import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, finalize, Observable } from 'rxjs';
import { AdminDirectoryService } from '../../../../core/admin-directory/admin-directory.service';
import { AdminUnitDraft, AdminUnitRecord, AdminUserDraft, AdminUserRecord } from '../../../../core/admin-directory/admin-directory.models';
import { UserRole } from '../../../../core/auth/auth.models';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';

type AdminEntity = 'users' | 'units';

@Component({
  selector: 'app-admin-directory',
  imports: [InternalDataPageComponent, FormModalComponent, FormFieldComponent, SearchableDropdownComponent, StatusToggleComponent, FeedbackBannerComponent],
  templateUrl: './admin-directory.html',
  styleUrl: './admin-directory.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDirectoryComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(AdminDirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  readonly entity = this.route.snapshot.data['adminEntity'] as AdminEntity;
  readonly users = signal<readonly AdminUserRecord[]>([]);
  readonly units = signal<readonly AdminUnitRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly roleFilter = signal('all');
  readonly unitFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly modalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<Record<string, string | boolean>>({});
  readonly successMessage = signal('');
  readonly errorMessage = signal('');

  readonly roleOptions = computed<readonly SelectOption[]>(() => {
    const roles = new Map<UserRole, string>();
    this.users().forEach((user) => roles.set(user.role, user.roleLabel));
    return [...roles].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  });
  readonly unitOptions = computed<readonly SelectOption[]>(() => this.units().map((unit) => ({ value: unit.id, label: unit.name, description: unit.code })));
  readonly filteredUsers = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.users().filter((user) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === user.active)
      && (this.roleFilter() === 'all' || user.role === this.roleFilter())
      && (this.unitFilter() === 'all' || user.unitId === this.unitFilter())
      && (!search || `${user.displayName} ${user.username} ${user.email} ${user.roleLabel} ${user.department}`.toLowerCase().includes(search)),
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
      description: this.entity === 'users' ? 'Manage internal user accounts, roles, unit assignments, and access status.' : 'Manage the operational units and departments available for internal user assignment.',
      countLabel: `${this.filteredCount()} ${this.entity === 'users' ? 'user' : 'unit'}${this.filteredCount() === 1 ? '' : 's'}`,
      primaryActionLabel: this.entity === 'users' ? 'Add user' : 'Add unit',
    },
    search: { ariaLabel: `Search ${this.entity}`, placeholder: this.entity === 'users' ? 'Search name, username, email, role, or unit' : 'Search unit name, code, or description' },
    columns: this.entity === 'users'
      ? [{ key: 'identity', label: 'User' }, { key: 'role', label: 'Role' }, { key: 'unit', label: 'Unit' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }]
      : [{ key: 'unit', label: 'Unit' }, { key: 'code', label: 'Code' }, { key: 'members', label: 'Users' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'edit', label: `Edit ${this.entity === 'users' ? 'user' : 'unit'}`, icon: 'edit' }, { key: 'status', label: 'Change active status', icon: 'power_settings_new' }],
    emptyTitle: `No ${this.entity} found`, emptyDescription: `Add a ${this.entity === 'users' ? 'user' : 'unit'} or change the current search and filters.`, pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    ...(this.entity === 'users' ? [
      { key: 'role', ariaLabel: 'Filter users by role', value: this.roleFilter(), options: [{ value: 'all', label: 'All roles' }, ...this.roleOptions()] },
      { key: 'unit', ariaLabel: 'Filter users by unit', value: this.unitFilter(), options: [{ value: 'all', label: 'All units' }, ...this.unitOptions()] },
    ] : []),
    { key: 'status', ariaLabel: `Filter ${this.entity} by status`, value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]);
  readonly formValid = computed(() => this.entity === 'users'
    ? ['displayName', 'username', 'email', 'role', 'unitId'].every((key) => String(this.draft()[key] ?? '').trim()) && !this.fieldError('username') && !this.fieldError('email')
    : ['name', 'code'].every((key) => String(this.draft()[key] ?? '').trim()) && !this.fieldError('name') && !this.fieldError('code'));

  constructor() {
    combineLatest([this.service.users$, this.service.units$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ([users, units]) => { this.users.set(users); this.units.set(units); this.loading.set(false); },
      error: () => { this.errorMessage.set(`The ${this.entity} data could not be loaded.`); this.loading.set(false); },
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'role') this.roleFilter.set(change.value);
    if (change.key === 'unit') this.unitFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.roleFilter.set('all'); this.unitFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  openAdd(): void {
    this.editingId.set(null); this.clearMessages();
    this.draft.set(this.entity === 'users'
      ? { displayName: '', username: '', email: '', role: '', unitId: '', active: true }
      : { name: '', code: '', description: '', active: true });
    this.modalOpen.set(true);
  }
  handleAction(event: InternalRowActionEvent): void {
    const record = this.entity === 'users' ? this.users().find((item) => item.id === event.record.id) : this.units().find((item) => item.id === event.record.id);
    if (!record) return;
    if (event.action.key === 'edit') { this.editingId.set(record.id); this.draft.set({ ...record }); this.modalOpen.set(true); this.clearMessages(); return; }
    this.changeStatus(record);
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft(key: string, value: string | boolean): void { this.draft.update((draft) => ({ ...draft, [key]: value })); }
  value(key: string): string { const value = this.draft()[key]; return typeof value === 'string' ? value : ''; }
  fieldError(key: string): string {
    const value = this.value(key).trim().toLowerCase();
    const id = this.editingId();
    if (!value) return '';
    if (key === 'email' && !/^\S+@\S+\.\S+$/.test(value)) return 'Email must be a valid email address.';
    if (key === 'email' && this.users().some((user) => user.id !== id && user.email.toLowerCase() === value)) return 'Email is already assigned to another user.';
    if (key === 'username' && this.users().some((user) => user.id !== id && user.username.toLowerCase() === value)) return 'Username is already assigned to another user.';
    if (key === 'name' && this.units().some((unit) => unit.id !== id && unit.name.toLowerCase() === value)) return 'Unit Name already exists.';
    if (key === 'code' && this.units().some((unit) => unit.id !== id && unit.code.toLowerCase() === value)) return 'Unit Code already exists.';
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
      next: () => { this.modalOpen.set(false); this.successMessage.set(`${this.entity === 'users' ? 'User' : 'Unit'} ${id ? 'updated' : 'created'} successfully.`); },
      error: () => this.errorMessage.set(`The ${this.entity === 'users' ? 'user' : 'unit'} could not be saved.`),
    });
  }

  private userDraft(): AdminUserDraft { return { displayName: this.value('displayName').trim(), username: this.value('username').trim(), email: this.value('email').trim().toLowerCase(), role: this.value('role') as UserRole, unitId: this.value('unitId'), active: Boolean(this.draft()['active']) }; }
  private unitDraft(): AdminUnitDraft { return { name: this.value('name').trim(), code: this.value('code').trim().toUpperCase(), description: this.value('description').trim(), active: Boolean(this.draft()['active']) }; }
  private clearMessages(): void { this.successMessage.set(''); this.errorMessage.set(''); }
  private changeStatus(record: AdminUserRecord | AdminUnitRecord): void {
    this.clearMessages();
    const request: Observable<AdminUserRecord | AdminUnitRecord> = this.entity === 'users'
      ? this.service.setUserActive(record.id, !record.active)
      : this.service.setUnitActive(record.id, !record.active);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.successMessage.set(`${this.entity === 'users' ? 'User' : 'Unit'} is now ${record.active ? 'inactive' : 'active'}.`),
      error: () => this.errorMessage.set('The active status could not be changed.'),
    });
  }
  private pageSlice<T>(records: readonly T[]): readonly T[] { return records.slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()); }
  private userRecords(): readonly InternalDataRecord[] { return this.pageSlice(this.filteredUsers()).map((user) => ({
    id: user.id,
    cells: { identity: { primary: user.displayName, secondary: `${user.username} · ${user.email}`, avatar: this.initials(user.displayName) }, role: { primary: user.roleLabel }, unit: { primary: user.department }, status: { primary: user.active ? 'Active' : 'Inactive', badge: true, tone: user.active ? 'success' : 'neutral' }, actions: { primary: '' } },
    mobile: { eyebrow: user.roleLabel, status: user.active ? 'Active' : 'Inactive', title: user.displayName, identity: user.email, initials: this.initials(user.displayName), details: [{ icon: 'alternate_email', text: user.username }, { icon: 'domain', text: user.department }] },
  })); }
  private unitRecords(): readonly InternalDataRecord[] { return this.pageSlice(this.filteredUnits()).map((unit) => {
    const count = this.users().filter((user) => user.unitId === unit.id).length;
    return { id: unit.id, cells: { unit: { primary: unit.name, secondary: unit.description }, code: { primary: unit.code }, members: { primary: `${count} user${count === 1 ? '' : 's'}` }, status: { primary: unit.active ? 'Active' : 'Inactive', badge: true, tone: unit.active ? 'success' : 'neutral' }, actions: { primary: '' } }, mobile: { eyebrow: unit.code, status: unit.active ? 'Active' : 'Inactive', title: unit.name, details: [{ icon: 'group', text: `${count} assigned user${count === 1 ? '' : 's'}` }, { icon: 'info', text: unit.description ?? 'No description' }] } };
  }); }
  private initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
}
