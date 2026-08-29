import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, switchMap, tap } from 'rxjs';
import { SelectOption } from '../../shared/components/form-controls/form-controls.models';
import { DeletionPreview } from '../../shared/models/deletion.models';
import { REQUEST_OPTION_REPOSITORY } from './request-option.repository';
import { ArchivedRequestOption, RequestOption, RequestOptionDraft, RequestOptionKind } from './request-option.models';

@Injectable({ providedIn: 'root' })
export class RequestOptionService {
  private readonly repository = inject(REQUEST_OPTION_REPOSITORY);
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);

  // Every caller passes the kinds it actually needs, so the filter is applied in SQL (see
  // GET /options?kinds=) rather than fetching all twelve catalogues and discarding most of the
  // rows client-side.
  watchAll(kinds?: readonly RequestOptionKind[]): Observable<readonly RequestOption[]> {
    return this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({ kinds })));
  }

  watchActive(kind: RequestOptionKind): Observable<readonly RequestOption[]> {
    return this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({ kinds: [kind], activeOnly: true })));
  }

  watchActiveCatalog(kinds?: readonly RequestOptionKind[]): Observable<readonly RequestOption[]> {
    return this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({ kinds, activeOnly: true })));
  }

  // Used by the F&B/Cafeteria Admin read-only menu views — menu items (fmb) are scoped per
  // cafeteria, unlike every other option kind, so this bypasses the shared allOptions$ cache to
  // re-query per pick.
  watchByCafeteria(cafeteriaCode: string): Observable<readonly RequestOption[]> {
    return this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({ kinds: ['fmb'], cafeteriaCode })));
  }

  toSelectOptions(options: readonly RequestOption[]): readonly SelectOption[] {
    return options.map((option) => ({ value: option.id, label: option.label, description: this.applicantDescription(option) }));
  }

  create(draft: RequestOptionDraft): Observable<RequestOption> { return this.repository.createOption(draft).pipe(tap(() => this.refresh())); }
  update(id: string, draft: RequestOptionDraft): Observable<RequestOption> { return this.repository.updateOption(id, draft).pipe(tap(() => this.refresh())); }
  setActive(id: string, active: boolean): Observable<RequestOption> { return this.repository.setOptionActive(id, active).pipe(tap(() => this.refresh())); }
  checkDeletion(id: string): Observable<DeletionPreview> { return this.repository.checkOptionDeletion(id); }
  delete(id: string): Observable<RequestOption> { return this.repository.deleteOption(id).pipe(tap(() => this.refresh())); }
  restore(id: string): Observable<RequestOption> { return this.repository.restoreOption(id).pipe(tap(() => this.refresh())); }
  purge(id: string): Observable<void> { return this.repository.purgeOption(id).pipe(tap(() => this.refresh())); }
  reorder(kind: RequestOptionKind, ids: readonly string[]): Observable<readonly RequestOption[]> { return this.repository.reorderOptions(kind, ids).pipe(tap(() => this.refresh())); }

  // Every Inside University venue dropdown in the system reads this, and only this.
  watchVenues(): Observable<readonly RequestOption[]> { return this.watchActive('venue'); }
  getDeleted(): Observable<readonly ArchivedRequestOption[]> { return this.repository.getDeletedOptions(); }
  getById(id: string): Observable<RequestOption> { return this.repository.getOption(id); }
  refresh(): void { this.refreshRequests.next(); }

  find(options: readonly RequestOption[], value: unknown): RequestOption | undefined {
    const key = String(value ?? '');
    return options.find((option) => option.id === key || option.label === key);
  }

  private applicantDescription(option: RequestOption): string | undefined {
    switch (option.kind) {
      case 'logistics': return `${option.availableQuantity} ${option.quantityUnit}${option.availableQuantity === 1 ? '' : 's'} available${option.description ? ` · ${option.description}` : ''}`;
      case 'transportation': return `Capacity: ${option.passengerCapacity} passengers${option.description ? ` · ${option.description}` : ''}`;
      case 'photoVideo': return option.description;
      case 'soundLight': return [option.setupRequirements, option.description].filter(Boolean).join(' · ') || undefined;
      case 'fmb': return option.description;
      case 'dietaryInformation': case 'servingUnit': return option.description;
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum group: ${option.maximumGroupSize}` : '', option.meetingInstructions ?? option.description ?? ''].filter(Boolean).join(' · ') || undefined;
      case 'campusTourType': return option.description;
      case 'fundingMain': return option.purchasingGuidance ?? option.description;
      case 'fundingSub': return option.purchasingNote ?? option.description;
      case 'venue': return [option.building, option.capacity ? `Seats ${option.capacity}` : '', option.description].filter(Boolean).join(' · ') || undefined;
    }
  }
}
