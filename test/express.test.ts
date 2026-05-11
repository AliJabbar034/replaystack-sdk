import { EventEmitter } from 'node:events';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import { ReplayStack } from '../src/client';
import { replayStackExpressErrorMiddleware, replayStackExpressMiddleware } from '../src/express';

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
    headers: {},
    ip: '::1',
    body: {},
    ...overrides,
  } as ExpressRequest;
}

describe('replayStackExpressMiddleware', () => {
  it('calls next immediately for ignored paths without capturing', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
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
  });

  it('respects shouldCapture returning false', async () => {
    const fetchImpl = mockFetch();
    const client = new ReplayStack({
      apiKey: 'k',
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
  });
});
