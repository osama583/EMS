export interface InternalPageHeaderConfig {
  readonly title: string;
  readonly description: string;
  readonly countLabel?: string;
  // Material Symbol shown before countLabel. Defaults to 'inbox' when countLabel is set, so
  // existing configs need no change to pick up the icon — pass a different icon only to override.
  readonly countIcon?: string;
  readonly primaryActionLabel?: string;
  readonly primaryActionIcon?: string;
}

export interface InternalSearchConfig {
  readonly ariaLabel: string;
  readonly placeholder: string;
}

export interface InternalFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface InternalFilterConfig {
  readonly key: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly InternalFilterOption[];
}

export interface InternalTableColumn {
  readonly key: string;
  readonly label: string;
  readonly actions?: boolean;
  readonly width?: string;
  // Opt-in: when set, the column header becomes a sort toggle. `sortKey` is what's emitted on
  // InternalSortChange (usually, but not always, the same as `key` — e.g. a display column backed
  // by a differently-named server sort field). Columns without this stay plain headers, unchanged.
  readonly sortKey?: string;
}

export type InternalSortOrder = 'asc' | 'desc';

export interface InternalSortState {
  readonly key: string;
  readonly order: InternalSortOrder;
}

export interface InternalSortChange {
  readonly key: string;
  readonly order: InternalSortOrder;
}

export type InternalCellTone = 'neutral' | 'blue' | 'success' | 'warning' | 'danger';

export interface InternalDataCell {
  readonly primary: string;
  readonly secondary?: string;
  readonly avatar?: string;
  readonly badge?: boolean;
  readonly tone?: InternalCellTone;
  // Opt-in: renders the badge as a real button (hover/focus states, primary-color on hover) and
  // emits cellClick instead of just being static text. Used by pages where a badge is itself the
  // affordance to open more detail (e.g. Page Visibility's roles badge opening the roles list)
  // rather than needing a separate row action button for the same thing.
  readonly clickable?: boolean;
  // Optional Material Symbol name shown to the left of a clickable badge's text (e.g. 'share').
  readonly badgeIcon?: string;
}

export interface InternalMobileDetail {
  readonly icon: string;
  readonly text: string;
}

export interface InternalMobileRecord {
  readonly eyebrow: string;
  readonly status: string;
  readonly title: string;
  readonly identity?: string;
  readonly initials?: string;
  readonly unread?: boolean;
  readonly details: readonly InternalMobileDetail[];
}

export interface InternalDataRecord {
  readonly id: string | number;
  readonly emphasized?: boolean;
  readonly cells: Readonly<Record<string, InternalDataCell>>;
  readonly mobile: InternalMobileRecord;
  readonly actionKeys?: readonly string[];
}

export interface InternalRowAction {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
}

export interface InternalRowActionEvent {
  readonly action: InternalRowAction;
  readonly record: InternalDataRecord;
}

export interface InternalCellClickEvent {
  readonly columnKey: string;
  readonly record: InternalDataRecord;
}

export interface InternalFilterChange {
  readonly key: string;
  readonly value: string;
}

export interface InternalDataPageConfig {
  readonly ariaLabel: string;
  readonly paginationLabel: string;
  readonly rowsPerPageLabel: string;
  readonly mobileListLabel: string;
  readonly header: InternalPageHeaderConfig;
  readonly search: InternalSearchConfig;
  readonly columns: readonly InternalTableColumn[];
  readonly actions: readonly InternalRowAction[];
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly pageSizeOptions?: readonly number[];
}
