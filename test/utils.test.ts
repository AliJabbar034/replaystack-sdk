import { describe, expect, it, vi } from 'vitest';
import {
  buildAbsoluteRequestUrlFromParts,
  createTraceId,
  detectAuthMode,
  getErrorDetails,
  headersToObject,
  maskSensitiveData,
  normalizeAbsoluteRequestUrl,
  normalizeEndpoint,
  safeJsonClone,
  shouldIgnorePath,
  shouldSample,
  truncatePayload,
  truncateUtf8String,
} from '../src/utils';

describe('createTraceId', () => {
  it('returns a UUID-shaped string', () => {
    const id = createTraceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('normalizeEndpoint', () => {
  it('returns undefined for missing input', () => {
    expect(normalizeEndpoint()).toBeUndefined();
  });

  it('parses pathname from full URLs', () => {
    expect(normalizeEndpoint('https://x.test/orders?page=2')).toBe('/orders');
  });

  it('fallback splits query for invalid URL strings', () => {
    expect(normalizeEndpoint('/path?foo=bar')).toBe('/path');
  });
});

describe('normalizeAbsoluteRequestUrl', () => {
  it('returns href for absolute URLs', () => {
    expect(normalizeAbsoluteRequestUrl('http://a.test/foo?bar=1')).toBe('http://a.test/foo?bar=1');
  });

  it('returns undefined for path-only strings', () => {
    expect(normalizeAbsoluteRequestUrl('/api/x')).toBeUndefined();
  });
});

describe('buildAbsoluteRequestUrlFromParts', () => {
  it('joins host, path, and query with forwarded proto', () => {
    const u = buildAbsoluteRequestUrlFromParts({
      pathWithQuery: '/v1/items?q=a',
      getHeader: (n) => (n === 'x-forwarded-proto' ? 'https' : n === 'host' ? 'api.example.com' : undefined),
    });
    expect(u).toBe('https://api.example.com/v1/items?q=a');
  });

  it('returns normalized href when path is already absolute', () => {
    expect(
      buildAbsoluteRequestUrlFromParts({
        pathWithQuery: 'https://z.test/a?b=c',
      }),
    ).toBe('https://z.test/a?b=c');
  });
});

describe('truncateUtf8String', () => {
  it('shortens UTF-8 strings and appends an ellipsis marker', () => {
    const heavy = 'é'.repeat(20);
    const out = truncateUtf8String(heavy, 10);
    expect(out.length).toBeLessThan(heavy.length);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('detectAuthMode', () => {
  it('reports none for missing or empty headers', () => {
    expect(detectAuthMode(undefined).mode).toBe('none');
    expect(detectAuthMode({}).mode).toBe('none');
  });

  it('recognizes Bearer tokens and preserves the scheme', () => {
    const got = detectAuthMode({ Authorization: 'Bearer abc.def.ghi' });
    expect(got.mode).toBe('bearer');
    expect(got.scheme).toBe('Bearer');
  });

  it('recognizes Basic auth case-insensitively', () => {
    expect(detectAuthMode({ authorization: 'basic dXNlcjpwYXNz' }).mode).toBe('basic');
  });

  it('treats Token / ApiKey / Api-Key Authorization schemes as api_key', () => {
    expect(detectAuthMode({ Authorization: 'Token xyz' }).mode).toBe('api_key');
    expect(detectAuthMode({ Authorization: 'ApiKey xyz' }).mode).toBe('api_key');
  });

  it('falls back to other for unknown Authorization schemes', () => {
    expect(detectAuthMode({ Authorization: 'Hawk credentials=...' }).mode).toBe('other');
  });

  it('detects custom API-key headers when Authorization is absent', () => {
    expect(detectAuthMode({ 'x-api-key': 'k_live_x' }).mode).toBe('api_key');
    expect(detectAuthMode({ 'X-Auth-Token': 'k' }).mode).toBe('api_key');
  });

  it('detects session cookies', () => {
    expect(detectAuthMode({ Cookie: 'connect.sid=abc; theme=dark' }).mode).toBe('cookie');
  });

  it('works with a Web Headers object', () => {
    const h = new Headers({ Authorization: 'Bearer t' });
    expect(detectAuthMode(h).mode).toBe('bearer');
  });
});

describe('shouldIgnorePath', () => {
  it('does not ignore empty path lists', () => {
    expect(shouldIgnorePath('/health', [])).toBe(false);
  });

  it('supports exact match and prefix wildcard', () => {
    expect(shouldIgnorePath('/health', ['/health'])).toBe(true);
    expect(shouldIgnorePath('/metrics/scrape', ['/metrics*'])).toBe(true);
    expect(shouldIgnorePath('/api/health', ['/metrics*'])).toBe(false);
  });
});

describe('shouldSample', () => {
  it('handles edge rates', () => {
    expect(shouldSample(1)).toBe(true);
    expect(shouldSample(0)).toBe(false);
  });

  it('uses random for fractional rates', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(shouldSample(0.6)).toBe(true);
    spy.mockReturnValue(0.9);
    expect(shouldSample(0.6)).toBe(false);
    spy.mockRestore();
  });
});

describe('maskSensitiveData', () => {
  it('masks default and custom keys case-insensitively', () => {
    const out = maskSensitiveData(
      {
        Authorization: 'secret',
        Password: 'x',
        nested: { token: 't' },
        ok: 'visible',
      },
      ['CUSTOM'],
    );
    expect(out.Authorization).toBe('[MASKED]');
    expect(out.Password).toBe('[MASKED]');
    expect((out as { nested: { token: unknown } }).nested.token).toBe('[MASKED]');
    expect(out.ok).toBe('visible');
  });
});

describe('safeJsonClone', () => {
  it('clones plain objects', () => {
    const o = { a: 1 };
    const c = safeJsonClone(o) as typeof o;
    expect(c).toEqual(o);
    expect(c).not.toBe(o);
  });

  it('handles undefined and circular refs', () => {
    expect(safeJsonClone(undefined)).toBeUndefined();
    const a: Record<string, unknown> = { self: undefined };
    a.self = a;
    const c = safeJsonClone(a) as Record<string, unknown>;
    expect(c.self).toBe('[Circular]');
  });
});

describe('truncatePayload', () => {
  it('returns small payloads untouched', () => {
    expect(truncatePayload({ a: 1 }, 4096)).toEqual({ a: 1 });
  });

  it('truncates oversized JSON', () => {
    const big = { x: 'z'.repeat(10_000) };
    const out = truncatePayload(big, 100) as { __truncated: boolean };
    expect(out.__truncated).toBe(true);
  });
});

describe('getErrorDetails', () => {
  it('extracts from Error', () => {
    const err = new TypeError('nope');
    const d = getErrorDetails(err);
    expect(d.errorName).toBe('TypeError');
    expect(d.errorMessage).toBe('nope');
    expect(d.stackTrace).toContain('TypeError');
  });

  it('handles string and unknown values', () => {
    expect(getErrorDetails('msg').errorMessage).toBe('msg');
    expect(getErrorDetails({ x: 1 }).errorMessage).toContain('x');
  });
});

describe('headersToObject', () => {
  it('handles plain records', () => {
    expect(headersToObject({ a: '1' })).toEqual({ a: '1' });
    expect(headersToObject(null)).toBeUndefined();
  });

  it('converts Headers when available', () => {
    const h = new Headers();
    h.set('X-Custom', 'v');
    expect(headersToObject(h)).toEqual({ 'x-custom': 'v' });
  });
});
