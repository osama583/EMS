import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { SiteHeaderComponent } from '../../shared/components/site-header/site-header';

@Component({
  selector: 'app-my-events',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  templateUrl: './my-events.html',
  styleUrl: './my-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyEventsComponent {
  private readonly router = inject(Router);
  readonly publicLayout = !this.router.url.startsWith('/app/');
  readonly basePath = this.publicLayout ? '/my-events' : '/app/events/my-events';

  readonly tabs = [
    { key: 'saved', label: 'Saved Events', path: 'saved', icon: 'bookmark' },
    { key: 'registered', label: 'Registered Events', path: 'registered', icon: 'how_to_reg' },
    { key: 'history', label: 'History', path: 'history', icon: 'history' },
  ] as const;
}
