import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { ProposalOverviewComponent } from './proposal-overview';

/**
 * The Event Overview block is shared by the reviewer view and the department view - it used to be
 * the same markup copy-pasted into both, hardcoded spans and all. These tests pin the behaviour
 * the copies never had: an optional field the applicant left blank is not rendered, and the grid
 * closes up behind it instead of leaving the space it used to occupy.
 */
describe('ProposalOverviewComponent', () => {
  function render(overrides: Partial<ProposalReviewRecord>) {
    const fixture = TestBed.createComponent(ProposalOverviewComponent);
    fixture.componentRef.setInput('proposal', {
      eventTitle: 'Tech Fest 2026',
      shortIntroduction: 'A three-day festival.',
      totalPax: 240,
      ...overrides,
    } as ProposalReviewRecord);
    fixture.detectChanges();
    return fixture;
  }

  const labels = (fixture: ReturnType<typeof render>) =>
    Array.from(fixture.nativeElement.querySelectorAll('.prv-field__label')).map(
      (node) => (node as HTMLElement).textContent?.trim(),
    );

  const rowSizes = (fixture: ReturnType<typeof render>) =>
    Array.from(fixture.nativeElement.querySelectorAll('.prv-summary-row')).map(
      (row) => (row as HTMLElement).querySelectorAll('.prv-field').length,
    );

  it('renders every field the applicant filled in', () => {
    const fixture = render({
      eventVisibility: 'Public',
      eventFormat: 'Physical',
      registrationMode: 'Automatic',
    });

    expect(labels(fixture)).toContain('Visibility');
    expect(labels(fixture)).toContain('Format');
    expect(labels(fixture)).toContain('Registration');
  });

  it('omits an optional field the applicant left blank', () => {
    const fixture = render({ eventVisibility: 'Public', eventFormat: undefined });

    expect(labels(fixture)).toContain('Visibility');
    expect(labels(fixture)).not.toContain('Format');
  });

  it('omits Categories entirely for an event that carries none', () => {
    const fixture = render({ eventCategories: [] });

    expect(labels(fixture)).not.toContain('Categories');
  });

  it('omits the prose fields the applicant left blank', () => {
    const fixture = render({ publicity: '', goals: undefined, benefits: '   ' });

    expect(labels(fixture)).not.toContain('Publicity');
    expect(labels(fixture)).not.toContain('Goals & Objectives');
    expect(labels(fixture)).not.toContain('Expected Benefits');
  });

  /**
   * The point of the whole exercise: with only two compact fields left, they share one row rather
   * than sitting in the first two thirds of a three-column grid with a hole on the right.
   */
  it('closes the grid up behind the fields it dropped', () => {
    const fixture = render({
      eventVisibility: 'Public',
      eventFormat: undefined,
      registrationMode: undefined,
      externalPax: undefined,
      eventCategories: [],
      publicity: '',
      goals: undefined,
      benefits: undefined,
    });

    // Event Title + Visibility + Total Pax survive as compacts; Short Introduction is prose.
    expect(rowSizes(fixture)).toEqual([3, 1]);
  });

  it('gives a lone surviving compact field the full row', () => {
    const fixture = render({
      eventTitle: '',
      totalPax: null as unknown as number,
      eventVisibility: 'Public',
      shortIntroduction: '',
    });

    expect(rowSizes(fixture)).toEqual([1]);
  });

  it('shows the event image only when the proposal carries one', () => {
    expect(render({ eventImage: null }).nativeElement.querySelector('.prv-event-image')).toBeNull();

    const withImage = render({ eventImage: { url: 'https://example.test/a.png' } as never });
    expect(withImage.nativeElement.querySelector('.prv-event-image')).not.toBeNull();
  });
});
