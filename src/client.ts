import {
  ReplayStackBreadcrumb,
  ReplayStackCaptureResponse,
  ReplayStackClientInterface,
  ReplayStackConfig,
  ReplayStackEventInput,
  ReplayStackExceptionContext,
} from './types';
import { addContextBreadcrumb, clearContextBreadcrumbs, getContextBreadcrumbs } from './context';
import {
  createTraceId,
  detectAuthMode,
  getErrorDetails,
  maskSensitiveData,
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
const DEFAULT_OFFLINE_QUEUE_MAX = 100;

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
      | 'offlineQueueMax'
      | 'flushIntervalMs'
    >
  > &
    Omit<ReplayStackConfig, 'apiKey'>;

  private readonly fetchImpl: typeof fetch;
  private breadcrumbs: ReplayStackBreadcrumb[] = [];
  private readonly offlineQueue: ReplayStackEventInput[] = [];
  private drainMode = false;
  private closed = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
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
      captureSuccess: config.captureSuccess ?? process.env.REPLAYSTACK_CAPTURE_SUCCESS !== 'false',
      maxPayloadSizeBytes:
        config.maxPayloadSizeBytes ??
        Number(process.env.REPLAYSTACK_MAX_PAYLOAD_SIZE_BYTES || DEFAULT_MAX_PAYLOAD_SIZE),
      maskFields: config.maskFields ?? [],
      ignoredPaths: config.ignoredPaths ?? [],
      maxBreadcrumbs:
        config.maxBreadcrumbs ?? Number(process.env.REPLAYSTACK_MAX_BREADCRUMBS || DEFAULT_MAX_BREADCRUMBS),
      offlineQueueMax:
        config.offlineQueueMax ??
        Number(process.env.REPLAYSTACK_OFFLINE_QUEUE_MAX || DEFAULT_OFFLINE_QUEUE_MAX),
      flushIntervalMs:
        config.flushIntervalMs ?? Number(process.env.REPLAYSTACK_FLUSH_INTERVAL_MS || 0),
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
      logs: context.logs,
      metadata: context.metadata,
    });
  }

  addBreadcrumb(message: string, data: Omit<ReplayStackBreadcrumb, 'message' | 'timestamp'> = {}): void {
    if (!message) return;

    const breadcrumb: ReplayStackBreadcrumb = {
      message,
      category: data.category,
      level: data.level || 'info',
      metadata: data.metadata,
      timestamp: new Date().toISOString(),
    };

    const addedToContext = addContextBreadcrumb(breadcrumb, this.config.maxBreadcrumbs);
    if (addedToContext) return;

    this.breadcrumbs.push(breadcrumb);

    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(this.breadcrumbs.length - this.config.maxBreadcrumbs);
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

  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.drainOfflineQueue());
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
    this.closed = true;
    this.flushChain = this.flushChain.then(() => this.drainOfflineQueue());
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
      breadcrumbs: cloned.breadcrumbs || this.getBreadcrumbs(),
    };

    if (enriched.authMode == null) {
      const detected = detectAuthMode(enriched.requestHeaders);
      enriched.authMode = detected.mode;
      if (detected.scheme && enriched.authScheme == null) {
        enriched.authScheme = detected.scheme;
      }
    }

    const masked = maskSensitiveData(enriched, this.config.maskFields);
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
