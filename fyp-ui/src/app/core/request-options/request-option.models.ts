export type RequestOptionKind =
  | 'logistics'
  | 'transportation'
  | 'photoVideo'
  | 'soundLight'
  | 'fmb'
  | 'dietaryInformation'
  | 'servingUnit'
  | 'campusTourStart'
  | 'waterLogo'
  | 'waterNormal'
  | 'fundingMain'
  | 'fundingSub';

export interface RequestOptionBase {
  readonly id: string;
  readonly kind: RequestOptionKind;
  readonly label: string;
  readonly description?: string;
  readonly active: boolean;
  readonly imageDataUrl?: string;
  readonly imageFileName?: string;
}

export interface LogisticsRequestOption extends RequestOptionBase {
  readonly kind: 'logistics';
  readonly availableQuantity: number;
  readonly quantityUnit: string;
}

export interface TransportationRequestOption extends RequestOptionBase {
  readonly kind: 'transportation';
  readonly passengerCapacity: number;
  readonly availableVehicles: number;
  readonly instructions?: string;
}

export interface MediaRequestOption extends RequestOptionBase {
  readonly kind: 'photoVideo';
  readonly maximumPersonnel?: number;
}

export interface SoundLightRequestOption extends RequestOptionBase {
  readonly kind: 'soundLight';
  readonly availableQuantity?: number;
  readonly setupRequirements?: string;
}

export interface FoodRequestOption extends RequestOptionBase {
  readonly kind: 'fmb';
  readonly servingUnitId?: string;
  readonly orderingNotes?: string;
  readonly dietaryInformationId?: string;
}

export interface DietaryInformationOption extends RequestOptionBase {
  readonly kind: 'dietaryInformation';
}

export interface ServingUnitOption extends RequestOptionBase {
  readonly kind: 'servingUnit';
}

export interface CampusTourStartOption extends RequestOptionBase {
  readonly kind: 'campusTourStart';
  readonly meetingInstructions?: string;
  readonly maximumGroupSize?: number;
}

export interface WaterRequestOption extends RequestOptionBase {
  readonly kind: 'waterLogo' | 'waterNormal';
  readonly bottleCount: number;
  readonly availableStock: number;
  readonly brandingRequirement?: string;
  readonly orderingInstructions?: string;
}

export interface FundingMainOption extends RequestOptionBase {
  readonly kind: 'fundingMain';
  readonly financeCode?: string;
  readonly purchasingGuidance?: string;
}

export interface FundingSubOption extends RequestOptionBase {
  readonly kind: 'fundingSub';
  readonly parentId: string;
  readonly financeCode?: string;
  readonly purchasingNote?: string;
}

export type RequestOption =
  | LogisticsRequestOption
  | TransportationRequestOption
  | MediaRequestOption
  | SoundLightRequestOption
  | FoodRequestOption
  | DietaryInformationOption
  | ServingUnitOption
  | CampusTourStartOption
  | WaterRequestOption
  | FundingMainOption
  | FundingSubOption;

export type RequestOptionDraft = Omit<RequestOption, 'id'>;

export interface RequestOptionQuery {
  readonly kinds?: readonly RequestOptionKind[];
  readonly activeOnly?: boolean;
  readonly search?: string;
}

export interface RequestOptionRepository {
  getOptions(query: RequestOptionQuery): import('rxjs').Observable<readonly RequestOption[]>;
  getOption(id: string): import('rxjs').Observable<RequestOption>;
  createOption(draft: RequestOptionDraft): import('rxjs').Observable<RequestOption>;
  updateOption(id: string, draft: RequestOptionDraft): import('rxjs').Observable<RequestOption>;
  setOptionActive(id: string, active: boolean): import('rxjs').Observable<RequestOption>;
  deleteOption(id: string): import('rxjs').Observable<void>;
}
