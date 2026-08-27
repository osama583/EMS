import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormModalComponent } from '../form-modal/form-modal';
import { DeletionPreview } from '../../models/deletion.models';

// Standard delete-confirmation flow for every soft-deletable Admin Settings entity: names exactly
// what's about to be deleted, states the 7-day recovery window, and — critically — shows the
// dependency check's result INSIDE the dialog (loading while the preview request is in flight,
// then either the blocking reasons with the Delete button disabled, or a "clear to delete"
// confirmation) rather than only surfacing a blocker after the admin clicks through. See
// server/services/soft-delete.service.js's previewDeletion()/softDelete() — this dialog's
// `preview` input is exactly that endpoint's response, fetched by the calling page before opening.
@Component({
  selector: 'app-delete-confirm-dialog',
  imports: [FormModalComponent],
  template: `
    <app-form-modal
      [open]="open()" title="{{ permanent() ? 'Permanently Delete' : 'Delete' }} {{ entityKind() }}" primaryLabel="{{ permanent() ? 'Delete Forever' : 'Delete' }}" [danger]="true"
      [loading]="deleting()" [disabled]="checkingDependencies() || (!!preview() && !preview()!.canDelete) || (requirePreview() && !preview())"
      (close)="cancel.emit()" (cancel)="cancel.emit()" (submit)="confirm.emit()"
    >
      @if (checkingDependencies()) {
        <p class="delete-confirm__checking">
          <span class="material-symbols-rounded delete-confirm__spin" aria-hidden="true">progress_activity</span>
          Checking whether {{ entityLabel() || 'this ' + entityKind().toLowerCase() }} can be deleted…
        </p>
      } @else if (preview() && !preview()!.canDelete) {
        <div class="delete-confirm__blocked">
          <p><strong>Cannot {{ permanent() ? 'permanently delete' : 'delete' }} {{ preview()!.entityLabel }}</strong></p>
          <ul>
            @for (reason of preview()!.blockingReasons; track reason) {
              <li>{{ reason }}.</li>
            }
          </ul>
          @if (blockedHint()) {
            <p class="delete-confirm__hint">{{ blockedHint() }}</p>
          }
        </div>
      } @else if (permanent()) {
        <p class="delete-confirm__message">
          Permanently delete {{ preview()?.entityLabel || entityLabel() }}? This action cannot be undone.
        </p>
      } @else {
        <p class="delete-confirm__message">
          Delete {{ preview()?.entityLabel || entityLabel() }}? It will be moved to Deleted and kept recoverable for 7 days — you (or another System Admin) can restore it from there at any time during that window. After 7 days it is permanently removed.
        </p>
      }
    </app-form-modal>
  `,
  styles: `
    :host { display: contents; }
    .delete-confirm__message { margin: 0; color: var(--apu-navy-900); font-size: .95rem; line-height: 1.55; }
    .delete-confirm__checking { display: flex; align-items: center; gap: .5rem; margin: 0; color: var(--color-text-muted, #6b7280); font-size: .9rem; }
    .delete-confirm__spin { animation: delete-confirm-spin 1s linear infinite; }
    @keyframes delete-confirm-spin { to { transform: rotate(360deg); } }
    .delete-confirm__blocked {
      display: grid; gap: .5rem; padding: .85rem 1rem; border: 1px solid var(--form-error, #ef4444);
      border-radius: var(--radius-control, .6rem); background: color-mix(in srgb, var(--form-error, #ef4444) 8%, white);
    }
    .delete-confirm__blocked p { margin: 0; color: var(--apu-navy-950, #041f41); font-size: .9rem; }
    .delete-confirm__blocked ul { margin: 0; padding-left: 1.2rem; color: var(--apu-navy-900); font-size: .88rem; line-height: 1.5; }
    .delete-confirm__hint { margin: 0; color: var(--apu-navy-900); font-size: .88rem; line-height: 1.5; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteConfirmDialogComponent {
  readonly open = input(false);
  // Human name for the entity kind ("User", "Unit", "Logistics item", ...) shown in the dialog
  // title and the "checking…" fallback message before the preview response has entityLabel.
  readonly entityKind = input('item');
  readonly entityLabel = input('');
  readonly checkingDependencies = input(false);
  readonly preview = input<DeletionPreview | null>(null);
  // Guards against a call site that opens this dialog without ever running the dependency
  // check: with no preview the button would otherwise stay enabled and fire a delete the
  // server is certain to refuse, so the user sees a red toast instead of the reasons. Delete
  // stays disabled until a preview arrives. A purge confirmation that has already been gated
  // elsewhere passes false.
  readonly requirePreview = input(true);
  readonly deleting = input(false);
  // Shown under the blocking reasons to name the way forward. Deletion is only ever refused
  // because the record is already in use, and the answer is always the same — deactivate it —
  // so this defaults to saying so rather than leaving every dialog to repeat it, and every
  // entity gives the same explanation. Override for a kind with different advice; pass '' to
  // show reasons alone.
  readonly blockedHint = input(
    'Records that have been used cannot be deleted, because other records depend on them. ' +
      'Deactivate it instead to take it out of use while keeping that history intact.',
  );
  // True for a "Delete forever" / purge confirmation (immediate, unrecoverable) rather than the
  // default 7-day-recoverable soft-delete this dialog otherwise confirms — swaps the title/body
  // copy accordingly. Existing soft-delete call sites don't pass this, so default false preserves
  // today's behavior everywhere unchanged.
  readonly permanent = input(false);
  readonly confirm = output<void>();
  readonly cancel = output<void>();
}
