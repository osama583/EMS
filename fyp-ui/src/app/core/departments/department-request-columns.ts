import { EditableRow, EditableTableColumn, SelectOption } from '../../shared/components/form-controls/form-controls.models';
import { RequestOption, RequestOptionKind } from '../request-options/request-option.models';
import { RequestOptionService } from '../request-options/request-option.service';
import { DepartmentRequestKind } from './department-workflow.config';

export interface DepartmentRequestDefinition {
  readonly key: DepartmentRequestKind;
  readonly label: string;
  readonly columns: readonly EditableTableColumn[];
}

// A 'half' column only looks right when it has another 'half' beside it in a 2-column request-
// editor grid — promote a lone 'half' (an odd-length run, or right after a 'full' resets pairing)
// to 'full' so it never lands alone. Mirrors event-proposal.ts's fillDanglingHalves exactly (same
// bug class: a column definition list that's edited over time can drift out of pairs).
function fillDanglingHalves(columns: readonly EditableTableColumn[]): readonly EditableTableColumn[] {
  const result: EditableTableColumn[] = [];
  let pendingHalf: EditableTableColumn | null = null;
  for (const column of columns) {
    if (column.span !== 'half') {
      if (pendingHalf) { result.push({ ...pendingHalf, span: 'full' }); pendingHalf = null; }
      result.push(column);
      continue;
    }
    if (pendingHalf) { result.push(pendingHalf, column); pendingHalf = null; }
    else pendingHalf = column;
  }
  if (pendingHalf) result.push({ ...pendingHalf, span: 'full' });
  return result;
}

const selectOptionOf = (label: string): SelectOption => ({ value: label, label });
const selectOptionsOf = (...labels: string[]): readonly SelectOption[] => labels.map(selectOptionOf);

/**
 * One department requirement's editable-table column layout, shared by the full proposal form
 * (event-proposal.ts, step 3 — every requirement at once) and the scoped department-resubmit page
 * (department-resubmit.ts — one requirement only, after that department alone sent its task back).
 * Column shape here MUST stay in sync with the backend's per-requirement row fields (see
 * proposals.py's _write_requirement_rows/_read_requirement_rows) — this is the client's side of
 * that same contract.
 */
export function buildDepartmentRequestDefinitions(
  optionService: RequestOptionService,
  catalog: readonly RequestOption[],
): readonly DepartmentRequestDefinition[] {
  const activeSelectOptions = (kind: RequestOptionKind): readonly SelectOption[] =>
    optionService.toSelectOptions(catalog.filter((option) => option.kind === kind && option.active));

  const date = { key: 'date', label: 'Date', type: 'date', required: true, span: 'half' } as const;
  const start = { key: 'start', label: 'Start Time', type: 'time', required: true, span: 'half' } as const;
  const end = { key: 'end', label: 'End Time', type: 'time', required: true, span: 'half' } as const;
  const location = { key: 'location', label: 'Location', type: 'text', required: true, span: 'full' } as const;
  const notes = { key: 'notes', label: 'Notes', type: 'text', span: 'full' } as const;

  const definitions: readonly DepartmentRequestDefinition[] = [
    {
      key: 'logistics', label: 'Logistics', columns: [
        { ...date }, { ...start },
        { ...end }, { key: 'quantity', label: 'Requested Quantity', type: 'number', min: 0, step: 1, required: true, span: 'half' },
        { ...location },
        { key: 'item', label: 'Item / Need', type: 'select', required: true, options: activeSelectOptions('logistics'), span: 'full' },
        { ...notes },
      ],
    },
    {
      key: 'transportation', label: 'Transportation', columns: [
        { key: 'type', label: 'Transportation Type', type: 'select', required: true, options: activeSelectOptions('transportation'), span: 'full' },
        { key: 'requestedPax', label: 'Requested Pax', type: 'number', min: 1, step: 1, required: true, span: 'full' },
        { ...date }, { key: 'start', label: 'Moving Time', type: 'time', required: true, span: 'half' },
        { key: 'pickup', label: 'Pickup Point', type: 'text', required: true, span: 'half' }, { key: 'dropoff', label: 'Drop-off Point', type: 'text', required: true, span: 'half' },
        { ...notes },
      ],
    },
    { key: 'photoVideo', label: 'Photographer / Videographer', columns: [{ key: 'service', label: 'Service', type: 'select', required: true, options: activeSelectOptions('photoVideo'), span: 'full' }, { ...date }, { ...start }, { ...end }, { ...location, span: 'half' }, { ...notes }] },
    { key: 'soundLight', label: 'Sound & Light', columns: [{ key: 'item', label: 'Item / Service', type: 'select', required: true, options: activeSelectOptions('soundLight'), span: 'full' }, { ...date }, { ...start }, { ...end }, { ...location, span: 'half' }, { ...notes }] },
    { key: 'fmb', label: 'Food Request', columns: [{ key: 'foodType', label: 'Food Type', type: 'select', required: true, options: activeSelectOptions('fmb'), span: 'full' }, { key: 'quantity', label: 'Pax / Quantity', type: 'number', min: 0, required: true, span: 'half' }, { ...date }, { key: 'start', label: 'Serve Time', type: 'time', required: true, span: 'half' }, { ...location }, { ...notes }] },
    {
      key: 'campusTour', label: 'Campus Tour', columns: [
        { key: 'startPoint', label: 'Starting Point', type: 'select', required: true, options: activeSelectOptions('campusTourStart'), span: 'half' },
        { key: 'tourType', label: 'Type of Tour', type: 'select', required: true, options: activeSelectOptions('campusTourType'), span: 'half' },
        { ...date }, { key: 'pax', label: 'Pax', type: 'number', min: 0, required: true, span: 'half' },
        { ...notes },
      ],
    },
    { key: 'waterNormal', label: 'Mineral Water', columns: [{ key: 'quantity', label: 'Quantity', type: 'select', required: true, options: activeSelectOptions('waterNormal'), span: 'half' }, { key: 'withLogo', label: 'With Logo?', type: 'select', required: true, options: selectOptionsOf('No', 'Yes'), span: 'half' }, { ...date }, { ...start }, { ...end }, { ...location, span: 'half' }, { ...notes }] },
    { key: 'fundingPurchase', label: 'Funding / Purchase Requirement', columns: [{ key: 'mainItem', label: 'Main Item', type: 'select', required: true, options: activeSelectOptions('fundingMain'), span: 'half' }, { key: 'subItem', label: 'Sub-item', type: 'select', required: true, parentKey: 'mainItem', span: 'half' }, { key: 'quantity', label: 'Quantity', type: 'number', min: 0, required: true, span: 'half' }, { key: 'unit', label: 'Unit RM', type: 'number', min: 0, step: 0.01, required: true, span: 'half' }, { ...notes }] },
  ];
  return definitions.map((definition) => ({ ...definition, columns: fillDanglingHalves(definition.columns) }));
}

/** Which catalog option kind a requirement's select-type column resolves against, if any. */
export function optionKindForDepartmentField(key: DepartmentRequestKind, columnKey: string): RequestOptionKind | null {
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

/**
 * Read-only tables (proposal-table.ts's ProposalTableComponent) render `String(row[key])`
 * directly with no knowledge of the option catalog — correct for plain text/number columns, but
 * a select-type column's row value is a catalog reference id (e.g. "transportation:2", written by
 * proposals.py's _option_ref/_read_requirement_rows), not the label the applicant picked. The
 * edit modal resolves this fine because its <select> already maps id -> label via
 * fieldOptions()/toSelectOptions(), but a table row bypasses that entirely. Swap each select
 * column's id for its label before handing rows to ProposalTableComponent, so a read-only summary
 * (department-resubmit.ts's table, event-proposal.ts's non-logistics request tables) shows the
 * same text the dropdown would have shown, instead of the raw "kind:id" reference.
 */
export function resolveDepartmentRowLabels(
  key: DepartmentRequestKind,
  columns: readonly EditableTableColumn[],
  rows: readonly EditableRow[],
  catalog: readonly RequestOption[],
): readonly EditableRow[] {
  const selectColumns = columns.filter((column) => column.type === 'select' && optionKindForDepartmentField(key, column.key));
  if (!selectColumns.length) return rows;
  return rows.map((row) => {
    const resolved = { ...row };
    for (const column of selectColumns) {
      const raw = String(row[column.key] ?? '');
      const option = catalog.find((item) => item.id === raw);
      if (option) resolved[column.key] = option.label;
    }
    return resolved;
  });
}
