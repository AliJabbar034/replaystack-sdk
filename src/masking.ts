/**
 * Shared field masking for payloads, headers, breadcrumb metadata, and log metadata.
 */

export const DEFAULT_MASK_FIELDS = [
  'authorization',
  'password',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'secret',
  'cookie',
  'session',
  'cardNumber',
  'card_number',
  'otp',
];

export interface ReplayStackRemoteMaskingRules {
  fields?: string[];
}

export type MaskFieldConfig = {
  maskFields?: string[];
  remoteMaskingRules?: ReplayStackRemoteMaskingRules;
};

/** Merges SDK defaults, user `maskFields`, and dashboard `remoteMaskingRules.fields`. */
export function resolveMaskFields(config: MaskFieldConfig = {}): string[] {
  const merged = new Set<string>();
  for (const field of DEFAULT_MASK_FIELDS) {
    merged.add(field.toLowerCase());
  }
  for (const field of config.maskFields ?? []) {
    if (field) merged.add(field.toLowerCase());
  }
  for (const field of config.remoteMaskingRules?.fields ?? []) {
    if (field) merged.add(field.toLowerCase());
  }
  return [...merged];
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
