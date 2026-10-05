import { Injectable, signal } from '@angular/core';

// Lightweight decoupled channel so unrelated feature components can nudge the orb's idle behavior
// (e.g.
export type AiAwarenessEvent = { readonly kind: 'notification' | 'content'; readonly at: number };

@Injectable({ providedIn: 'root' })
export class AiOrbAwarenessService {
  readonly pulse = signal<AiAwarenessEvent | null>(null);

  notify(kind: AiAwarenessEvent['kind']): void {
    this.pulse.set({ kind, at: Date.now() });
  }
}
