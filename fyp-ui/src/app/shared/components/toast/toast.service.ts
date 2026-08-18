import { Injectable, signal } from '@angular/core';
import { Toast, ToastRequest } from './toast.models';

// 5s: long enough to read a two-line message, short enough that it never blocks the UI. Every
// toast is also dismissible via its own close button (system specification §8C).
const DEFAULT_DURATION_MS = 5000;

// Pulls the most useful message out of an HttpErrorResponse: the backend's own
// { message } body if there is one (every route in server/ throws WorkflowError with a
// human-readable message), otherwise the caller's fallback. Keeps error toasts specific
// ("The cancellation deadline for this event has passed") instead of generic.
export function apiErrorMessage(error: unknown, fallback: string): string {
  const body = (error as { error?: unknown } | null)?.error;
  if (typeof body === 'string' && body.trim()) return body;
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<readonly Toast[]>([]);

  show(request: ToastRequest): number {
    const id = this.nextId++;
    const toast: Toast = { id, tone: 'success', ...request };
    this.toasts.update((toasts) => [...toasts, toast]);
    const duration = toast.durationMs ?? DEFAULT_DURATION_MS;
    if (duration > 0) {
      this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
    }
    return id;
  }

  success(title: string, message?: string, options?: Omit<ToastRequest, 'title' | 'message' | 'tone'>): number {
    return this.show({ title, message, tone: 'success', ...options });
  }
  error(title: string, message?: string, options?: Omit<ToastRequest, 'title' | 'message' | 'tone'>): number {
    return this.show({ title, message, tone: 'error', ...options });
  }
  warning(title: string, message?: string, options?: Omit<ToastRequest, 'title' | 'message' | 'tone'>): number {
    return this.show({ title, message, tone: 'warning', ...options });
  }
  info(title: string, message?: string, options?: Omit<ToastRequest, 'title' | 'message' | 'tone'>): number {
    return this.show({ title, message, tone: 'info', ...options });
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
    this.toasts.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }
}
