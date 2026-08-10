export interface InternalPageHeaderConfig {
  readonly title: string;
  readonly description: string;
  readonly countLabel?: string;
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
}

export type InternalCellTone = 'neutral' | 'blue' | 'success' | 'warning' | 'danger';

export interface InternalDataCell {
  readonly primary: string;
  readonly secondary?: string;
  readonly avatar?: string;
  readonly badge?: boolean;
  readonly tone?: InternalCellTone;
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
