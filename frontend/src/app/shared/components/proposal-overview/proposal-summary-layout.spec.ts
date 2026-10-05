import { describe, expect, it } from 'vitest';
import { packProposalFields } from './proposal-summary-layout';

/**
 * The reviewer's proposal view is a SUMMARY, so its job is to be short. Most of the fields on a
 * proposal are optional (`applicant_department_or_school`, `event_format_snapshot`,
 * `registration_approval`, `promotion_publicity_method` are all nullable in 001_initial_schema.sql,
 * and Categories is deliberately cleared for non-Public events), and the old template rendered
 * every one of them unconditionally - a labelled card with nothing inside it.
 *
 * Hiding them is only half the fix. The old template also hardcoded its spans (`span="2"`,
 * `span="full"`, and a hand-built two-up wrapper), so removing a field left a ragged grid with a
 * hole where it used to be. This packer is the other half: it decides the rows, and the invariant
 * it exists to guarantee is that NO combination of present and absent fields can leave a gap.
 */
describe('packProposalFields', () => {
  const compact = (label: string, value: string | number | null | undefined) => ({ label, value });
  const prose = (label: string, value: string | number | null | undefined) =>
    ({ label, value, variant: 'prose' as const });

  const labelsOf = (rows: readonly (readonly { label: string }[])[]) =>
    rows.map((row) => row.map((cell) => cell.label));

  describe('dropping empty fields', () => {
    it('omits a field whose value is an empty string', () => {
      const rows = packProposalFields([compact('Visibility', 'Public'), compact('Format', '')]);

      expect(labelsOf(rows)).toEqual([['Visibility']]);
    });

    it('omits a field whose value is only whitespace', () => {
      const rows = packProposalFields([compact('Visibility', 'Public'), compact('Format', '   ')]);

      expect(labelsOf(rows)).toEqual([['Visibility']]);
    });

    it('omits a field whose value is null or undefined', () => {
      const rows = packProposalFields([
        compact('Visibility', 'Public'),
        compact('Format', null),
        compact('Registration', undefined),
      ]);

      expect(labelsOf(rows)).toEqual([['Visibility']]);
    });

    it('returns no rows at all when every field is empty', () => {
      expect(packProposalFields([compact('Format', ''), prose('Publicity', null)])).toEqual([]);
    });

    /**
     * A real zero is a fact, not a blank. `total_pax` is NOT NULL DEFAULT 0, so hiding 0 would
     * silently turn "nobody is expected" into "this proposal doesn't mention attendance".
     */
    it('keeps a numeric zero, which is a value rather than a blank', () => {
      const rows = packProposalFields([compact('Total Pax', 0)]);

      expect(rows).toEqual([[{ label: 'Total Pax', value: '0' }]]);
    });

    it('trims the surviving value', () => {
      const rows = packProposalFields([compact('Visibility', '  Public  ')]);

      expect(rows).toEqual([[{ label: 'Visibility', value: 'Public' }]]);
    });
  });

  describe('packing rows so no gap can occur', () => {
    it('fills a row with three compact fields', () => {
      const rows = packProposalFields([
        compact('A', '1'),
        compact('B', '2'),
        compact('C', '3'),
      ]);

      expect(labelsOf(rows)).toEqual([['A', 'B', 'C']]);
    });

    it('gives a lone compact field the whole row rather than a third of it', () => {
      const rows = packProposalFields([compact('Total Pax', 240)]);

      expect(labelsOf(rows)).toEqual([['Total Pax']]);
    });

    /**
     * The balance rule. Seven fields chunked greedily would be 3/3/1, leaving one field stranded
     * across a full row while two rows above it are dense. Spreading them 3/2/2 keeps the block
     * even, and still never leaves a hole because a row's column count is always its own length.
     */
    it('balances a run rather than stranding a remainder on its own row', () => {
      const rows = packProposalFields(
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label) => compact(label, label)),
      );

      expect(labelsOf(rows)).toEqual([['A', 'B', 'C'], ['D', 'E'], ['F', 'G']]);
    });

    it('balances five compact fields into three and two', () => {
      const rows = packProposalFields(
        ['A', 'B', 'C', 'D', 'E'].map((label) => compact(label, label)),
      );

      expect(labelsOf(rows)).toEqual([['A', 'B', 'C'], ['D', 'E']]);
    });

    it('balances four compact fields into two even rows', () => {
      const rows = packProposalFields(
        ['A', 'B', 'C', 'D'].map((label) => compact(label, label)),
      );

      expect(labelsOf(rows)).toEqual([['A', 'B'], ['C', 'D']]);
    });

    it('counts only the surviving fields when balancing', () => {
      const rows = packProposalFields([
        compact('A', 'a'),
        compact('B', ''),
        compact('C', 'c'),
        compact('D', ''),
        compact('E', 'e'),
      ]);

      expect(labelsOf(rows)).toEqual([['A', 'C', 'E']]);
    });
  });

  describe('prose fields', () => {
    it('gives each prose field a row of its own', () => {
      const rows = packProposalFields([
        prose('Short Introduction', 'A three-day festival.'),
        prose('Goals & Objectives', 'Raise awareness.'),
      ]);

      expect(labelsOf(rows)).toEqual([['Short Introduction'], ['Goals & Objectives']]);
    });

    it('breaks the compact run where a prose field interrupts it', () => {
      const rows = packProposalFields([
        compact('A', 'a'),
        compact('B', 'b'),
        prose('Publicity', 'Posters and IG.'),
        compact('C', 'c'),
        compact('D', 'd'),
      ]);

      expect(labelsOf(rows)).toEqual([['A', 'B'], ['Publicity'], ['C', 'D']]);
    });

    it('rejoins the compact run when the prose field between them is empty', () => {
      const rows = packProposalFields([
        compact('A', 'a'),
        compact('B', 'b'),
        prose('Publicity', ''),
        compact('C', 'c'),
      ]);

      expect(labelsOf(rows)).toEqual([['A', 'B', 'C']]);
    });
  });

  it('preserves the order the fields were declared in', () => {
    const rows = packProposalFields([
      compact('Event Title', 'Tech Fest'),
      compact('Visibility', 'Public'),
      compact('Format', 'Physical'),
      prose('Short Introduction', 'A festival.'),
    ]);

    expect(labelsOf(rows)).toEqual([
      ['Event Title', 'Visibility', 'Format'],
      ['Short Introduction'],
    ]);
  });
});
