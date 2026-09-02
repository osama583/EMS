import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormModalComponent } from '../form-modal/form-modal';
import { OptionCardMetaField, OptionCardViewModel } from '../option-card-grid/option-card-grid.models';

/**
 * The full record for one catalogue item — a cafeteria menu dish, a logistics asset,
 * a vehicle — opened from the card grid.
 *
 * It reads as the item's SPEC SHEET rather than a larger copy of the card that opened
 * it. The plate (photo, or the grid's own placeholder) anchors the top beside what the
 * item is and whether it is live; the facts sit under it as a hairline-ruled ledger,
 * label left and value right, the way a menu board carries its price column. Notes drop
 * out of the ledger into their own block because they are prose, not a value.
 *
 * This used to render every field as an uppercase <dt> over a <dd> and no image at all,
 * which threw away the icons and tones the card had already used to tell these fields
 * apart — the dialog said less than the card the reader had just clicked.
 */
@Component({
  selector: 'app-option-item-details-modal',
  imports: [FormModalComponent],
  template: `
    <app-form-modal
      [open]="open()"
      [title]="item()?.label || 'Item details'"
      [hidePrimary]="true"
      secondaryLabel="Close"
      (close)="close.emit()"
      (cancel)="close.emit()"
      (submit)="close.emit()"
    >
      @if (item(); as menuItem) {
        <article class="item-details">
          <div class="item-details__intro">
            <figure class="item-details__plate">
              @if (menuItem.imageDataUrl && !imageFailed()) {
                <img
                  [src]="menuItem.imageDataUrl"
                  [alt]="menuItem.imageFileName || menuItem.label"
                  (error)="onImageError()"
                />
              } @else {
                <span class="material-symbols-rounded" aria-hidden="true">category</span>
              }
            </figure>

            <div class="item-details__summary">
              <p class="item-details__status" [attr.data-active]="menuItem.active">
                <span class="item-details__dot" aria-hidden="true"></span>
                {{ menuItem.active ? 'Active' : 'Inactive' }}
              </p>
              @if (menuItem.description) {
                <p class="item-details__description">{{ menuItem.description }}</p>
              } @else {
                <p class="item-details__description item-details__description--none">No description added.</p>
              }

              @if (specs().length > 0) {
                <dl class="item-details__specs">
                  @for (spec of specs(); track spec.label) {
                    <div class="item-details__spec" [attr.data-tone]="spec.badgeTone || 'blue'">
                      <dt>
                        <span class="material-symbols-rounded" aria-hidden="true">{{ spec.icon || 'info' }}</span>
                        {{ spec.label }}
                      </dt>
                      <dd>{{ spec.value }}</dd>
                    </div>
                  }
                </dl>
              }
            </div>
          </div>

          @for (note of notes(); track note.label) {
            <section class="item-details__note">
              <h3>
                <span class="material-symbols-rounded" aria-hidden="true">{{ note.icon || 'sticky_note_2' }}</span>
                {{ note.label }}
              </h3>
              <p>{{ note.value }}</p>
            </section>
          }
        </article>
      }
    </app-form-modal>
  `,
  styles: `
    :host { display: contents; }

    .item-details { display: grid; gap: var(--space-4); }

    /* Plate beside the record, not a banner above it: a full-width hero would be a
       vast gradient whenever an item has no photo, which is most of the catalogue.
       Everything else — status, description, facts — stacks in the second column, so
       the plate never stands next to an empty half. */
    .item-details__intro {
      display: grid;
      grid-template-columns: 13rem minmax(0, 1fr);
      gap: var(--space-4);
      align-items: start;
    }

    .item-details__plate {
      display: grid;
      margin: 0;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      place-items: center;
      border-radius: var(--radius-card);
      background: linear-gradient(145deg, rgb(240 244 250), rgb(225 233 245));
    }
    .item-details__plate img { width: 100%; height: 100%; object-fit: cover; }
    .item-details__plate .material-symbols-rounded { font-size: 2.5rem; color: rgb(42 131 255 / 38%); }

    .item-details__summary { display: grid; gap: var(--space-2); align-content: start; }

    /* The dot carries the state; the word confirms it. Same pairing as the card's
       status pill, so live/withdrawn reads identically in both places. */
    .item-details__status {
      display: inline-flex;
      width: fit-content;
      margin: 0;
      padding: .3rem .8rem .3rem .6rem;
      align-items: center;
      gap: .45rem;
      border-radius: var(--radius-pill);
      background: var(--apu-surface-muted);
      color: var(--apu-text-muted);
      font-size: .8rem;
      font-weight: 700;
    }
    .item-details__dot { width: .45rem; height: .45rem; border-radius: 50%; background: #9fb0c3; }
    .item-details__status[data-active='true'] { background: rgb(24 168 108 / 13%); color: #0f7a4f; }
    .item-details__status[data-active='true'] .item-details__dot { background: #12a970; box-shadow: 0 0 0 .18rem rgb(18 169 112 / 22%); }

    .item-details__description {
      max-width: 60ch;
      margin: 0;
      color: var(--apu-navy-900);
      font-size: 1rem;
      line-height: 1.65;
      white-space: pre-wrap;
    }
    .item-details__description--none { color: var(--apu-text-soft); }

    /* The ledger: label and icon left, value right, one hairline per row. Quiet on
       purpose — the plate is the only loud thing in the dialog. It sits in the second
       column rather than spanning the dialog, because a two-word value pushed to the
       far edge of 50rem reads as a torn receipt rather than a spec sheet. */
    .item-details__specs { display: grid; margin: var(--space-2) 0 0; }
    .item-details__spec {
      display: flex;
      padding: .85rem .25rem;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-4);
      border-top: 1px solid var(--apu-border);
    }
    .item-details__spec:last-child { border-bottom: 1px solid var(--apu-border); }

    .item-details__spec dt {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: .5rem;
      color: var(--apu-text-muted);
      font-size: .875rem;
    }
    .item-details__spec dd {
      margin: 0;
      color: var(--apu-navy-950);
      font-size: .95rem;
      font-weight: 650;
      line-height: 1.45;
      text-align: right;
      white-space: pre-wrap;
    }

    /* Tone colours the icon only. The card tints whole chips; repeating that here
       would be three coloured boxes competing with the photo. */
    .item-details__spec .material-symbols-rounded { font-size: 1.15rem; color: var(--apu-blue-600); }
    .item-details__spec[data-tone='emerald'] .material-symbols-rounded { color: #059669; }
    .item-details__spec[data-tone='amber'] .material-symbols-rounded { color: #d97706; }

    /* Notes are prose, so they leave the ledger and get room to be read. */
    .item-details__note {
      padding: var(--space-3) var(--space-4);
      border-left: 3px solid var(--apu-blue-600);
      border-radius: .55rem;
      background: var(--apu-surface-muted);
    }
    .item-details__note h3 {
      display: flex;
      margin: 0 0 .35rem;
      align-items: center;
      gap: .5rem;
      color: var(--apu-navy-950);
      font-size: .95rem;
      font-weight: 700;
    }
    .item-details__note h3 .material-symbols-rounded { font-size: 1.15rem; color: var(--apu-blue-600); }
    .item-details__note p {
      max-width: 60ch;
      margin: 0;
      color: var(--apu-navy-900);
      font-size: .92rem;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    @media (max-width: 40rem) {
      .item-details { gap: var(--space-4); }
      /* The plate becomes a landscape strip rather than a shrunken square — a phone
         has the width for the photo and no room for a side-by-side split. */
      .item-details__intro { grid-template-columns: minmax(0, 1fr); }
      .item-details__plate { aspect-ratio: 16 / 9; }
      .item-details__spec { flex-direction: column; align-items: flex-start; gap: .25rem; }
      .item-details__spec dd { text-align: left; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionItemDetailsModalComponent {
  readonly open = input(false);
  readonly item = input<OptionCardViewModel | null>(null);
  readonly close = output<void>();

  // Keyed by item id rather than a bare boolean: one broken image used to latch the
  // placeholder on for every item opened afterwards in the same session.
  private readonly failedFor = signal<string | null>(null);
  readonly imageFailed = computed(() => this.failedFor() !== null && this.failedFor() === this.item()?.id);

  /**
   * One list whichever way the caller filled the view model. Callers that build
   * metaFields (cafeteria menus, request options) already carry the icon and tone;
   * the older flat fields are given the same ones the card grid uses for them, so a
   * dish looks the same here whichever page opened it.
   */
  private readonly facts = computed<readonly OptionCardMetaField[]>(() => {
    const item = this.item();
    if (!item) return [];
    if (item.metaFields && item.metaFields.length > 0) return item.metaFields;
    return [
      ...(item.servingUnitLabel ? [{ label: 'Serving unit', value: item.servingUnitLabel, icon: 'restaurant', badgeTone: 'blue' as const }] : []),
      ...(item.dietaryInformationLabel ? [{ label: 'Dietary info', value: item.dietaryInformationLabel, icon: 'nutrition', badgeTone: 'emerald' as const }] : []),
      ...(item.orderingNotes ? [{ label: 'Ordering notes', value: item.orderingNotes, icon: 'notes', isNotes: true }] : []),
    ];
  });

  readonly specs = computed(() => this.facts().filter((fact) => !fact.isNotes));
  readonly notes = computed(() => this.facts().filter((fact) => fact.isNotes));

  onImageError(): void {
    this.failedFor.set(this.item()?.id ?? null);
  }
}
