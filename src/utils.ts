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
