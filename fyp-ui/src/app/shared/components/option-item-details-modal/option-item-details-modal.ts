import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormModalComponent } from '../form-modal/form-modal';
import { OptionCardViewModel } from '../option-card-grid/option-card-grid.models';

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
        <article class="menu-item-details">
          @if (menuItem.imageDataUrl && !imageFailed()) {
            <img
              class="menu-item-details__image"
              [src]="menuItem.imageDataUrl"
              [alt]="menuItem.imageFileName || menuItem.label"
              (error)="onImageError()"
            />
          }
          <span class="menu-item-details__status" [attr.data-active]="menuItem.active">
            {{ menuItem.active ? 'Active' : 'Inactive' }}
          </span>
          @if (menuItem.description) {
            <section>
              <h3>Description</h3>
              <p>{{ menuItem.description }}</p>
            </section>
          }
          <dl>
            @if (menuItem.metaFields && menuItem.metaFields.length > 0) {
              @for (field of menuItem.metaFields; track field.label) {
                <div>
                  <dt>{{ field.label }}</dt>
                  <dd>{{ field.value }}</dd>
                </div>
              }
            } @else {
              @if (menuItem.servingUnitLabel) { <div><dt>Serving unit</dt><dd>{{ menuItem.servingUnitLabel }}</dd></div> }
              @if (menuItem.dietaryInformationLabel) { <div><dt>Dietary information</dt><dd>{{ menuItem.dietaryInformationLabel }}</dd></div> }
              @if (menuItem.orderingNotes) { <div><dt>Availability / ordering notes</dt><dd>{{ menuItem.orderingNotes }}</dd></div> }
            }
          </dl>
        </article>
      }
    </app-form-modal>
  `,
  styles: `
    :host { display: contents; }
    .menu-item-details { display: grid; gap: var(--space-4); }
    .menu-item-details__image { width: 100%; max-height: 16rem; border-radius: var(--radius-card); object-fit: cover; }
    .menu-item-details__status { display: inline-flex; width: fit-content; padding: .3rem .75rem; border-radius: var(--radius-pill); font-size: .8rem; font-weight: 700; text-transform: capitalize; background: var(--apu-surface-muted); color: var(--apu-text-muted); }
    .menu-item-details__status[data-active='true'] { background: rgb(24 168 108 / 14%); color: #128a5b; }
    .menu-item-details section h3 { margin: 0 0 .35rem; color: var(--apu-navy-950); font-size: 1rem; }
    .menu-item-details section p { margin: 0; color: var(--apu-navy-900); line-height: 1.6; white-space: pre-wrap; }
    .menu-item-details dl { display: grid; gap: var(--space-3); margin: 0; }
    .menu-item-details dl div { display: grid; gap: .2rem; }
    .menu-item-details dt { color: var(--apu-text-muted); font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .menu-item-details dd { margin: 0; color: var(--apu-navy-900); line-height: 1.55; white-space: pre-wrap; }
    @media (max-width: 48rem) {
      .menu-item-details__image { max-height: 12rem; }
      .menu-item-details { gap: var(--space-3); }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionItemDetailsModalComponent {
  readonly open = input(false);
  readonly item = input<OptionCardViewModel | null>(null);
  readonly close = output<void>();

  readonly imageFailed = signal(false);

  onImageError(): void {
    this.imageFailed.set(true);
  }
}
