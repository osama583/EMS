export interface LogisticsCommittedWindow {
  readonly quantity: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly bufferedEndTime: string;
}

export interface LogisticsAvailability {
  readonly availableQuantity: number;
  readonly remainingQuantity: number;
  readonly committedWindows: readonly LogisticsCommittedWindow[];
  readonly nextAvailableAt: string | null;
}
