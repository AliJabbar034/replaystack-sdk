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
  getErrorDetails,
  maskSensitiveData,
  normalizeEndpoint,
  safeJsonClone,
  shouldIgnorePath,
  shouldSample,
  sleep,
  truncatePayload,
} from './utils';

const DEFAULT_ENDPOINT = 'https://api.replaystack.dev';
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_RETRIES = 1;
const DEFAULT_MAX_PAYLOAD_SIZE = 512 * 1024;
const DEFAULT_MAX_BREADCRUMBS = 50;

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
    >
  > &
    Omit<ReplayStackConfig, 'apiKey'>;

  private readonly fetchImpl: typeof fetch;
  private breadcrumbs: ReplayStackBreadcrumb[] = [];

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
      maxBreadcrumbs: config.maxBreadcrumbs ?? Number(process.env.REPLAYSTACK_MAX_BREADCRUMBS || DEFAULT_MAX_BREADCRUMBS),
    };

    const selectedFetch = config.fetchImpl || globalThis.fetch;
    if (!selectedFetch) {
      throw new Error('ReplayStack requires Node.js >= 18 or a custom fetchImpl.');
    }

    this.fetchImpl = selectedFetch.bind(globalThis);
  }

  async captureEvent(event: ReplayStackEventInput): Promise<ReplayStackCaptureResponse | null> {
    try {
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
    // Current SDK sends immediately. Method is provided for future batching support.
    return Promise.resolve();
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

    const masked = maskSensitiveData(enriched, this.config.maskFields);

    return {
      ...masked,
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

    if (lastError) this.reportInternalError(lastError);
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
          'x-replaystack-sdk-version': '1.1.0',
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
