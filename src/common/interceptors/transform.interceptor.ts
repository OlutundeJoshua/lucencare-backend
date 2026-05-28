import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { StandardResponse } from 'src/common/dto/response.dto';

type PaginatedPayload<T> = { data: T; meta: StandardResponse<T>['meta'] };

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
  constructor(private readonly cls?: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {
    return next.handle().pipe(
      map((raw) => {
        const traceId = this.cls?.get<string>('traceId') ?? crypto.randomUUID();

        if (
          raw !== null &&
          typeof raw === 'object' &&
          'data' in raw &&
          'meta' in raw
        ) {
          const paginated = raw as PaginatedPayload<T>;
          return { data: paginated.data, meta: paginated.meta, traceId };
        }

        return { data: raw as T, traceId };
      }),
    );
  }
}
