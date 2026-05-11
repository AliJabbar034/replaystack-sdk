export { ReplayStack, ReplayStack as ReplayStackClient, createReplayStackClient } from './client';
export { replayStackExpressMiddleware, replayStackExpressErrorMiddleware } from './express';
export { withReplayStackNext, withReplayStackNextApi } from './nextjs';
export { createReplayStackNestInterceptor, createReplayStackNestExceptionFilter } from './nestjs';
export { createTraceId, detectAuthMode } from './utils';
export { parseStackTrace } from './stacktrace';
export type {
  ExpressMiddlewareOptions,
  ReplayStackBreadcrumb,
  ReplayStackCaptureResponse,
  ReplayStackClientInterface,
  ReplayStackConfig,
  ReplayStackEventInput,
  ReplayStackEventStatus,
  ReplayStackEventType,
  ReplayStackExceptionContext,
  ReplayStackLog,
  ReplayStackLogLevel,
  ReplayStackStackFrame,
} from './types';
