import { AsyncLocalStorage } from 'async_hooks';
import type { ReplayStackBreadcrumb } from './types';

interface ReplayStackContextStore {
  breadcrumbs: ReplayStackBreadcrumb[];
}

const storage = new AsyncLocalStorage<ReplayStackContextStore>();

export function runWithReplayStackContext<T>(callback: () => T): T {
  return storage.run({ breadcrumbs: [] }, callback);
}

export function getContextBreadcrumbs(): ReplayStackBreadcrumb[] | undefined {
  return storage.getStore()?.breadcrumbs;
}

export function addContextBreadcrumb(breadcrumb: ReplayStackBreadcrumb, maxBreadcrumbs: number): boolean {
  const store = storage.getStore();
  if (!store) return false;

  store.breadcrumbs.push(breadcrumb);

  if (store.breadcrumbs.length > maxBreadcrumbs) {
    store.breadcrumbs = store.breadcrumbs.slice(store.breadcrumbs.length - maxBreadcrumbs);
  }

  return true;
}

export function clearContextBreadcrumbs(): boolean {
  const store = storage.getStore();
  if (!store) return false;
  store.breadcrumbs = [];
  return true;
}
