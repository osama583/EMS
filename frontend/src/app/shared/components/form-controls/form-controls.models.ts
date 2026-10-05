export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export type FormControlType = 'text' | 'email' | 'password' | 'number' | 'date' | 'time' | 'datetime-local' | 'textarea';

export type EditableColumnType = FormControlType | 'select' | 'staff' | 'readonly';

export interface EditableTableColumn {
  readonly key: string;
  readonly label: string;
  readonly type: EditableColumnType;
  readonly placeholder?: string;
  readonly options?: readonly SelectOption[];
  readonly required?: boolean;
  readonly min?: number;
  readonly step?: number;
  readonly readOnly?: boolean;
  readonly parentKey?: string;
  readonly dependentOptions?: Readonly<Record<string, readonly SelectOption[]>>;
  readonly width?: string;
  // Layout hint for modal/detail forms rendered as a 2-column grid (event-proposal's request
  // editor) — 'full' spans both columns, omitted/'half' takes one. Purely a display hint, not
  // read anywhere else (table columns, validation) so it's safe to leave unset by default.
  readonly span?: 'half' | 'full';
}

export interface StaffOption extends SelectOption {
  readonly email: string;
  readonly role: string;
}

export type EditableRow = Readonly<Record<string, string | number>>;
