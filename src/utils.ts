import { randomUUID } from 'crypto';
import { parseStackTrace } from './stacktrace';
import type { ReplayStackStackFrame } from './types';

const DEFAULT_MASK_FIELDS = [
  'authorization',
  'password',
  'passwd',
  'token',
  'access_token',
  'refresh_token',
  'apiKey',
  'api_key',
  'secret',
  'client_secret',
  'cookie',
  'set-cookie',
  'cardNumber',
  'card_number',
  'cvv',
  'otp',
];

export function createTraceId(): string {
  return randomUUID();
}

export function normalizeEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return endpoint;
  try {
    const url = new URL(endpoint, 'http://placeholder.local');
    return url.pathname;
  } catch {
    return endpoint.split('?')[0];
  }
}

/**
 * When `candidate` is already an absolute `http(s)` URL, return normalized `href`
 * (e.g. from `Request.url` in Next.js App Router).
 */
export function normalizeAbsoluteRequestUrl(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  try {
    return new URL(candidate).href;
  } catch {
    return undefined;
  }
}

export type RequestUrlHeaderGetter = (name: string) => string | string[] | undefined | null;

/**
 * Builds `https://host/path?query` from path+query plus forwarded / Host headers (Express, Nest, Pages API).
 */
export function buildAbsoluteRequestUrlFromParts(parts: {
  pathWithQuery: string;
  getHeader?: RequestUrlHeaderGetter;
  protocolFallback?: string;
}): string | undefined {
  const raw = parts.pathWithQuery ?? '';
  if (!raw && raw !== '') return undefined;

  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).href;
    } catch {
      return raw;
    }
  }

  const get = parts.getHeader;
  const xfHost = get?.('x-forwarded-host');
  const forwardedHost = xfHost != null && xfHost !== '' ? (String(xfHost).split(',')[0]?.trim() ?? '') : '';
  const h = get?.('host');
  const host = (forwardedHost || (h != null && h !== '' ? String(h).split(',')[0]?.trim() : '') || '').trim();
  if (!host) return undefined;

  const xfProto = get?.('x-forwarded-proto');
  const forwardedProto = xfProto != null && xfProto !== '' ? (String(xfProto).split(',')[0]?.trim() ?? '') : '';
  const proto = (forwardedProto || parts.protocolFallback || 'http').replace(/:$/, '');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${proto}://${host}${path}`;
}

/** Truncate a UTF-8 string by byte length (for bounded ingest payloads). */
export function truncateUtf8String(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  const buf = Buffer.from(str, 'utf8');
  let end = maxBytes;
  let slice = '';
  while (end > 0) {
    slice = buf.subarray(0, end).toString('utf8');
    if (Buffer.byteLength(slice, 'utf8') <= maxBytes) break;
    end -= 1;
  }
  return `${slice}…`;
}

/** Auth signal preserved alongside captured events; raw token values are NEVER stored. */
export type ReplayStackAuthMode = 'bearer' | 'basic' | 'api_key' | 'cookie' | 'other' | 'none';

export interface DetectedAuth {
  mode: ReplayStackAuthMode;
  /**
   * Original `Authorization` scheme string (e.g. `Bearer`, `Token`, `Hawk`) when present.
   * Surfaced verbatim so the dashboard can show "needs a Bearer token" / "needs Hawk creds" in replay UX.
   */
  scheme?: string;
}

const API_KEY_HEADER_NAMES = new Set([
  'x-api-key',
  'x-apikey',
  'x-auth-token',
  'x-access-token',
  'x-token',
  'apikey',
  'api-key',
  'authentication',
]);

const SESSION_COOKIE_HINTS = ['session', 'sessid', 'sid=', 'auth', 'token', 'jwt', 'jsessionid', 'connect.sid'];

/**
 * Inspect request headers and decide whether the captured request was authenticated.
 * Must be called BEFORE masking; downstream consumers (dashboard, replay) read the
 * result to decide if a token prompt is required to replay the event.
 */
export function detectAuthMode(headers: unknown): DetectedAuth {
  const flat = flattenHeadersForAuthCheck(headers);
  if (!flat) return { mode: 'none' };

  const authzRaw = flat.get('authorization');
  if (authzRaw) {
    const first = String(authzRaw).trim();
    const scheme = first.split(/\s+/, 1)[0]?.trim() || '';
    const schemeLower = scheme.toLowerCase();
    if (schemeLower === 'bearer') return { mode: 'bearer', scheme };
    if (schemeLower === 'basic') return { mode: 'basic', scheme };
    if (schemeLower === 'token' || schemeLower === 'apikey' || schemeLower === 'api-key') {
      return { mode: 'api_key', scheme };
    }
    return { mode: 'other', scheme: scheme || undefined };
  }

  for (const name of API_KEY_HEADER_NAMES) {
    if (flat.get(name)) {
      return { mode: 'api_key', scheme: name };
    }
  }

  const cookie = flat.get('cookie');
  if (cookie) {
    const lower = String(cookie).toLowerCase();
    if (SESSION_COOKIE_HINTS.some((hint) => lower.includes(hint))) {
      return { mode: 'cookie' };
    }
    return { mode: 'cookie' };
  }

  return { mode: 'none' };
}

function flattenHeadersForAuthCheck(headers: unknown): Map<string, string> | undefined {
  if (!headers) return undefined;
  const out = new Map<string, string>();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((v, k) => out.set(k.toLowerCase(), v));
    return out;
  }
  if (typeof headers !== 'object') return undefined;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (v == null) continue;
    const value = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : String(v);
    out.set(k.toLowerCase(), value);
  }
  return out;
}

export function shouldIgnorePath(path: string | undefined, ignoredPaths: string[] = []): boolean {
  if (!path) return false;
  return ignoredPaths.some((ignored) => {
    if (!ignored) return false;
    if (ignored.endsWith('*')) return path.startsWith(ignored.slice(0, -1));
    return path === ignored || path.startsWith(ignored);
  });
}

export function shouldSample(sampleRate = 1): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return Math.random() <= sampleRate;
}

export function maskSensitiveData<T>(value: T, customFields: string[] = []): T {
  const fields = new Set([...DEFAULT_MASK_FIELDS, ...customFields].map((f) => f.toLowerCase()));
  return deepMask(value, fields, new WeakSet()) as T;
}

function deepMask(value: unknown, fields: Set<string>, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => deepMask(item, fields, seen));
  }

  const output: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (fields.has(key.toLowerCase())) {
      output[key] = '[MASKED]';
    } else {
      output[key] = deepMask(val, fields, seen);
    }
  }

  return output;
}

export function safeJsonClone(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value, circularReplacer()));
  } catch {
    return String(value);
  }
}

function circularReplacer() {
  const seen = new WeakSet();
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

export function truncatePayload(value: unknown, maxBytes: number): unknown {
  if (value === undefined || value === null) return value;

  const json = JSON.stringify(value);
  const size = Buffer.byteLength(json, 'utf8');

  if (size <= maxBytes) return value;

  return {
    __truncated: true,
    originalSizeBytes: size,
    maxSizeBytes: maxBytes,
    preview: json.slice(0, Math.min(maxBytes, 2000)),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getErrorDetails(error: unknown): {
  errorName?: string;
  errorMessage?: string;
  stackTrace?: string;
  stackFrames?: ReplayStackStackFrame[];
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stackTrace: error.stack,
      stackFrames: parseStackTrace(error.stack),
    };
  }

  if (typeof error === 'string') {
    return { errorMessage: error, stackFrames: [] };
  }

  return { errorMessage: safeStringify(error), stackFrames: [] };
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, circularReplacer());
  } catch {
    return String(value);
  }
}

export function headersToObject(headers: unknown): Record<string, unknown> | undefined {
  if (!headers) return undefined;

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (typeof headers === 'object') {
    return { ...(headers as Record<string, unknown>) };
  }

  return undefined;
}
