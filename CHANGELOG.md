# Changelog

All notable changes to `@replaystack/sdk` are documented here.

## [1.0.7] - 2026-05-16

### Changed

- **`captureLogs` default is now `true`**. Opt out with `captureLogs: false` or `REPLAYSTACK_CAPTURE_LOGS=false`.
- **Express/Nest error handlers** call `captureErrorLog()` so failed events include an error log line automatically.

### Added

- **`captureLog(log)`** — optional application logs attached to events when `captureLogs: true` (default `false`).
- **`logLevel`** config (default `error`). Both can be overridden via dashboard remote SDK config patterns.
- **`remoteMaskingRules.fields`** merged with SDK default mask fields and `maskFields`.
- **`clearLogs()` / `getLogs()`**; request-scoped logs via async context (same as breadcrumbs).
- README section **“What ReplayStack Captures”** documenting the four capture levels and explicit non-goals (no profiler / line-by-line capture).

### Changed

- **Framework HTTP breadcrumbs are off by default** — use `addBreadcrumb()` for business steps, or `automaticFrameworkBreadcrumbs: true` on Express/Next/Nest options.
- **Breadcrumb metadata is masked at `addBreadcrumb()` time** before storage.
- **`addBreadcrumb(message, metadata?)`** — plain object second argument is treated as metadata (legacy `{ category, level, metadata }` still supported).

## [1.0.6] - 2026-05-16

### Added

- **Bulk ingest batching:** `batchFlushIntervalMs` and `batchMaxEvents` buffer events and POST to `/api/v1/ingest/bulk-events` (Datadog-style flush interval).

### Changed

- **`captureSuccess` default is now `false`** — set `REPLAYSTACK_CAPTURE_SUCCESS=true` or `captureSuccess: true` to record 2xx traffic.
- **`offlineQueueMax` default is now `0`** — failed sends are dropped instead of buffering up to 100 full events in RAM (set `REPLAYSTACK_OFFLINE_QUEUE_MAX` to re-enable).

## [1.0.5] - 2026-05-16

### Added

- `captureFailure(message, responsePayload?, statusCode?)` — throw this instead of bare `Error` when you want rich JSON on the failed event’s response body (multi-step workflows, etc.).
- Express error middleware: uses `error.replayStack.responsePayload` when set; otherwise captures `{ message, breadcrumbs }` automatically (no app middleware required).
- Sanitizes breadcrumb `metadata` before ingest (backend requires a plain object when present).
- Exported `getReplayStackErrorCapture` and `ReplayStackErrorCapture` for optional HTTP handlers.

## [1.0.4] - 2026-05-16

### Fixed

- **Express-only installs:** The main entry (`@replaystack/sdk`) no longer loads NestJS at import time. Previously, any import from the root package required `@nestjs/common` to be installed ([issue when using the published package from Express apps](https://www.npmjs.com/package/@replaystack/sdk)).

### Changed

- **Breaking (import paths only):** NestJS helpers (`createReplayStackNestInterceptor`, `createReplayStackNestExceptionFilter`) must be imported from `@replaystack/sdk/nestjs`, not the package root.
- **Breaking (import paths only):** Next.js helpers (`withReplayStackNext`, `withReplayStackNextApi`) must be imported from `@replaystack/sdk/nextjs`, not the package root.
- Added explicit export `@replaystack/sdk/client` for the core client module.

### Unchanged

- Express middleware remains on the main entry and on `@replaystack/sdk/express`.
- `createReplayStackClient`, `captureEvent`, `captureException`, breadcrumbs, and utilities remain on the main entry.

### Migration

See [docs/PACKAGE-ENTRYPOINTS.md](./docs/PACKAGE-ENTRYPOINTS.md).

```diff
- import { createReplayStackNestInterceptor } from '@replaystack/sdk';
+ import { createReplayStackNestInterceptor } from '@replaystack/sdk/nestjs';

- import { withReplayStackNext } from '@replaystack/sdk';
+ import { withReplayStackNext } from '@replaystack/sdk/nextjs';
```

## [1.0.3] - earlier

- Initial public release with framework helpers re-exported from the main entry (NestJS import side effect).
