import { describe, expect, it } from 'vitest';
import type { ReplayStackBreadcrumb } from '../src/types';
import {
  addContextBreadcrumb,
  clearContextBreadcrumbs,
  getContextBreadcrumbs,
  runWithReplayStackContext,
} from '../src/context';

describe('replay stack ALS context', () => {
  it('isolates breadcrumbs per async scope', () => {
    const b: ReplayStackBreadcrumb = {
      message: 'a',
      level: 'info',
      timestamp: new Date().toISOString(),
    };

    let outerLen = 0;
    runWithReplayStackContext(() => {
      expect(addContextBreadcrumb(b, 50)).toBe(true);
      expect(getContextBreadcrumbs()?.length).toBe(1);

      runWithReplayStackContext(() => {
        expect(getContextBreadcrumbs()?.length ?? 0).toBe(0);
      });

      outerLen = getContextBreadcrumbs()?.length ?? 0;
    });

    expect(outerLen).toBe(1);
    expect(getContextBreadcrumbs()).toBeUndefined();
  });

  it('trims to max breadcrumbs', () => {
    runWithReplayStackContext(() => {
      for (let i = 0; i < 5; i++) {
        addContextBreadcrumb({ message: `m${i}`, level: 'info', timestamp: new Date().toISOString() }, 2);
      }
      expect(getContextBreadcrumbs()?.length).toBe(2);
      clearContextBreadcrumbs();
      expect(getContextBreadcrumbs()?.length).toBe(0);
    });
  });

  it('returns false when no store', () => {
    const crumb: ReplayStackBreadcrumb = {
      message: 'x',
      level: 'debug',
      timestamp: new Date().toISOString(),
    };
    expect(addContextBreadcrumb(crumb, 50)).toBe(false);
    expect(clearContextBreadcrumbs()).toBe(false);
  });
});
