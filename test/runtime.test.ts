import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplayStack } from '../src/client';
import { installReplayStackProcessGuards } from '../src/runtime';

describe('installReplayStackProcessGuards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers handlers and unsubscribe removes them', () => {
    const onSpy = vi.spyOn(process, 'on');
    const offSpy = vi.spyOn(process, 'off');
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as globalThis.Response);

    const client = new ReplayStack({
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    });
    const unsub = installReplayStackProcessGuards(client, {
      flushOnShutdown: true,
      unhandledRejection: true,
      uncaughtException: true,
    });

    expect(onSpy).toHaveBeenCalled();
    unsub();
    expect(offSpy).toHaveBeenCalled();

    void client.close();
  });
});
