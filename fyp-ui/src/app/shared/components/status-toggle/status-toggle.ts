import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-status-toggle',
  template: `
    <label class="shared-status-toggle">
      <input type="checkbox" [checked]="active()" [disabled]="disabled()" (change)="activeChange.emit($any($event.target).checked)" />
      <span><strong>{{ label() }}</strong><small>{{ description() }}</small></span>
    </label>
  `,
  styleUrl: './status-toggle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusToggleComponent {
  readonly active = input(true);
  readonly disabled = input(false);
  readonly label = input('Active');
  readonly description = input('Active records are available throughout the system.');
  readonly activeChange = output<boolean>();
}

