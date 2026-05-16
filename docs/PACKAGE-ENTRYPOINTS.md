# Package entry points (`@replaystack/sdk`)

ReplayStack ships **one npm package** with **several import paths**. Framework helpers are not removed—they live on **subpaths** so Express-only apps do not load NestJS or Next.js code at startup.

## Quick reference

| What you need                                                  | Import from                                          | Requires installed       |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------ |
| Client, `captureEvent`, `captureException`, breadcrumbs, utils | `@replaystack/sdk`                                   | Node 18+                 |
| Express middleware                                             | `@replaystack/sdk` **or** `@replaystack/sdk/express` | `express`                |
| Next.js route wrappers                                         | `@replaystack/sdk/nextjs`                            | `next` (in your app)     |
| NestJS interceptor + exception filter                          | `@replaystack/sdk/nestjs`                            | `@nestjs/common`, `rxjs` |
| Client only (explicit)                                         | `@replaystack/sdk/client`                            | Node 18+                 |

## Why subpaths exist (v1.0.4+)

In **v1.0.3**, the main entry re-exported NestJS and Next.js. Importing `createReplayStackClient` from `@replaystack/sdk` still executed `require('@nestjs/common')`, so **Express apps failed** unless Nest peers were installed.

From **v1.0.4** onward:

- **`@replaystack/sdk`** — core client, Express middleware, shared utilities.
- **`@replaystack/sdk/nestjs`** — Nest factories (loads `@nestjs/common` only when you import this path).
- **`@replaystack/sdk/nextjs`** — Next.js App/Pages wrappers.

Nothing was deleted from the package; only the **default barrel** was narrowed.

## Copy-paste by framework

### Express

```ts
import {
  createReplayStackClient,
  replayStackExpressMiddleware,
  replayStackExpressErrorMiddleware,
} from '@replaystack/sdk';
```

### Next.js

```ts
import { createReplayStackClient } from '@replaystack/sdk';
import { withReplayStackNext } from '@replaystack/sdk/nextjs';
// Pages Router: withReplayStackNextApi from '@replaystack/sdk/nextjs'
```

### NestJS

```ts
import { createReplayStackClient } from '@replaystack/sdk';
import { createReplayStackNestInterceptor, createReplayStackNestExceptionFilter } from '@replaystack/sdk/nestjs';
```

### Workers / cron / scripts

```ts
import { createReplayStackClient } from '@replaystack/sdk';
```

## Upgrading from v1.0.3

If you see:

```text
Error: Cannot find module '@nestjs/common'
Require stack: .../node_modules/@replaystack/sdk/dist/nestjs.js
```

you are on **v1.0.3** (or an old import pattern). Do **one** of the following:

1. **Recommended:** Upgrade and fix imports

   ```bash
   npm install @replaystack/sdk@^1.0.4
   ```

   Then change Nest imports to `@replaystack/sdk/nestjs` and Next wrappers to `@replaystack/sdk/nextjs` if they still use the root path.

2. **Temporary workaround on v1.0.3 only:** Install optional peers (not recommended long-term):
   ```bash
   npm install @nestjs/common rxjs
   ```

### Find-and-replace

| Old (v1.0.3 root import)                           | New (v1.0.4+)                                     |
| -------------------------------------------------- | ------------------------------------------------- |
| `from '@replaystack/sdk'` + Nest factories         | Nest factories → `from '@replaystack/sdk/nestjs'` |
| `from '@replaystack/sdk'` + `withReplayStackNext*` | Wrappers → `from '@replaystack/sdk/nextjs'`       |
| Client + Express middleware                        | Keep `from '@replaystack/sdk'`                    |

## FAQ

**Did you remove NestJS / Next.js support?**  
No. Use `@replaystack/sdk/nestjs` and `@replaystack/sdk/nextjs`.

**Can I import everything from the root again?**  
Not in v1.0.4+. Subpaths keep optional framework dependencies out of Express bundles and avoid startup errors.

**Are subpaths documented in TypeScript?**  
Yes—`package.json` `exports` maps each path to `.d.ts` files.

**Which docs are canonical?**  
This file, plus framework pages: [NESTJS.md](./NESTJS.md), [NEXTJS.md](./NEXTJS.md), and the [README](../README.md) framework section.
