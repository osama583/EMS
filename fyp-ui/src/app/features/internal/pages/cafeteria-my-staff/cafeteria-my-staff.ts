import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { AssignableCafeteriaUser, CafeteriaAssignment } from '../../../../core/cafeterias/cafeteria.models';
import { CafeteriaStaffRequestService } from '../../../../core/cafeterias/cafeteria-staff-request.service';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';

// Cafeteria Manager's own staff-roster screen — scoped to their own cafeteria only (unlike
// Cafeteria Admin's cross-cafeteria Staff Assignments page). Every add/edit/remove goes through
// CafeteriaStaffRequestService.submit() instead of CafeteriaService directly — nothing here
// mutates user_unit_roles; it only ever creates a pending request for Cafeteria Admin to review
// (see server/routes/cafeterias.routes.js's /staff-requests section). See the History page for
// the manager's own request outcomes.
@Component({
  selector: 'app-cafeteria-my-staff',
  imports: [InternalDataPageComponent, FormModalComponent, FeedbackBannerComponent, SearchableDropdownComponent],
  templateUrl: './cafeteria-my-staff.html',
  styleUrl: './cafeteria-my-staff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaMyStaffComponent {
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
  readonly successMessage = signal('');
  readonly errorMessage = signal('');

  readonly removeTarget = signal<CafeteriaAssignment | null>(null);
  readonly removing = signal(false);

  readonly myStaff = computed(() => this.staff().filter((a) => a.cafeteriaCode === this.ownCafeteriaCode && a.roleCode === 'cafeteria-staff'));
  readonly filteredStaff = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.myStaff().filter((a) => !search || `${a.displayName} ${a.email}`.toLowerCase().includes(search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredStaff().length / this.pageSize())));
  readonly userOptions = computed<readonly SelectOption[]>(() => this.assignableUsers().map((u) => ({ value: u.id, label: u.displayName, description: u.email })));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'My cafeteria staff', paginationLabel: 'Staff pages', rowsPerPageLabel: 'Staff per page', mobileListLabel: 'Staff cards',
    header: {
      title: 'My Staff',
      description: 'Add, edit, or remove staff at your cafeteria. Changes are sent to Cafeteria Admin for approval.',
      countLabel: `${this.filteredStaff().length} staff member${this.filteredStaff().length === 1 ? '' : 's'}`,
      primaryActionLabel: 'Request new staff',
    },
    search: { ariaLabel: 'Search staff', placeholder: 'Search name or email' },
    columns: [
      { key: 'user', label: 'User' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'remove', label: 'Request removal', icon: 'delete' },
    ],
    emptyTitle: 'No staff yet', emptyDescription: 'Request a new staff member to get started.', pageSizeOptions: [5, 10, 25],
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() =>
    this.filteredStaff().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()).map((a) => ({
      id: a.assignmentId,
      actionKeys: ['remove'],
      cells: {
        user: { primary: a.displayName, secondary: a.email },
        actions: { primary: '' },
      },
      mobile: { eyebrow: 'Cafeteria Staff', status: '', title: a.displayName, identity: a.email, details: [] },
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
    this.selectedUserId.set(''); this.selectedUserLabel.set('');
    this.cafeterias.getAssignableUsers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((users) => this.assignableUsers.set(users));
    this.modalOpen.set(true);
  }
  closeModal(): void { if (!this.submitting()) this.modalOpen.set(false); }
  selectUser(value: string | readonly string[]): void { this.selectedUserId.set(Array.isArray(value) ? value[0] ?? '' : value); }

  submitAdd(): void {
    const user = this.assignableUsers().find((u) => u.id === this.selectedUserId());
    if (!user) return;
    this.submitting.set(true); this.clearMessages();
    this.requests.submit({ requestedByUserId: this.auth.user()!.id!, action: 'add', email: user.email, displayName: user.displayName, roleCode: 'cafeteria-staff' })
      .pipe(finalize(() => this.submitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.modalOpen.set(false); this.successMessage.set('Request sent to Cafeteria Admin for approval.'); },
        error: (err) => this.errorMessage.set(err?.error?.message || 'The request could not be sent. Please try again.'),
      });
  }

  handleAction(event: InternalRowActionEvent): void {
    const assignment = this.myStaff().find((a) => a.assignmentId === event.record.id);
    if (!assignment) return;
    if (event.action.key === 'remove') this.removeTarget.set(assignment);
  }

  cancelRemove(): void { if (!this.removing()) this.removeTarget.set(null); }
  confirmRemove(): void {
    const target = this.removeTarget();
    if (!target) return;
    this.removing.set(true); this.clearMessages();
    this.requests.submit({ requestedByUserId: this.auth.user()!.id!, action: 'remove', targetAssignmentId: target.assignmentId })
      .pipe(finalize(() => this.removing.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.removeTarget.set(null); this.successMessage.set('Removal request sent to Cafeteria Admin for approval.'); },
        error: (err) => { this.removeTarget.set(null); this.errorMessage.set(err?.error?.message || 'The request could not be sent. Please try again.'); },
      });
  }

  private clearMessages(): void { this.successMessage.set(''); this.errorMessage.set(''); }
}
