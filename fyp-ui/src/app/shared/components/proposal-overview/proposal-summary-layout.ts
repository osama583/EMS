/**
 * Row packing for the reviewer's proposal summary.
 *
 * The reviewer view is a summary, so its job is to be short, and most of a proposal's fields are
 * optional - `applicant_department_or_school`, `event_format_snapshot`, `registration_approval`
 * and `promotion_publicity_method` are all nullable in 001_initial_schema.sql, and Categories is
 * deliberately cleared for non-Public events. The template used to render every one of them
 * unconditionally, so a proposal that skipped them showed a row of labelled cards with nothing
 * inside.
 *
 * Dropping the blanks is only half of it. The template also hardcoded its spans (`span="2"`,
 * `span="full"`, plus a hand-built two-up wrapper), so removing a field left a hole where it used
 * to sit. This module owns the other half, and the invariant it exists for is:
 *
 *     A ROW'S COLUMN COUNT IS ALWAYS ITS OWN LENGTH.
 *
 * The renderer sets `grid-template-columns: repeat(<row.length>, 1fr)`, so a row of one fills the
 * width, a row of two splits it in half, and a row of three splits it in thirds. There is no
 * arrangement of present and absent fields that can leave a gap, because a gap would require a
 * row to be shorter than the track count it was given, which cannot happen by construction.
 */

export type ProposalFieldVariant = 'compact' | 'prose';

export interface ProposalSummaryField {
  readonly label: string;
  /** Anything the model holds. Coerced and trimmed here; blank means the field is omitted. */
  readonly value: string | number | null | undefined;
  /** `prose` takes a row of its own - paragraphs read badly in a third of the width. */
  readonly variant?: ProposalFieldVariant;
}

export interface ProposalSummaryCell {
  readonly label: string;
  readonly value: string;
}

export type ProposalSummaryRow = readonly ProposalSummaryCell[];

/**
 * A field is blank when its value renders as nothing. Deliberately NOT falsiness: `total_pax` is
 * NOT NULL DEFAULT 0, and hiding a zero would turn "nobody is expected" into "this proposal never
 * mentions attendance", which is a different and wrong statement.
 */
function displayValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Split a run of compact fields into rows of at most `maxPerRow`, as evenly as possible.
 *
 * Greedy chunking would put seven fields in rows of 3/3/1 and strand the last one alone across a
 * full row under two dense ones. Spreading them 3/2/2 keeps the block even. Both are gap-free -
 * this is the difference between correct and tidy.
 */
function balancedRows(
  run: readonly ProposalSummaryCell[],
  maxPerRow: number,
): readonly ProposalSummaryRow[] {
  const rowCount = Math.ceil(run.length / maxPerRow);
  const base = Math.floor(run.length / rowCount);
  // The first `remainder` rows carry one extra field, which is what makes 7 into 3/2/2 and not
  // 2/2/3 - the denser rows read better at the top of a block.
  const remainder = run.length % rowCount;

  const rows: ProposalSummaryRow[] = [];
  let taken = 0;
  for (let index = 0; index < rowCount; index++) {
    const size = base + (index < remainder ? 1 : 0);
    rows.push(run.slice(taken, taken + size));
    taken += size;
  }
  return rows;
}

/**
 * Drop the blank fields, then lay the survivors out in gap-free rows, preserving declaration
 * order so the page does not rearrange itself between one proposal and the next.
 */
export function packProposalFields(
  fields: readonly ProposalSummaryField[],
  maxPerRow = 3,
): readonly ProposalSummaryRow[] {
  const rows: ProposalSummaryRow[] = [];
  let run: ProposalSummaryCell[] = [];

  const flushRun = (): void => {
    if (run.length) {
      rows.push(...balancedRows(run, maxPerRow));
      run = [];
    }
  };

  for (const field of fields) {
    const value = displayValue(field.value);
    // Checked before the variant, so an EMPTY prose field does not split the compact run around
    // it - "A, B, [absent Publicity], C" is one row of three, not two rows with a hole between.
    if (!value) continue;

    const cell: ProposalSummaryCell = { label: field.label, value };
    if (field.variant === 'prose') {
      flushRun();
      rows.push([cell]);
    } else {
      run.push(cell);
    }
  }
  flushRun();

  return rows;
}
