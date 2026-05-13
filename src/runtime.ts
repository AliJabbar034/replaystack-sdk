import type { ReplayStack } from './client';
import type { InstallReplayStackProcessGuardsOptions } from './types';

/**
 * Registers Node process hooks so runtime failures are captured and the offline queue is flushed on shutdown.
 * Returns an unsubscribe function. Safe to call in non-Node environments (no-op).
 */
export function installReplayStackProcessGuards(
  client: ReplayStack,
  options: InstallReplayStackProcessGuardsOptions = {},
): () => void {
  if (typeof process === 'undefined' || typeof process.on !== 'function') {
    return () => {};
  }

  const {
    unhandledRejection = true,
    uncaughtException = true,
    flushOnShutdown = true,
    shutdownSignals = ['SIGINT', 'SIGTERM'],
  } = options;

  const unsubs: Array<() => void> = [];

  const capture = (reason: unknown, endpoint: string) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void client.captureException(err, {
      eventType: 'custom',
      endpoint,
      statusCode: 500,
    });
  };

  if (unhandledRejection) {
    const fn = (reason: unknown) => {
      capture(reason, '/runtime/unhandledRejection');
    };
    process.on('unhandledRejection', fn);
    unsubs.push(() => process.off('unhandledRejection', fn));
  }

  if (uncaughtException) {
    const fn = (error: Error) => {
      void client.captureException(error, {
        eventType: 'custom',
        endpoint: '/runtime/uncaughtException',
        statusCode: 500,
      });
    };
    process.on('uncaughtException', fn);
    unsubs.push(() => process.off('uncaughtException', fn));
  }

  if (flushOnShutdown) {
    const beforeExit = () => {
      void client.flush();
    };
    process.on('beforeExit', beforeExit);
    unsubs.push(() => process.off('beforeExit', beforeExit));

    const onSignal = () => {
      void client.flush();
    };
    for (const sig of shutdownSignals) {
      process.on(sig, onSignal);
      unsubs.push(() => process.off(sig, onSignal));
    }
  }

  return () => {
    for (const u of unsubs) {
      u();
    }
  };
}
