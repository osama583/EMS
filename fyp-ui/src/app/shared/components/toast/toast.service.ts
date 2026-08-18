import { Injectable, signal } from '@angular/core';
import { Toast, ToastRequest } from './toast.models';

const DEFAULT_DURATION_MS = 7000;

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
