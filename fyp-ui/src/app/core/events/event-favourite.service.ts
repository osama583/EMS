import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { GuestRegistrationFlowService } from '../auth/external-registration.service';
import { SavedEventsService } from './saved-events.service';

@Injectable({ providedIn: 'root' })
export class EventFavouriteService {
  private readonly auth = inject(AuthService);
  private readonly savedEvents = inject(SavedEventsService);
  private readonly guestFlow = inject(GuestRegistrationFlowService);
  private readonly router = inject(Router);

  readonly savedEventIds = this.savedEvents.savedEventIds;
  isSaved(eventId: string): boolean { return this.savedEvents.isSaved(eventId); }

  toggle(eventId: string): void {
    const user = this.auth.user();
    if (!user) {
      this.guestFlow.requestForEvent(eventId);
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    const operation = this.savedEvents.isSaved(eventId)
      ? this.savedEvents.removeSavedEvent(user.email, eventId)
      : this.savedEvents.saveEvent(user.email, eventId);
    // The heart already flipped optimistically (see SavedEventsService). On failure it rolls
    // back and reports itself here via the service's own error signal — this subscribe only
    // needs an error callback so a failed request doesn't surface as an unhandled RxJS error.
    operation.subscribe({ error: () => {} });
  }
}
