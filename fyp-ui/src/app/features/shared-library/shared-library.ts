import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PAGE_SIZE_OPTIONS,
  InternalDataRecord,
  InternalFilterConfig,
  InternalPageHeaderConfig,
  InternalRowActionEvent,
  InternalSearchConfig,
} from '../../shared/components/internal-data-page/internal-data-page.models';
import {
  InternalDataTableComponent,
  InternalFilterControlsComponent,
  InternalMobileRecordListComponent,
  InternalPageHeaderComponent,
  InternalPageStateComponent,
  InternalPaginationComponent,
  InternalResetButtonComponent,
  InternalSearchFieldComponent,
} from '../../shared/components/internal-data-page/internal-data-page-parts';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { SiteHeaderComponent } from '../../shared/components/site-header/site-header';
import { DataTableComponent } from '../../shared/components/data-table/data-table';
import { FormFieldComponent } from '../../shared/components/form-controls/form-field';
import { SearchableDropdownComponent } from '../../shared/components/searchable-dropdown/searchable-dropdown';
import { StepIndicatorComponent, StepStatus } from '../../shared/components/step-indicator/step-indicator';
import { FormModalComponent } from '../../shared/components/form-modal/form-modal';
import { ProposalTableComponent, ProposalTableColumn } from '../../shared/components/proposal-table/proposal-table';
import { CharacterCounterComponent } from '../../shared/components/character-counter/character-counter';
import { RowCounterComponent } from '../../shared/components/row-counter/row-counter';
import { UserAvatarComponent } from '../../shared/components/user-avatar/user-avatar';
import { EventImageUploadComponent } from '../../shared/components/event-image-upload/event-image-upload';
import { EditableRow, EditableTableColumn, SelectOption } from '../../shared/components/form-controls/form-controls.models';

type LibraryCategory =
  | 'Typography'
  | 'Page headers'
  | 'Buttons'
  | 'Inputs and selects'
  | 'Search and filter controls'
  | 'Containers'
  | 'Tables'
  | 'Status badges'
  | 'Pagination'
  | 'Empty and loading states'
  | 'Sidebar elements'
  | 'Icons'
  | 'Mobile patterns'
  | 'Site chrome'
  | 'Forms'
  | 'Authentication';

interface LibraryEntry {
  readonly key: string;
  readonly name: string;
  readonly category: LibraryCategory;
  readonly purpose: string;
  readonly selector: string;
  readonly usage: string;
  readonly states: readonly string[];
  readonly responsive: string;
}

@Component({
  selector: 'app-shared-library',
  imports: [
    InternalPageHeaderComponent,
    InternalSearchFieldComponent,
    InternalFilterControlsComponent,
    InternalResetButtonComponent,
    InternalDataTableComponent,
    InternalPaginationComponent,
    InternalPageStateComponent,
    InternalMobileRecordListComponent,
    SiteHeaderComponent,
    SiteFooterComponent,
    FormFieldComponent,
    SearchableDropdownComponent,
    DataTableComponent,
    StepIndicatorComponent,
    FormModalComponent,
    ProposalTableComponent,
    CharacterCounterComponent,
    RowCounterComponent,
    UserAvatarComponent,
    EventImageUploadComponent,
  ],
  templateUrl: './shared-library.html',
  styleUrl: './shared-library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedLibraryComponent {
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly query = signal('');
  readonly category = signal('All');
  readonly demoSearch = signal('');
  readonly demoStatus = signal('All');
  readonly demoCategory = signal('All');
  readonly demoPage = signal(2);
  readonly showLoading = signal(false);
  readonly modalDemoOpen = signal(false);
  readonly proposalRows = signal<readonly Record<string, string | number>[]>([
    { id: 1, name: 'Aisha Rahman', email: 'aisha.rahman@apu.edu.my', role: 'Senior Lecturer' },
    { id: 2, name: 'Daniel Lee', email: 'daniel.lee@apu.edu.my', role: 'Programme Leader' },
  ]);
  readonly proposalColumns: readonly ProposalTableColumn[] = [
    { key: 'name', label: 'Staff Name', width: '34%' }, { key: 'email', label: 'Email', width: '34%' }, { key: 'role', label: 'Role' },
  ];

  readonly categories: readonly string[] = [
    'All',
    'Typography',
    'Page headers',
    'Buttons',
    'Inputs and selects',
    'Search and filter controls',
    'Containers',
    'Tables',
    'Status badges',
    'Pagination',
    'Empty and loading states',
    'Sidebar elements',
    'Icons',
    'Mobile patterns',
    'Site chrome',
    'Forms',
    'Authentication',
  ];

  readonly entries: readonly LibraryEntry[] = [
    {
      key: 'event-image-upload', name: 'Event image upload', category: 'Forms',
      purpose: 'Validates, previews, replaces and removes the proposal-owned image asset through an API-ready upload contract.',
      selector: 'app-event-image-upload / .event-image-upload',
      usage: '<app-event-image-upload [value]="eventImage()" (valueChange)="eventImage.set($event)" />',
      states: ['Empty', 'Preparing', 'Preview', 'Invalid file', 'Image selected'], responsive: 'Stacks its image preview and actions on phone screens.',
    },
    {
      key: 'user-avatar', name: 'User avatar', category: 'Icons',
      purpose: 'Responsive user image with an APU-styled default profile placeholder when no image is available.',
      selector: 'app-user-avatar / .shared-user-avatar',
      usage: '<app-user-avatar [name]="user.displayName" [imageUrl]="user.photoUrl" />',
      states: ['Profile image', 'Default placeholder'], responsive: 'Uses a configurable CSS size and never stretches its image.',
    },
    {
      key: 'authentication', name: 'Authentication state', category: 'Authentication',
      purpose: 'Central persisted user session with development mock-provider support and logout handling.',
      selector: 'AuthService / AuthUser / UserRole',
      usage: 'auth.login(email, password); auth.user(); auth.logout();',
      states: ['Signed out', 'Authenticating', 'Authenticated', 'Invalid credentials'], responsive: 'Authentication state is independent of viewport and shared by all application layouts.',
    },
    {
      key: 'role-navigation', name: 'Role navigation and access', category: 'Authentication',
      purpose: 'Single role-to-navigation configuration shared by the sidebar and protected-route guards.',
      selector: 'ROLE_NAVIGATION / roleCanAccess',
      usage: 'ROLE_NAVIGATION[user.role]; roleCanAccess(user.role, targetUrl);',
      states: ['Role default route', 'Allowed route', 'Unauthorized redirect', 'Expandable folder'], responsive: 'The same configuration feeds desktop navigation and the mobile drawer.',
    },
    {
      key: 'form-field', name: 'Form field', category: 'Forms',
      purpose: 'Reusable labelled text, email, number, date, time, select, and textarea control with validation feedback.',
      selector: 'app-form-field / .shared-form-field',
      usage: '<app-form-field controlId="title" label="Event title" [required]="true" [value]="title" />',
      states: ['Default', 'Filled', 'Hover', 'Focus', 'Read-only', 'Disabled', 'Invalid'], responsive: 'Fields occupy their configured grid column and stack cleanly on mobile.',
    },
    {
      key: 'validation-message', name: 'Validation message', category: 'Forms',
      purpose: 'Shared required-field feedback with a warning icon, accessible alert semantics, and field-specific copy.',
      selector: 'app-validation-message / .shared-validation-message',
      usage: '<app-validation-message controlId="title" message="Event Title is required." />',
      states: ['Hidden', 'Required', 'Invalid', 'Focused field'], responsive: 'Keeps compact spacing and readable icon/text alignment on mobile.',
    },
    {
      key: 'character-counter', name: 'Character counter', category: 'Forms',
      purpose: 'Live, shared length feedback for limited text inputs and textareas.',
      selector: 'app-character-counter / .shared-character-counter',
      usage: '<app-character-counter [value]="value" [maxLength]="100" />',
      states: ['Default', 'Approaching limit', 'At limit'], responsive: 'Remains compact and right-aligned below every compatible text field.',
    },
    {
      key: 'row-counter', name: 'Table row counter', category: 'Tables',
      purpose: 'Consistent live count and maximum row limit beneath proposal tables.',
      selector: 'app-row-counter / .shared-row-counter',
      usage: '<app-row-counter [count]="3" [maximum]="20" />',
      states: ['Empty', 'Populated', 'Maximum reached'], responsive: 'Stays left-aligned below the table on all viewports.',
    },
    {
      key: 'step-indicator', name: 'Step indicator', category: 'Forms',
      purpose: 'Responsive wizard navigation with active, complete, warning, and submission-error states.',
      selector: 'app-step-indicator / .step-indicator',
      usage: '<app-step-indicator [steps]="steps" [stepStatuses]="statuses" [currentStep]="2" />',
      states: ['Pending', 'Current', 'Complete', 'Warning', 'Error'], responsive: 'Labels collapse while step icons and connectors remain usable on compact screens.',
    },
    {
      key: 'form-modal', name: 'Shared form modal', category: 'Forms',
      purpose: 'Reusable modal shell with projected form content, configurable actions, loading, disabled, and close states.',
      selector: 'app-form-modal / .shared-form-modal',
      usage: '<app-form-modal title="Add item" [open]="open" (submit)="save()"><form>...</form></app-form-modal>',
      states: ['Open', 'Closed', 'Disabled submit', 'Loading', 'Cancel', 'Escape'], responsive: 'The modal becomes a bottom-sheet style dialog with stacked content on phones.',
    },
    {
      key: 'searchable-dropdown', name: 'Searchable dropdown', category: 'Forms',
      purpose: 'One searchable selector for single or multiple values, chips, clearing, loading, and validation.',
      selector: 'app-searchable-dropdown / .searchable-dropdown',
      usage: '<app-searchable-dropdown [options]="options" [isMulti]="true" [value]="selected" />',
      states: ['Single', 'Multiple', 'Open', 'Selected chips', 'Loading', 'Empty', 'Disabled', 'Invalid'], responsive: 'Dropdown panel remains anchored to the full-width trigger on small screens.',
    },
    {
      key: 'editable-table', name: 'Configurable data table', category: 'Forms',
      purpose: 'Configuration-driven editable rows, staff autofill, dependent options, calculations, actions, and cell validation.',
      selector: 'app-data-table / .shared-editable-table',
      usage: '<app-data-table [columns]="columns" [rows]="rows" (rowsChange)="rows = $event" />',
      states: ['Default', 'Invalid cell', 'Maximum rows', 'Read-only cell', 'Calculated footer'], responsive: 'Automatically switches from a table to editable row cards below 768px.',
    },
    {
      key: 'proposal-table', name: 'Proposal table', category: 'Tables',
      purpose: 'Read-only proposal rows with initials avatars, alternating surfaces, and edit/delete actions.',
      selector: 'app-proposal-table / .proposal-table',
      usage: '<app-proposal-table [columns]="columns" [rows]="rows" (edit)="edit($event)" (deleteRow)="remove($event)" />',
      states: ['Default', 'Row hover', 'Edit action', 'Delete action', 'Empty', 'Loading'], responsive: 'Keeps its readable minimum width and provides keyboard-accessible horizontal scrolling on compact screens.',
    },
    {
      key: 'typography', name: 'Typography tokens and section title', category: 'Typography',
      purpose: 'Shared heading, body, label, weight, and section-title treatment.',
      selector: '.section-title, --type-*, --weight-*',
      usage: '<p class="section-title">Section label</p>\n<h2>Section heading</h2>',
      states: ['Hero', 'Section', 'Card', 'Body', 'Label'], responsive: 'Token sizes scale with clamp() and shared breakpoints.',
    },
    {
      key: 'page-header', name: 'Internal page header', category: 'Page headers',
      purpose: 'Displays a routed page title, description, and optional count label.',
      selector: 'app-internal-page-header / .shared-page-header',
      usage: '<app-internal-page-header [config]="headerConfig" />',
      states: ['Default', 'With count'], responsive: 'Title row compresses and aligns to the top on mobile.',
    },
    {
      key: 'buttons', name: 'Internal action buttons', category: 'Buttons',
      purpose: 'Primary, secondary, icon, and reset actions using shared tokens.',
      selector: '.table-control, .table-control--primary, app-internal-reset-button',
      usage: '<button class="table-control table-control--primary">Primary</button>',
      states: ['Default', 'Hover', 'Focus', 'Pressed', 'Disabled'], responsive: 'Touch targets remain at least 44px on compact screens.',
    },
    {
      key: 'inputs', name: 'Shared inputs and selects', category: 'Inputs and selects',
      purpose: 'Pill-shaped form controls with consistent border and focus treatments.',
      selector: '.internal-table-workspace__controls input, select',
      usage: '<label><span>Label</span><select>...</select></label>',
      states: ['Default', 'Hover', 'Focus', 'Disabled'], responsive: 'Controls expand to available width when their group wraps.',
    },
    {
      key: 'search', name: 'Internal search field', category: 'Search and filter controls',
      purpose: 'Dynamic search input with icon, hover feedback, and focus expansion.',
      selector: 'app-internal-search-field / .shared-search-field',
      usage: '<app-internal-search-field [config]="searchConfig" [value]="query" />',
      states: ['Default', 'Hover', 'Focus', 'Populated'], responsive: 'Uses full available width on mobile.',
    },
    {
      key: 'filters', name: 'Filter controls and reset', category: 'Search and filter controls',
      purpose: 'Configurable select filters paired with a shared reset action.',
      selector: 'app-internal-filter-controls, app-internal-reset-button',
      usage: '<app-internal-filter-controls [filters]="filters" />\n<app-internal-reset-button />',
      states: ['Default', 'Selected', 'Focused', 'Reset'], responsive: 'Filters remain a compact row and wrap safely when needed.',
    },
    {
      key: 'containers', name: 'Internal workspace containers', category: 'Containers',
      purpose: 'Glass controls surface and rounded white content container.',
      selector: '.internal-table-workspace__controls, .internal-table-workspace__table-card',
      usage: '<section class="internal-table-workspace__controls">...</section>',
      states: ['Controls surface', 'Table surface'], responsive: 'Padding and radius reduce at the mobile breakpoint.',
    },
    {
      key: 'table', name: 'Configurable data table', category: 'Tables',
      purpose: 'Renders configured columns, cells, statuses, and row actions.',
      selector: 'app-internal-data-table / .shared-data-table',
      usage: '<app-internal-data-table [columns]="columns" [records]="records" [actions]="actions" />',
      states: ['Default', 'Emphasized row', 'Row hover', 'Actions'], responsive: 'Replaced by the shared mobile record list below 768px.',
    },
    {
      key: 'badges', name: 'Status badges', category: 'Status badges',
      purpose: 'Consistent pill badges for neutral, active, successful, warning, and danger states.',
      selector: '.shared-data-cell__badge[data-tone]',
      usage: '<span class="shared-data-cell__badge" data-tone="success">Approved</span>',
      states: ['Neutral', 'Blue', 'Success', 'Warning', 'Danger'], responsive: 'Badge sizing remains compact across breakpoints.',
    },
    {
      key: 'pagination', name: 'Pagination and rows per page', category: 'Pagination',
      purpose: 'Reusable page navigation, ellipsis handling, and page-size selector.',
      selector: 'app-internal-pagination / .workspace-pagination',
      usage: '<app-internal-pagination [totalPages]="12" [page]="2" />',
      states: ['Previous', 'Current', 'Next', 'Ellipsis', 'Disabled'], responsive: 'Mobile shows only Previous, current page, Next, and row count.',
    },
    {
      key: 'states', name: 'Empty and loading states', category: 'Empty and loading states',
      purpose: 'Standard feedback for no results and asynchronous loading.',
      selector: 'app-internal-page-state / .shared-page-state',
      usage: '<app-internal-page-state [loading]="isLoading" />',
      states: ['Empty', 'Loading'], responsive: 'Maintains readable spacing without fixed desktop widths.',
    },
    {
      key: 'sidebar', name: 'Sidebar navigation item', category: 'Sidebar elements',
      purpose: 'Shared navigation row, icon slot, selected circle, and label behavior.',
      selector: '.internal-nav__item, .internal-nav__icon, .internal-nav__item--active',
      usage: '<a class="internal-nav__item internal-nav__item--active">...</a>',
      states: ['Default', 'Hover', 'Selected', 'Collapsed'], responsive: 'The internal layout converts the sidebar into an overlay drawer.',
    },
    {
      key: 'icons', name: 'Material Symbols icon system', category: 'Icons',
      purpose: 'Consistent rounded interface icons used throughout public and internal pages.',
      selector: '.material-symbols-rounded',
      usage: '<span class="material-symbols-rounded" aria-hidden="true">search</span>',
      states: ['16px', '20px', '24px', 'Action icon'], responsive: 'Icons inherit colour and remain vector-sharp at every size.',
    },
    {
      key: 'mobile', name: 'Mobile record cards', category: 'Mobile patterns',
      purpose: 'Compact, tappable alternative to wide internal tables.',
      selector: 'app-internal-mobile-record-list / .shared-mobile-card',
      usage: '<app-internal-mobile-record-list [records]="records" [actions]="actions" />',
      states: ['Read', 'Unread', 'Overflow menu', 'Full-card action'], responsive: 'Designed for phone widths and hidden on desktop data pages.',
    },
    {
      key: 'site-header', name: 'Public site header', category: 'Site chrome',
      purpose: 'Responsive APU logo, section navigation, mobile menu, and request action.',
      selector: 'app-site-header / .site-header',
      usage: '<app-site-header />',
      states: ['Transparent', 'Scrolled', 'Mobile menu'], responsive: 'Switches to the existing mobile navigation at 1024px.',
    },
    {
      key: 'site-footer', name: 'Public site footer', category: 'Site chrome',
      purpose: 'Official awards, social links, navigation groups, and legal information.',
      selector: 'app-site-footer / .site-footer',
      usage: '<app-site-footer />',
      states: ['Desktop columns', 'Responsive stack'], responsive: 'Columns collapse progressively for tablets and phones.',
    },
  ];

  readonly filteredEntries = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const category = this.category();
    return this.entries.filter((entry) => {
      const matchesCategory = category === 'All' || entry.category === category;
      const haystack = `${entry.name} ${entry.category} ${entry.purpose} ${entry.selector} ${entry.usage}`.toLocaleLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
  });

  readonly headerConfig: InternalPageHeaderConfig = {
    title: 'Inbox',
    description: 'Review conversations and updates related to your event proposals.',
    countLabel: '3 unread',
  };
  readonly searchConfig: InternalSearchConfig = {
    ariaLabel: 'Search components',
    placeholder: 'Search component examples',
  };
  readonly demoFilters = computed<readonly InternalFilterConfig[]>(() => [
    {
      key: 'status', ariaLabel: 'Status', value: this.demoStatus(),
      options: [{ value: 'All', label: 'All messages' }, { value: 'Unread', label: 'Unread' }, { value: 'Read', label: 'Read' }],
    },
    {
      key: 'category', ariaLabel: 'Category', value: this.demoCategory(),
      options: [{ value: 'All', label: 'All categories' }, { value: 'Approval', label: 'Approval' }, { value: 'Revision', label: 'Revision' }],
    },
  ]);
  readonly columns = [
    { key: 'message', label: 'Message' },
    { key: 'proposal', label: 'Related Proposal' },
    { key: 'status', label: 'Status' },
    { key: 'actions', label: 'Actions', actions: true },
  ] as const;
  readonly actions = [
    { key: 'open', label: 'Open message', icon: 'visibility' },
    { key: 'reply', label: 'Reply', icon: 'reply' },
  ] as const;
  readonly records: readonly InternalDataRecord[] = [
    {
      id: 1, emphasized: true,
      cells: {
        message: { primary: 'Proposal approved', secondary: 'Your proposal moved to department review.' },
        proposal: { primary: 'APU Cultural Night', secondary: 'Approval' },
        status: { primary: 'Unread', badge: true, tone: 'blue' },
      },
      mobile: {
        eyebrow: 'Approval', status: 'Unread', title: 'Proposal approved', identity: 'School Administration', initials: 'SA', unread: true,
        details: [{ icon: 'description', text: 'APU Cultural Night' }, { icon: 'schedule', text: '31 Jul 2026, 4:18 PM' }],
      },
    },
    {
      id: 2,
      cells: {
        message: { primary: 'Venue confirmed', secondary: 'The requested venue is available.' },
        proposal: { primary: 'Future Tech Showcase', secondary: 'Department' },
        status: { primary: 'Read', badge: true, tone: 'neutral' },
      },
      mobile: {
        eyebrow: 'Department', status: 'Read', title: 'Venue confirmed', identity: 'Facilities Management', initials: 'FM',
        details: [{ icon: 'description', text: 'Future Tech Showcase' }, { icon: 'schedule', text: '30 Jul 2026, 9:16 AM' }],
      },
    },
  ];
  readonly formOptions: readonly SelectOption[] = [
    { value: 'Computing', label: 'School of Computing' },
    { value: 'Business', label: 'School of Business' },
  ];
  readonly formSelection = signal<string | readonly string[]>('Computing');
  readonly formValue = signal('APU Innovation Day');
  readonly editableColumns: readonly EditableTableColumn[] = [
    { key: 'item', label: 'Item', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0, required: true },
  ];
  readonly editableRows = signal<readonly EditableRow[]>([{ id: 1, item: 'Registration table', quantity: 2 }]);
  readonly librarySteps = [{ label: 'Applicant', icon: 'person' }, { label: 'Event Info', icon: 'event' }, { label: 'Review', icon: 'task_alt' }];
  readonly libraryStepStatuses: readonly StepStatus[] = [{ visited: true, valid: true, missingFields: [] }, { visited: true, valid: false, missingFields: [{ label: 'Event Title', target: 'library-form-title' }] }, { visited: false, valid: true, missingFields: [] }];

  updateQuery(event: Event): void { this.query.set((event.target as HTMLInputElement).value); }
  updateCategory(event: Event): void { this.category.set((event.target as HTMLSelectElement).value); }
  updateDemoFilter(change: { key: string; value: string }): void {
    if (change.key === 'status') this.demoStatus.set(change.value);
    if (change.key === 'category') this.demoCategory.set(change.value);
  }
  resetDemoFilters(): void { this.demoSearch.set(''); this.demoStatus.set('All'); this.demoCategory.set('All'); }
  handleAction(_event: InternalRowActionEvent): void {}
  handleProposalTableEdit(_index: number): void {}
  handleProposalTableDelete(index: number): void { this.proposalRows.update((rows) => rows.filter((_, rowIndex) => rowIndex !== index)); }
  addEditableRow(): void { this.editableRows.update((rows) => [...rows, { id: Date.now(), item: '', quantity: 0 }]); }
  removeEditableRow(index: number): void { this.editableRows.update((rows) => rows.length > 1 ? rows.filter((_, rowIndex) => rowIndex !== index) : rows); }
}
