import { ReplayStack } from './client';
import { runWithReplayStackContext } from './context';
import { ReplayStackEventStatus } from './types';
import {
  createTraceId,
  getErrorDetails,
  headersToObject,
  normalizeEndpoint,
  normalizeAbsoluteRequestUrl,
  buildAbsoluteRequestUrlFromParts,
} from './utils';

export interface NextRouteHandlerOptions {
  client: ReplayStack;
  endpoint?: string;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  captureHeaders?: boolean;
  getTraceId?: (request: Request) => string | undefined;
  shouldCapture?: (data: { method: string; endpoint?: string; statusCode: number; executionTimeMs: number }) => boolean;
  /** Default false — use `client.addBreadcrumb()` for business steps. */
  automaticFrameworkBreadcrumbs?: boolean;
}

export type NextRouteHandler<TRequest extends Request = Request> = (
  request: TRequest,
  context?: unknown,
) => Promise<Response> | Response;

/**
 * Wraps a Next.js App Router route handler.
 *
 * Supported files:
 * - app/api/example/route.ts
 *
 * Example:
 * export const POST = withReplayStackNext(async (req) => NextResponse.json({ ok: true }), { client });
 */
export function withReplayStackNext<TRequest extends Request = Request>(
  handler: NextRouteHandler<TRequest>,
  options: NextRouteHandlerOptions,
): NextRouteHandler<TRequest> {
  const captureRequestBody = options.captureRequestBody ?? true;
  const captureResponseBody = options.captureResponseBody ?? true;
  const captureHeaders = options.captureHeaders ?? true;
  const frameworkBreadcrumbs = options.automaticFrameworkBreadcrumbs ?? false;

  return async function replayStackNextHandler(request: TRequest, context?: unknown): Promise<Response> {
    return runWithReplayStackContext(async () => {
      const startedAt = Date.now();
      const method = request.method;
      const endpoint = normalizeEndpoint(options.endpoint || request.url);
      const requestUrl = normalizeAbsoluteRequestUrl(request.url) || normalizeAbsoluteRequestUrl(options.endpoint);
      const traceId = options.getTraceId?.(request) || request.headers.get('x-trace-id') || createTraceId();

      let requestPayload: unknown;
      let responsePayload: unknown;

      try {
        if (frameworkBreadcrumbs) {
          options.client.addBreadcrumb('Next.js route handler started', {
            category: 'http',
            level: 'info',
            metadata: { method, endpoint },
          });
        }

        const requestForHandler = request.clone() as TRequest;

        if (captureRequestBody) {
          requestPayload = await readRequestBodySafely(request.clone());
        }

        const response = await handler(requestForHandler, context);
        const statusCode = response.status || 200;
        const executionTimeMs = Date.now() - startedAt;
        const status = getStatusFromCode(statusCode);

        if (captureResponseBody) {
          responsePayload = await readResponseBodySafely(response.clone());
        }

        const shouldCapture = options.shouldCapture?.({ method, endpoint, statusCode, executionTimeMs }) ?? true;

        if (shouldCapture) {
          if (frameworkBreadcrumbs) {
            options.client.addBreadcrumb('Next.js route handler finished', {
              category: 'http',
              level: status === 'failed' ? 'error' : status === 'warning' ? 'warning' : 'info',
              metadata: { statusCode, executionTimeMs },
            });
          }

          void options.client.captureEvent({
            traceId,
            eventType: 'api',
            method,
            endpoint,
            requestUrl: requestUrl ?? undefined,
            requestHeaders: captureHeaders ? headersToObject(request.headers) : undefined,
            requestPayload,
            responseHeaders: captureHeaders ? headersToObject(response.headers) : undefined,
            responsePayload,
            status,
            statusCode,
            executionTimeMs,
            userAgent: request.headers.get('user-agent') || undefined,
          });
        }

        const clonedHeaders = new Headers(response.headers);
        clonedHeaders.set('x-trace-id', traceId);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: clonedHeaders,
        });
      } catch (error) {
        const details = getErrorDetails(error);
        const executionTimeMs = Date.now() - startedAt;

        void options.client.captureEvent({
          traceId,
          eventType: 'api',
          method,
          endpoint,
          requestUrl: requestUrl ?? undefined,
          requestHeaders: captureHeaders ? headersToObject(request.headers) : undefined,
          requestPayload,
          responsePayload: { message: details.errorMessage || 'Internal Server Error' },
          status: 'failed',
          statusCode: 500,
          executionTimeMs,
          errorName: details.errorName,
          errorMessage: details.errorMessage,
          stackTrace: details.stackTrace,
          stackFrames: details.stackFrames,
          breadcrumbs: options.client.getBreadcrumbs(),
          userAgent: request.headers.get('user-agent') || undefined,
        });

        throw error;
      }
    });
  };
}

export interface NextApiWrapperOptions {
  client: ReplayStack;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  captureHeaders?: boolean;
  getTraceId?: (req: any) => string | undefined;
  /** Default false — use `client.addBreadcrumb()` for business steps. */
  automaticFrameworkBreadcrumbs?: boolean;
}

/**
 * Wraps a Next.js Pages Router API handler.
 *
 * Supported files:
 * - pages/api/example.ts
 */
export function withReplayStackNextApi<TReq extends any = any, TRes extends any = any>(
  handler: (req: TReq, res: TRes) => unknown | Promise<unknown>,
  options: NextApiWrapperOptions,
) {
  const captureRequestBody = options.captureRequestBody ?? true;
  const captureResponseBody = options.captureResponseBody ?? true;
  const captureHeaders = options.captureHeaders ?? true;
  const frameworkBreadcrumbs = options.automaticFrameworkBreadcrumbs ?? false;

  return async function replayStackNextApiHandler(req: TReq, res: TRes): Promise<unknown> {
    return runWithReplayStackContext(async () => {
      const startedAt = Date.now();
      const anyReq = req as any;
      const anyRes = res as any;
      const endpoint = normalizeEndpoint(anyReq.url);
      const requestUrl = buildAbsoluteRequestUrlFromParts({
        pathWithQuery: anyReq.url || '',
        getHeader: nextPagesHeaderGetter(anyReq),
        protocolFallback: anyReq.protocol,
      });
      const traceId = options.getTraceId?.(anyReq) || anyReq.headers?.['x-trace-id'] || createTraceId();

      let responsePayload: unknown;

      if (captureResponseBody) {
        patchNextApiResponse(anyRes, (body) => {
          responsePayload = body;
        });
      }

      try {
        if (typeof anyRes.setHeader === 'function') {
          anyRes.setHeader('x-trace-id', traceId);
        }

        if (frameworkBreadcrumbs) {
          options.client.addBreadcrumb('Next.js API route started', {
            category: 'http',
            level: 'info',
            metadata: { method: anyReq.method, endpoint },
          });
        }

        const result = await handler(req, res);
        const statusCode = anyRes.statusCode || 200;
        const executionTimeMs = Date.now() - startedAt;
        const status = getStatusFromCode(statusCode);

        if (frameworkBreadcrumbs) {
          options.client.addBreadcrumb('Next.js API route finished', {
            category: 'http',
            level: status === 'failed' ? 'error' : status === 'warning' ? 'warning' : 'info',
            metadata: { statusCode, executionTimeMs },
          });
        }

        void options.client.captureEvent({
          traceId,
          eventType: 'api',
          method: anyReq.method,
          endpoint,
          requestUrl,
          requestHeaders: captureHeaders ? headersToObject(anyReq.headers) : undefined,
          requestPayload: captureRequestBody ? anyReq.body : undefined,
          responseHeaders: captureHeaders ? headersToObject(anyRes.getHeaders?.()) : undefined,
          responsePayload,
          status,
          statusCode,
          executionTimeMs,
          sourceIp: anyReq.socket?.remoteAddress,
          userAgent: anyReq.headers?.['user-agent'],
        });

        return result;
      } catch (error) {
        const details = getErrorDetails(error);
        const executionTimeMs = Date.now() - startedAt;

        void options.client.captureEvent({
          traceId,
          eventType: 'api',
          method: anyReq.method,
          endpoint,
          requestUrl,
          requestHeaders: captureHeaders ? headersToObject(anyReq.headers) : undefined,
          requestPayload: captureRequestBody ? anyReq.body : undefined,
          responsePayload: { message: details.errorMessage || 'Internal Server Error' },
          status: 'failed',
          statusCode: anyRes.statusCode && anyRes.statusCode >= 400 ? anyRes.statusCode : 500,
          executionTimeMs,
          errorName: details.errorName,
          errorMessage: details.errorMessage,
          stackTrace: details.stackTrace,
          stackFrames: details.stackFrames,
          breadcrumbs: options.client.getBreadcrumbs(),
          sourceIp: anyReq.socket?.remoteAddress,
          userAgent: anyReq.headers?.['user-agent'],
        });

        throw error;
      }
    });
  };
}

function nextPagesHeaderGetter(req: {
  get?: (n: string) => unknown;
  headers?: Record<string, unknown>;
}): ((name: string) => string | string[] | undefined | null) | undefined {
  if (typeof req.get === 'function') {
    return (name) => req.get?.(name) as string | string[] | undefined | null;
  }
  const headers = req.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  return (name: string) => {
    const k = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
    if (!k) return undefined;
    const v = headers[k];
    if (Array.isArray(v)) return v[0];
    return v != null ? String(v) : undefined;
  };
}

function getStatusFromCode(statusCode: number): ReplayStackEventStatus {
  if (statusCode >= 500) return 'failed';
  if (statusCode >= 400) return 'warning';
  return 'success';
}

async function readRequestBodySafely(request: Request): Promise<unknown> {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return await request.json();
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      return Object.fromEntries(formData.entries());
    }
    if (contentType.includes('multipart/form-data')) return '[multipart/form-data]';
    const text = await request.text();
    return text || undefined;
  } catch {
    return undefined;
  }
}

async function readResponseBodySafely(response: Response): Promise<unknown> {
  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return await response.json();
    const text = await response.text();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function patchNextApiResponse(res: any, onBody: (body: unknown) => void): void {
  if (!res || res.__replayStackPatched) return;
  res.__replayStackPatched = true;

  if (typeof res.json === 'function') {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      onBody(body);
      return originalJson(body);
    };
  }

  if (typeof res.send === 'function') {
    const originalSend = res.send.bind(res);
    res.send = (body: unknown) => {
      onBody(body);
      return originalSend(body);
    };
  }
}
