import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

export type TaskCalendarMode = 'single' | 'range';

export interface TaskDateSelection {
  readonly start: string;
  readonly end: string | null;
}

interface CalendarCell {
  readonly date: Date;
  readonly key: string;
  readonly dayNumber: number;
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly hasTasks: boolean;
  readonly isSelected: boolean;
}

// Compact single-day / date-range filter control, used by My Tasks (staff-tasks.ts) and the
// Cafeteria queue. Presentation-only: the owning page computes taskDates() from its own list and
// reads selection() back out to filter it - this component never fetches anything itself.
@Component({
  selector: 'app-task-calendar',
  templateUrl: './task-calendar.html',
  styleUrl: './task-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskCalendarComponent {
  private readonly today = this.startOfDay(new Date());

  // Days (YYYY-MM-DD) that should render the primary-color dot indicator.
  readonly taskDates = input<readonly string[]>([]);
  readonly mode = model<TaskCalendarMode>('single');
  /** Hides the Single day / Date range switch and pins the calendar to whatever
   *  `mode` was given. The dashboard's period filter is always a window, so
   *  offering "Single day" there would let the reader pick a one-day reporting
   *  range by accident — and the switch would sit above a calendar whose owner
   *  cannot honour half of it. */
  readonly lockMode = input(false);
  readonly selection = model<TaskDateSelection>({ start: this.dateKey(this.today), end: null });

  readonly currentMonth = signal(this.startOfMonth(this.today));
  // While picking the second end of a range, the first click is held here until the second lands.
  private readonly pendingRangeStart = signal<string | null>(null);

  readonly weekDayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  readonly monthLabel = computed(() =>
    new Intl.DateTimeFormat('en-MY', { month: 'long', year: 'numeric' }).format(this.currentMonth()),
  );

  readonly days = computed<readonly CalendarCell[]>(() => {
    const month = this.currentMonth();
    const taskDateSet = new Set(this.taskDates());
    const { start, end } = this.selection();
    const firstGridDay = this.addDays(month, -month.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = this.addDays(firstGridDay, index);
      const key = this.dateKey(date);
      return {
        date,
        key,
        dayNumber: date.getDate(),
        isCurrentMonth: date.getMonth() === month.getMonth(),
        isToday: key === this.dateKey(this.today),
        hasTasks: taskDateSet.has(key),
        isSelected: end ? key >= start && key <= end : key === start,
      };
    });
  });

  setMode(next: TaskCalendarMode): void {
    this.mode.set(next);
    this.pendingRangeStart.set(null);
    const { start } = this.selection();
    this.selection.set({ start, end: null });
  }

  navigate(direction: -1 | 1): void {
    const month = this.currentMonth();
    this.currentMonth.set(new Date(month.getFullYear(), month.getMonth() + direction, 1));
  }

  goToToday(): void {
    this.currentMonth.set(this.startOfMonth(this.today));
    this.selectDay(this.dateKey(this.today));
  }

  selectDay(key: string): void {
    if (this.mode() === 'single') {
      this.selection.set({ start: key, end: null });
      return;
    }

    const pending = this.pendingRangeStart();
    if (!pending) {
      this.pendingRangeStart.set(key);
      this.selection.set({ start: key, end: null });
      return;
    }

    const [start, end] = key >= pending ? [pending, key] : [key, pending];
    this.selection.set({ start, end });
    this.pendingRangeStart.set(null);
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return this.startOfDay(result);
  }

  private dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
