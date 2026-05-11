import { describe, expect, it } from 'vitest';
import {
  createReplayStackClient,
  createReplayStackNestExceptionFilter,
  createReplayStackNestInterceptor,
  createTraceId,
  parseStackTrace,
  replayStackExpressErrorMiddleware,
  replayStackExpressMiddleware,
  withReplayStackNext,
  withReplayStackNextApi,
} from '../src/index';

describe('package exports', () => {
  it('exports client and trace helpers', () => {
    expect(typeof createReplayStackClient).toBe('function');
    expect(typeof createTraceId).toBe('function');
    expect(typeof parseStackTrace).toBe('function');
  });

  it('exports framework wrappers', () => {
    expect(typeof replayStackExpressMiddleware).toBe('function');
    expect(typeof replayStackExpressErrorMiddleware).toBe('function');
    expect(typeof withReplayStackNext).toBe('function');
    expect(typeof withReplayStackNextApi).toBe('function');
    expect(createReplayStackNestInterceptor({ client: {} as never })).toBeTruthy();
    expect(createReplayStackNestExceptionFilter({ client: {} as never })).toBeTruthy();
  });
});
