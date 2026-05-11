import { describe, expect, it } from 'vitest';
import { parseStackTrace } from '../src/stacktrace';

describe('parseStackTrace', () => {
  it('returns empty array for missing stack', () => {
    expect(parseStackTrace()).toEqual([]);
  });

  it('parses V8 frames with function name', () => {
    const stack = `Error: boom
    at inner (/app/src/svc.ts:10:5)
    at outer (/app/src/svc.ts:20:15)`;

    const frames = parseStackTrace(stack);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0]).toMatchObject({
      functionName: 'inner',
      fileName: '/app/src/svc.ts',
      lineNumber: 10,
      columnNumber: 5,
    });
  });

  it('parses anonymous file:line frames', () => {
    const stack = `Err
    at /app/task.js:3:14`;
    const frames = parseStackTrace(stack);
    expect(frames[0]).toMatchObject({
      fileName: '/app/task.js',
      lineNumber: 3,
      columnNumber: 14,
    });
  });

  it('keeps raw for non-matching lines', () => {
    const frames = parseStackTrace('Error:\n    at strange line without colon');
    expect(frames[0]?.raw).toContain('strange line');
  });
});
