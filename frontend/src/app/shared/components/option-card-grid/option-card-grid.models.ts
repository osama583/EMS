export interface OptionCardMetaField {
  readonly label: string;
  readonly value: string;
  readonly icon?: string;
  readonly isNotes?: boolean;
  readonly isBadge?: boolean;
  readonly badgeTone?: 'blue' | 'emerald' | 'amber' | 'neutral';
}

export interface OptionCardViewModel {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly active: boolean;
  readonly imageDataUrl: string;
  readonly imageFileName: string;
  readonly servingUnitLabel?: string;
  readonly dietaryInformationLabel?: string;
  readonly orderingNotes?: string;
  readonly metaFields?: readonly OptionCardMetaField[];
}
