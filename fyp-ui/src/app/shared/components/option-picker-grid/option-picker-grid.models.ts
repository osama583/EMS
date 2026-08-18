export interface OptionPickerItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly imageDataUrl?: string;
  readonly imageFileName?: string;
  readonly contextText?: string;
}
