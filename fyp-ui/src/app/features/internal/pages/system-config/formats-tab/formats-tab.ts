import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EventFormatService } from '../../../../../core/event-catalog/event-catalog.service';
import { EventCatalogSectionComponent } from '../event-catalog-section/event-catalog-section';

@Component({
  selector: 'app-formats-tab',
  imports: [EventCatalogSectionComponent],
  template: `<app-event-catalog-section [service]="eventFormatService" entityLabel="Event format" entityLabelPlural="Event Formats" />`,
  styleUrl: './formats-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatsTabComponent {
  readonly eventFormatService = inject(EventFormatService);
}
