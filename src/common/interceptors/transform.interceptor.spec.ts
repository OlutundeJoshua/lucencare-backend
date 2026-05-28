import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import { TransformInterceptor } from './transform.interceptor';

const mockCls = (traceId?: string) => ({
  get: jest.fn().mockReturnValue(traceId),
});

const mockContext = {} as ExecutionContext;

const mockHandler = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

describe('TransformInterceptor', () => {
  it('wraps a plain value in { data, traceId }', async () => {
    const cls = mockCls('trace-123') as any;
    const interceptor = new TransformInterceptor(cls);
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler('hello')));
    expect(result).toEqual({ data: 'hello', traceId: 'trace-123' });
  });

  it('wraps a plain object in { data, traceId }', async () => {
    const cls = mockCls('trace-abc') as any;
    const interceptor = new TransformInterceptor(cls);
    const payload = { id: '01H', name: 'Test' };
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler(payload)));
    expect(result).toEqual({ data: payload, traceId: 'trace-abc' });
  });

  it('spreads meta to top level when service returns { data, meta }', async () => {
    const cls = mockCls('trace-xyz') as any;
    const interceptor = new TransformInterceptor(cls);
    const paginated = { data: [1, 2, 3], meta: { cursor: 'abc', limit: 20 } };
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler(paginated)));
    expect(result).toEqual({ data: [1, 2, 3], meta: { cursor: 'abc', limit: 20 }, traceId: 'trace-xyz' });
    expect((result as any).data).not.toHaveProperty('meta');
  });

  it('falls back to randomUUID when CLS has no traceId', async () => {
    const cls = mockCls(undefined) as any;
    const interceptor = new TransformInterceptor(cls);
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler(null)));
    expect(typeof result.traceId).toBe('string');
    expect(result.traceId.length).toBeGreaterThan(0);
  });

  it('falls back to randomUUID when no CLS provided', async () => {
    const interceptor = new TransformInterceptor();
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler(42)));
    expect(result.data).toBe(42);
    expect(typeof result.traceId).toBe('string');
  });

  it('does not treat an object with only data (no meta) as paginated', async () => {
    const cls = mockCls('t1') as any;
    const interceptor = new TransformInterceptor(cls);
    const obj = { data: 'inner' };
    const result = await firstValueFrom(interceptor.intercept(mockContext, mockHandler(obj)));
    expect(result.data).toEqual({ data: 'inner' });
  });
});
