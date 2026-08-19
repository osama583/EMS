export type RequestOptionKind =
  | 'logistics'
  | 'transportation'
  | 'photoVideo'
  | 'soundLight'
  | 'fmb'
  | 'dietaryInformation'
  | 'servingUnit'
  | 'campusTourStart'
  | 'campusTourType'
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
}

export interface SoundLightRequestOption extends RequestOptionBase {
  readonly kind: 'soundLight';
  readonly setupRequirements?: string;
}

export interface FoodRequestOption extends RequestOptionBase {
  readonly kind: 'fmb';
  readonly servingUnitId?: string;
  readonly orderingNotes?: string;
  // A dish carries one or more dietary tags (halal AND nut-free, say), so this is
  // a set. Backed by a junction table server-side — see migration 006.
  readonly dietaryInformationIds?: readonly string[];
  // Cafeteria unit code (unit.code, CAFETERIA_UNIT_PREFIX-coded) — a Cafeteria is a Unit, see
  // server/db.js's seedCafeteriaDomain().
  readonly cafeteriaCode?: string;
  readonly cafeteriaName?: string;
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

export interface CampusTourTypeOption extends RequestOptionBase {
  readonly kind: 'campusTourType';
}

// Merged catalog — one Mineral Water source consumed everywhere (manager admin page and the
// applicant's single Mineral Water request, which toggles "with logo" rather than picking a
// separate option kind). brandingRequirement is optional guidance a manager can fill in when an
// option supports logo printing; leaving it blank just means no logo-specific note is shown.
export interface WaterRequestOption extends RequestOptionBase {
  readonly kind: 'waterNormal';
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
  | CampusTourTypeOption
  | WaterRequestOption
  | FundingMainOption
  | FundingSubOption;

export type RequestOptionDraft = Omit<RequestOption, 'id'>;

export interface RequestOptionQuery {
  readonly kinds?: readonly RequestOptionKind[];
  readonly activeOnly?: boolean;
  readonly search?: string;
  readonly cafeteriaCode?: string;
}

export type ArchivedRequestOption = RequestOption & import('../../shared/models/deletion.models').DeletionMetadata;

export interface RequestOptionRepository {
  getOptions(query: RequestOptionQuery): import('rxjs').Observable<readonly RequestOption[]>;
  getOption(id: string): import('rxjs').Observable<RequestOption>;
  createOption(draft: RequestOptionDraft): import('rxjs').Observable<RequestOption>;
  updateOption(id: string, draft: RequestOptionDraft): import('rxjs').Observable<RequestOption>;
  setOptionActive(id: string, active: boolean): import('rxjs').Observable<RequestOption>;
  checkOptionDeletion(id: string): import('rxjs').Observable<import('../../shared/models/deletion.models').DeletionPreview>;
  deleteOption(id: string): import('rxjs').Observable<RequestOption>;
  restoreOption(id: string): import('rxjs').Observable<RequestOption>;
  purgeOption(id: string): import('rxjs').Observable<void>;
  getDeletedOptions(): import('rxjs').Observable<readonly ArchivedRequestOption[]>;
}
