export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastRequest {
  readonly title: string;
  readonly message?: string;
  readonly tone?: ToastTone;
  // Milliseconds before auto-dismiss. Set to 0 to require manual dismissal (the X button).
  // Defaults to 7000ms per the shared UX convention — a brief, self-clearing sign the user's
  // action registered, matching this app's other transient confirmations (e.g. showToast() in
  // event-proposal.ts) rather than a banner that lingers until the next navigation.
  readonly durationMs?: number;
  readonly action?: ToastAction;
}

export interface Toast extends ToastRequest {
  readonly id: number;
}
