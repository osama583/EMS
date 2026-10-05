import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** One labelled fact in a detail modal. */
export interface DetailField {
  readonly label: string;
  readonly value: string;
  /** Optional Material Symbol shown beside the value. */
  readonly icon?: string;
  /** Renders the value as a pill instead of plain text (status, visibility, ...). */
  readonly badge?: boolean;
  readonly tone?: 'neutral' | 'blue' | 'success' | 'warning' | 'danger';
  /** Lets one field span the full width of the grid (long prose, a club list). */
  readonly wide?: boolean;
}

/**
 * The shared presentation for "here are the details of one record", used by every
 * detail/read-only modal.
 *
 * Before this, each modal hand-rolled its own <h3>/<p>/<dl> and they drifted: the club
 * request dialogs were bare bolded text with no visual hierarchy, while the event
 * dialogs had tags, a summary strip and a definition grid. Same kind of content, three
 * different looks. Consolidating means a club request and an event now read the same
 * way, and a change to the presentation happens once.
 */
@Component({
  selector: 'app-detail-view',
  templateUrl: './detail-view.html',
  styleUrl: './detail-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailViewComponent {
  /** Pills above the fields — category, visibility, status. */
  readonly tags = input<readonly DetailField[]>([]);
  /** The labelled fact grid. */
  readonly fields = input<readonly DetailField[]>([]);
  /** Free-text sections (a reason, a description), rendered under the grid. */
  readonly sections = input<readonly { readonly title: string; readonly body: string }[]>([]);
  /** Optional accent strip at the top, used by the calendar to carry the category colour. */
  readonly accentClass = input('');
}
