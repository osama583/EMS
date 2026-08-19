import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { AssignableCafeteriaUser, CafeteriaAssignment } from '../../../../core/cafeterias/cafeteria.models';
import { CafeteriaStaffRequestService } from '../../../../core/cafeterias/cafeteria-staff-request.service';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Cafeteria Manager's own staff-roster screen — scoped to their own cafeteria only (unlike
// Cafeteria Admin's cross-cafeteria Staff Assignments page). Every add/edit/remove goes through
// CafeteriaStaffRequestService.submit() instead of CafeteriaService directly — nothing here
// mutates user_unit_roles; it only ever creates a pending request for Cafeteria Admin to review
// (see server/routes/cafeterias.routes.js's /staff-requests section). See the History page for
// the manager's own request outcomes.
const PASSWORD_MIN_LENGTH = 8;

@Component({
  selector: 'app-cafeteria-my-staff',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent, FormFieldComponent, StatusToggleComponent],
  templateUrl: './cafeteria-my-staff.html',
  styleUrl: './cafeteria-my-staff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaMyStaffComponent {
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly cafeterias = inject(CafeteriaService);
  private readonly requests = inject(CafeteriaStaffRequestService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly ownCafeteriaCode = this.auth.user()?.cafeteriaCode;

  readonly staff = signal<readonly CafeteriaAssignment[]>([]);
  readonly assignableUsers = signal<readonly AssignableCafeteriaUser[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly modalOpen = signal(false);
  readonly submitting = signal(false);
  readonly editingAssignment = signal<CafeteriaAssignment | null>(null);
  readonly selectedUserId = signal('');
  readonly selectedUserLabel = signal('');
  readonly errorMessage = signal('');

  readonly removeTarget = signal<CafeteriaAssignment | null>(null);
  readonly removing = signal(false);
  readonly statusTarget = signal<CafeteriaAssignment | null>(null);
  readonly changingStatus = signal(false);

  // The account being proposed (add) or amended (edit). The Manager fills these in; nothing is
  // written until the Cafeteria Admin approves.
  readonly draft = signal<Record<string, string | boolean>>({});

  readonly isEditing = computed(() => this.editingAssignment() !== null);
  readonly formValid = computed(() => {
    const d = this.draft();
    const name = String(d['displayName'] ?? '').trim();
    const email = String(d['email'] ?? '').trim();
    const password = String(d['password'] ?? '');
    // A password is optional on edit (blank = leave it alone) and on add (blank = the account is
    // created with a random secret, reachable only through a reset).
    if (password && password.length < PASSWORD_MIN_LENGTH) return false;
    return name.length > 0 && /^\S+@\S+\.\S+$/.test(email);
  });
  readonly passwordHint = computed(() => {
    const password = String(this.draft()['password'] ?? '');
    if (password && password.length < PASSWORD_MIN_LENGTH) return `At least ${PASSWORD_MIN_LENGTH} characters.`;
    return this.isEditing() ? 'Leave blank to keep the current password.' : 'Leave blank to create the account without a password.';
  });

  readonly myStaff = computed(() => this.staff().filter((a) => a.cafeteriaCode === this.ownCafeteriaCode && a.roleCode === 'cafeteria-staff'));
  readonly filteredStaff = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.myStaff().filter((a) => !search || `${a.displayName} ${a.email}`.toLowerCase().includes(search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredStaff().length / this.pageSize())));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'My cafeteria staff', paginationLabel: 'Staff pages', rowsPerPageLabel: 'Staff per page', mobileListLabel: 'Staff cards',
    header: {
      title: 'My Staff',
      // No "edit" here: an assignment's only editable field is its role, and a Manager may only
      // ever request Cafeteria Staff (the server rejects anything else), so an edit they could
      // raise would always be staff -> staff. Changing someone's role is the Admin's to make.
      description: 'Add or remove staff at your cafeteria. Changes are sent to Cafeteria Admin for approval.',
      countLabel: `${this.filteredStaff().length} staff member${this.filteredStaff().length === 1 ? '' : 's'}`,
      primaryActionLabel: 'Request new staff',
    },
    search: { ariaLabel: 'Search staff', placeholder: 'Search name or email' },
    columns: [
      { key: 'user', label: 'User' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'edit', label: 'Request edit', icon: 'edit' },
      { key: 'status', label: 'Request suspend / restore', icon: 'toggle_on' },
      { key: 'remove', label: 'Request removal', icon: 'delete' },
    ],
    emptyTitle: 'No staff yet', emptyDescription: 'Request a new staff member to get started.', pageSizeOptions: [5, 10, 25],
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() =>
    this.filteredStaff().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()).map((a) => ({
      id: a.assignmentId,
      actionKeys: ['edit', 'status', 'remove'],
      cells: {
        user: { primary: a.displayName, secondary: a.email },
        status: {
          primary: a.active === false ? 'Suspended' : 'Active',
          badge: true,
          tone: a.active === false ? 'warning' : 'success',
        },
        actions: { primary: '' },
      },
      mobile: {
        eyebrow: 'Cafeteria Staff',
        status: a.active === false ? 'Suspended' : 'Active',
        title: a.displayName, identity: a.email, details: [],
      },
    })),
  );

  constructor() {
    this.cafeterias.assignments$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (assignments) => { this.staff.set(assignments); this.loading.set(false); },
      error: () => { this.errorMessage.set('Staff could not be loaded.'); this.loading.set(false); },
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  reset(): void { this.search.set(''); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  openAdd(): void {
    this.clearMessages();
    this.editingAssignment.set(null);
    this.draft.set({ displayName: '', username: '', email: '', password: '', active: true });
    this.modalOpen.set(true);
  }

  openEdit(assignment: CafeteriaAssignment): void {
    this.clearMessages();
    this.editingAssignment.set(assignment);
    this.draft.set({
      displayName: assignment.displayName,
      username: assignment.username ?? '',
      email: assignment.email,
      // Never pre-filled: the stored value is a hash, so there is nothing to show, and a blank
      // field correctly means "leave the password alone".
      password: '',
      active: assignment.userActive !== false,
    });
    this.modalOpen.set(true);
  }

  closeModal(): void { if (!this.submitting()) this.modalOpen.set(false); }
  setDraft(key: string, value: string | boolean): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }
  value(key: string): string { return String(this.draft()[key] ?? ''); }

  submitAdd(): void {
    if (!this.formValid()) return;
    const d = this.draft();
    const editing = this.editingAssignment();
    this.submitting.set(true); this.clearMessages();

    const draft = {
      requestedByUserId: this.auth.user()!.id!,
      action: (editing ? 'edit' : 'add') as 'edit' | 'add',
      ...(editing ? { targetAssignmentId: editing.assignmentId } : {}),
      displayName: String(d['displayName']).trim(),
      username: String(d['username'] ?? '').trim() || undefined,
      email: String(d['email']).trim(),
      password: String(d['password'] ?? '') || undefined,
      active: d['active'] !== false,
      roleCode: 'cafeteria-staff',
    };
    this.requests.submit(draft)
      .pipe(finalize(() => this.submitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.modalOpen.set(false); this.toast.success('Request sent to Cafeteria Admin for approval'); },
        error: (err) => this.toast.error('The request could not be sent', apiErrorMessage(err, 'Please try again.')),
      });
  }

  handleAction(event: InternalRowActionEvent): void {
    const assignment = this.myStaff().find((a) => a.assignmentId === event.record.id);
    if (!assignment) return;
    if (event.action.key === 'edit') { this.openEdit(assignment); return; }
    if (event.action.key === 'status') { this.statusTarget.set(assignment); return; }
    if (event.action.key === 'remove') this.removeTarget.set(assignment);
  }

  // Suspend/restore is the same request either way — which one it is follows from the assignment's
  // current state, so the Manager cannot ask to suspend someone already suspended.
  statusActionLabel(): string { return this.statusTarget()?.active === false ? 'restore' : 'suspend'; }
  cancelStatus(): void { if (!this.changingStatus()) this.statusTarget.set(null); }
  confirmStatus(): void {
    const target = this.statusTarget();
    if (!target) return;
    this.changingStatus.set(true); this.clearMessages();
    this.requests.submit({
      requestedByUserId: this.auth.user()!.id!,
      action: target.active === false ? 'restore' : 'suspend',
      targetAssignmentId: target.assignmentId,
    }).pipe(finalize(() => this.changingStatus.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.statusTarget.set(null); this.toast.success('Request sent to Cafeteria Admin for approval'); },
      error: (err) => { this.statusTarget.set(null); this.toast.error('The request could not be sent', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  cancelRemove(): void { if (!this.removing()) this.removeTarget.set(null); }
  confirmRemove(): void {
    const target = this.removeTarget();
    if (!target) return;
    this.removing.set(true); this.clearMessages();
    this.requests.submit({ requestedByUserId: this.auth.user()!.id!, action: 'remove', targetAssignmentId: target.assignmentId })
      .pipe(finalize(() => this.removing.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.removeTarget.set(null); this.toast.success('Removal request sent to Cafeteria Admin for approval'); },
        error: (err) => { this.removeTarget.set(null); this.toast.error('The request could not be sent', apiErrorMessage(err, 'Please try again.')); },
      });
  }

  private clearMessages(): void { this.errorMessage.set(''); }
}
