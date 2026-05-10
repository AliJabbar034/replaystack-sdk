import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { ReplayStack } from './client';
import { runWithReplayStackContext } from './context';
import { getErrorDetails, headersToObject, normalizeEndpoint } from './utils';

export interface ReplayStackNestOptions {
  client: ReplayStack;
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  captureHeaders?: boolean;
  getTraceId?: (req: any) => string | undefined;
  shouldCapture?: (data: {
    method: string;
    endpoint?: string;
    statusCode: number;
    executionTimeMs: number;
  }) => boolean;
}

/**
 * Creates a NestJS interceptor class for request/response capture.
 *
 * Usage:
 * providers: [{ provide: APP_INTERCEPTOR, useClass: createReplayStackNestInterceptor({ client }) }]
 */
export function createReplayStackNestInterceptor(options: ReplayStackNestOptions): new () => NestInterceptor {
  const captureRequestBody = options.captureRequestBody ?? true;
  const captureResponseBody = options.captureResponseBody ?? true;
  const captureHeaders = options.captureHeaders ?? true;

  @Injectable()
  class ReplayStackNestInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      const http = context.switchToHttp();
      const req = http.getRequest();
      const res = http.getResponse();
      const startedAt = Date.now();
      const endpoint = normalizeEndpoint(req.originalUrl || req.url);
      const traceId = options.getTraceId?.(req) || req.headers?.['x-trace-id'];

      options.client.addBreadcrumb('NestJS request started', {
        category: 'http',
        level: 'info',
        metadata: { method: req.method, endpoint },
      });

      return next.handle().pipe(
        tap((responseBody) => {
          const executionTimeMs = Date.now() - startedAt;
          const statusCode = res.statusCode || 200;
          const status = statusCode >= 500 ? 'failed' : statusCode >= 400 ? 'warning' : 'success';

          const shouldCapture =
            options.shouldCapture?.({
              method: req.method,
              endpoint,
              statusCode,
              executionTimeMs,
            }) ?? true;

          if (!shouldCapture) return;

          options.client.addBreadcrumb('NestJS request finished', {
            category: 'http',
            level: status === 'failed' ? 'error' : status === 'warning' ? 'warning' : 'info',
            metadata: { statusCode, executionTimeMs },
          });

          void options.client.captureEvent({
            traceId,
            eventType: 'api',
            method: req.method,
            endpoint,
            requestHeaders: captureHeaders ? headersToObject(req.headers) : undefined,
            requestPayload: captureRequestBody ? req.body : undefined,
            responseHeaders: captureHeaders ? headersToObject(res.getHeaders?.()) : undefined,
            responsePayload: captureResponseBody ? responseBody : undefined,
            status,
            statusCode,
            executionTimeMs,
            sourceIp: req.ip,
            userAgent: req.headers?.['user-agent'],
          });
        }),
        catchError((error) => throwError(() => error)),
      );
    }
  }

  return ReplayStackNestInterceptor;
}

/**
 * Creates a NestJS exception filter class for exception capture with stack frames.
 *
 * Usage:
 * providers: [{ provide: APP_FILTER, useClass: createReplayStackNestExceptionFilter({ client }) }]
 */
export function createReplayStackNestExceptionFilter(options: ReplayStackNestOptions): new () => ExceptionFilter {
  const captureRequestBody = options.captureRequestBody ?? true;
  const captureHeaders = options.captureHeaders ?? true;

  @Catch()
  class ReplayStackNestExceptionFilter implements ExceptionFilter {
    async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
      await runWithReplayStackContext(async () => {
        const ctx = host.switchToHttp();
        const req = ctx.getRequest();
        const res = ctx.getResponse();
        const details = getErrorDetails(exception);
        const statusCode = getExceptionStatus(exception);
        const endpoint = normalizeEndpoint(req.originalUrl || req.url);
        const traceId = options.getTraceId?.(req) || req.headers?.['x-trace-id'];

        options.client.addBreadcrumb('NestJS exception captured', {
          category: 'exception',
          level: 'error',
          metadata: { errorName: details.errorName, errorMessage: details.errorMessage },
        });

        await options.client.captureEvent({
          traceId,
          eventType: 'api',
          method: req.method,
          endpoint,
          requestHeaders: captureHeaders ? headersToObject(req.headers) : undefined,
          requestPayload: captureRequestBody ? req.body : undefined,
          responseHeaders: captureHeaders ? headersToObject(res.getHeaders?.()) : undefined,
          responsePayload: { message: details.errorMessage || 'Internal Server Error' },
          status: 'failed',
          statusCode,
          errorName: details.errorName,
          errorMessage: details.errorMessage,
          stackTrace: details.stackTrace,
          stackFrames: details.stackFrames,
          breadcrumbs: options.client.getBreadcrumbs(),
          sourceIp: req.ip,
          userAgent: req.headers?.['user-agent'],
        });

        if (typeof res.status === 'function') {
          res.status(statusCode).json({
            statusCode,
            message: details.errorMessage || 'Internal Server Error',
          });
          return;
        }

        throw exception;
      });
    }
  }

  return ReplayStackNestExceptionFilter;
}

function getExceptionStatus(exception: unknown): number {
  if (
    exception &&
    typeof exception === 'object' &&
    'getStatus' in exception &&
    typeof (exception as any).getStatus === 'function'
  ) {
    return (exception as any).getStatus();
  }

  return 500;
}
