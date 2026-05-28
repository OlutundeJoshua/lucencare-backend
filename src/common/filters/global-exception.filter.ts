import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  traceId: string;
  errors?: Array<{ path: string; message: string }>;
}

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly cls?: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId =
      this.cls?.get<string>('traceId') ??
      (request as unknown as Record<string, string>)['traceId'] ??
      crypto.randomUUID();

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

        // Structured errors produced by the ValidationPipe exceptionFactory
        if (Array.isArray(body['errors'])) {
          errors = body['errors'] as Array<{ path: string; message: string }>;
          detail = 'Validation failed';
        } else if (typeof body['message'] === 'string') {
          detail = body['message'];
        } else if (Array.isArray(body['message'])) {
          // Fallback: plain string array from default ValidationPipe (no exceptionFactory)
          detail = (body['message'] as string[]).join('; ');
        }
      }

      title = this.toTitle(exception.name);
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error('Unknown exception', String(exception));
    }

    const slug = title.toLowerCase().replace(/\s+/g, '-');
    const problemDetail: ProblemDetail = {
      type: `https://lucencare.io/errors/${slug}`,
      title,
      status,
      detail,
      traceId,
      ...(errors ? { errors } : {}),
    };

    response.status(status).json(problemDetail);
  }

  private toTitle(exceptionName: string): string {
    return exceptionName
      .replace(/Exception$/, '')
      .replace(/([A-Z])/g, ' $1')
      .trim();
  }
}
