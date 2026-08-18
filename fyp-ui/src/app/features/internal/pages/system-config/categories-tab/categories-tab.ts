import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EventCategoryService } from '../../../../../core/event-catalog/event-catalog.service';
import { EventCatalogSectionComponent } from '../event-catalog-section/event-catalog-section';

@Component({
  selector: 'app-categories-tab',
  imports: [EventCatalogSectionComponent],
  template: `<app-event-catalog-section [service]="eventCategoryService" entityLabel="Event category" entityLabelPlural="Event Categories" />`,
  styleUrl: './categories-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesTabComponent {
  readonly eventCategoryService = inject(EventCategoryService);
}
