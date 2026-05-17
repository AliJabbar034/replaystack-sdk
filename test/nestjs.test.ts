import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ReplayStack } from '../src/client';
import { createReplayStackNestExceptionFilter, createReplayStackNestInterceptor } from '../src/nestjs';

function mockFetch(): Mock<typeof fetch> {
  const fn = vi.fn<typeof fetch>();
  fn.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as unknown as globalThis.Response);
  return fn;
}

async function drainInterceptor(
  interceptor: NestInterceptor,
  context: ExecutionContext,
  next: CallHandler,
): Promise<void> {
  let result = interceptor.intercept(context, next);
  if (result instanceof Promise) {
    result = await result;
  }
  await firstValueFrom(result);
}

describe('createReplayStackNestInterceptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeHttpContext(req: Record<string, unknown>, res: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as ExecutionContext;
  }

  it('captures successful handler result via tap', async () => {
    const captureEvent = vi.fn().mockResolvedValue(null);
    const addBreadcrumb = vi.fn();
    const client = {
      captureEvent,
      addBreadcrumb,
      getBreadcrumbs: vi.fn(() => []),
    } as unknown as ReplayStack;

    const InterceptorClass = createReplayStackNestInterceptor({
      client,
      automaticFrameworkBreadcrumbs: true,
    });
    const interceptor = new InterceptorClass();

    const req = {
      method: 'GET',
      originalUrl: '/users',
      url: '/users',
      protocol: 'https',
      headers: { 'x-trace-id': 'tid-nest' },
      body: undefined,
      ip: '127.0.0.1',
      get: vi.fn((name: string) => (name === 'host' ? 'nest.test' : undefined)),
    };
    const res = { statusCode: 200, getHeaders: vi.fn(() => ({ 'x-powered-by': 'nest' })) };

    await drainInterceptor(interceptor, makeHttpContext(req, res), {
      handle: () => of({ data: 1 }),
    });

    expect(addBreadcrumb).toHaveBeenCalled();
    expect(captureEvent).toHaveBeenCalledTimes(1);
    const payload = captureEvent.mock.calls[0][0];
    expect(payload.traceId).toBe('tid-nest');
    expect(payload.endpoint).toBe('/users');
    expect(payload.requestUrl).toBe('https://nest.test/users');
    expect(payload.status).toBe('success');
    expect(payload.responsePayload).toEqual({ data: 1 });
  });

  it('skips capture when shouldCapture returns false', async () => {
    const captureEvent = vi.fn();
    const client = {
      captureEvent,
      addBreadcrumb: vi.fn(),
      getBreadcrumbs: vi.fn(() => []),
    } as unknown as ReplayStack;

    const InterceptorClass = createReplayStackNestInterceptor({
      client,
      shouldCapture: () => false,
    });
    const interceptor = new InterceptorClass();

    const req = { method: 'GET', originalUrl: '/skip', headers: {}, ip: '' };
    const res = { statusCode: 200, getHeaders: vi.fn(() => ({})) };

    await drainInterceptor(interceptor, makeHttpContext(req, res), {
      handle: () => of(null),
    });

    expect(captureEvent).not.toHaveBeenCalled();
  });

  it('rethrows errors from the handler', async () => {
    const client = {
      captureEvent: vi.fn(),
      addBreadcrumb: vi.fn(),
      getBreadcrumbs: vi.fn(() => []),
    } as unknown as ReplayStack;

    const InterceptorClass = createReplayStackNestInterceptor({ client });
    const interceptor = new InterceptorClass();

    const req = { method: 'POST', originalUrl: '/boom', headers: {}, ip: '' };
    const res = { statusCode: 500, getHeaders: vi.fn(() => ({})) };

    await expect(
      drainInterceptor(interceptor, makeHttpContext(req, res), {
        handle: () => throwError(() => new Error('fail')),
      }),
    ).rejects.toThrow('fail');
  });

  it('uses getTraceId when provided', async () => {
    const captureEvent = vi.fn().mockResolvedValue(null);
    const client = {
      captureEvent,
      addBreadcrumb: vi.fn(),
      getBreadcrumbs: vi.fn(() => []),
    } as unknown as ReplayStack;

    const InterceptorClass = createReplayStackNestInterceptor({
      client,
      getTraceId: () => 'custom-trace',
    });
    const interceptor = new InterceptorClass();

    const req = { method: 'GET', originalUrl: '/a', headers: {}, ip: '' };
    const res = { statusCode: 200, getHeaders: vi.fn(() => ({})) };

    await drainInterceptor(interceptor, makeHttpContext(req, res), {
      handle: () => of(undefined),
    });

    expect(captureEvent.mock.calls[0][0].traceId).toBe('custom-trace');
  });
});

describe('createReplayStackNestExceptionFilter', () => {
  let fetchImpl: Mock<typeof fetch>;

  beforeEach(() => {
    fetchImpl = mockFetch();
  });

  function makeArgumentsHost(req: Record<string, unknown>, res: Record<string, unknown>) {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    };
  }

  it('sends failed event and responds with JSON when res.status exists', async () => {
    const captureEvent = vi.fn().mockResolvedValue(null);
    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl,
      captureSuccess: false,
      retries: 0,
    });
    vi.spyOn(client, 'captureEvent').mockImplementation(captureEvent);

    const FilterClass = createReplayStackNestExceptionFilter({ client });
    const filter = new FilterClass();

    const statusJson = vi.fn();
    const statusFn = vi.fn().mockReturnValue({ json: statusJson });
    const req = {
      method: 'GET',
      originalUrl: '/err',
      headers: {},
      body: {},
      ip: '10.0.0.1',
    };
    const res = {
      getHeaders: vi.fn(() => ({})),
      status: statusFn,
    };

    await filter.catch(new Error('handled'), makeArgumentsHost(req, res) as never);

    expect(captureEvent).toHaveBeenCalled();
    expect(captureEvent.mock.calls[0][0].status).toBe('failed');
    expect(statusFn).toHaveBeenCalledWith(500);
    expect(statusJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'handled',
      }),
    );
  });

  it('uses HttpException getStatus when present', async () => {
    const captureEvent = vi.fn().mockResolvedValue(null);
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });
    vi.spyOn(client, 'captureEvent').mockImplementation(captureEvent);

    const FilterClass = createReplayStackNestExceptionFilter({ client });
    const filter = new FilterClass();

    const statusJson = vi.fn();
    const statusFn = vi.fn().mockReturnValue({ json: statusJson });
    const req = { method: 'POST', originalUrl: '/v', headers: {}, body: {}, ip: '' };
    const res = { getHeaders: vi.fn(() => ({})), status: statusFn };

    const httpEx = Object.assign(new Error('bad'), {
      getStatus: () => 422,
    });

    await filter.catch(httpEx, makeArgumentsHost(req, res) as never);

    expect(captureEvent.mock.calls[0][0].statusCode).toBe(422);
    expect(statusFn).toHaveBeenCalledWith(422);
  });

  it('throws when response has no status()', async () => {
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });
    vi.spyOn(client, 'captureEvent').mockResolvedValue(null);

    const FilterClass = createReplayStackNestExceptionFilter({ client });
    const filter = new FilterClass();

    const req = { method: 'GET', originalUrl: '/raw', headers: {}, body: {}, ip: '' };
    const res = { getHeaders: vi.fn(() => ({})) };

    await expect(filter.catch(new Error('no-status-fn'), makeArgumentsHost(req, res) as never)).rejects.toThrow(
      'no-status-fn',
    );
  });
});
