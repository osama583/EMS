import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Pending club requests and request history moved to /app/ongoing/clubs and /app/history/clubs
// (see app.routes.ts) — this shell now wraps the two My Clubs views, kept as its own
// route/component so /app/clubs/my-clubs stays a stable, bookmarkable,
// Page-Visibility-grantable URL.
//
// Current and Previous are tabs rather than one list with a filter because they answer different
// questions and offer different actions: Current has a roster, a category editor and a way out,
// Previous is a read-only record of clubs you can no longer act on at all.
@Component({
  selector: 'app-club-hub',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './club-hub.html',
  styleUrl: './club-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubHubComponent {
  readonly tabs = [
    { key: 'current', label: 'My Clubs', path: '/app/clubs/my-clubs', icon: 'groups', exact: true },
    { key: 'previous', label: 'Previous Clubs', path: '/app/clubs/my-clubs/previous', icon: 'history', exact: false },
  ] as const;
}
