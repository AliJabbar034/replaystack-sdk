import { describe, expect, it } from 'vitest';
import { maskSensitiveData, resolveMaskFields } from '../src/masking';

describe('resolveMaskFields', () => {
  it('merges defaults, maskFields, and remoteMaskingRules', () => {
    const fields = resolveMaskFields({
      maskFields: ['customSecret'],
      remoteMaskingRules: { fields: ['dashboardField'] },
    });
    expect(fields).toContain('password');
    expect(fields).toContain('accesstoken');
    expect(fields).toContain('customsecret');
    expect(fields).toContain('dashboardfield');
  });
});

describe('maskSensitiveData (masking module)', () => {
  it('masks nested keys case-insensitively without throwing on circular refs', () => {
    const circular: Record<string, unknown> = { accessToken: 't', nested: {} };
    (circular.nested as Record<string, unknown>).parent = circular;

    const out = maskSensitiveData(circular, resolveMaskFields()) as Record<string, unknown>;
    expect(out.accessToken).toBe('[MASKED]');
    expect((out.nested as Record<string, unknown>).parent).toBe('[Circular]');
  });
});
