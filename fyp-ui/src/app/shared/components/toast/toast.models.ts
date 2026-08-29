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
  readonly durationMs?: number;
  readonly action?: ToastAction;
}

export interface Toast extends ToastRequest {
  readonly id: number;
}
