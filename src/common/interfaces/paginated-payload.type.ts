import { StandardResponse } from 'src/common/dto/response.dto';

export type PaginatedPayload<T> = { data: T; meta: StandardResponse<T>['meta'] };
