// TODO: Implement — see docs/modules/interceptors.md

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { StandardResponse } from 'src/common/dto/response.dto';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, StandardResponse<T>> {
  constructor(private readonly cls?: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<StandardResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        data,
        traceId: this.cls?.get<string>('traceId') ?? crypto.randomUUID(),
      })),
    );
  }
}
