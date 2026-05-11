import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import { ReplayStack } from '../src/client';
import { withReplayStackNext, withReplayStackNextApi } from '../src/nextjs';

function mockFetch(): Mock<typeof fetch> {
  const fn = vi.fn<typeof fetch>();
  fn.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as unknown as globalThis.Response);
  return fn;
}

describe('withReplayStackNext', () => {
  it('runs handler, captures event, and sets x-trace-id', async () => {
    const fetchImpl = mockFetch();
    const captureSpy = vi.spyOn(ReplayStack.prototype, 'captureEvent').mockResolvedValue({ success: true } as never);

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl,
      retries: 0,
    });

    const wrapped = withReplayStackNext(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      { client },
    );

    const req = new Request('http://localhost/app/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qty: 2 }),
    });

    const out = await wrapped(req as Request);

    expect(out.headers.get('x-trace-id')).toBeTruthy();
    expect(captureSpy).toHaveBeenCalled();
    const payload = captureSpy.mock.calls[0][0];
    expect(payload.method).toBe('POST');
    expect(payload.endpoint).toBe('/app/api/orders');
    expect(payload.requestUrl).toBe('http://localhost/app/api/orders');
    expect(payload.status).toBe('success');

    captureSpy.mockRestore();
  });

  it('honors options.endpoint override', async () => {
    const fetchImpl = mockFetch();
    const captureSpy = vi.spyOn(ReplayStack.prototype, 'captureEvent').mockResolvedValue({ success: true } as never);
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    const wrapped = withReplayStackNext(async () => new Response('plain', { status: 200 }), {
      client,
      endpoint: '/custom-route',
    });

    await wrapped(new Request('http://localhost/long/url'));

    expect(captureSpy.mock.calls[0][0].endpoint).toBe('/custom-route');
    captureSpy.mockRestore();
  });

  it('skips capture when shouldCapture is false', async () => {
    const fetchImpl = mockFetch();
    const captureSpy = vi.spyOn(ReplayStack.prototype, 'captureEvent').mockResolvedValue(null);
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    const wrapped = withReplayStackNext(async () => new Response(null, { status: 204 }), {
      client,
      shouldCapture: () => false,
    });

    await wrapped(new Request('http://localhost/x'));

    expect(captureSpy).not.toHaveBeenCalled();
    captureSpy.mockRestore();
  });

  it('captures failure when handler throws', async () => {
    const fetchImpl = mockFetch();
    const captureSpy = vi.spyOn(ReplayStack.prototype, 'captureEvent').mockResolvedValue(null);
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    const wrapped = withReplayStackNext(
      async () => {
        throw new Error('route exploded');
      },
      { client },
    );

    await expect(wrapped(new Request('http://localhost/fail'))).rejects.toThrow('route exploded');

    expect(captureSpy).toHaveBeenCalled();
    expect(captureSpy.mock.calls[0][0].status).toBe('failed');
    expect(captureSpy.mock.calls[0][0].statusCode).toBe(500);

    captureSpy.mockRestore();
  });
});

describe('withReplayStackNextApi', () => {
  it('captures pages router flow when handler calls res.json', async () => {
    const fetchImpl = mockFetch();
    const captureSpy = vi.spyOn(ReplayStack.prototype, 'captureEvent').mockResolvedValue(null);
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    const wrapped = withReplayStackNextApi(
      (req, res) => {
        (res as { statusCode: number }).statusCode = 200;
        return (res as { json: (b: unknown) => void }).json({ page: true });
      },
      { client },
    );

    const req = {
      method: 'GET',
      url: '/api/pages-test',
      headers: { host: 'localhost:3000' },
      body: {},
      protocol: 'http',
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeaders: vi.fn(() => ({})),
      json(this: { statusCode: number }, body: unknown) {
        return body;
      },
    };

    await wrapped(req as never, res as never);

    expect(captureSpy).toHaveBeenCalled();
    expect(captureSpy.mock.calls[0][0].endpoint).toBe('/api/pages-test');
    expect(captureSpy.mock.calls[0][0].requestUrl).toBe('http://localhost:3000/api/pages-test');
    expect(captureSpy.mock.calls[0][0].responsePayload).toEqual({ page: true });

    captureSpy.mockRestore();
  });

  it('captures exception path with status from response when >= 400', async () => {
    const fetchImpl = mockFetch();
    const captureSpy = vi.spyOn(ReplayStack.prototype, 'captureEvent').mockResolvedValue(null);
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    const wrapped = withReplayStackNextApi(
      () => {
        throw Object.assign(new Error('visible'), { expose: true });
      },
      { client },
    );

    const req = {
      method: 'POST',
      url: '/api/e',
      headers: { host: '127.0.0.1:3000' },
      body: {},
      protocol: 'http',
      socket: {},
    };
    const res = {
      statusCode: 418,
      setHeader: vi.fn(),
      getHeaders: vi.fn(() => ({})),
      json: vi.fn(),
    };

    await expect(wrapped(req as never, res as never)).rejects.toThrow();

    expect(captureSpy.mock.calls[0][0].statusCode).toBe(418);

    captureSpy.mockRestore();
  });
});
