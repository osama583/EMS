// Matches the shape GET /options/logistics/{id}/availability actually returns (see
// backend/app/api/options.py's logistics_availability) - totalQuantity is the item's total stock,
// committedQuantity is what other already-approved proposals hold for this date/time window,
// availableQuantity is what's left.
export interface LogisticsAvailability {
  readonly optionId: number;
  readonly label: string;
  readonly unit: string;
  readonly totalQuantity: number;
  readonly committedQuantity: number;
  readonly availableQuantity: number;
}
