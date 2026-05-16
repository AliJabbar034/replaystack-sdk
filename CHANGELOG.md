# Changelog

All notable changes to `@replaystack/sdk` are documented here.

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
