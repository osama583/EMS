import { DOCUMENT } from '@angular/common';
import { DestroyRef, Signal, inject, signal } from '@angular/core';

// One breakpoint for every reviewer-comments surface in the app. Below it none of the three
// layouts that host a comments panel still has a right-hand column to put it in
// (proposal-reviewer-view's and proposal-department-view's .prv-layout, department-resubmit's
// grid, event-proposal's pushed drawer), so instead of letting the conversation stack at the
// very bottom of the page they all collapse to the same thing: an edge tab that opens a
// right-docked overlay. Kept here rather than in each caller so the number cannot drift.
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
