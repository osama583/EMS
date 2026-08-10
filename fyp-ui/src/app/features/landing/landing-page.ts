import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { SiteHeaderComponent } from '../../shared/components/site-header/site-header';
import { CampusLifeComponent } from './components/campus-life/campus-life';
import { EventCalendarComponent } from './components/event-calendar/event-calendar';
import { ExploreEventsComponent } from './components/explore-events/explore-events';
import { HappeningSoonComponent } from './components/happening-soon/happening-soon';
import { HeroComponent } from './components/hero/hero';

@Component({
  selector: 'app-landing-page',
  imports: [
    SiteHeaderComponent,
    HeroComponent,
    CampusLifeComponent,
    HappeningSoonComponent,
    ExploreEventsComponent,
    EventCalendarComponent,
    SiteFooterComponent,
  ],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent {}
