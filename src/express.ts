import type { NextFunction, Request, Response } from 'express';
import { ReplayStack } from './client';
import { runWithReplayStackContext } from './context';
import { ExpressMiddlewareOptions } from './types';
import {
  createTraceId,
  getErrorDetails,
  headersToObject,
  normalizeEndpoint,
  shouldIgnorePath,
  buildAbsoluteRequestUrlFromParts,
} from './utils';

const DEFAULT_IGNORED_PATHS = ['/health', '/metrics', '/favicon.ico'];

export function replayStackExpressMiddleware(client: ReplayStack, options: ExpressMiddlewareOptions = {}) {
  const captureRequestBody = options.captureRequestBody ?? true;
  const captureResponseBody = options.captureResponseBody ?? true;
  const captureHeaders = options.captureHeaders ?? true;
  const ignoredPaths = [...DEFAULT_IGNORED_PATHS, ...(options.ignoredPaths || [])];

  return function replayStackMiddleware(req: Request, res: Response, next: NextFunction) {
    return runWithReplayStackContext(() => {
      const startedAt = Date.now();
      const path = normalizeEndpoint(req.originalUrl || req.url);
      const requestUrl = buildAbsoluteRequestUrlFromParts({
        pathWithQuery: req.originalUrl || req.url || '',
        getHeader: (name) => req.get(name),
        protocolFallback: req.protocol,
      });

      if (shouldIgnorePath(path, ignoredPaths)) {
        return next();
      }

      const traceId = options.getTraceId?.(req) || (req.headers['x-trace-id'] as string) || createTraceId();
      res.setHeader('x-trace-id', traceId);

      client.addBreadcrumb('HTTP request started', {
        category: 'http',
        level: 'info',
        metadata: {
          method: req.method,
          endpoint: path || req.path,
        },
      });

      let responseBody: unknown;
      let capturedError: unknown;

      if (captureResponseBody) {
        patchResponseBodyCapture(res, (body) => {
          responseBody = body;
        });
      }

      res.on('finish', () => {
        // The Express error middleware already captured the exception with stack frames.
        // Avoid creating a duplicate failed event from the same request.
        if (res.locals.replayStackErrorCaptured) return;

        const executionTimeMs = Date.now() - startedAt;
        const statusCode = res.statusCode;
        const status = statusCode >= 500 ? 'failed' : statusCode >= 400 ? 'warning' : 'success';

        const shouldCapture =
          options.shouldCapture?.({
            method: req.method,
            path: path || req.path,
            statusCode,
            executionTimeMs,
          }) ?? true;

        if (!shouldCapture) return;

        const errorDetails = getErrorDetails(capturedError);

        client.addBreadcrumb('HTTP request finished', {
          category: 'http',
          level: status === 'failed' ? 'error' : status === 'warning' ? 'warning' : 'info',
          metadata: {
            statusCode,
            executionTimeMs,
          },
        });

        void client.captureEvent({
          traceId,
          eventType: 'api',
          method: req.method,
          endpoint: path || req.path,
          requestUrl,
          requestHeaders: captureHeaders ? headersToObject(req.headers) : undefined,
          requestPayload: captureRequestBody ? req.body : undefined,
          responseHeaders: captureHeaders ? headersToObject(res.getHeaders()) : undefined,
          responsePayload: responseBody,
          status,
          statusCode,
          executionTimeMs,
          errorName: errorDetails.errorName,
          errorMessage: errorDetails.errorMessage,
          stackTrace: errorDetails.stackTrace,
          stackFrames: errorDetails.stackFrames,
          sourceIp: req.ip,
          userAgent: req.headers['user-agent'],
        });
      });

      try {
        return next();
      } catch (error) {
        capturedError = error;
        throw error;
      }
    });
  };
}

export function replayStackExpressErrorMiddleware(client: ReplayStack) {
  return function replayStackErrorMiddleware(error: unknown, req: Request, res: Response, next: NextFunction) {
    const traceId = (res.getHeader('x-trace-id') as string) || (req.headers['x-trace-id'] as string) || createTraceId();
    const details = getErrorDetails(error);

    res.locals.replayStackErrorCaptured = true;

    client.addBreadcrumb('Unhandled exception captured', {
      category: 'exception',
      level: 'error',
      metadata: {
        errorName: details.errorName,
        errorMessage: details.errorMessage,
      },
    });

    void client.captureEvent({
      traceId,
      eventType: 'api',
      method: req.method,
      endpoint: normalizeEndpoint(req.originalUrl || req.url) || req.path,
      requestUrl: buildAbsoluteRequestUrlFromParts({
        pathWithQuery: req.originalUrl || req.url || '',
        getHeader: (name) => req.get(name),
        protocolFallback: req.protocol,
      }),
      requestHeaders: headersToObject(req.headers),
      requestPayload: req.body,
      responseHeaders: headersToObject(res.getHeaders()),
      responsePayload: {
        message: details.errorMessage,
      },
      status: 'failed',
      statusCode: res.statusCode >= 400 ? res.statusCode : 500,
      errorName: details.errorName,
      errorMessage: details.errorMessage,
      stackTrace: details.stackTrace,
      stackFrames: details.stackFrames,
      breadcrumbs: client.getBreadcrumbs(),
      sourceIp: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return next(error);
  };
}

function patchResponseBodyCapture(res: Response, onBody: (body: unknown) => void): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = ((body: unknown) => {
    onBody(body);
    return originalJson(body);
  }) as Response['json'];

  res.send = ((body: unknown) => {
    try {
      if (typeof body === 'string') {
        const trimmed = body.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          onBody(JSON.parse(trimmed));
        } else {
          onBody(body);
        }
      } else {
        onBody(body);
      }
    } catch {
      onBody(body);
    }

    return originalSend(body as Parameters<Response['send']>[0]);
  }) as Response['send'];
}
