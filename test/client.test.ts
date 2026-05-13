import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayStack, createReplayStackClient } from '../src/client';

function mockOkFetch(): Mock<typeof fetch> {
  const fn = vi.fn<typeof fetch>();
  fn.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  } as unknown as globalThis.Response);
  return fn;
}

describe('ReplayStack', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when apiKey missing', () => {
    expect(() => new ReplayStack({ apiKey: '' })).toThrow(/apiKey is required/i);
  });

  it('throws when fetch is unavailable', () => {
    vi.stubGlobal('fetch', undefined as unknown as typeof fetch);
    try {
      expect(() => new ReplayStack({ apiKey: 'key' })).toThrow(/fetch/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('strips trailing slash from endpoint when posting', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'secret',
      endpoint: 'https://edge.test/',
      fetchImpl: fetchImpl,
      retries: 0,
    });

    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/widgets',
      status: 'success',
      statusCode: 200,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://edge.test/api/v1/ingest/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-tracereplay-api-key': 'secret',
        }),
      }),
    );
  });

  it('uses REPLAYSTACK_ENDPOINT when endpoint not set on config', async () => {
    vi.stubEnv('REPLAYSTACK_ENDPOINT', 'https://from-env.example');
    const fetchImpl = mockOkFetch();
    await createReplayStackClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }).captureEvent({
      eventType: 'custom',
      endpoint: '/x',
      status: 'success',
      statusCode: 200,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://from-env.example/api/v1/ingest/events', expect.anything());
  });

  it('defaults to ReplayStack Cloud when no endpoint env or option', async () => {
    const fetchImpl = mockOkFetch();
    await createReplayStackClient({
      apiKey: 'k',
      fetchImpl: fetchImpl,
    }).captureEvent({
      eventType: 'custom',
      endpoint: '/',
      status: 'success',
      statusCode: 200,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.replaystack.co/api/v1/ingest/events', expect.anything());
  });

  it('annotates outgoing events with detected auth mode based on request headers', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    await client.captureEvent({
      eventType: 'api',
      method: 'GET',
      endpoint: '/me',
      requestHeaders: { Authorization: 'Bearer ey.j.w.t' },
      status: 'failed',
      statusCode: 500,
    });

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(init.body as string);
    expect(payload.authMode).toBe('bearer');
    expect(payload.authScheme).toBe('Bearer');
    // The Authorization value itself remains masked end-to-end.
    expect(payload.requestHeaders.Authorization).toBe('[MASKED]');
  });

  it('marks an event as `none` when no auth headers are present', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });

    await client.captureEvent({
      eventType: 'api',
      method: 'GET',
      endpoint: '/status',
      requestHeaders: { 'content-type': 'application/json' },
      status: 'success',
      statusCode: 200,
    });

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(init.body as string);
    expect(payload.authMode).toBe('none');
  });

  it('returns null when disabled', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      enabled: false,
      fetchImpl: fetchImpl,
    });
    const res = await client.captureEvent({
      eventType: 'custom',
      endpoint: '/z',
      status: 'success',
      statusCode: 200,
    });
    expect(res).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips success events when captureSuccess is false', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      captureSuccess: false,
      fetchImpl: fetchImpl,
    });
    expect(
      await client.captureEvent({
        eventType: 'api',
        endpoint: '/ok',
        status: 'success',
        statusCode: 200,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still sends failed events when captureSuccess is false', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      captureSuccess: false,
      fetchImpl: fetchImpl,
      retries: 0,
    });
    await client.captureEvent({
      eventType: 'api',
      endpoint: '/bad',
      status: 'failed',
      statusCode: 500,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('skips paths on ignoredPaths', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      ignoredPaths: ['/skip'],
      fetchImpl: fetchImpl,
    });
    expect(
      await client.captureEvent({
        eventType: 'api',
        endpoint: '/skip',
        status: 'success',
        statusCode: 200,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null when sample rate excludes event', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      sampleRate: 0,
      fetchImpl: fetchImpl,
    });
    expect(
      await client.captureEvent({
        eventType: 'custom',
        endpoint: '/rare',
        status: 'success',
        statusCode: 200,
      }),
    ).toBeNull();
  });

  it('invokes onError after failed ingest with no retries', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'bad key' }),
    } as unknown as globalThis.Response);

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl,
      retries: 0,
      onError,
    });

    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/e',
      status: 'success',
      statusCode: 200,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]?.message).toMatch(/bad key|401/);
  });

  it('captureException forwards to ingest', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl,
      retries: 0,
    });

    await client.captureException(new Error('oops'), { endpoint: '/api' });

    expect(fetchImpl).toHaveBeenCalled();
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toBe('oops');
  });

  it('does not append empty breadcrumbs', () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl,
    });
    client.addBreadcrumb('', {});
    expect(client.getBreadcrumbs().length).toBe(0);
  });

  it('flush resolves', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl,
    });
    await expect(client.flush()).resolves.toBeUndefined();
  });

  it('queues failed ingest and flush sends when API recovers', async () => {
    let stable = false;
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async () => {
      if (!stable) {
        throw new Error('connection refused');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as unknown as globalThis.Response;
    });

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
      offlineQueueMax: 50,
    });

    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/q',
      status: 'success',
      statusCode: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    stable = true;
    await client.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await client.close();
  });

  it('does not queue when offlineQueueMax is 0', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockRejectedValue(new Error('down'));

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
      offlineQueueMax: 0,
    });

    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/q',
      status: 'success',
      statusCode: 200,
    });
    await client.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('drops oldest when queue exceeds offlineQueueMax', async () => {
    const onQueueDrop = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockRejectedValue(new Error('down'));

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
      offlineQueueMax: 1,
      onQueueDrop,
    });

    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/first',
      status: 'success',
      statusCode: 200,
    });
    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/second',
      status: 'success',
      statusCode: 200,
    });
    expect(onQueueDrop).toHaveBeenCalled();

    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as globalThis.Response);

    await client.flush();
    const lastCall = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
    const body = JSON.parse((lastCall[1] as RequestInit).body as string);
    expect(body.endpoint).toBe('/second');
    await client.close();
  });

  it('flushInterval triggers periodic flush', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async () => {
      n += 1;
      if (n === 1) {
        throw new Error('down');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as unknown as globalThis.Response;
    });

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
      flushIntervalMs: 5_000,
      offlineQueueMax: 10,
    });

    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/tick',
      status: 'success',
      statusCode: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    await client.close();
  });

  it('close disables new captures', async () => {
    const fetchImpl = mockOkFetch();
    const client = new ReplayStack({ apiKey: 'k', fetchImpl, retries: 0 });
    await client.close();
    await client.captureEvent({
      eventType: 'custom',
      endpoint: '/x',
      status: 'success',
      statusCode: 200,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
