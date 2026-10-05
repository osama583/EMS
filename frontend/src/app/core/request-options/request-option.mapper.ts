import { RequestOption, RequestOptionDraft } from './request-option.models';

// API DTOs are deliberately isolated here so transport mapping can evolve
// without changing manager pages or applicant form components.
export type RequestOptionDto = RequestOption;
export type RequestOptionWriteDto = RequestOptionDraft;

export function mapRequestOptionResponse(dto: RequestOptionDto): RequestOption { return { ...dto } as RequestOption; }
export function mapRequestOptionWrite(draft: RequestOptionDraft): RequestOptionWriteDto { return { ...draft } as RequestOptionWriteDto; }

