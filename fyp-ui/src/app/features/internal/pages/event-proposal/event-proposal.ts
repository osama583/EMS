import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { MissingFieldItem, StepIndicatorComponent, StepStatus } from '../../../../shared/components/step-indicator/step-indicator';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { EventImageUploadComponent } from '../../../../shared/components/event-image-upload/event-image-upload';
import { ProposalTableComponent, ProposalTableColumn } from '../../../../shared/components/proposal-table/proposal-table';
import { ValidationMessageComponent } from '../../../../shared/components/validation-message/validation-message';
import { EditableRow, EditableTableColumn, SelectOption, StaffOption, FormControlType } from '../../../../shared/components/form-controls/form-controls.models';
import { RequestOption, RequestOptionKind } from '../../../../core/request-options/request-option.models';
import { RequestOptionService } from '../../../../core/request-options/request-option.service';
import { LogisticsAvailabilityService } from '../../../../core/request-options/logistics-availability.service';
import { LogisticsAvailability } from '../../../../core/request-options/logistics-availability.models';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';
import { OptionPickerGridComponent } from '../../../../shared/components/option-picker-grid/option-picker-grid';
import { OptionPickerItem } from '../../../../shared/components/option-picker-grid/option-picker-grid.models';
import { AuthService } from '../../../../core/auth/auth.service';
import { EventImageAsset, EventVisibility, RegistrationMode } from '../../../../core/events/published-event.models';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ReviewerCommentEntry, allCommentEntries } from '../../../../core/proposals/proposal-status.models';

import { AdminDirectoryService } from '../../../../core/admin-directory/admin-directory.service';
import { SystemConfigService } from '../../../../core/config/system-config.service';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { EventCategoryService, EventFormatService } from '../../../../core/event-catalog/event-catalog.service';

type RequirementKey = 'logistics' | 'transportation' | 'photoVideo' | 'soundLight' | 'fmb' | 'campusTour' | 'waterNormal' | 'fundingPurchase';
type RowCollection = 'coOwners' | 'schedule' | 'organizers' | 'importantPeople' | 'guests' | 'agenda' | 'discussions';
type TableEditorCollection = Exclude<RowCollection, 'coOwners'>;

interface ProposalStep { readonly label: string; readonly icon: string; }
interface RequestDefinition { readonly key: RequirementKey; readonly label: string; readonly columns: readonly EditableTableColumn[]; }
interface ProposalReviewItem { readonly label: string; readonly value: string; readonly wide?: boolean; }
interface ProposalReviewSection { readonly title: string; readonly icon: string; readonly items: readonly ProposalReviewItem[]; }

const option = (label: string): SelectOption => ({ value: label, label });
const options = (...labels: string[]): readonly SelectOption[] => labels.map(option);

@Component({
  selector: 'app-event-proposal',
  imports: [FormFieldComponent, SearchableDropdownComponent, ProposalTableComponent, ValidationMessageComponent, StepIndicatorComponent, FormModalComponent, EventImageUploadComponent, LoadingStateComponent, OptionPickerGridComponent],
  templateUrl: './event-proposal.html',
  styleUrl: './event-proposal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventProposalComponent implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly optionService = inject(RequestOptionService);
  private readonly availabilityService = inject(LogisticsAvailabilityService);
  private readonly applicant = this.auth.user();
  private readonly requestOptionCatalog = signal<readonly RequestOption[]>([]);
  readonly requestCatalogLoading = signal(true);
  private readonly requestOptionSubscription: Subscription = this.optionService.watchActiveCatalog().subscribe({ next: (options) => { this.requestOptionCatalog.set(options); this.requestCatalogLoading.set(false); }, error: () => this.requestCatalogLoading.set(false) });
  private validationGuidanceTimer: ReturnType<typeof setTimeout> | undefined;
  private requestOptionsTimer: ReturnType<typeof setTimeout> | undefined;
  private logisticsAvailabilityTimer: ReturnType<typeof setTimeout> | undefined;
  private logisticsAvailabilitySubscription: Subscription | undefined;
  private logisticsAvailabilityRequestToken = 0;
  readonly logisticsAvailability = signal<LogisticsAvailability | null>(null);
  readonly logisticsAvailabilityLoading = signal(false);
  readonly logisticsAvailabilityError = signal(false);
  private nextRowId = 100;
  readonly currentStep = signal(0);
  readonly status = signal<'Draft' | 'Draft saved' | 'Submitted'>('Draft');
  readonly resubmitProposalId = signal<number | null>(null);
  readonly draftRequestId = signal<number | null>(null);
  readonly savingDraft = signal(false);
  // Every comment waiting on the applicant: the reviewer stage that sent the whole proposal back,
  // and/or each department that asked for changes to its own part of it.
  readonly reviewerComments = signal<readonly ReviewerCommentEntry[]>([]);
  readonly commentsPanelOpen = signal(true);
  readonly resubmitting = signal(false);
  readonly errors = signal<Readonly<Record<string, string>>>({});
  readonly previewOpen = signal(false);
  readonly validationModalOpen = signal(false);
  readonly validationGuidanceVisible = signal(false);
  readonly validationGuidanceVersion = signal(0);
  readonly submitAttempted = signal(false);
  readonly visitedSteps = signal<readonly number[]>([0]);
  readonly checkedSteps = signal<readonly number[]>([]);
  readonly requirementsTouched = signal(false);

  readonly steps: readonly ProposalStep[] = [
    { label: 'Applicant Info', icon: 'person' }, { label: 'General Event Info', icon: 'event' },
    { label: 'Required for Event', icon: 'checklist' }, { label: 'Request Details', icon: 'request_page' },
    { label: 'Detailed Event Info', icon: 'article' }, { label: 'Final Review', icon: 'task_alt' },
  ];
  readonly applicantName = signal(this.applicant?.displayName ?? '');
  readonly department = signal(this.applicant?.department ?? '');
  readonly email = signal(this.applicant?.email ?? '');
  readonly eventTitle = signal('');
  readonly shortIntro = signal('');
  readonly goals = signal('');
  readonly benefits = signal('');
  readonly isPublic = signal(false);
  // Holds catalog ids (the picker's `value`), not display names — see categoryOptions/
  // formatOptions below, which source from the id-backed Event Categories/Formats catalog.
  readonly eventCategories = signal<readonly string[]>([]);
  readonly eventVisibility = signal<EventVisibility>('Private');
  readonly eventFormat = signal<string>('');
  readonly eventImage = signal<EventImageAsset | null>(null);
  readonly registrationMode = signal<RegistrationMode>('Automatic');
  readonly publicity = signal('');
  readonly cost = signal<number | null>(null);
  readonly bankAccountName = signal('');
  readonly bankAccountNumber = signal('');
  readonly selectedRequirements = signal<readonly string[]>([]);
  readonly submitConfirmOpen = signal(false);
  readonly requestModalOpen = signal(false);
  readonly requestModalDefinition = signal<RequestDefinition | null>(null);
  readonly requestEditingIndex = signal<number | null>(null);
  readonly requestDraft = signal<EditableRow>({});
  readonly requestOptionsLoading = signal(false);
  // Logistics' Item / Need picker is a collapsed card by default (a large always-open image
  // grid was pushing the rest of the form down the page) — expands in place on click, and
  // auto-collapses again once a selection is made.
  readonly logisticsPickerExpanded = signal(false);
  readonly tableModalOpen = signal(false);
  readonly tableEditorCollection = signal<TableEditorCollection | null>(null);
  readonly tableEditingIndex = signal<number | null>(null);
  readonly tableDraft = signal<EditableRow>({});

  private readonly toastService = inject(ToastService);
  private readonly systemConfig = inject(SystemConfigService);
  private readonly directory = inject(AdminDirectoryService);
  private readonly eventCategoryService = inject(EventCategoryService);
  private readonly eventFormatService = inject(EventFormatService);
  // ACTIVE-only options — an archived category/format must not be offered on a new proposal, even
  // though already-submitted proposals keep showing their frozen snapshot label regardless.
  readonly categoryOptions = computed<readonly SelectOption[]>(() =>
    this.eventCategoryService.activeEntries().map((entry) => ({ value: entry.id, label: entry.name }))
  );
  // Admin-settable (System Configuration -> Policies). The server enforces the same cap on
  // submit, so this only keeps the picker honest — it is never the authority.
  readonly maxEventCategories = computed(() => this.systemConfig.maxEventCategories());
  // Club Only visibility is gated on being the President of at least one club — a data fact
  // (AuthUser.presidentOfClubIds, sourced from the clubs table), not a role check.
  private readonly isClubPresident = Boolean(this.applicant?.presidentOfClubIds?.length);
  readonly visibilityOptions: readonly SelectOption[] = (this.isClubPresident ? ['Public', 'Private', 'Club Only'] : ['Public', 'Private']).map((label) => ({ value: label, label }));
  readonly formatOptions = computed<readonly SelectOption[]>(() =>
    this.eventFormatService.activeEntries().map((entry) => ({ value: entry.id, label: entry.name }))
  );
  readonly registrationModeOptions = options('Automatic', 'Approval Required');
  // Co-owner candidates come from the live user directory (system specification §8D: every
  // dropdown is populated from the database). Only active, internal accounts are offered.
  readonly staff = signal<readonly StaffOption[]>([]);

  readonly coOwners = signal<readonly EditableRow[]>([]);
  readonly coOwnerEditorVisible = signal(false);
  readonly coOwnerModalOpen = signal(false);
  readonly editingCoOwnerIndex = signal<number | null>(null);
  readonly coOwnerStaff = signal('');
  readonly coOwnerFormError = signal('');
  readonly schedule = signal<readonly EditableRow[]>([]);
  readonly organizers = signal<readonly EditableRow[]>([]);
  readonly importantPeople = signal<readonly EditableRow[]>([]);
  readonly guests = signal<readonly EditableRow[]>([]);
  readonly agenda = signal<readonly EditableRow[]>([]);
  readonly discussions = signal<readonly EditableRow[]>([]);
  readonly requestRows = signal<Readonly<Record<RequirementKey, readonly EditableRow[]>>>({
    logistics: [], transportation: [], photoVideo: [], soundLight: [], fmb: [], campusTour: [], waterNormal: [], fundingPurchase: [],
  });

  // record.eventCategories/eventFormat carry the frozen SNAPSHOT NAMEs (proposal-projection.
  // service.js reads request_categories.category_name / request.event_format_snapshot, not ids)
  // — the picker's `value` is a catalog id, so these need resolving back to the catalog's CURRENT
  // id before the picker can highlight the right option. Held here (rather than resolved once,
  // inline in prefillFromRecord) because the catalogs load asynchronously and may still be loading
  // when the proposal record itself arrives — the effect() below re-resolves once both are ready.
  private readonly pendingCategoryNames = signal<readonly string[] | null>(null);
  private readonly pendingFormatName = signal<string | null>(null);

  constructor() {
    // Co-owner candidates: every active internal account except the applicant themselves.
    this.directory.users$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((users) => {
      this.staff.set(users
        // External (guest) accounts hold only the flat 'external-user' role and can never be
        // co-owners or organizers of an internal proposal.
        .filter((user) => user.active && !user.roles.some((role) => role.roleCode === 'external-user'))
        .map((user) => ({
          value: user.displayName,
          label: user.displayName,
          email: user.email,
          role: user.roleLabel,
          description: user.department,
        })));
    });
    effect(() => {
      const names = this.pendingCategoryNames();
      if (names === null || this.eventCategoryService.loading()) return;
      const idsByName = new Map(this.eventCategoryService.entries().map((entry) => [entry.name, entry.id]));
      this.eventCategories.set(names.map((name) => idsByName.get(name)).filter((id): id is string => !!id));
    });
    effect(() => {
      const name = this.pendingFormatName();
      if (name === null || this.eventFormatService.loading()) return;
      const formatEntry = this.eventFormatService.entries().find((entry) => entry.name === name);
      this.eventFormat.set(formatEntry ? formatEntry.id : '');
    });
    // Brand-new proposal (nothing pending to prefill) — default to the first active format once
    // the catalog loads, mirroring the old hardcoded 'On Campus' default's intent without assuming
    // any specific format still exists/is active.
    effect(() => {
      if (this.pendingFormatName() !== null || this.eventFormat() || this.eventFormatService.loading()) return;
      const first = this.eventFormatService.activeEntries()[0];
      if (first) this.eventFormat.set(first.id);
    });

    const proposalId = Number(this.route.snapshot.queryParamMap.get('proposalId'));
    if (Number.isFinite(proposalId) && proposalId > 0) {
      this.workflow.getById(proposalId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((record) => {
        if (!record) return;
        // A record still in status 'Draft' was opened from the Drafts list to keep editing — it
        // continues saving as a draft (and eventually submits fresh) rather than going through
        // resubmitFromApplicant(), which only exists for proposals a reviewer sent back
        // (status='resubmission_required') and would reject a plain draft's status server-side.
        if (record.status === 'Draft') this.draftRequestId.set(proposalId);
        else this.resubmitProposalId.set(proposalId);
        this.prefillFromRecord(record);
      });
    }
  }

  // Loads a proposal a reviewer sent back with a comment so the applicant can see what needs to
  // change and edit in place, rather than starting a fresh submission from scratch.
  private prefillFromRecord(record: ProposalReviewRecord): void {
    this.reviewerComments.set(allCommentEntries(record.workflow));
    this.commentsPanelOpen.set(this.reviewerComments().length > 0);
    this.eventTitle.set(record.eventTitle);
    this.shortIntro.set(record.shortIntroduction);
    this.goals.set(record.goals);
    this.benefits.set(record.benefits);
    this.publicity.set(record.publicity);
    this.cost.set(record.costAmount ?? null);
    this.bankAccountName.set(record.bankAccountName ?? '');
    this.bankAccountNumber.set(record.bankAccountNumber ?? '');
    this.pendingCategoryNames.set(record.eventCategories);
    this.pendingFormatName.set(record.eventFormat);
    this.eventVisibility.set(record.eventVisibility);
    this.eventImage.set(record.eventImage);
    this.registrationMode.set(record.registrationMode);
    this.coOwners.set(record.coOwners);
    this.schedule.set(record.scheduleRows);
    this.organizers.set(record.organizers);
    this.importantPeople.set(record.importantPeople);
    this.guests.set(record.guests);
    this.agenda.set(record.agenda);
    this.discussions.set(record.discussions);
    this.selectedRequirements.set(record.selectedRequirements);
    // Use the server's structured per-requirement rows (date/start/end/withLogo/etc. as real
    // fields) rather than reconstructing them from the flattened, display-only `record.requests`
    // strings — that used to silently drop fields the editor needs (e.g. Mineral Water's
    // withLogo, and every requirement's date/start/end), which then saved back as
    // undefined/false and blanked the Request Details schedule after resubmission.
    const structuredRows = record.requestRows ?? {};
    this.requestRows.set({
      logistics: [], transportation: [], photoVideo: [], soundLight: [], fmb: [], campusTour: [], waterNormal: [], fundingPurchase: [],
      ...Object.fromEntries(
        record.selectedRequirements.map((key) => [key, (structuredRows[key] ?? []).map((row) => ({ ...row }))]),
      ),
    });
  }

  readonly coOwnerColumns: readonly EditableTableColumn[] = [
    { key: 'name', label: 'Name', type: 'staff', required: true }, { key: 'email', label: 'Email', type: 'readonly' }, { key: 'role', label: 'Role', type: 'readonly' },
  ];
  readonly coOwnerDisplayColumns: readonly ProposalTableColumn[] = [
    { key: 'name', label: 'Staff Name', width: '14rem' }, { key: 'email', label: 'Email', width: '14rem' }, { key: 'role', label: 'Role', width: '12rem' },
  ];
  readonly scheduleColumns: readonly EditableTableColumn[] = [
    { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'start', label: 'Start Time', type: 'time', required: true }, { key: 'end', label: 'End Time', type: 'time', required: true }, { key: 'location', label: 'Location', type: 'text', required: true },
  ];
  readonly organizerColumns: readonly EditableTableColumn[] = [
    { key: 'name', label: 'Name', type: 'staff', required: true }, { key: 'email', label: 'Email', type: 'readonly' }, { key: 'role', label: 'Role', type: 'readonly', span: 'full' }, { key: 'notes', label: 'Responsibility / Notes', type: 'text', span: 'full' },
  ];
  readonly importantColumns: readonly EditableTableColumn[] = [
    { key: 'name', label: 'Name', type: 'text' }, { key: 'type', label: 'Type', type: 'select', options: options('VIP', 'Speaker', 'Partner', 'Important Guest') }, { key: 'organization', label: 'Organization', type: 'text' }, { key: 'designation', label: 'Designation', type: 'text' },
  ];
  readonly guestColumns: readonly EditableTableColumn[] = [
    { key: 'guestType', label: 'Guest Type', type: 'select', options: options('Students', 'APU Staff', 'External Guests', 'Parents-Guardians', 'Industry Partners', 'Alumni', 'Others') }, { key: 'count', label: 'Count', type: 'number', min: 0, step: 1 }, { key: 'notes', label: 'Notes', type: 'text', span: 'full' },
  ];
  readonly agendaColumns: readonly EditableTableColumn[] = [
    { key: 'time', label: 'Time', type: 'time', required: true }, { key: 'activity', label: 'Activity', type: 'text', required: true }, { key: 'location', label: 'Location', type: 'text', required: true }, { key: 'pic', label: 'PIC', type: 'text', required: true }, { key: 'notes', label: 'Notes', type: 'text', span: 'full' },
  ];
  readonly discussionColumns: readonly EditableTableColumn[] = [{ key: 'topic', label: 'Discussion Topic', type: 'text', required: true, span: 'full' }];

  get requirements(): readonly RequestDefinition[] { this.requestOptionCatalog(); return this.buildRequirementDefinitions(); }

  readonly importantPeopleCount = computed(() => this.importantPeople().filter((row) => this.rowHasValue(row, ['name', 'type'])).length);
  readonly totalPax = computed(() => this.guests().reduce((sum, row) => sum + this.nonNegative(row['count']), 0) + this.importantPeopleCount());
  readonly externalPax = computed(() => this.guests().reduce((sum, row) => ['External Guests', 'Parents-Guardians', 'Industry Partners', 'Alumni', 'Others'].includes(String(row['guestType'])) ? sum + this.nonNegative(row['count']) : sum, 0));
  readonly selectedCoOwner = computed(() => this.coOwnerStaffOptions().find((person) => person.label === this.coOwnerStaff()));
  readonly coOwnerFormValid = computed(() => Boolean(this.selectedCoOwner()));
  // Excludes the applicant (self) and staff already added as a co-owner in another row —
  // the row currently being edited is exempted so its own existing selection still appears.
  readonly coOwnerStaffOptions = computed<readonly StaffOption[]>(() => {
    const applicantEmail = this.email().trim().toLowerCase();
    const editingIndex = this.editingCoOwnerIndex();
    const takenEmails = new Set(
      this.coOwners()
        .filter((_, index) => index !== editingIndex)
        .map((row) => String(row['email'] ?? '').trim().toLowerCase())
        .filter(Boolean)
    );
    return this.staff().filter((person) => person.email.trim().toLowerCase() !== applicantEmail && !takenEmails.has(person.email.trim().toLowerCase()));
  });
  readonly hasSpeaker = computed(() => this.importantPeople().some((row) => row['type'] === 'Speaker'));
  readonly agendaReasons = computed(() => {
    const reasons: string[] = [];
    if (this.schedule().some((row) => this.durationMinutes(String(row['start']), String(row['end'])) > 120)) reasons.push('an event session is longer than two hours');
    if (this.schedule().length > 1) reasons.push('the event has more than one schedule row');
    if (this.externalPax() > 0) reasons.push('external guests are attending');
    if (this.hasSpeaker()) reasons.push('a Speaker is included');
    if (this.selectedRequirements().includes('campusTour')) reasons.push('Campus Tour is selected');
    const times = new Set<string>();
    this.selectedRequirements().forEach((key) => this.requestRows()[key as RequirementKey]?.forEach((row) => ['start', 'end', 'time', 'datetime'].forEach((field) => { if (row[field]) times.add(String(row[field])); })));
    if (times.size > 1) reasons.push('selected services use different times');
    return reasons;
  });
  readonly agendaRequired = computed(() => this.agendaReasons().length > 0);
  readonly discussionRequired = computed(() => !this.hasSpeaker() && this.totalPax() < 20 && (this.importantPeople().some((row) => Boolean(row['organization'])) || this.importantPeople().some((row) => ['VIP', 'Partner'].includes(String(row['type'])))));
  readonly totalCost = computed(() => this.requestRows().fundingPurchase.reduce((sum, row) => sum + this.nonNegative(row['quantity']) * this.nonNegative(row['unit']), 0));
  readonly showCostFields = computed(() => this.eventVisibility() !== 'Private');
  // Bank details are only meaningful once the event actually charges attendees — an empty or
  // zero Cost means "free", so there's nothing to collect payment for.
  readonly requiresPayment = computed(() => this.cost() !== null && this.cost()! > 0);
  readonly selectedDefinitions = computed(() => this.requirements.filter((item) => this.selectedRequirements().includes(item.key)));
  readonly stepHasError = computed(() => this.steps.map((_, index) => Object.keys(this.errors()).some((key) => key.startsWith(`${index}.`))));
  readonly stepStatuses = computed<readonly StepStatus[]>(() => this.steps.map((step, index) => {
    const stepErrors = Object.entries(this.errors()).filter(([key]) => key.startsWith(`${index}.`));
    return {
      visited: this.visitedSteps().includes(index),
      checked: this.checkedSteps().includes(index),
      valid: stepErrors.length === 0,
      missingFields: this.uniqueMissingFields(stepErrors.map(([key, message]) => this.missingField(key.split('.').slice(1).join('.'), message))),
    };
  }));
  /* Previous identity-heavy summary removed: the review now uses only entered event data.
    ['Applicant', this.applicantName() || '—'], ['School / Department', this.department() || '—'], ['Email', this.email() || '—'], ['Event Title', this.eventTitle() || '—'],
    ['Total Expected Pax', String(this.totalPax())], ['Important People count', String(this.importantPeopleCount())],
    ['Selected requirements', this.selectedDefinitions().map((item) => item.label).join(', ') || 'None selected'],
    ...(this.totalCost() > 0 ? [['Total Expected Cost', this.currency(this.totalCost())]] : []),
    ['Short Introduction', this.shortIntro() || '—'], ['Goals & Objectives', this.goals() || '—'], ['Expected Benefits', this.benefits() || '—'],
    ['Brief Agenda', !this.agendaRequired() ? 'Not required.' : this.completedRows(this.agenda(), ['time', 'activity', 'location', 'pic']).length ? `${this.completedRows(this.agenda(), ['time', 'activity', 'location', 'pic']).length} completed item(s)` : 'Included but incomplete.'],
    ['Discussion Topics', !this.discussionRequired() ? 'Not required.' : this.completedRows(this.discussions(), ['topic']).length ? this.completedRows(this.discussions(), ['topic']).map((row) => row['topic']).join(', ') : 'Included but incomplete.'],
  */

  readonly reviewSections = computed<readonly ProposalReviewSection[]>(() => {
    const schedules = this.completedRows(this.schedule(), ['date', 'start', 'end', 'location']);
    const organizers = this.completedRows(this.organizers(), ['name']);
    const importantPeople = this.importantPeople().filter((row) => this.rowHasValue(row, ['name', 'type']));
    const guests = this.guests().filter((row) => this.nonNegative(row['count']) > 0);
    const agenda = this.completedRows(this.agenda(), ['time', 'activity', 'location', 'pic']);
    const discussions = this.completedRows(this.discussions(), ['topic']);
    const requestedServices = this.selectedDefinitions().map((definition) => {
      const count = this.requestRows()[definition.key].length;
      return `${definition.label}${count ? ` (${count} request${count === 1 ? '' : 's'})` : ''}`;
    }).join(', ');
    const sections: ProposalReviewSection[] = [
      {
        title: 'Event Overview', icon: 'event', items: [
          this.reviewItem('Event Title', this.eventTitle()),
          this.reviewItem('Short Introduction', this.shortIntro(), true),
          ...(this.publicity().trim() ? [this.reviewItem('Promotion / Publicity', this.publicity(), true)] : []),
        ].filter(this.hasReviewValue),
      },
      {
        title: 'Schedule & Attendance', icon: 'calendar_month', items: [
          ...(schedules.length ? [this.reviewItem('Event Schedule', schedules.map((row) => `${row['date']} · ${row['start']}–${row['end']} · ${row['location']}`).join('\n'), true)] : []),
          ...(this.totalPax() > 0 ? [this.reviewItem('Total Expected Pax', String(this.totalPax()))] : []),
          ...(guests.length ? [this.reviewItem('Audience', guests.map((row) => `${row['guestType']}: ${row['count']}`).join(', '), true)] : []),
          ...(organizers.length ? [this.reviewItem('Organizer / PIC', organizers.map((row) => String(row['name'])).join(', '), true)] : []),
          ...(importantPeople.length ? [this.reviewItem('Speakers, VIPs & Partners', importantPeople.map((row) => `${row['name']} (${row['type']})`).join(', '), true)] : []),
        ].filter(this.hasReviewValue),
      },
      {
        title: 'Event Requirements', icon: 'checklist', items: [
          ...(requestedServices ? [this.reviewItem('Departments / Services', requestedServices, true)] : []),
          ...(this.totalCost() > 0 ? [this.reviewItem('Total Expected Cost', this.currency(this.totalCost()))] : []),
          ...(this.showCostFields() && this.cost() !== null ? [this.reviewItem('Event Cost', this.cost()! > 0 ? this.currency(this.cost()!) : 'Free')] : []),
          ...(agenda.length ? [this.reviewItem('Agenda', agenda.map((row) => `${row['time']} · ${row['activity']} · ${row['location']}`).join('\n'), true)] : []),
          ...(discussions.length ? [this.reviewItem('Discussion Topics', discussions.map((row) => String(row['topic'])).join(', '), true)] : []),
        ],
      },
      {
        title: 'Purpose & Outcomes', icon: 'target', items: [
          this.reviewItem('Goals & Objectives', this.goals(), true),
          this.reviewItem('Expected Benefits', this.benefits(), true),
        ].filter(this.hasReviewValue),
      },
    ];
    return sections.filter((section) => section.items.length > 0);
  });

  private readonly hasReviewValue = (item: ProposalReviewItem): boolean => item.value.trim().length > 0;
  private reviewItem(label: string, value: string, wide = false): ProposalReviewItem { return { label, value: value.trim(), wide }; }

  error(key: string): string { return this.errors()[`${this.currentStep()}.${key}`] ?? ''; }
  tableErrors(key: string): Readonly<Record<string, string>> {
    const prefix = `${this.currentStep()}.${key}.`;
    return Object.fromEntries(Object.entries(this.errors()).filter(([name]) => name.startsWith(prefix)).map(([name, value]) => [name.slice(prefix.length), value]));
  }
  setApplicantName(value: string): void { this.applicantName.set(value); this.clearFieldError('applicantName', Boolean(value.trim())); }
  setDepartment(value: string | readonly string[]): void { const next = Array.isArray(value) ? value[0] ?? '' : value; this.department.set(next); this.clearFieldError('department', Boolean(next)); }
  setEmail(value: string): void { this.email.set(value); this.clearFieldError('email', /^\S+@\S+\.\S+$/.test(value)); }
  setEventTitle(value: string): void { this.eventTitle.set(value); this.clearFieldError('eventTitle', Boolean(value.trim())); }
  setShortIntro(value: string): void { this.shortIntro.set(value); this.clearFieldError('shortIntro', Boolean(value.trim())); }
  setGoals(value: string): void { this.goals.set(value); this.clearFieldError('goals', Boolean(value.trim())); }
  setBenefits(value: string): void { this.benefits.set(value); this.clearFieldError('benefits', Boolean(value.trim())); }
  setEventCategories(value: string | readonly string[]): void { const values = (Array.isArray(value) ? value : [value]).slice(0, 2); this.eventCategories.set(values); this.clearFieldError('eventCategories', values.length > 0); }
  setEventVisibility(value: string | readonly string[]): void { const next = (Array.isArray(value) ? value[0] : value) as EventVisibility; if (next === 'Club Only' && !this.isClubPresident) return; this.eventVisibility.set(next); this.isPublic.set(next === 'Public'); if (next !== 'Public') { this.publicity.set(''); this.eventCategories.set([]); this.clearFieldError('eventCategories', true); } this.clearFieldError('eventVisibility', Boolean(next)); }
  setEventFormat(value: string | readonly string[]): void { this.eventFormat.set(Array.isArray(value) ? value[0] : value); }
  setRegistrationMode(value: string | readonly string[]): void { this.registrationMode.set((Array.isArray(value) ? value[0] : value) as RegistrationMode); }
  setPublicity(value: string): void { this.publicity.set(value); this.clearFieldError('publicity', Boolean(value.trim())); }
  setCost(value: string | number): void {
    const text = String(value).trim();
    const parsed = text === '' ? null : Number(text);
    this.cost.set(parsed !== null && Number.isFinite(parsed) ? parsed : null);
    this.clearFieldError('cost', text === '' || (Number.isFinite(parsed) && Number(parsed) >= 0));
    if (!this.requiresPayment()) {
      this.bankAccountName.set('');
      this.bankAccountNumber.set('');
      this.clearFieldError('bankAccountName', true);
      this.clearFieldError('bankAccountNumber', true);
    }
  }
  setBankAccountName(value: string): void { this.bankAccountName.set(value); this.clearFieldError('bankAccountName', Boolean(value.trim())); }
  setBankAccountNumber(value: string): void { this.bankAccountNumber.set(value); this.clearFieldError('bankAccountNumber', Boolean(value.trim())); }
  setRows(collection: RowCollection, rows: readonly EditableRow[]): void {
    const normalized = this.normalizeRows(collection, rows);
    (this[collection] as unknown as { set(value: readonly EditableRow[]): void }).set(normalized);
    this.clearTableErrors(collection, normalized);
  }
  addCoOwner(): void {
    if (this.coOwners().length >= 5 && this.coOwnerEditorVisible()) return;
    this.editingCoOwnerIndex.set(null);
    this.coOwnerStaff.set('');
    this.coOwnerFormError.set('');
    this.coOwnerModalOpen.set(true);
  }
  editCoOwner(index: number): void {
    const row = this.coOwners()[index];
    if (!row) return;
    this.editingCoOwnerIndex.set(index);
    this.coOwnerStaff.set(String(row['name'] ?? ''));
    this.coOwnerFormError.set('');
    this.coOwnerModalOpen.set(true);
  }
  closeCoOwnerModal(): void { this.coOwnerModalOpen.set(false); this.coOwnerFormError.set(''); this.editingCoOwnerIndex.set(null); }
  confirmAddCoOwner(): void {
    const person = this.selectedCoOwner();
    if (!person) { this.coOwnerFormError.set('Staff Name is required.'); return; }
    const record = this.row({ name: person.label, email: person.email, role: person.role });
    const editingIndex = this.editingCoOwnerIndex();
    if (editingIndex !== null) {
      this.coOwners.update((rows) => rows.map((row, index) => index === editingIndex ? { ...row, name: record['name'], email: record['email'], role: record['role'] } : row));
      this.closeCoOwnerModal();
      return;
    }
    if (this.coOwners().length >= 5 && this.coOwnerEditorVisible()) return;
    if (!this.coOwnerEditorVisible()) {
      this.coOwners.set([record]);
      this.coOwnerEditorVisible.set(true);
    } else {
      this.coOwners.update((rows) => [...rows, record]);
    }
    this.closeCoOwnerModal();
  }
  removeCoOwner(index: number): void {
    if (this.coOwners().length <= 1) {
      this.coOwners.set([]);
      this.coOwnerEditorVisible.set(false);
      return;
    }
    this.removeRow('coOwners', index);
  }
  addRow(collection: RowCollection): void {
    const target = this[collection] as unknown as { update(fn: (rows: readonly EditableRow[]) => readonly EditableRow[]): void };
    const defaults: Record<RowCollection, EditableRow> = { coOwners: { name: '', email: '', role: '' }, schedule: { date: '', start: '', end: '', location: '' }, organizers: { name: '', email: '', role: '', notes: '' }, importantPeople: { name: '', type: '', organization: '', designation: '' }, guests: { guestType: '', count: 0, notes: '' }, agenda: { time: '', activity: '', location: '', pic: '', notes: '' }, discussions: { topic: '' } };
    target.update((rows) => [...rows, this.row(defaults[collection])]);
  }
  removeRow(collection: RowCollection, index: number): void {
    const target = this[collection] as unknown as { update(fn: (rows: readonly EditableRow[]) => readonly EditableRow[]): void };
    target.update((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }
  proposalColumns(columns: readonly EditableTableColumn[]): readonly ProposalTableColumn[] {
    return columns.map((column) => ({ key: column.key, label: column.label, width: column.width ?? '12rem' }));
  }
  // Resolves each Logistics row's option id (stored as the OPTION ID, e.g. "logistics:3", not
  // the image URL — see saveRequestRow()) to its imageDataUrl, added as a synthetic itemImageUrl
  // field the read-only table's imageKey="item" input reads via `${imageKey}ImageUrl`. Keeps
  // ProposalTableComponent dumb/presentational — it never sees the option catalog.
  logisticsRowsWithImages(): readonly EditableRow[] {
    return this.requestRows().logistics.map((row) => {
      const option = this.optionService.find(this.requestOptionCatalog(), row['item']);
      return option?.kind === 'logistics' && option.imageDataUrl ? { ...row, itemImageUrl: option.imageDataUrl } : row;
    });
  }
  tableRows(collection: TableEditorCollection): readonly EditableRow[] {
    return (this[collection] as unknown as () => readonly EditableRow[])();
  }
  tableColumns(collection: TableEditorCollection): readonly EditableTableColumn[] {
    return ({ schedule: this.scheduleColumns, organizers: this.organizerColumns, importantPeople: this.importantColumns, guests: this.guestColumns, agenda: this.agendaColumns, discussions: this.discussionColumns })[collection];
  }
  tableEditorColumns(): readonly EditableTableColumn[] { const collection = this.tableEditorCollection(); return collection ? this.tableColumns(collection) : []; }
  tableTitle(collection: TableEditorCollection): string {
    return ({ schedule: 'Event Schedule', organizers: 'Organizer / PIC', importantPeople: 'Important People', guests: 'General Guest / Pax', agenda: 'Brief Agenda', discussions: 'Discussion Topics' })[collection];
  }
  isTableAtLimit(collection: TableEditorCollection): boolean { return this.tableRows(collection).length >= 20; }
  openTableEditor(collection: TableEditorCollection): void { this.tableEditorCollection.set(collection); this.tableEditingIndex.set(null); this.tableDraft.set({}); this.tableModalOpen.set(true); }
  editTableRow(collection: TableEditorCollection, index: number): void { this.tableEditorCollection.set(collection); this.tableEditingIndex.set(index); this.tableDraft.set({ ...this.tableRows(collection)[index] }); this.tableModalOpen.set(true); }
  closeTableModal(): void { this.tableModalOpen.set(false); this.tableEditorCollection.set(null); this.tableEditingIndex.set(null); this.tableDraft.set({}); }
  tableModalTitle(): string { const collection = this.tableEditorCollection(); return collection ? `Add ${this.tableTitle(collection)} row` : 'Add table row'; }
  tableDraftValue(key: string): string | number { return this.tableDraft()[key] ?? ''; }
  tableFieldType(column: EditableTableColumn): FormControlType { return column.type === 'select' || column.type === 'staff' || column.type === 'readonly' ? 'text' : column.type; }
  tableFieldOptions(column: EditableTableColumn): readonly SelectOption[] { return column.options ?? (column.parentKey && column.dependentOptions ? column.dependentOptions[String(this.tableDraft()[column.parentKey])] ?? [] : []); }
  setTableDraftValue(key: string, value: string): void {
    const collection = this.tableEditorCollection();
    const column = collection ? this.tableColumns(collection).find((item) => item.key === key) : undefined;
    const draft: Record<string, string | number> = { ...this.tableDraft(), [key]: column?.type === 'number' ? (value === '' ? '' : Number(value)) : value };
    if (column?.type === 'staff') {
      const person = this.tableStaffOptions(column).find((item) => item.value === value);
      if (person) { draft['name'] = person.label; draft['email'] = person.email; draft['role'] = person.role; }
    }
    this.tableDraft.set(draft);
  }
  tableFieldMin(column: EditableTableColumn): string { return column.type === 'date' && this.tableEditorCollection() === 'schedule' ? this.todayIso() : String(column.min ?? ''); }
  // Staff options for a `staff`-type table column, excluding anyone already picked in another row
  // of the same collection (e.g. Organizer / PIC) — the row currently being edited is exempted so
  // its own existing selection still appears. Mirrors coOwnerStaffOptions' dedupe logic.
  tableStaffOptions(column: EditableTableColumn): readonly StaffOption[] {
    const collection = this.tableEditorCollection();
    if (!collection || column.type !== 'staff') return this.staff();
    const editingIndex = this.tableEditingIndex();
    const takenEmails = new Set(
      this.tableRows(collection)
        .filter((_, index) => index !== editingIndex)
        .map((row) => String(row['email'] ?? '').trim().toLowerCase())
        .filter(Boolean)
    );
    return this.staff().filter((person) => !takenEmails.has(person.email.trim().toLowerCase()));
  }
  tableFieldError(column: EditableTableColumn): string {
    const collection = this.tableEditorCollection();
    const raw = this.tableDraft()[column.key];
    if (raw === '' || raw === undefined || raw === null) return '';
    if (collection === 'schedule') {
      if (column.key === 'date' && this.isPastDate(String(raw))) return 'Date cannot be in the past.';
      if (column.key === 'end' && !this.isTimeAfter(String(this.tableDraft()['start'] ?? ''), String(raw))) return 'End Time must be after Start Time.';
      if (column.key === 'location' && String(raw).trim().length < 2) return 'Location must be at least 2 characters.';
    }
    return '';
  }
  // Non-blocking hint (not a tableFieldError) — a long session is allowed, just flagged since
  // it also drives the Brief Agenda requirement on step 4 (see agendaReasons()).
  tableLongSessionWarning(): string {
    if (this.tableEditorCollection() !== 'schedule') return '';
    const draft = this.tableDraft();
    return this.durationMinutes(String(draft['start'] ?? ''), String(draft['end'] ?? '')) > 120
      ? 'This session is longer than two hours — a Brief Agenda will be required on step 4.'
      : '';
  }
  tableFormValid(): boolean {
    const collection = this.tableEditorCollection();
    return !!collection
      && this.tableColumns(collection).filter((column) => column.required).every((column) => String(this.tableDraft()[column.key] ?? '').trim() !== '')
      && this.tableColumns(collection).every((column) => !this.tableFieldError(column));
  }
  saveTableRow(): void {
    const collection = this.tableEditorCollection();
    if (!collection || !this.tableFormValid()) return;
    const draft = this.row({ ...this.tableDraft() });
    const editingIndex = this.tableEditingIndex();
    const rows = this.tableRows(collection);
    if (editingIndex === null && rows.length >= 20) return;
    this.setRows(collection, editingIndex === null ? [...rows, draft] : rows.map((row, index) => index === editingIndex ? { ...draft, id: row['id'] } : row));
    this.closeTableModal();
  }
  setRequestRows(key: RequirementKey, rows: readonly EditableRow[]): void {
    this.requestRows.update((current) => ({ ...current, [key]: rows }));
    this.clearTableErrors(`request.${key}`, rows);
  }
  openRequestEditor(definition: RequestDefinition): void {
    this.requestModalDefinition.set(definition);
    this.requestEditingIndex.set(null);
    this.requestDraft.set(this.requestScheduleDefaults(definition.key));
    this.requestModalOpen.set(true);
    this.logisticsPickerExpanded.set(false);
    if (definition.key === 'logistics') this.scheduleLogisticsAvailabilityCheck();
  }
  editRequestRow(definition: RequestDefinition, index: number): void {
    const row = this.requestRows()[definition.key][index];
    this.requestModalDefinition.set(definition); this.requestEditingIndex.set(index); this.requestDraft.set({ ...row }); this.requestModalOpen.set(true);
    this.logisticsPickerExpanded.set(false);
    definition.columns.forEach((column) => {
      const kind = this.optionKindForField(definition.key, column.key);
      const value = String(row[column.key] ?? '');
      if (!kind || !value || this.optionService.find(this.requestOptionCatalog(), value)) return;
      this.requestOptionSubscription.add(this.optionService.getById(value).subscribe({ next: (option) => this.requestOptionCatalog.update((options) => options.some((item) => item.id === option.id) ? options : [...options, option]), error: () => undefined }));
    });
    if (definition.key === 'logistics') this.scheduleLogisticsAvailabilityCheck();
  }
  closeRequestModal(): void {
    this.requestOptionsLoading.set(false);
    this.requestModalOpen.set(false);
    this.requestModalDefinition.set(null);
    this.requestEditingIndex.set(null);
    this.requestDraft.set({});
    this.logisticsPickerExpanded.set(false);
    this.resetLogisticsAvailability();
  }
  toggleLogisticsPicker(): void { this.logisticsPickerExpanded.update((value) => !value); }
  selectLogisticsItem(value: string): void {
    this.setRequestDraftValue('item', value);
    this.logisticsPickerExpanded.set(false);
  }
  logisticsSelectedOption(): OptionPickerItem | null {
    const value = String(this.requestDraft()['item'] ?? '');
    if (!value) return null;
    return this.logisticsPickerOptions().find((option) => option.id === value) ?? null;
  }
  requestModalTitle(): string { const definition = this.requestModalDefinition(); return definition ? `Add ${definition.label} request` : 'Add request'; }
  requestDraftValue(key: string): string | number { return this.requestDraft()[key] ?? ''; }
  setRequestDraftValue(key: string, value: string): void {
    const definition = this.requestModalDefinition();
    const column = definition?.columns.find((item) => item.key === key);
    const draft: Record<string, string | number> = { ...this.requestDraft(), [key]: column?.type === 'number' ? (value === '' ? '' : Number(value)) : value };
    if (definition?.key === 'fundingPurchase' && key === 'mainItem') {
      const selectedMain = this.optionService.find(this.requestOptionCatalog(), value);
      const parentId = selectedMain?.kind === 'fundingMain' ? selectedMain.id : value;
      const allowed = this.requestOptionCatalog().filter((item) => item.kind === 'fundingSub' && item.active && item.parentId === parentId);
      const selectedSub = this.optionService.find(this.requestOptionCatalog(), draft['subItem']);
      if (!allowed.some((item) => item.id === selectedSub?.id)) draft['subItem'] = '';
      this.requestOptionsLoading.set(true);
      if (this.requestOptionsTimer) clearTimeout(this.requestOptionsTimer);
      this.requestOptionsTimer = setTimeout(() => this.requestOptionsLoading.set(false), 160);
    }
    this.requestDraft.set(draft);
    if (definition?.key === 'logistics' && ['date', 'start', 'end', 'item', 'quantity'].includes(key)) this.scheduleLogisticsAvailabilityCheck();
  }
  requestFieldType(column: EditableTableColumn): FormControlType { return column.type === 'select' || column.type === 'staff' || column.type === 'readonly' ? 'text' : column.type; }
  requestFieldOptions(column: EditableTableColumn): readonly SelectOption[] {
    const definition = this.requestModalDefinition();
    const kind = definition ? this.optionKindForField(definition.key, column.key) : null;
    if (!kind) return column.options ?? [];
    let options = this.requestOptionCatalog().filter((option) => option.kind === kind && option.active);
    if (kind === 'fundingSub') {
      const selectedMain = this.optionService.find(this.requestOptionCatalog(), this.requestDraft()['mainItem']);
      options = options.filter((option) => option.kind === 'fundingSub' && option.parentId === selectedMain?.id);
    }
    const selected = this.optionService.find(this.requestOptionCatalog(), this.requestDraft()[column.key]);
    if (selected?.kind === kind && !options.some((option) => option.id === selected.id)) options = [...options, selected];
    return this.optionService.toSelectOptions(options);
  }
  requestFieldDisabled(column: EditableTableColumn): boolean { return !!column.parentKey && !String(this.requestDraft()[column.parentKey] ?? '').trim(); }
  requestFieldLoading(column: EditableTableColumn): boolean {
    const definition = this.requestModalDefinition();
    return (!!definition && !!this.optionKindForField(definition.key, column.key) && this.requestCatalogLoading())
      || (column.key === 'subItem' && definition?.key === 'fundingPurchase' && this.requestOptionsLoading());
  }
  requestFieldPlaceholder(column: EditableTableColumn): string { return this.requestFieldDisabled(column) ? 'Select a main item first' : 'Select an option'; }
  requestFieldMin(column: EditableTableColumn): string {
    if (column.type !== 'date') return String(column.min ?? '');
    const window = this.scheduleDateWindow();
    return window ? window.min : this.todayIso();
  }
  requestFieldError(column: EditableTableColumn): string {
    const definition = this.requestModalDefinition();
    const raw = this.requestDraft()[column.key];
    if (raw === '' || raw === undefined || raw === null) return '';
    const value = Number(raw);
    if (definition?.key === 'transportation' && column.key === 'requestedPax') {
      if (!Number.isInteger(value) || value <= 0) return 'Requested Pax must be a positive whole number.';
      if (this.totalPax() > 0 && value > this.totalPax()) return `Requested Pax cannot exceed Total Expected Pax (${this.totalPax()}).`;
    }
    if (definition?.key === 'fundingPurchase' && column.key === 'subItem') {
      const mainItem = this.optionService.find(this.requestOptionCatalog(), this.requestDraft()['mainItem']);
      if (!this.requestFieldOptions(column).some((item) => item.value === String(raw))) return `Sub-item must belong to ${mainItem?.label || 'the selected main item'}.`;
    }
    if (column.type === 'date' && this.isPastDate(String(raw))) return 'Date cannot be in the past.';
    if (column.type === 'date') {
      const window = this.scheduleDateWindow();
      if (window && (String(raw) < window.min || String(raw) > window.max)) {
        return `Date must be between ${window.min} and ${window.max} (up to 2 days before the event for preparation).`;
      }
    }
    if (column.key === 'end' && !this.isTimeAfter(String(this.requestDraft()['start'] ?? ''), String(raw))) return 'End Time must be after Start Time.';
    if (column.type === 'number' && (!Number.isFinite(value) || value <= 0)) return `${column.label} must be greater than 0.`;
    if (column.type === 'text' && !column.readOnly && String(raw).trim() === '') return `${column.label} cannot be blank.`;
    return '';
  }
  logisticsAvailableQuantity(): number | null {
    if (this.requestModalDefinition()?.key !== 'logistics') return null;
    const option = this.optionService.find(this.requestOptionCatalog(), this.requestDraft()['item']);
    return option?.kind === 'logistics' ? option.availableQuantity : null;
  }
  logisticsRequestedQuantity(): number { return Number(this.requestDraft()['quantity'] ?? 0) || 0; }
  logisticsQuantityUnit(): string {
    const option = this.optionService.find(this.requestOptionCatalog(), this.requestDraft()['item']);
    return option?.kind === 'logistics' ? option.quantityUnit : '';
  }
  logisticsExceedsAvailability(): boolean { const available = this.logisticsAvailableQuantity(); return available !== null && this.logisticsRequestedQuantity() > available; }
  // Dynamic, window-aware remaining quantity from the availability endpoint — falls back to the
  // static availableQuantity total (and thus to logisticsExceedsAvailability()'s behavior) when
  // the check hasn't completed yet or the network call failed, so the form never blocks on it.
  logisticsRemainingQuantity(): number | null {
    const availability = this.logisticsAvailability();
    return availability ? availability.remainingQuantity : null;
  }
  logisticsExceedsRemaining(): boolean {
    const remaining = this.logisticsRemainingQuantity();
    if (remaining === null) return this.logisticsExceedsAvailability();
    return this.logisticsRequestedQuantity() > remaining;
  }
  logisticsNextAvailableMessage(): string {
    const availability = this.logisticsAvailability();
    if (!availability || !this.logisticsExceedsRemaining()) return '';
    const unit = this.logisticsQuantityUnit();
    const unitSuffix = this.logisticsRequestedQuantity() === 1 ? '' : 's';
    if (availability.nextAvailableAt) {
      return `Only ${availability.remainingQuantity} ${unit}${availability.remainingQuantity === 1 ? '' : 's'} available for this window. ${this.logisticsRequestedQuantity()} ${unit}${unitSuffix} will be available from ${availability.nextAvailableAt} onward.`;
    }
    return `Only ${availability.remainingQuantity} ${unit}${availability.remainingQuantity === 1 ? '' : 's'} available for this window — not enough frees up for ${this.logisticsRequestedQuantity()} ${unit}${unitSuffix} on this date.`;
  }
  private logisticsPickerContext(option: RequestOption): string {
    return option.kind === 'logistics' ? `${option.availableQuantity} ${option.quantityUnit}${option.availableQuantity === 1 ? '' : 's'} available` : '';
  }
  logisticsPickerOptions(): readonly OptionPickerItem[] {
    return this.requestOptionCatalog()
      .filter((option): option is Extract<RequestOption, { kind: 'logistics' }> => option.kind === 'logistics' && option.active)
      .map((option) => ({ id: option.id, label: option.label, description: option.description, imageDataUrl: option.imageDataUrl, imageFileName: option.imageFileName, contextText: this.logisticsPickerContext(option) }));
  }
  private resetLogisticsAvailability(): void {
    if (this.logisticsAvailabilityTimer) clearTimeout(this.logisticsAvailabilityTimer);
    this.logisticsAvailabilitySubscription?.unsubscribe();
    this.logisticsAvailability.set(null);
    this.logisticsAvailabilityLoading.set(false);
    this.logisticsAvailabilityError.set(false);
  }
  private scheduleLogisticsAvailabilityCheck(): void {
    if (this.logisticsAvailabilityTimer) clearTimeout(this.logisticsAvailabilityTimer);
    this.logisticsAvailabilityTimer = setTimeout(() => this.runLogisticsAvailabilityCheck(), 350);
  }
  private runLogisticsAvailabilityCheck(): void {
    const draft = this.requestDraft();
    const date = String(draft['date'] ?? '');
    const start = String(draft['start'] ?? '');
    const end = String(draft['end'] ?? '');
    const option = this.optionService.find(this.requestOptionCatalog(), draft['item']);
    if (!date || !start || !end || option?.kind !== 'logistics') { this.logisticsAvailability.set(null); return; }
    const numericId = option.id.split(':')[1];
    const quantity = this.logisticsRequestedQuantity();
    const token = ++this.logisticsAvailabilityRequestToken;
    this.logisticsAvailabilitySubscription?.unsubscribe();
    this.logisticsAvailabilityLoading.set(true);
    this.logisticsAvailabilityError.set(false);
    this.logisticsAvailabilitySubscription = this.availabilityService.check(numericId, date, start, end, quantity || undefined).subscribe({
      next: (result) => { if (token !== this.logisticsAvailabilityRequestToken) return; this.logisticsAvailability.set(result); this.logisticsAvailabilityLoading.set(false); },
      error: () => { if (token !== this.logisticsAvailabilityRequestToken) return; this.logisticsAvailability.set(null); this.logisticsAvailabilityLoading.set(false); this.logisticsAvailabilityError.set(true); },
    });
  }
  transportationCapacity(): number | null {
    if (this.requestModalDefinition()?.key !== 'transportation') return null;
    const option = this.optionService.find(this.requestOptionCatalog(), this.requestDraft()['type']);
    return option?.kind === 'transportation' ? option.passengerCapacity : null;
  }
  requestOptionContext(column: EditableTableColumn): string {
    const definition = this.requestModalDefinition();
    if (!definition) return '';
    const kind = this.optionKindForField(definition.key, column.key);
    const option = kind ? this.optionService.find(this.requestOptionCatalog(), this.requestDraft()[column.key]) : undefined;
    if (!option || option.kind === 'logistics' || option.kind === 'transportation' || option.kind === 'fundingMain' || option.kind === 'fundingSub') return '';
    switch (option.kind) {
      case 'photoVideo': return option.description ?? '';
      case 'soundLight': return option.setupRequirements ?? option.description ?? '';
      case 'fmb': return option.orderingNotes ?? '';
      case 'dietaryInformation': case 'servingUnit': return option.description ?? '';
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum group size: ${option.maximumGroupSize}` : '', option.meetingInstructions].filter(Boolean).join(' · ');
      case 'campusTourType': return option.description ?? '';
      case 'waterNormal': return [`${option.bottleCount || 'Custom'} bottles`, `${option.availableStock} in stock`, option.brandingRequirement, option.orderingInstructions].filter(Boolean).join(' · ');
    }
  }
  requestFormValid(): boolean {
    const definition = this.requestModalDefinition();
    return !!definition
      && definition.columns.filter((column) => column.required).every((column) => String(this.requestDraft()[column.key] ?? '').trim() !== '')
      && definition.columns.every((column) => !this.requestFieldError(column))
      && !this.requestCatalogLoading()
      && !this.requestOptionsLoading();
  }
  saveRequestRow(): void {
    const definition = this.requestModalDefinition();
    if (!definition || !this.requestFormValid()) return;
    const rows = this.requestRows()[definition.key];
    const draft = this.row({ ...this.requestDraft() });
    const editingIndex = this.requestEditingIndex();
    if (editingIndex === null && rows.length >= 20) return;
    this.requestRows.update((current) => ({ ...current, [definition.key]: editingIndex === null ? [...current[definition.key], draft] : current[definition.key].map((row, index) => index === editingIndex ? { ...draft, id: row['id'] } : row) }));
    this.setRequestRows(definition.key, this.requestRows()[definition.key]);
    this.closeRequestModal();
  }
  removeRequestRow(key: RequirementKey, index: number): void { this.requestRows.update((current) => ({ ...current, [key]: current[key].filter((_, rowIndex) => rowIndex !== index) })); }
  requestError(key: RequirementKey): string { return this.error(`request.${key}`); }
  toggleRequirement(key: RequirementKey, checked: boolean): void {
    this.selectedRequirements.update((current) => checked ? (current.includes(key) ? current : [...current, key]) : current.filter((item) => item !== key));
    if (this.selectedRequirements().length) this.clearFieldError('requirements', true, 2);
    else if (this.requirementsTouched()) this.setRequirementsError();
  }
  leaveRequirements(event: FocusEvent): void {
    const section = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && section.contains(event.relatedTarget)) return;
    this.requirementsTouched.set(true);
    if (!this.selectedRequirements().length) this.setRequirementsError();
  }

  goToStep(index: number): void {
    const nextStep = Math.max(0, Math.min(this.steps.length - 1, index));
    if (nextStep !== this.currentStep()) this.validateStep(this.currentStep(), false);
    this.currentStep.set(nextStep);
    this.visitedSteps.update((visited) => visited.includes(this.currentStep()) ? visited : [...visited, this.currentStep()]);
    this.scrollToTop();
  }
  next(): void { this.goToStep(this.currentStep() + 1); }
  previous(): void { this.goToStep(this.currentStep() - 1); }
  goToMissingField(event: { step: number; field: MissingFieldItem }): void {
    const stepIndex = event.step - 1;
    this.currentStep.set(stepIndex);
    this.visitedSteps.update((visited) => visited.includes(stepIndex) ? visited : [...visited, stepIndex]);
    const view = this.document.defaultView;
    view?.requestAnimationFrame(() => view.requestAnimationFrame(() => {
      if (event.field.table) { this.navigateToTableError(event.field); return; }
      const compact = view.matchMedia?.('(max-width: 48rem)').matches ?? false;
      const target = event.field.target ? this.document.getElementById(`${event.field.target}${compact ? '-mobile' : ''}`) ?? this.document.getElementById(event.field.target) : null;
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('proposal-field-target');
      const focusable = target.matches('input, textarea, select, button') ? target as HTMLElement : target.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]');
      focusable?.focus({ preventScroll: true });
      view.setTimeout(() => target.classList.remove('proposal-field-target'), 1800);
    }));
  }
  saveDraft(): void {
    this.savingDraft.set(true);
    const payload = { ...this.buildSubmissionPayload(), draftRequestId: this.draftRequestId() ?? undefined };
    this.workflow.saveDraft(payload).pipe(finalize(() => this.savingDraft.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (record) => { this.draftRequestId.set(record.id); this.status.set('Draft saved'); this.showToast('Draft saved', 'Continue it any time from Drafts.'); },
      error: (err) => this.showError('The draft could not be saved', err, 'Please try again.'),
    });
  }

  toggleCommentsPanel(): void { this.commentsPanelOpen.update((open) => !open); }

  // "Save" for a proposal a reviewer sent back — persists every edited field without submitting
  // it back into the workflow: the proposal stays in the applicant's Inbox at
  // resumption_required, and the reviewer's comment is left in place so it's still visible next
  // time this form is opened. Distinct from saveDraft(), which targets brand-new/'Draft' status
  // proposals and would fail server-side on a resubmission_required one.
  saveEdits(): void {
    const proposalId = this.resubmitProposalId();
    if (proposalId === null) return;
    this.savingDraft.set(true);
    this.workflow.saveEdits(proposalId, this.buildSubmissionPayload()).pipe(finalize(() => this.savingDraft.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.showToast('Changes saved', 'This proposal stays in your Inbox until you resubmit it.'),
      error: (err) => this.showError('Your changes could not be saved', err, 'Please try again.'),
    });
  }
  openPreview(): void { this.previewOpen.set(true); }
  closePreview(): void { this.previewOpen.set(false); }
  closeValidationModal(): void {
    this.validationModalOpen.set(false);
    this.validationGuidanceVisible.set(true);
    this.validationGuidanceVersion.update((version) => version + 1);
    if (this.validationGuidanceTimer) clearTimeout(this.validationGuidanceTimer);
    this.validationGuidanceTimer = setTimeout(() => this.validationGuidanceVisible.set(false), 6000);
  }
  reviewValidation(): void {
    this.closeValidationModal();
    queueMicrotask(() => this.focusFirstInvalid());
  }
  private buildSubmissionPayload(): Record<string, unknown> {
    return {
      applicantEmail: this.email(),
      applicantDepartment: this.department(),
      eventTitle: this.eventTitle(),
      shortIntroduction: this.shortIntro(),
      goals: this.goals(),
      benefits: this.benefits(),
      totalPax: this.totalPax(),
      eventVisibility: this.eventVisibility(),
      eventFormat: this.eventFormat(),
      registrationMode: this.registrationMode(),
      publicity: this.publicity(),
      costAmount: this.cost(),
      bankAccountName: this.bankAccountName().trim() || null,
      bankAccountNumber: this.bankAccountNumber().trim() || null,
      eventImage: this.eventImage(),
      eventCategories: this.eventCategories(),
      selectedRequirements: this.selectedRequirements(),
      scheduleRows: this.schedule(),
      coOwners: this.coOwners(),
      organizers: this.organizers(),
      importantPeople: this.importantPeople(),
      guests: this.guests(),
      agenda: this.agenda(),
      discussions: this.discussions(),
      requestRows: this.requestRows(),
    };
  }

  // Step 1 of submitting: validate every step, then ask for confirmation. submit() itself only
  // runs once the applicant confirms in the dialog (system specification §8B).
  submit(): void {
    this.submitAttempted.set(true);
    const stepValidity = this.steps.map((_, index) => this.validateStep(index, false));
    const invalidStep = stepValidity.findIndex((valid) => !valid);
    if (invalidStep >= 0) {
      this.currentStep.set(invalidStep);
      this.previewOpen.set(false);
      this.validationGuidanceVisible.set(false);
      this.scrollToTop();
      this.validationModalOpen.set(true);
      return;
    }
    this.submitConfirmOpen.set(true);
  }

  confirmSubmit(): void {
    this.submitConfirmOpen.set(false);
    this.performSubmit();
  }

  private performSubmit(): void {
    const proposalId = this.resubmitProposalId();
    if (proposalId !== null) {
      this.resubmitting.set(true);
      this.workflow.resubmitFromApplicant(proposalId, this.buildSubmissionPayload()).pipe(finalize(() => this.resubmitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.status.set('Submitted'); this.previewOpen.set(false); this.reviewerComments.set([]);
          this.showToast('Proposal resubmitted', 'It resumes at whichever stage sent it back to you.');
          void this.router.navigateByUrl('/app/ongoing/proposals');
        },
        error: (err) => this.showError('The proposal could not be resubmitted', err, 'Please try again.'),
      });
      return;
    }
    this.resubmitting.set(true);
    const payload = { ...this.buildSubmissionPayload(), draftRequestId: this.draftRequestId() ?? undefined };
    this.workflow.create(payload).pipe(finalize(() => this.resubmitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.status.set('Submitted'); this.previewOpen.set(false);
        this.showToast('Proposal submitted', 'You can follow its progress under Ongoing.');
        void this.router.navigateByUrl('/app/ongoing/proposals');
      },
      error: (err) => this.showError('The proposal could not be submitted', err, 'Please try again.'),
    });
  }

  private validateStep(step: number, focus = true): boolean {
    this.checkedSteps.update((checked) => checked.includes(step) ? checked : [...checked, step]);
    const next = { ...this.errors() } as Record<string, string>;
    Object.keys(next).filter((key) => key.startsWith(`${step}.`)).forEach((key) => delete next[key]);
    const add = (key: string, message: string): void => { next[`${step}.${key}`] = message; };
    if (step === 0) {
      if (!this.applicantName().trim()) add('applicantName', 'Applicant Name is required.');
      if (!this.department()) add('department', 'School / Department is required.');
      if (!/^\S+@\S+\.\S+$/.test(this.email())) add('email', 'Email must be a valid email address.');
      if (!this.coOwners().some((row) => row['name'] && row['email'])) add('coOwners', 'Co-requesters / Co-owners is required.');
    }
    if (step === 1) {
      if (!this.eventTitle().trim()) add('eventTitle', 'Event Title is required.');
      this.validateRows(next, step, 'schedule', this.schedule(), ['date', 'start', 'end', 'location']);
      this.validateRows(next, step, 'organizers', this.organizers(), ['name', 'email', 'role']);
      this.validateNonNegative(next, step, 'guests', this.guests(), ['count']);
    }
    if (step === 2 && !this.selectedRequirements().length) add('requirements', 'Select at least one department or requirement.');
    if (step === 3) this.selectedDefinitions().forEach((definition) => {
      const required = definition.columns.filter((column) => column.required).map((column) => column.key);
      this.validateRows(next, step, `request.${definition.key}`, this.requestRows()[definition.key], required);
      this.validateNonNegative(next, step, `request.${definition.key}`, this.requestRows()[definition.key], definition.columns.filter((column) => column.type === 'number').map((column) => column.key));
      this.validateRequestSpecific(next, step, definition.key, this.requestRows()[definition.key]);
    });
    if (step === 4) {
      if (!this.eventCategories().length) add('eventCategories', 'Select at least one event category.');
      if (this.eventCategories().length > 2) add('eventCategories', 'Select no more than two event categories.');
      if (!this.eventVisibility()) add('eventVisibility', 'Event Visibility is required.');
      if (!this.shortIntro().trim()) add('shortIntro', 'Short Introduction is required.');
      if (!this.goals().trim()) add('goals', 'Goals & Objectives is required.');
      if (!this.benefits().trim()) add('benefits', 'Expected Benefits is required.');
      if (this.isPublic() && !this.publicity().trim()) add('publicity', 'Promotion / Publicity Method is required.');
      if (this.cost() !== null && this.cost()! < 0) add('cost', 'Cost must be zero or greater.');
      if (this.requiresPayment()) {
        if (!this.bankAccountName().trim()) add('bankAccountName', 'Bank Account Name is required.');
        if (!this.bankAccountNumber().trim()) add('bankAccountNumber', 'Bank Account Number is required.');
      }
      if (this.agendaRequired()) this.validateRows(next, step, 'agenda', this.agenda(), ['time', 'activity', 'location', 'pic']);
      if (this.discussionRequired()) this.validateRows(next, step, 'discussions', this.discussions(), ['topic']);
    }
    this.errors.set(next);
    const valid = !Object.keys(next).some((key) => key.startsWith(`${step}.`));
    if (!valid && focus) queueMicrotask(() => this.focusFirstInvalid());
    return valid;
  }
  private validateRows(errors: Record<string, string>, step: number, table: string, rows: readonly EditableRow[], keys: readonly string[]): void {
    const populated = rows.filter((row) => this.rowHasValue(row, keys));
    if (!populated.length) { errors[`${step}.${table}`] = 'Complete at least one row.'; return; }
    rows.forEach((row, index) => { if (this.rowHasAnyValue(row) && keys.some((key) => !String(row[key] ?? '').trim())) keys.forEach((key) => { if (!String(row[key] ?? '').trim()) errors[`${step}.${table}.${index}.${key}`] = `${this.tableColumnLabel(table, key)} is required.`; }); });
  }
  private validateNonNegative(errors: Record<string, string>, step: number, table: string, rows: readonly EditableRow[], keys: readonly string[]): void { rows.forEach((row, index) => keys.forEach((key) => { if (Number(row[key]) < 0) errors[`${step}.${table}.${index}.${key}`] = `${this.tableColumnLabel(table, key)} must be zero or greater.`; })); }
  private validateRequestSpecific(errors: Record<string, string>, step: number, key: RequirementKey, rows: readonly EditableRow[]): void {
    if (key === 'transportation') rows.forEach((row, index) => {
      const value = Number(row['requestedPax']);
      if (!Number.isInteger(value) || value <= 0) errors[`${step}.request.${key}.${index}.requestedPax`] = 'Requested Pax must be a positive whole number.';
      else if (this.totalPax() > 0 && value > this.totalPax()) errors[`${step}.request.${key}.${index}.requestedPax`] = `Requested Pax cannot exceed Total Expected Pax (${this.totalPax()}).`;
    });
    // Final-submit safety net against the option's static total, since the dynamic
    // window-aware remaining figure (logisticsRemainingQuantity()) only exists live for
    // whichever row is currently open in the modal — requestFieldError() blocks that case
    // before a row can even be added/saved. This catches the simpler "impossible regardless of
    // timing" case for rows already in the table.
    if (key === 'logistics') rows.forEach((row, index) => {
      const option = this.optionService.find(this.requestOptionCatalog(), row['item']);
      const quantity = Number(row['quantity']);
      if (option?.kind === 'logistics' && quantity > option.availableQuantity) {
        errors[`${step}.request.${key}.${index}.quantity`] = `Requested quantity exceeds the ${option.availableQuantity} ${option.quantityUnit}${option.availableQuantity === 1 ? '' : 's'} available in total.`;
      }
    });
    if (key === 'fundingPurchase') rows.forEach((row, index) => {
      const option = this.optionService.find(this.requestOptionCatalog(), row['subItem']);
      const main = this.optionService.find(this.requestOptionCatalog(), row['mainItem']);
      if (option?.kind !== 'fundingSub' || !main || option.parentId !== main.id) errors[`${step}.request.${key}.${index}.subItem`] = 'Sub-item must belong to the selected Main Item.';
    });
  }
  private clearFieldError(key: string, valid: boolean, step = this.currentStep()): void {
    if (!valid) return;
    const errorKey = `${step}.${key}`;
    this.errors.update((errors) => {
      if (!(errorKey in errors)) return errors;
      const next = { ...errors };
      delete next[errorKey];
      return next;
    });
  }
  private setRequirementsError(): void {
    this.errors.update((errors) => ({ ...errors, '2.requirements': 'Select at least one department or requirement.' }));
  }
  private clearTableErrors(table: string, rows: readonly EditableRow[]): void {
    const prefix = `${this.currentStep()}.${table}`;
    this.errors.update((errors) => {
      const next = { ...errors };
      Object.keys(next).filter((key) => key === prefix || key.startsWith(`${prefix}.`)).forEach((key) => {
        if (key === prefix) {
          if (rows.some((row) => this.rowHasAnyValue(row))) delete next[key];
          return;
        }
        const parts = key.slice(prefix.length + 1).split('.');
        const row = rows[Number(parts[0])];
        const field = parts[1];
        if (!row || !field) return;
        const value = String(row[field] ?? '').trim();
        if (value && !(/zero or greater/i.test(next[key]) && Number(row[field]) < 0)) delete next[key];
      });
      return next;
    });
  }
  private tableColumnLabel(table: string, key: string): string {
    const requestKey = table.startsWith('request.') ? table.slice('request.'.length) as RequirementKey : null;
    const requestDefinition = requestKey ? this.requirements.find((item) => item.key === requestKey) : undefined;
    const columns = requestDefinition?.columns ?? ({ coOwners: this.coOwnerColumns, schedule: this.scheduleColumns, organizers: this.organizerColumns, guests: this.guestColumns, agenda: this.agendaColumns, discussions: this.discussionColumns } as Record<string, readonly EditableTableColumn[]>)[table];
    return columns?.find((column) => column.key === key)?.label ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
  }
  private row(values: EditableRow): EditableRow { return { id: this.nextRowId++, ...values }; }
  private requestScheduleDefaults(key: RequirementKey): EditableRow {
    if (key === 'fundingPurchase') return {};
    const first = this.schedule()[0];
    if (!first) return {};
    return {
      date: first['date'] ?? '',
      start: first['start'] ?? '',
      end: first['end'] ?? '',
      location: first['location'] ?? '',
    };
  }
  private normalizeRows(_collection: RowCollection, rows: readonly EditableRow[]): readonly EditableRow[] { return rows; }
  private nonNegative(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
  private rowHasValue(row: EditableRow, keys: readonly string[]): boolean { return keys.some((key) => String(row[key] ?? '').trim() !== '' && row[key] !== 0); }
  private rowHasAnyValue(row: EditableRow): boolean { return Object.entries(row).some(([key, value]) => key !== 'id' && String(value ?? '').trim() !== '' && value !== 0); }
  private completedRows(rows: readonly EditableRow[], keys: readonly string[]): readonly EditableRow[] { return rows.filter((row) => keys.every((key) => String(row[key] ?? '').trim())); }
  private durationMinutes(start: string, end: string): number { if (!start || !end) return 0; const toMinutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; }; let result = toMinutes(end) - toMinutes(start); if (result < 0) result += 1440; return result; }
  private todayIso(): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
  private isPastDate(date: string): boolean { return !!date && date < this.todayIso(); }
  private isTimeAfter(start: string, end: string): boolean { return !start || !end || end > start; }
  // Earliest/latest dates across the Event Schedule rows — request items (logistics, food,
  // transportation, etc.) are allowed from up to 2 days before the first session, for setup/prep,
  // through the last session's date.
  private scheduleDateWindow(): { min: string; max: string } | null {
    const dates = this.completedRows(this.schedule(), ['date']).map((row) => String(row['date'])).sort();
    if (!dates.length) return null;
    const earliest = new Date(dates[0]);
    earliest.setDate(earliest.getDate() - 2);
    const min = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
    return { min, max: dates[dates.length - 1] };
  }
  private currency(value: number): string { return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(value); }
  private focusFirstInvalid(): void { (this.document.querySelector('[aria-invalid="true"], .is-invalid, .shared-editable-table--invalid button') as HTMLElement | null)?.focus(); }
  private navigateToTableError(field: MissingFieldItem): void {
    const table = field.table;
    const view = this.document.defaultView;
    if (!table || !view) return;
    const target = this.document.getElementById(table.id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('proposal-field-target');
    view.setTimeout(() => target.classList.remove('proposal-field-target'), 1800);
    if (table.rowIndex === undefined) {
      (this.document.getElementById(`${table.id}-add`) ?? target).focus({ preventScroll: true });
      return;
    }
    const affectedRow = this.document.getElementById(`${table.id}-row-${table.rowIndex}`);
    affectedRow?.classList.add('proposal-field-target');
    if (affectedRow) view.setTimeout(() => affectedRow.classList.remove('proposal-field-target'), 1800);
    if (table.requestKey) {
      const definition = this.requirements.find((item) => item.key === table.requestKey);
      if (definition) this.editRequestRow(definition, table.rowIndex);
    } else if (table.collection === 'coOwners') {
      this.editCoOwner(table.rowIndex);
    } else {
      this.editTableRow(table.collection as TableEditorCollection, table.rowIndex);
    }
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => {
      const prefix = table.requestKey ? 'request-editor' : table.collection === 'coOwners' ? 'co-owner' : 'table-editor';
      const fieldId = table.collection === 'coOwners' ? 'co-owner-staff' : `${prefix}-${table.fieldKey ?? ''}`;
      const fieldTarget = this.document.getElementById(fieldId);
      fieldTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fieldTarget?.classList.add('proposal-field-target');
      const focusable = fieldTarget?.matches('input, textarea, select, button') ? fieldTarget as HTMLElement : fieldTarget?.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]');
      focusable?.focus({ preventScroll: true });
      if (fieldTarget) view.setTimeout(() => fieldTarget.classList.remove('proposal-field-target'), 1800);
    }));
  }
  private scrollToTop(): void { this.document.defaultView?.scrollTo({ top: 0, behavior: 'smooth' }); }
  // Every action feedback goes through the one shared ToastService (system specification §8C) —
  // this page used to render its own bespoke toast div with different styling and timing.
  private showToast(title: string, message?: string): void { this.toastService.success(title, message); }
  private showError(title: string, error: unknown, fallback: string): void { this.toastService.error(title, apiErrorMessage(error, fallback)); }
  ngOnDestroy(): void {
    if (this.validationGuidanceTimer) clearTimeout(this.validationGuidanceTimer);
    if (this.requestOptionsTimer) clearTimeout(this.requestOptionsTimer);
    if (this.logisticsAvailabilityTimer) clearTimeout(this.logisticsAvailabilityTimer);
    this.logisticsAvailabilitySubscription?.unsubscribe();
    this.requestOptionSubscription.unsubscribe();
  }
  private missingField(key: string, fallback: string): MissingFieldItem {
    const labels: Record<string, string> = { applicantName: 'Applicant Name', department: 'School / Department', email: 'Email', coOwners: 'Co-requesters', eventTitle: 'Event Title', schedule: 'Event Schedule', organizers: 'Organizer / PIC', requirements: 'Required for Event', shortIntro: 'Short Introduction', goals: 'Goals & Objectives', benefits: 'Expected Benefits', publicity: 'Promotion / Publicity Method', agenda: 'Brief Agenda', discussions: 'Discussion Topics', bankAccountName: 'Bank Account Name', bankAccountNumber: 'Bank Account Number' };
    const parts = key.split('.');
    const root = parts[0];
    const requestDefinition = root === 'request' ? this.requirements.find((item) => item.key === parts[1]) : undefined;
    const tableIdMap: Record<string, string> = { coOwners: 'co-owners', importantPeople: 'important-people' };
    const tableId = root === 'request' ? `request-${parts[1] ?? ''}` : tableIdMap[root] ?? root;
    const rowIndex = root === 'request' ? parts[2] : parts[1];
    const columnKey = root === 'request' ? parts[3] : parts[2];
    const tableColumns: Record<string, readonly EditableTableColumn[]> = { coOwners: this.coOwnerColumns, schedule: this.scheduleColumns, organizers: this.organizerColumns, guests: this.guestColumns, agenda: this.agendaColumns, discussions: this.discussionColumns };
    const column = (requestDefinition?.columns ?? tableColumns[root] ?? []).find((item) => item.key === columnKey);
    const tableLabel = labels[root] ?? requestDefinition?.label ?? fallback;
    const directTargetMap: Record<string, string> = { applicantName: 'applicant-name', department: 'department', email: 'applicant-email', eventTitle: 'event-title', requirements: 'requirements-selection', shortIntro: 'short-intro', goals: 'goals', benefits: 'benefits', publicity: 'publicity', bankAccountName: 'event-bank-account-name', bankAccountNumber: 'event-bank-account-number' };
    const isTable = root === 'request' || root === 'coOwners' || root in tableColumns;
    const parsedRowIndex = rowIndex !== undefined && /^\d+$/.test(rowIndex) ? Number(rowIndex) : undefined;
    return {
      label: column ? `${tableLabel} — Row ${(parsedRowIndex ?? 0) + 1}: ${column.label}` : tableLabel,
      target: isTable ? tableId : directTargetMap[root] ?? tableId,
      table: isTable ? { id: tableId, collection: root, requestKey: requestDefinition?.key, rowIndex: parsedRowIndex, fieldKey: columnKey } : undefined,
    };
  }
  private uniqueMissingFields(fields: readonly MissingFieldItem[]): readonly MissingFieldItem[] {
    return fields.filter((field, index) => fields.findIndex((candidate) => candidate.label === field.label && candidate.target === field.target && candidate.table?.rowIndex === field.table?.rowIndex && candidate.table?.fieldKey === field.table?.fieldKey) === index);
  }

  // A 'half' column only looks right when it has another 'half' beside it in the 2-column
  // request-editor grid — a 'half' that lands alone on its row (an odd-length run, or a 'full'
  // column resets pairing) would otherwise leave dead space next to it, so promote it to 'full'.
  // A single left-to-right scan: consecutive 'half' columns pair up two at a time; any 'full'
  // column resets pairing for the run that follows it.
  private fillDanglingHalves(columns: readonly EditableTableColumn[]): readonly EditableTableColumn[] {
    const result: EditableTableColumn[] = [];
    let pending: EditableTableColumn | null = null;
    for (const column of columns) {
      if (column.span !== 'half') {
        if (pending) { result.push({ ...pending, span: 'full' }); pending = null; }
        result.push(column);
        continue;
      }
      if (pending) { result.push(pending, column); pending = null; } else { pending = column; }
    }
    if (pending) result.push({ ...pending, span: 'full' });
    return result;
  }
  private buildRequirementDefinitions(): readonly RequestDefinition[] {
    const date = { key: 'date', label: 'Date', type: 'date', required: true, span: 'half' } as const;
    const start = { key: 'start', label: 'Start Time', type: 'time', required: true, span: 'half' } as const;
    const end = { key: 'end', label: 'End Time', type: 'time', required: true, span: 'half' } as const;
    const location = { key: 'location', label: 'Location', type: 'text', required: true, span: 'full' } as const;
    const notes = { key: 'notes', label: 'Notes', type: 'text', span: 'full' } as const;
    const definitions: readonly RequestDefinition[] = [
      // Required scheduling/quantity fields first (paired 2-up), then the Item / Need picker
      // as its own full-width card (rendered specially, see event-proposal.html), then Notes.
      {
        key: 'logistics', label: 'Logistics', columns: [
          { ...date }, { ...start },
          { ...end }, { key: 'quantity', label: 'Requested Quantity', type: 'number', min: 0, step: 1, required: true, span: 'half' },
          { ...location },
          { key: 'item', label: 'Item / Need', type: 'select', required: true, options: this.activeSelectOptions('logistics'), span: 'full' },
          { ...notes },
        ],
      },
      // Type first (what), then Requested Pax (how many), then Date/Moving Time (when) paired,
      // then Pickup/Drop-off (where) paired, then Notes.
      {
        key: 'transportation', label: 'Transportation', columns: [
          { key: 'type', label: 'Transportation Type', type: 'select', required: true, options: this.activeSelectOptions('transportation'), span: 'full' },
          { key: 'requestedPax', label: 'Requested Pax', type: 'number', min: 1, step: 1, required: true, span: 'full' },
          { ...date }, { key: 'start', label: 'Moving Time', type: 'time', required: true, span: 'half' },
          { key: 'pickup', label: 'Pickup Point', type: 'text', required: true, span: 'half' }, { key: 'dropoff', label: 'Drop-off Point', type: 'text', required: true, span: 'half' },
          { ...notes },
        ],
      },
      { key: 'photoVideo', label: 'Photographer / Videographer', columns: [{ key: 'service', label: 'Service', type: 'select', required: true, options: this.activeSelectOptions('photoVideo'), span: 'full' }, { ...date }, { ...start }, { ...end }, { ...location, span: 'half' }, { ...notes }] },
      { key: 'soundLight', label: 'Sound & Light', columns: [{ key: 'item', label: 'Item / Service', type: 'select', required: true, options: this.activeSelectOptions('soundLight'), span: 'full' }, { ...date }, { ...start }, { ...end }, { ...location, span: 'half' }, { ...notes }] },
      { key: 'fmb', label: 'Food Request', columns: [{ key: 'foodType', label: 'Food Type', type: 'select', required: true, options: this.activeSelectOptions('fmb'), span: 'full' }, { key: 'quantity', label: 'Pax / Quantity', type: 'number', min: 0, required: true, span: 'half' }, { ...date }, { key: 'start', label: 'Serve Time', type: 'time', required: true, span: 'half' }, { ...location }, { ...notes }] },
      // Starting Point + Type of Tour (both "what/where") paired, then Date/Pax paired, then Notes.
      {
        key: 'campusTour', label: 'Campus Tour', columns: [
          { key: 'startPoint', label: 'Starting Point', type: 'select', required: true, options: this.activeSelectOptions('campusTourStart'), span: 'half' },
          { key: 'tourType', label: 'Type of Tour', type: 'select', required: true, options: this.activeSelectOptions('campusTourType'), span: 'half' },
          { ...date }, { key: 'pax', label: 'Pax', type: 'number', min: 0, required: true, span: 'half' },
          { ...notes },
        ],
      },
      { key: 'waterNormal', label: 'Mineral Water', columns: [{ key: 'quantity', label: 'Quantity', type: 'select', required: true, options: this.activeSelectOptions('waterNormal'), span: 'half' }, { key: 'withLogo', label: 'With Logo?', type: 'select', required: true, options: options('No', 'Yes'), span: 'half' }, { ...date }, { ...start }, { ...end }, { ...location, span: 'half' }, { ...notes }] },
      { key: 'fundingPurchase', label: 'Funding / Purchase Requirement', columns: [{ key: 'mainItem', label: 'Main Item', type: 'select', required: true, options: this.activeSelectOptions('fundingMain'), span: 'half' }, { key: 'subItem', label: 'Sub-item', type: 'select', required: true, parentKey: 'mainItem', span: 'half' }, { key: 'quantity', label: 'Quantity', type: 'number', min: 0, required: true, span: 'half' }, { key: 'unit', label: 'Unit RM', type: 'number', min: 0, step: 0.01, required: true, span: 'half' }, { ...notes }] },
    ];
    return definitions.map((definition) => ({ ...definition, columns: this.fillDanglingHalves(definition.columns) }));
  }
  private activeSelectOptions(kind: RequestOptionKind): readonly SelectOption[] { return this.optionService.toSelectOptions(this.requestOptionCatalog().filter((option) => option.kind === kind && option.active)); }
  private requestOptionLabel(id: string): string { return this.requestOptionCatalog().find((option) => option.id === id)?.label ?? id; }
  private optionKindForField(key: RequirementKey, columnKey: string): RequestOptionKind | null {
    if (key === 'logistics' && columnKey === 'item') return 'logistics';
    if (key === 'transportation' && columnKey === 'type') return 'transportation';
    if (key === 'photoVideo' && columnKey === 'service') return 'photoVideo';
    if (key === 'soundLight' && columnKey === 'item') return 'soundLight';
    if (key === 'fmb' && columnKey === 'foodType') return 'fmb';
    if (key === 'campusTour' && columnKey === 'startPoint') return 'campusTourStart';
    if (key === 'campusTour' && columnKey === 'tourType') return 'campusTourType';
    if (key === 'waterNormal' && columnKey === 'quantity') return 'waterNormal';
    if (key === 'fundingPurchase' && columnKey === 'mainItem') return 'fundingMain';
    if (key === 'fundingPurchase' && columnKey === 'subItem') return 'fundingSub';
    return null;
  }
}
