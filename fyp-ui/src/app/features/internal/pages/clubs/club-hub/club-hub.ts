import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Single shell for the 3 Clubs member-facing tabs (My Clubs / Pending Requests / Request
// History) — each tab is still its own route (/app/clubs/my-clubs, /pending, /history) so deep
// links and back/forward keep working; this shell only adds the tab strip + router-outlet, same
// pattern as RecordsHubComponent.
@Component({
  selector: 'app-club-hub',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './club-hub.html',
  styleUrl: './club-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubHubComponent {}
