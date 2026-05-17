import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCaptureLogs } from '../src/logs';

describe('resolveCaptureLogs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to true when unset', () => {
    expect(resolveCaptureLogs()).toBe(true);
    expect(resolveCaptureLogs(undefined)).toBe(true);
  });

  it('respects explicit config false', () => {
    expect(resolveCaptureLogs(false)).toBe(false);
  });

  it('respects explicit config true', () => {
    expect(resolveCaptureLogs(true)).toBe(true);
  });

  it('respects REPLAYSTACK_CAPTURE_LOGS=false', () => {
    vi.stubEnv('REPLAYSTACK_CAPTURE_LOGS', 'false');
    expect(resolveCaptureLogs()).toBe(false);
  });

  it('config false wins over env true', () => {
    vi.stubEnv('REPLAYSTACK_CAPTURE_LOGS', 'true');
    expect(resolveCaptureLogs(false)).toBe(false);
  });
});
