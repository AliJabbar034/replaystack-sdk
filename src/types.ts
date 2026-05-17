export type ReplayStackEventType = 'api' | 'queue' | 'webhook' | 'custom' | 'cron';
export type ReplayStackEventStatus = 'success' | 'failed' | 'warning' | 'pending';
export type ReplayStackLogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface ReplayStackStackFrame {
  functionName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  raw: string;
}

export interface ReplayStackBreadcrumb {
  message: string;
  category?: string;
  level?: ReplayStackLogLevel;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface ReplayStackExceptionContext {
  traceId?: string;
  eventType?: ReplayStackEventType;
  method?: string;
  endpoint?: string;
  /** Absolute URL (scheme, host, path, query) for replay and dashboards. */
  requestUrl?: string;
  requestHeaders?: Record<string, unknown>;
  requestPayload?: unknown;
  responseHeaders?: Record<string, unknown>;
  responsePayload?: unknown;
  statusCode?: number;
  executionTimeMs?: number;
  sourceIp?: string;
  userAgent?: string;
  logs?: ReplayStackLog[];
  metadata?: Record<string, unknown>;
}

export interface ReplayStackConfig {
  /** Project API key generated from ReplayStack dashboard. */
  apiKey: string;

  /** Base URL for ingest (no `/api/v1/...` path). Defaults to `https://api.replaystack.co` when omitted and `REPLAYSTACK_ENDPOINT` is unset. */
  endpoint?: string;

  /** Service/application name shown in ReplayStack dashboard. */
  serviceName?: string;

  /** Environment name shown in ReplayStack dashboard. */
  environment?: 'local' | 'development' | 'staging' | 'production' | string;

  /** App release version. Example: 1.2.0 */
  appVersion?: string;

  /** Git commit hash or deployment SHA. */
  commitHash?: string;

  /** Enable/disable SDK without removing code. */
  enabled?: boolean;

  /** Request timeout when sending event to ReplayStack backend. */
  timeoutMs?: number;

  /** Retry count for failed ingestion requests. */
  retries?: number;

  /** Sampling rate between 0 and 1. Example: 0.1 means capture 10% of events. */
  sampleRate?: number;

  /** Capture successful API responses. Failed responses are captured by default. */
  captureSuccess?: boolean;

  /** Maximum payload size in bytes before SDK truncates it. */
  maxPayloadSizeBytes?: number;

  /** Field names to mask inside payloads, headers, breadcrumb metadata, and log metadata. */
  maskFields?: string[];

  /**
   * Dashboard-provided masking rules (e.g. from remote SDK config).
   * `remoteMaskingRules.fields` is merged with SDK defaults and `maskFields`.
   */
  remoteMaskingRules?: { fields?: string[] };

  /**
   * Attach `captureLog()` lines to captured events. Default `true`.
   * Set to `false` or `REPLAYSTACK_CAPTURE_LOGS=false` to disable.
   */
  captureLogs?: boolean;

  /**
   * Minimum log level to retain when `captureLogs` is true. Default `error`.
   * Can also be set via dashboard remote SDK config.
   */
  logLevel?: ReplayStackLogLevel;

  /** Maximum logs kept in memory per request/client. Default `50`. */
  maxLogs?: number;

  /** URL paths that should never be captured. */
  ignoredPaths?: string[];

  /** Optional custom fetch implementation for tests or custom runtimes. */
  fetchImpl?: typeof fetch;

  /** Maximum number of breadcrumbs to keep in memory per client. */
  maxBreadcrumbs?: number;

  /** Optional hook called when SDK fails internally. */
  onError?: (error: Error) => void;

  /**
   * Max prepared ingest payloads to retain in memory when the API is unreachable (after retries).
   * When full, oldest entries are dropped. Default `100`. Set to `0` to disable offline buffering.
   */
  offlineQueueMax?: number;

  /**
   * If greater than zero, periodically calls `flush()` to drain the offline queue when the API recovers.
   * Useful for long-running servers without a custom health hook.
   */
  flushIntervalMs?: number;

  /**
   * When &gt; 0, buffers prepared events and POSTs to `/ingest/bulk-events` on an interval or when the batch is full.
   * Reduces HTTP overhead (Datadog-style batching). Default off (`0`).
   */
  batchFlushIntervalMs?: number;

  /** Max events per bulk ingest request (backend cap: 100). Default `20`. */
  batchMaxEvents?: number;

  /** Called when the offline queue drops the oldest event because `offlineQueueMax` was exceeded. */
  onQueueDrop?: (info: { reason: 'max_queue_size' }) => void;
}

export interface ReplayStackLog {
  level: ReplayStackLogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  /** ISO-8601 timestamp; assigned by the SDK when omitted. */
  timestamp?: string;
}

export interface ReplayStackEventInput {
  traceId?: string;
  eventType: ReplayStackEventType;
  method?: string;
  endpoint?: string;
  /** Absolute URL (scheme, host, path, query). Populated by framework integrations when available. */
  requestUrl?: string;
  /**
   * Detected auth signal at capture time (e.g. `'bearer'` when the original request had `Authorization: Bearer …`).
   * Computed automatically by the SDK from request headers BEFORE masking; no raw token is ever sent.
   */
  authMode?: 'bearer' | 'basic' | 'api_key' | 'cookie' | 'other' | 'none';
  /** Original `Authorization` scheme string (e.g. `Bearer`, `Hawk`) when detected. */
  authScheme?: string;
  requestHeaders?: Record<string, unknown>;
  requestPayload?: unknown;
  responseHeaders?: Record<string, unknown>;
  responsePayload?: unknown;
  status: ReplayStackEventStatus;
  statusCode?: number;
  executionTimeMs?: number;
  errorName?: string;
  errorMessage?: string;
  stackTrace?: string;
  stackFrames?: ReplayStackStackFrame[];
  breadcrumbs?: ReplayStackBreadcrumb[];
  serviceName?: string;
  environment?: string;
  appVersion?: string;
  commitHash?: string;
  sourceIp?: string;
  userAgent?: string;
  logs?: ReplayStackLog[];
  metadata?: Record<string, unknown>;
}

export interface ReplayStackCaptureResponse {
  success: boolean;
  message?: string;
  data?: {
    eventId?: string;
  };
}

export interface ExpressMiddlewareOptions {
  /** Capture request body. Requires body parser middleware before ReplayStack middleware. */
  captureRequestBody?: boolean;

  /** Capture response body by monkey-patching res.send/res.json. */
  captureResponseBody?: boolean;

  /** Capture headers. */
  captureHeaders?: boolean;

  /** Ignore paths for this middleware only. */
  ignoredPaths?: string[];

  /** Convert request to custom traceId. */
  getTraceId?: (req: unknown) => string | undefined;

  /** Decide whether request should be captured. */
  shouldCapture?: (data: { method: string; path: string; statusCode: number; executionTimeMs: number }) => boolean;

  /**
   * When true, framework middleware may add HTTP lifecycle breadcrumbs.
   * Default `false` — use `addBreadcrumb()` for meaningful business steps.
   */
  automaticFrameworkBreadcrumbs?: boolean;
}

export interface ReplayStackClientInterface {
  captureEvent(event: ReplayStackEventInput): Promise<ReplayStackCaptureResponse | null>;
  captureException(error: unknown, context?: ReplayStackExceptionContext): Promise<ReplayStackCaptureResponse | null>;
  /**
   * Record a developer-defined business step. Pass optional `metadata` (masked before storage).
   * Legacy shape `{ category, level, metadata }` is also supported as the second argument.
   */
  addBreadcrumb(message: string, metadataOrOptions?: Record<string, unknown>): void;
  /** Optional application log (no console/Winston interception). Requires `captureLogs: true`. */
  captureLog(log: ReplayStackLog): void;
  /** Records exception message as an error log when `captureLogs` is enabled. */
  captureErrorLog(error: unknown, metadata?: Record<string, unknown>): void;
  clearBreadcrumbs(): void;
  getBreadcrumbs(): ReplayStackBreadcrumb[];
  clearLogs(): void;
  getLogs(): ReplayStackLog[];
  flush(): Promise<void>;
  /** Stops periodic flush, then drains the offline queue. After this, capture calls are no-ops. */
  close(): Promise<void>;
}

export interface InstallReplayStackProcessGuardsOptions {
  /** Register `unhandledRejection` → `captureException` (default: true). */
  unhandledRejection?: boolean;
  /** Register `uncaughtException` → `captureException` (default: true). */
  uncaughtException?: boolean;
  /**
   * Flush the offline queue on process shutdown signals and `beforeExit` (default: true).
   * Does not call `process.exit`; combine with your own shutdown logic if needed.
   */
  flushOnShutdown?: boolean;
  /** Signals that trigger a best-effort `flush()` when `flushOnShutdown` is true. Default: `SIGINT`, `SIGTERM`. */
  shutdownSignals?: NodeJS.Signals[];
}
