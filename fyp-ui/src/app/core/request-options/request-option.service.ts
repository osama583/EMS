import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map, shareReplay, switchMap, tap } from 'rxjs';
import { SelectOption } from '../../shared/components/form-controls/form-controls.models';
import { REQUEST_OPTION_REPOSITORY } from './request-option.repository';
import { RequestOption, RequestOptionDraft, RequestOptionKind } from './request-option.models';

@Injectable({ providedIn: 'root' })
export class RequestOptionService {
  private readonly repository = inject(REQUEST_OPTION_REPOSITORY);
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);
  private readonly allOptions$ = this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({})), shareReplay({ bufferSize: 1, refCount: true }));

  watchAll(kinds?: readonly RequestOptionKind[]): Observable<readonly RequestOption[]> {
    return this.allOptions$.pipe(map((options) => !kinds?.length ? options : options.filter((option) => kinds.includes(option.kind))));
  }

  watchActive(kind: RequestOptionKind): Observable<readonly RequestOption[]> {
    return this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({ kinds: [kind], activeOnly: true })));
  }

  watchActiveCatalog(kinds?: readonly RequestOptionKind[]): Observable<readonly RequestOption[]> {
    return this.refreshRequests.pipe(switchMap(() => this.repository.getOptions({ kinds, activeOnly: true })));
  }

  toSelectOptions(options: readonly RequestOption[]): readonly SelectOption[] {
    return options.map((option) => ({ value: option.id, label: option.label, description: this.applicantDescription(option) }));
  }

  create(draft: RequestOptionDraft): Observable<RequestOption> { return this.repository.createOption(draft).pipe(tap(() => this.refresh())); }
  update(id: string, draft: RequestOptionDraft): Observable<RequestOption> { return this.repository.updateOption(id, draft).pipe(tap(() => this.refresh())); }
  setActive(id: string, active: boolean): Observable<RequestOption> { return this.repository.setOptionActive(id, active).pipe(tap(() => this.refresh())); }
  delete(id: string): Observable<void> { return this.repository.deleteOption(id).pipe(tap(() => this.refresh())); }
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
      case 'photoVideo': return option.maximumPersonnel ? `Up to ${option.maximumPersonnel} personnel${option.description ? ` · ${option.description}` : ''}` : option.description;
      case 'soundLight': return option.availableQuantity !== undefined ? `${option.availableQuantity} available${option.description ? ` · ${option.description}` : ''}` : option.description;
      case 'fmb': return option.description;
      case 'dietaryInformation': case 'servingUnit': return option.description;
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum group: ${option.maximumGroupSize}` : '', option.meetingInstructions ?? option.description ?? ''].filter(Boolean).join(' · ') || undefined;
      case 'waterLogo': case 'waterNormal': return [`${option.bottleCount || 'Custom'} bottles`, `${option.availableStock} in stock`, option.brandingRequirement ?? option.orderingInstructions ?? ''].filter(Boolean).join(' · ');
      case 'fundingMain': return option.purchasingGuidance ?? option.description;
      case 'fundingSub': return option.purchasingNote ?? option.description;
    }
  }
}
