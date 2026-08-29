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
  | 'fundingMain'
  | 'fundingSub'
  | 'venue';

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
  // Price per serving unit in RM. Undefined means "not priced yet", which is not the same as 0
  // (free) — the two are stored and rendered differently.
  readonly unitPriceRm?: number | null;
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

// Mineral water has no catalogue: the applicant types the number of bottles they want
// straight into the request (migration 028 dropped water_normal_options), so there is no
// WaterRequestOption and no /app/dropdown-options/waterNormal page to maintain one on.

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

// A university venue. The single source for every Inside University location
// dropdown in the system — the event schedule and the four university-delivered
// requests all read this one catalogue, so a venue the CFO archives disappears
// from all of them at once and a venue they reorder moves in all of them at
// once. See backend migration 032.
export interface VenueOption extends RequestOptionBase {
  readonly kind: 'venue';
  readonly building?: string;
  readonly capacity?: number | null;
  // The CFO's display order. Server-assigned (appended on create, rewritten by
  // reorder) — the management page never asks anyone to type a number.
  readonly sortOrder?: number;
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
  | FundingMainOption
  | FundingSubOption
  | VenueOption;

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
  // Whole-list write: the caller sends the order it wants and the server assigns
  // the positions, so two managers reordering at once cannot interleave into a
  // half-applied order. Only orderable catalogues (venues) accept it.
  reorderOptions(kind: RequestOptionKind, ids: readonly string[]): import('rxjs').Observable<readonly RequestOption[]>;
}
