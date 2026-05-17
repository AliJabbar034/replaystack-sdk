import { EventEmitter } from 'node:events';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import { ReplayStack } from '../src/client';
import { captureFailure, replayStackExpressErrorMiddleware, replayStackExpressMiddleware } from '../src/express';

function mockFetch(): Mock<typeof fetch> {
  const fn = vi.fn<typeof fetch>();
  fn.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as unknown as globalThis.Response);
  return fn;
}

function mockResponse(): ExpressResponse & EventEmitter {
  type JsonSendThis = ExpressResponse & EventEmitter;

  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    getHeaders: vi.fn(() => ({})),
    locals: {} as Record<string, unknown>,
    json: vi.fn(function (this: JsonSendThis, body: unknown) {
      (this as unknown as { _jsonBody?: unknown })._jsonBody = body;
      return this;
    }),
    send: vi.fn(function (this: JsonSendThis, body: unknown) {
      (this as unknown as { _sendBody?: unknown })._sendBody = body;
      return this;
    }),
  }) as unknown as ExpressResponse & EventEmitter;
  return res;
}

function mockRequest(overrides: Partial<ExpressRequest> = {}): ExpressRequest {
  return {
    method: 'GET',
    originalUrl: '/path',
    path: '/path',
    url: '/path',
    protocol: 'https',
    headers: {},
    ip: '::1',
    body: {},
    get(name: string) {
      if (name === 'host') return 'api.example.com';
      return undefined;
    },
    ...overrides,
  } as ExpressRequest;
}

describe('replayStackExpressMiddleware', () => {
  it('calls next immediately for ignored paths without capturing', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      captureSuccess: true,
      fetchImpl: fetchImpl,
    });
    const mw = replayStackExpressMiddleware(client);
    const next = vi.fn() as NextFunction;

    mw(mockRequest({ originalUrl: '/health', path: '/health' }), mockResponse(), next);

    expect(next).toHaveBeenCalled();
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('captures api traffic on finish', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      captureSuccess: true,
      fetchImpl: fetchImpl,
    });
    const mw = replayStackExpressMiddleware(client);
    const req = mockRequest({ originalUrl: '/orders', path: '/orders' });
    const res = mockResponse();
    const next = vi.fn(() => {
      res.json({ created: true });
    }) as NextFunction;

    mw(req, res, next);

    await new Promise<void>((resolve) => {
      res.once('finish', resolve);
      res.emit('finish');
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v1/ingest/events');

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(init.body as string);
    expect(payload.method).toBe('GET');
    expect(payload.endpoint).toBe('/orders');
    expect(payload.requestUrl).toBe('https://api.example.com/orders');
  });

  it('respects shouldCapture returning false', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      captureSuccess: true,
      fetchImpl: fetchImpl,
    });
    const mw = replayStackExpressMiddleware(client, {
      shouldCapture: () => false,
    });
    const res = mockResponse();
    const next = vi.fn(() => res.json({})) as NextFunction;

    mw(mockRequest(), res, next);
    await new Promise<void>((resolve) => {
      res.once('finish', resolve);
      res.emit('finish');
    });

    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('replayStackExpressErrorMiddleware', () => {
  it('marks error captured and reports failed event', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl,
      retries: 0,
    });
    const errMw = replayStackExpressErrorMiddleware(client);
    const req = mockRequest({ method: 'POST', originalUrl: '/fail', path: '/fail' });
    const res = mockResponse();
    res.statusCode = 500;
    const next = vi.fn() as NextFunction;

    errMw(new Error('handler blew up'), req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(init.body as string);
    expect(payload.status).toBe('failed');
    expect(payload.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: 'handler blew up',
        }),
      ]),
    );
  });

  it('uses error.replayStack.responsePayload when present', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl,
      retries: 0,
    });
    const errMw = replayStackExpressErrorMiddleware(client);
    const req = mockRequest({
      method: 'POST',
      originalUrl: '/workflow/provision',
      path: '/workflow/provision',
      body: { orderId: 'ord_1', failAtStep: 3 },
    });
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    const err = new Error('step 3 failed') as Error & {
      replayStack: {
        responsePayload: { steps: [{ name: 'charge_payment'; status: 'failed' }] };
        statusCode?: number;
      };
    };
    err.replayStack = {
      responsePayload: { steps: [{ name: 'charge_payment', status: 'failed' }] },
      statusCode: 500,
    };

    errMw(err, req, res, next);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(init.body as string);
    expect(payload.requestPayload).toEqual({ orderId: 'ord_1', failAtStep: 3 });
    expect(payload.responsePayload).toEqual({
      steps: [{ name: 'charge_payment', status: 'failed' }],
    });
    expect(payload.statusCode).toBe(500);
  });

  it('includes breadcrumbs in responsePayload for plain thrown errors', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({ apiKey: 'k', captureSuccess: true, fetchImpl: fetchImpl, retries: 0 });
    client.addBreadcrumb('step one', { category: 'workflow', level: 'info' });
    const errMw = replayStackExpressErrorMiddleware(client);
    const req = mockRequest({ method: 'POST', body: { orderId: 'x' } });
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    errMw(new Error('failed'), req, res, next);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const payload = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(payload.responsePayload.message).toBe('failed');
    expect(payload.responsePayload.breadcrumbs.length).toBeGreaterThanOrEqual(1);
    expect(payload.requestPayload).toEqual({ orderId: 'x' });
  });
});

describe('captureFailure', () => {
  it('attaches response payload for error middleware', () => {
    const err = captureFailure('workflow stopped', { steps: [{ name: 'pay', status: 'failed' }] });
    expect(err.message).toBe('workflow stopped');
    expect((err as Error & { replayStack: { responsePayload: unknown } }).replayStack.responsePayload).toEqual({
      steps: [{ name: 'pay', status: 'failed' }],
    });
  });
});
