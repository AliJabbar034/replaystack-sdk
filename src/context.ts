import { AsyncLocalStorage } from 'async_hooks';
import type { ReplayStackBreadcrumb, ReplayStackLog } from './types';

interface ReplayStackContextStore {
  breadcrumbs: ReplayStackBreadcrumb[];
  logs: ReplayStackLog[];
}

const storage = new AsyncLocalStorage<ReplayStackContextStore>();

export function runWithReplayStackContext<T>(callback: () => T): T {
  return storage.run({ breadcrumbs: [], logs: [] }, callback);
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

export function getContextLogs(): ReplayStackLog[] | undefined {
  return storage.getStore()?.logs;
}

export function addContextLog(log: ReplayStackLog, maxLogs: number): boolean {
  const store = storage.getStore();
  if (!store) return false;

  store.logs.push(log);

  if (store.logs.length > maxLogs) {
    store.logs = store.logs.slice(store.logs.length - maxLogs);
  }

  return true;
}

export function clearContextLogs(): boolean {
  const store = storage.getStore();
  if (!store) return false;
  store.logs = [];
  return true;
}
