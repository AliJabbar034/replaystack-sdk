import { describe, expect, it } from 'vitest';
import {
  createReplayStackClient,
  createTraceId,
  parseStackTrace,
  replayStackExpressErrorMiddleware,
  replayStackExpressMiddleware,
} from '../src/index';
import { createReplayStackNestExceptionFilter, createReplayStackNestInterceptor } from '../src/nestjs';
import { withReplayStackNext, withReplayStackNextApi } from '../src/nextjs';

describe('package exports', () => {
  it('exports client and trace helpers from main entry', () => {
    expect(typeof createReplayStackClient).toBe('function');
    expect(typeof createTraceId).toBe('function');
    expect(typeof parseStackTrace).toBe('function');
  });

  it('exports Express middleware from main entry', () => {
    expect(typeof replayStackExpressMiddleware).toBe('function');
    expect(typeof replayStackExpressErrorMiddleware).toBe('function');
  });

  it('exports Next.js helpers from @replaystack/sdk/nextjs', () => {
    expect(typeof withReplayStackNext).toBe('function');
    expect(typeof withReplayStackNextApi).toBe('function');
  });

  it('exports NestJS helpers from @replaystack/sdk/nestjs', () => {
    expect(createReplayStackNestInterceptor({ client: {} as never })).toBeTruthy();
    expect(createReplayStackNestExceptionFilter({ client: {} as never })).toBeTruthy();
  });
});
