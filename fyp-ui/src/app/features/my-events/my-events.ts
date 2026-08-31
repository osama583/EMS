import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SiteHeaderComponent } from '../../shared/components/site-header/site-header';

@Component({
  selector: 'app-my-events',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, SiteHeaderComponent],
  templateUrl: './my-events.html',
  styleUrl: './my-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyEventsComponent {
  private readonly router = inject(Router);
  readonly publicLayout = !this.router.url.startsWith('/app/');
  readonly basePath = this.publicLayout ? '/my-events' : '/app/events/my-events';

  private static readonly publicTabs = [
    { key: 'saved', label: 'Saved Events', path: 'saved', icon: 'bookmark' },
    { key: 'pending', label: 'Pending Events', path: 'pending', icon: 'hourglass_top' },
    { key: 'registered', label: 'Registered Events', path: 'registered', icon: 'how_to_reg' },
    { key: 'history', label: 'History', path: 'history', icon: 'history' },
  ] as const;

  // Internal users track pending/history centrally under /app/ongoing/events and
  // /app/history/events, so those two tabs are hidden here to avoid a duplicate home for the
  // same data — only external users (public layout, no Inbox/Ongoing/History shell) see them.
  private static readonly internalTabs = [
    { key: 'saved', label: 'Saved Events', path: 'saved', icon: 'bookmark' },
    { key: 'registered', label: 'Registered Events', path: 'registered', icon: 'how_to_reg' },
    // Registered only ever holds events still to come — one that has finished moves itself here,
    // which is why there is no action to "complete" an event anywhere: the date decides.
    { key: 'conducted', label: 'Conducted Events', path: 'conducted', icon: 'task_alt' },
  ] as const;

  readonly tabs = this.publicLayout ? MyEventsComponent.publicTabs : MyEventsComponent.internalTabs;
}
