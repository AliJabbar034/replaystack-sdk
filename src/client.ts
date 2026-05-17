import {
  ReplayStackBreadcrumb,
  ReplayStackCaptureResponse,
  ReplayStackClientInterface,
  ReplayStackConfig,
  ReplayStackEventInput,
  ReplayStackExceptionContext,
  ReplayStackLog,
  ReplayStackLogLevel,
} from './types';
import {
  addContextBreadcrumb,
  addContextLog,
  clearContextBreadcrumbs,
  clearContextLogs,
  getContextBreadcrumbs,
  getContextLogs,
} from './context';
import { logMeetsMinLevel, normalizeLogs, resolveCaptureLogs } from './logs';
import { maskSensitiveData as maskValue, resolveMaskFields } from './masking';
import { formatStackFrameLocation, pickPrimaryStackFrame } from './stacktrace';
import {
  createTraceId,
  detectAuthMode,
  getErrorDetails,
  normalizeBreadcrumbs,
  normalizeEndpoint,
  safeJsonClone,
  shouldIgnorePath,
  shouldSample,
  sleep,
  truncatePayload,
  truncateUtf8String,
} from './utils';

const DEFAULT_ENDPOINT = 'https://api.replaystack.co';
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_RETRIES = 1;
const DEFAULT_MAX_PAYLOAD_SIZE = 512 * 1024;
const DEFAULT_MAX_BREADCRUMBS = 50;
const DEFAULT_MAX_LOGS = 50;
const DEFAULT_OFFLINE_QUEUE_MAX = 0;
const DEFAULT_BATCH_MAX_EVENTS = 20;
const DEFAULT_LOG_LEVEL: ReplayStackLogLevel = 'error';

export class ReplayStack implements ReplayStackClientInterface {
  private readonly config: Required<
    Pick<
      ReplayStackConfig,
      | 'apiKey'
      | 'endpoint'
      | 'enabled'
      | 'timeoutMs'
      | 'retries'
      | 'sampleRate'
      | 'captureSuccess'
      | 'maxPayloadSizeBytes'
      | 'maskFields'
      | 'ignoredPaths'
      | 'maxBreadcrumbs'
      | 'captureLogs'
      | 'logLevel'
      | 'maxLogs'
      | 'offlineQueueMax'
      | 'flushIntervalMs'
      | 'batchFlushIntervalMs'
      | 'batchMaxEvents'
    >
  > &
    Omit<ReplayStackConfig, 'apiKey'>;

  private readonly fetchImpl: typeof fetch;
  private breadcrumbs: ReplayStackBreadcrumb[] = [];
  private logs: ReplayStackLog[] = [];
  private readonly offlineQueue: ReplayStackEventInput[] = [];
  private readonly pendingBatch: ReplayStackEventInput[] = [];
  private drainMode = false;
  private closed = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private batchTimer: ReturnType<typeof setInterval> | undefined;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(config: ReplayStackConfig) {
    if (!config.apiKey) {
      throw new Error('ReplayStack apiKey is required.');
    }

    this.config = {
      ...config,
      apiKey: config.apiKey,
      endpoint: config.endpoint || process.env.REPLAYSTACK_ENDPOINT || DEFAULT_ENDPOINT,
      enabled: config.enabled ?? process.env.REPLAYSTACK_ENABLED !== 'false',
      timeoutMs: config.timeoutMs ?? Number(process.env.REPLAYSTACK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
      retries: config.retries ?? Number(process.env.REPLAYSTACK_RETRIES || DEFAULT_RETRIES),
      sampleRate: config.sampleRate ?? Number(process.env.REPLAYSTACK_SAMPLE_RATE || 1),
      captureSuccess: config.captureSuccess ?? process.env.REPLAYSTACK_CAPTURE_SUCCESS === 'true',
      maxPayloadSizeBytes:
        config.maxPayloadSizeBytes ??
        Number(process.env.REPLAYSTACK_MAX_PAYLOAD_SIZE_BYTES || DEFAULT_MAX_PAYLOAD_SIZE),
      maskFields: config.maskFields ?? [],
      ignoredPaths: config.ignoredPaths ?? [],
      maxBreadcrumbs:
        config.maxBreadcrumbs ?? Number(process.env.REPLAYSTACK_MAX_BREADCRUMBS || DEFAULT_MAX_BREADCRUMBS),
      captureLogs: resolveCaptureLogs(config.captureLogs),
      logLevel: (config.logLevel ??
        (process.env.REPLAYSTACK_LOG_LEVEL as ReplayStackLogLevel | undefined) ??
        DEFAULT_LOG_LEVEL) as ReplayStackLogLevel,
      maxLogs: config.maxLogs ?? Number(process.env.REPLAYSTACK_MAX_LOGS || DEFAULT_MAX_LOGS),
      offlineQueueMax:
        config.offlineQueueMax ?? Number(process.env.REPLAYSTACK_OFFLINE_QUEUE_MAX || DEFAULT_OFFLINE_QUEUE_MAX),
      flushIntervalMs: config.flushIntervalMs ?? Number(process.env.REPLAYSTACK_FLUSH_INTERVAL_MS || 0),
      batchFlushIntervalMs: config.batchFlushIntervalMs ?? Number(process.env.REPLAYSTACK_BATCH_FLUSH_INTERVAL_MS || 0),
      batchMaxEvents:
        config.batchMaxEvents ?? Number(process.env.REPLAYSTACK_BATCH_MAX_EVENTS || DEFAULT_BATCH_MAX_EVENTS),
    };

    const selectedFetch = config.fetchImpl || globalThis.fetch;
    if (!selectedFetch) {
      throw new Error('ReplayStack requires Node.js >= 18 or a custom fetchImpl.');
    }

    this.fetchImpl = selectedFetch.bind(globalThis);

    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        void this.flush().catch(() => {});
      }, this.config.flushIntervalMs);
      this.flushTimer.unref?.();
    }

    if (this.isBatchingEnabled()) {
      this.batchTimer = setInterval(() => {
        void this.flushPendingBatch().catch(() => {});
      }, this.config.batchFlushIntervalMs);
      this.batchTimer.unref?.();
    }
  }

  async captureEvent(event: ReplayStackEventInput): Promise<ReplayStackCaptureResponse | null> {
    try {
      if (this.closed) return null;
      if (!this.config.enabled) return null;
      if (!shouldSample(this.config.sampleRate)) return null;

      const endpoint = normalizeEndpoint(event.endpoint);
      if (shouldIgnorePath(endpoint, this.config.ignoredPaths)) return null;

      if (event.status === 'success' && !this.config.captureSuccess) return null;

      const payload = this.prepareEventPayload({ ...event, endpoint });

      if (this.isBatchingEnabled()) {
        this.enqueueBatch(payload);
        return null;
      }

      return await this.sendWithRetry(payload);
    } catch (error) {
      this.reportInternalError(error);
      return null;
    }
  }

  async captureException(
    error: unknown,
    context: ReplayStackExceptionContext = {},
  ): Promise<ReplayStackCaptureResponse | null> {
    this.captureErrorLog(error);

    const details = getErrorDetails(error);

    return this.captureEvent({
      traceId: context.traceId,
      eventType: context.eventType || 'custom',
      method: context.method,
      endpoint: context.endpoint,
      requestUrl: context.requestUrl,
      requestHeaders: context.requestHeaders,
      requestPayload: context.requestPayload,
      responseHeaders: context.responseHeaders,
      responsePayload: context.responsePayload,
      status: 'failed',
      statusCode: context.statusCode || 500,
      executionTimeMs: context.executionTimeMs,
      errorName: details.errorName,
      errorMessage: details.errorMessage,
      stackTrace: details.stackTrace,
      stackFrames: details.stackFrames,
      breadcrumbs: this.getBreadcrumbs(),
      sourceIp: context.sourceIp,
      userAgent: context.userAgent,
      logs: this.config.captureLogs ? (context.logs ?? this.getLogs()) : undefined,
      metadata: context.metadata,
    });
  }

  addBreadcrumb(message: string, metadataOrOptions: Record<string, unknown> = {}): void {
    if (!message) return;

    const maskFields = this.getMaskFields();
    let category: string | undefined;
    let level: ReplayStackLogLevel | undefined;
    let metadata: Record<string, unknown> | undefined;

    if ('category' in metadataOrOptions || 'level' in metadataOrOptions) {
      const legacy = metadataOrOptions as Omit<ReplayStackBreadcrumb, 'message' | 'timestamp'>;
      category = legacy.category;
      level = legacy.level;
      metadata =
        legacy.metadata != null ? (maskValue(legacy.metadata, maskFields) as Record<string, unknown>) : undefined;
    } else if (Object.keys(metadataOrOptions).length > 0) {
      metadata = maskValue(metadataOrOptions, maskFields) as Record<string, unknown>;
    }

    const breadcrumb: ReplayStackBreadcrumb = {
      message,
      category,
      level: level || 'info',
      metadata,
      timestamp: new Date().toISOString(),
    };

    const addedToContext = addContextBreadcrumb(breadcrumb, this.config.maxBreadcrumbs);
    if (addedToContext) return;

    this.breadcrumbs.push(breadcrumb);

    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(this.breadcrumbs.length - this.config.maxBreadcrumbs);
    }
  }

  /**
   * When `captureLogs` is enabled, records the exception message as an error-level log line.
   * Used by Express/Nest error handlers and `captureException`.
   */
  captureErrorLog(error: unknown, metadata?: Record<string, unknown>): void {
    const details = getErrorDetails(error);
    if (!details.errorMessage) return;

    const primary = pickPrimaryStackFrame(details.stackFrames);
    const location = primary ? formatStackFrameLocation(primary) : undefined;

    this.captureLog({
      level: 'error',
      message: details.errorMessage,
      metadata: {
        ...(details.errorName ? { errorName: details.errorName } : {}),
        ...(primary?.functionName ? { functionName: primary.functionName } : {}),
        ...(primary?.fileName ? { fileName: primary.fileName } : {}),
        ...(primary?.lineNumber != null ? { lineNumber: primary.lineNumber } : {}),
        ...(primary?.columnNumber != null ? { columnNumber: primary.columnNumber } : {}),
        ...(location ? { location } : {}),
        ...metadata,
      },
    });
  }

  captureLog(log: ReplayStackLog): void {
    if (!this.config.captureLogs) return;
    if (!log?.message) return;
    if (!logMeetsMinLevel(log.level, this.config.logLevel)) return;

    const maskFields = this.getMaskFields();
    const entry: ReplayStackLog = {
      level: log.level,
      message: log.message,
      timestamp: log.timestamp ?? new Date().toISOString(),
      metadata: log.metadata != null ? (maskValue(log.metadata, maskFields) as Record<string, unknown>) : undefined,
    };

    const addedToContext = addContextLog(entry, this.config.maxLogs);
    if (addedToContext) return;

    this.logs.push(entry);

    if (this.logs.length > this.config.maxLogs) {
      this.logs = this.logs.slice(this.logs.length - this.config.maxLogs);
    }
  }

  clearBreadcrumbs(): void {
    const clearedContext = clearContextBreadcrumbs();
    if (clearedContext) return;
    this.breadcrumbs = [];
  }

  getBreadcrumbs(): ReplayStackBreadcrumb[] {
    const contextBreadcrumbs = getContextBreadcrumbs();
    if (contextBreadcrumbs) return [...contextBreadcrumbs];
    return [...this.breadcrumbs];
  }

  clearLogs(): void {
    const clearedContext = clearContextLogs();
    if (clearedContext) return;
    this.logs = [];
  }

  getLogs(): ReplayStackLog[] {
    const contextLogs = getContextLogs();
    if (contextLogs) return [...contextLogs];
    return [...this.logs];
  }

  private getMaskFields(): string[] {
    return resolveMaskFields({
      maskFields: this.config.maskFields,
      remoteMaskingRules: this.config.remoteMaskingRules,
    });
  }

  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.flushPendingBatch()).then(() => this.drainOfflineQueue());
    return this.flushChain;
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.flushChain;
      return;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
    this.closed = true;
    this.flushChain = this.flushChain.then(() => this.flushPendingBatch()).then(() => this.drainOfflineQueue());
    await this.flushChain;
  }

  private async drainOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) {
      return;
    }

    this.drainMode = true;
    try {
      while (this.offlineQueue.length > 0) {
        const payload = this.offlineQueue[0]!;
        const response = await this.sendWithRetry(payload);
        if (response) {
          this.offlineQueue.shift();
        } else {
          break;
        }
      }
    } finally {
      this.drainMode = false;
    }
  }

  private enqueueOffline(payload: ReplayStackEventInput): void {
    if (this.closed) {
      return;
    }
    const max = this.config.offlineQueueMax;
    if (max <= 0 || this.drainMode) {
      return;
    }

    const copy = safeJsonClone(payload) as ReplayStackEventInput;
    this.offlineQueue.push(copy);

    while (this.offlineQueue.length > max) {
      this.offlineQueue.shift();
      this.config.onQueueDrop?.({ reason: 'max_queue_size' });
    }
  }

  private prepareEventPayload(event: ReplayStackEventInput): ReplayStackEventInput {
    const cloned = safeJsonClone(event) as ReplayStackEventInput;

    const enriched: ReplayStackEventInput = {
      ...cloned,
      traceId: cloned.traceId || createTraceId(),
      serviceName: cloned.serviceName || this.config.serviceName || process.env.REPLAYSTACK_SERVICE_NAME,
      environment: cloned.environment || this.config.environment || process.env.NODE_ENV || 'development',
      appVersion: cloned.appVersion || this.config.appVersion || process.env.REPLAYSTACK_APP_VERSION,
      commitHash: cloned.commitHash || this.config.commitHash || process.env.REPLAYSTACK_COMMIT_HASH,
      breadcrumbs: normalizeBreadcrumbs(cloned.breadcrumbs || this.getBreadcrumbs()),
      logs: this.config.captureLogs ? normalizeLogs(cloned.logs ?? this.getLogs()) : undefined,
    };

    if (enriched.authMode == null) {
      const detected = detectAuthMode(enriched.requestHeaders);
      enriched.authMode = detected.mode;
      if (detected.scheme && enriched.authScheme == null) {
        enriched.authScheme = detected.scheme;
      }
    }

    const masked = maskValue(enriched, this.getMaskFields());
    const maxUrlBytes = Math.min(8192, this.config.maxPayloadSizeBytes);

    return {
      ...masked,
      requestUrl:
        typeof masked.requestUrl === 'string' ? truncateUtf8String(masked.requestUrl, maxUrlBytes) : masked.requestUrl,
      requestPayload: truncatePayload(masked.requestPayload, this.config.maxPayloadSizeBytes),
      responsePayload: truncatePayload(masked.responsePayload, this.config.maxPayloadSizeBytes),
      requestHeaders: truncatePayload(masked.requestHeaders, this.config.maxPayloadSizeBytes) as Record<
        string,
        unknown
      >,
      responseHeaders: truncatePayload(masked.responseHeaders, this.config.maxPayloadSizeBytes) as Record<
        string,
        unknown
      >,
    };
  }

  private async sendWithRetry(payload: ReplayStackEventInput): Promise<ReplayStackCaptureResponse | null> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await this.send(payload);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.retries) {
          await sleep(150 * (attempt + 1));
        }
      }
    }

    if (lastError) {
      this.reportInternalError(lastError);
      if (!this.drainMode) {
        this.enqueueOffline(payload);
      }
    }
    return null;
  }

  private isBatchingEnabled(): boolean {
    return this.config.batchFlushIntervalMs > 0;
  }

  private enqueueBatch(payload: ReplayStackEventInput): void {
    this.pendingBatch.push(payload);
    const max = Math.min(100, Math.max(1, this.config.batchMaxEvents));
    if (this.pendingBatch.length >= max) {
      void this.flushPendingBatch().catch(() => {});
    }
  }

  private async flushPendingBatch(): Promise<void> {
    if (this.pendingBatch.length === 0) return;

    const max = Math.min(100, Math.max(1, this.config.batchMaxEvents));
    while (this.pendingBatch.length > 0) {
      const chunk = this.pendingBatch.splice(0, max);
      const ok = await this.sendBulkWithRetry(chunk);
      if (!ok) {
        if (!this.drainMode && this.config.offlineQueueMax > 0) {
          for (const ev of chunk) {
            this.enqueueOffline(ev);
          }
        }
        break;
      }
    }
  }

  private async sendBulkWithRetry(events: ReplayStackEventInput[]): Promise<boolean> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        await this.sendBulk(events);
        return true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.retries) {
          await sleep(150 * (attempt + 1));
        }
      }
    }

    if (lastError) {
      this.reportInternalError(lastError);
    }
    return false;
  }

  private async sendBulk(events: ReplayStackEventInput[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = `${this.config.endpoint.replace(/\/$/, '')}/api/v1/ingest/bulk-events`;

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tracereplay-api-key': this.config.apiKey,
          'x-replaystack-api-key': this.config.apiKey,
          'x-replaystack-sdk': '@replaystack/sdk',
          'x-replaystack-sdk-version': '1.0.2',
        },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({ success: response.ok }))) as ReplayStackCaptureResponse;

      if (!response.ok) {
        throw new Error(data.message || `ReplayStack bulk ingest failed with status ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async send(payload: ReplayStackEventInput): Promise<ReplayStackCaptureResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = `${this.config.endpoint.replace(/\/$/, '')}/api/v1/ingest/events`;

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Canonical header for TraceReplay backend; x-replaystack-api-key kept as a duplicate alias.
          'x-tracereplay-api-key': this.config.apiKey,
          'x-replaystack-api-key': this.config.apiKey,
          'x-replaystack-sdk': '@replaystack/sdk',
          'x-replaystack-sdk-version': '1.0.2',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({ success: response.ok }))) as ReplayStackCaptureResponse;

      if (!response.ok) {
        throw new Error(data.message || `ReplayStack ingestion failed with status ${response.status}`);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  private reportInternalError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (this.config.onError) {
      this.config.onError(normalized);
    }
  }
}

export function createReplayStackClient(config: ReplayStackConfig): ReplayStack {
  return new ReplayStack(config);
}
