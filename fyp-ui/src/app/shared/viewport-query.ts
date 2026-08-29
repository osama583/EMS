import { DOCUMENT } from '@angular/common';
import { DestroyRef, Signal, inject, signal } from '@angular/core';

// One breakpoint for every reviewer-comments surface in the app.
export const COMMENTS_DOCK_QUERY = '(max-width: 72rem)';

// Live `matchMedia` result as a signal. Call from an injection context (a field initialiser or a
// constructor) — the change listener is torn down with the caller. Resolves to false where there
// is no window (server render), which is the desktop layout, so nothing is hidden by default.
export function viewportMatches(query: string): Signal<boolean> {
  const view = inject(DOCUMENT).defaultView;
  const destroyRef = inject(DestroyRef);
  const media = view?.matchMedia?.(query);
  const matches = signal(media?.matches ?? false);

  if (media) {
    const onChange = (event: MediaQueryListEvent) => matches.set(event.matches);
    media.addEventListener('change', onChange);
    destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
  }

  return matches.asReadonly();
}
