// TODO: Implement — see docs/modules/filters.md
// Maps all thrown exceptions to RFC 7807 Problem Detail format

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  traceId: string;
  errors?: Array<{ path: string; message: string }>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = (request as unknown as Record<string, string>)['traceId'] ?? crypto.randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred';
    let errors: Array<{ path: string; message: string }> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        detail = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        detail = (body['message'] as string) ?? detail;
        errors = body['errors'] as typeof errors;
      }

      title = exception.name.replace(/Exception$/, '');
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    const problemDetail: ProblemDetail = {
      type: `https://lucencare.io/errors/${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      status,
      detail,
      traceId,
      ...(errors ? { errors } : {}),
    };

    response.status(status).json(problemDetail);
  }
}
