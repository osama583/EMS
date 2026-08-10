import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ExploreEventsComponent as SharedExploreEventsComponent } from '../../../landing/components/explore-events/explore-events';

@Component({
  selector: 'app-internal-explore-events',
  imports: [SharedExploreEventsComponent],
  templateUrl: './explore-events.html',
  styleUrl: './explore-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalExploreEventsComponent {}
