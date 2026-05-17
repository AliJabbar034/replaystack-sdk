export { ReplayStack, ReplayStack as ReplayStackClient, createReplayStackClient } from './client';
export { installReplayStackProcessGuards } from './runtime';
export {
  replayStackExpressMiddleware,
  replayStackExpressErrorMiddleware,
  captureFailure,
  getReplayStackErrorCapture,
  type ReplayStackErrorCapture,
} from './express';
export { createTraceId, detectAuthMode, maskSensitiveData, resolveMaskFields, DEFAULT_MASK_FIELDS } from './utils';
export type { MaskFieldConfig, ReplayStackRemoteMaskingRules } from './masking';
export { formatStackFrameLocation, parseStackTrace, pickPrimaryStackFrame } from './stacktrace';
export type {
  ExpressMiddlewareOptions,
  InstallReplayStackProcessGuardsOptions,
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
