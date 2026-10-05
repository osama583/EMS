// The rows-per-page choices, for every paginated list in the app.
export const PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 15, 25];

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
  // Opt-in: renders the badge as a real button (hover/focus states, primary-color on hover) and emits
  // cellClick instead of just being static text.
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
  // Tints the whole row (and its mobile card) instead of one cell — for a state that describes the
  // record rather than any single column, e.g. a proposal whose event is days away. Colour alone is
  // never the only signal: the row that sets this must still say why in one of its cells.
  readonly rowTone?: InternalCellTone;
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
