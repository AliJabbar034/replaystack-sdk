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

  /** Field names to mask inside payloads and headers. */
  maskFields?: string[];

  /** URL paths that should never be captured. */
  ignoredPaths?: string[];

  /** Optional custom fetch implementation for tests or custom runtimes. */
  fetchImpl?: typeof fetch;

  /** Maximum number of breadcrumbs to keep in memory per client. */
  maxBreadcrumbs?: number;

  /** Optional hook called when SDK fails internally. */
  onError?: (error: Error) => void;
}

export interface ReplayStackLog {
  level: ReplayStackLogLevel;
  message: string;
  metadata?: Record<string, unknown>;
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
}

export interface ReplayStackClientInterface {
  captureEvent(event: ReplayStackEventInput): Promise<ReplayStackCaptureResponse | null>;
  captureException(error: unknown, context?: ReplayStackExceptionContext): Promise<ReplayStackCaptureResponse | null>;
  addBreadcrumb(message: string, data?: Omit<ReplayStackBreadcrumb, 'message' | 'timestamp'>): void;
  clearBreadcrumbs(): void;
  getBreadcrumbs(): ReplayStackBreadcrumb[];
  flush(): Promise<void>;
}
