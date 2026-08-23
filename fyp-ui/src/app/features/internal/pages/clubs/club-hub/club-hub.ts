import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Pending club requests and request history moved to /app/ongoing/clubs and /app/history/clubs
// (see app.routes.ts) — this shell now only wraps My Clubs, kept as its own route/component so
// /app/clubs/my-clubs stays a stable, bookmarkable, Page-Visibility-grantable URL.
@Component({
  selector: 'app-club-hub',
  imports: [RouterOutlet],
  templateUrl: './club-hub.html',
  styleUrl: './club-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubHubComponent {}
