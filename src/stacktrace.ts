import type { ReplayStackStackFrame } from './types';

/**
 * Parses V8/Node.js stack traces into structured frames.
 *
 * Supported examples:
 *   at createOrder (/app/src/controllers/order.controller.ts:42:15)
 *   at /app/src/controllers/order.controller.ts:42:15
 *   at async processOrder (/app/src/services/order.service.ts:88:9)
 */
export function parseStackTrace(stack?: string): ReplayStackStackFrame[] {
  if (!stack) return [];

  const lines = stack.split('\n').slice(1);

  return lines.map((line) => parseStackLine(line)).filter((frame): frame is ReplayStackStackFrame => Boolean(frame));
}

function parseStackLine(line: string): ReplayStackStackFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/^at\s+async\s+/, 'at ');

  const matchWithFunction = normalized.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
  if (matchWithFunction) {
    return {
      functionName: matchWithFunction[1],
      fileName: matchWithFunction[2],
      lineNumber: Number(matchWithFunction[3]),
      columnNumber: Number(matchWithFunction[4]),
      raw: trimmed,
    };
  }

  const matchWithoutFunction = normalized.match(/^at\s+(.+):(\d+):(\d+)$/);
  if (matchWithoutFunction) {
    return {
      fileName: matchWithoutFunction[1],
      lineNumber: Number(matchWithoutFunction[2]),
      columnNumber: Number(matchWithoutFunction[3]),
      raw: trimmed,
    };
  }

  return { raw: trimmed };
}

/** Prefer the first app frame (skip node_modules); fallback to first frame. */
export function pickPrimaryStackFrame(frames?: ReplayStackStackFrame[]): ReplayStackStackFrame | undefined {
  if (!frames?.length) return undefined;
  const app = frames.find((f) => f.fileName && !f.fileName.includes('node_modules') && !f.fileName.startsWith('node:'));
  return app ?? frames[0];
}

export function formatStackFrameLocation(frame: ReplayStackStackFrame): string | undefined {
  if (!frame.fileName || frame.lineNumber == null) return undefined;
  const file = frame.fileName.replace(/\\/g, '/');
  const parts = file.split('/');
  const short = parts.length > 3 ? parts.slice(-3).join('/') : file;
  const fn = frame.functionName ? `${frame.functionName} ` : '';
  const col = frame.columnNumber != null ? `:${frame.columnNumber}` : '';
  return `${fn}@ ${short}:${frame.lineNumber}${col}`;
}
