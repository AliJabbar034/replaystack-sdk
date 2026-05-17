import type { ReplayStackLog, ReplayStackLogLevel } from './types';

const LOG_LEVEL_RANK: Record<ReplayStackLogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

/** Returns true when `level` meets or exceeds the configured minimum. */
export function logMeetsMinLevel(level: ReplayStackLogLevel, minLevel: ReplayStackLogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[minLevel];
}

/** Default `true`; set `config.captureLogs: false` or `REPLAYSTACK_CAPTURE_LOGS=false` to disable. */
export function resolveCaptureLogs(configValue?: boolean): boolean {
  if (configValue === false) return false;
  if (configValue === true) return true;

  const env = process.env.REPLAYSTACK_CAPTURE_LOGS?.trim().toLowerCase();
  if (env === 'false' || env === '0') return false;
  if (env === 'true' || env === '1') return true;

  return true;
}

export function normalizeLogs(logs?: ReplayStackLog[]): ReplayStackLog[] {
  if (!logs?.length) return [];
  return logs.map((log) => ({
    level: log.level,
    message: log.message,
    timestamp: log.timestamp ?? new Date().toISOString(),
    ...(log.metadata != null && typeof log.metadata === 'object' && !Array.isArray(log.metadata)
      ? { metadata: log.metadata as Record<string, unknown> }
      : {}),
  }));
}
