import {
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';

import { GlobalExceptionFilter } from './global-exception.filter';

function makeHost(json: jest.Mock, status: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json }), json }),
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
}

function makeHostCapture(): { host: ArgumentsHost; captured: { status: number; body: unknown } } {
  const captured: { status: number; body: unknown } = { status: 0, body: undefined };
  const json = jest.fn((body) => { captured.body = body; });
  const statusFn = jest.fn((code: number) => { captured.status = code; return { json }; });
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusFn }),
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('GlobalExceptionFilter', () => {
  const cls = { get: jest.fn().mockReturnValue('trace-fixed') } as any;

  it('maps NotFoundException to 404 RFC 7807', () => {
    const { host, captured } = makeHostCapture();
    const filter = new GlobalExceptionFilter(cls);
    filter.catch(new NotFoundException('Patient not found'), host);
    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    const body = captured.body as any;
    expect(body.status).toBe(404);
    expect(body.type).toMatch(/lucencare\.io\/errors/);
    expect(body.traceId).toBe('trace-fixed');
    expect(body.detail).toBe('Patient not found');
  });

  it('maps ForbiddenException to 403', () => {
    const { host, captured } = makeHostCapture();
    const filter = new GlobalExceptionFilter(cls);
    filter.catch(new ForbiddenException('Access denied'), host);
    expect(captured.status).toBe(403);
    const body = captured.body as any;
    expect(body.status).toBe(403);
  });

  it('maps UnprocessableEntityException with errors[] to 422 with path/message', () => {
    const { host, captured } = makeHostCapture();
    const filter = new GlobalExceptionFilter(cls);
    const exception = new UnprocessableEntityException({
      errors: [
        { path: 'email', message: 'must be an email' },
        { path: 'name', message: 'should not be empty' },
      ],
    });
    filter.catch(exception, host);
    expect(captured.status).toBe(422);
    const body = captured.body as any;
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0]).toEqual({ path: 'email', message: 'must be an email' });
    expect(body.errors[1]).toEqual({ path: 'name', message: 'should not be empty' });
    expect(body.detail).toBe('Validation failed');
  });

  it('maps unknown Error to 500 with generic detail', () => {
    const { host, captured } = makeHostCapture();
    const filter = new GlobalExceptionFilter(cls);
    filter.catch(new Error('db connection failed'), host);
    expect(captured.status).toBe(500);
    const body = captured.body as any;
    expect(body.status).toBe(500);
    expect(body.detail).toBe('An unexpected error occurred');
    expect(body.traceId).toBe('trace-fixed');
  });

  it('includes traceId on every response', () => {
    const { host, captured } = makeHostCapture();
    const filter = new GlobalExceptionFilter(cls);
    filter.catch(new NotFoundException('x'), host);
    expect((captured.body as any).traceId).toBe('trace-fixed');
  });

  it('falls back to randomUUID when no CLS', () => {
    const { host, captured } = makeHostCapture();
    const filter = new GlobalExceptionFilter();
    filter.catch(new NotFoundException('x'), host);
    expect(typeof (captured.body as any).traceId).toBe('string');
    expect((captured.body as any).traceId).toBeTruthy();
  });
});
