# ReplayStack TypeScript SDK

ReplayStack SDK captures backend events from Node.js/TypeScript applications and sends them to the ReplayStack ingestion API.

It is designed for backend debugging, event replay, exception inspection, and real-time dashboard updates.

---

## What This SDK Captures

The SDK can automatically capture:

- API request method and endpoint
- Request headers and body
- Response headers and body
- Status code
- Response time
- Error name and message
- Full stack trace
- Parsed stack frames with file name, function name, line number, and column number
- Request-scoped breadcrumbs
- Service name, environment, app version, and commit hash

Important: the SDK does not capture every executed source-code line automatically. That would require a heavy profiler/debugger and is not recommended for production. Instead, it captures line-level exception details from stack traces and supports breadcrumbs for step-by-step debugging context.

---

## Installation

```bash
npm install @replaystack/sdk
```

For Express apps:

```bash
npm install express @replaystack/sdk
```

---

## Requirements

- Node.js >= 18
- TypeScript supported
- A ReplayStack project API key
- ReplayStack backend ingestion endpoint

---

## Development

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm test
npm run test:coverage
npm run test:typecheck
npm run release:verify   # lint + format check + tests + typecheck + build
```

### Publish to npm

1. Ensure you are logged in: `npm login`
2. Verify locally: `npm run release:verify`
3. Dry run: `npm run publish:dry`
4. Bump version (creates a git tag unless you use `--no-git-tag-version`): `npm run version:patch` / `version:minor` / `version:major`
5. Publish: `npm run publish:npm` (runs `prepublishOnly` → `npm run build`)

`prepublishOnly` only builds; run `release:verify` before publishing if you want the full gate.

The package uses [Vitest](https://vitest.dev/) with V8 coverage. Tests cover the core client (including offline queue, `flush`, and periodic flush), utilities, async context, stack parsing, Express middleware, and **NestJS interceptor / exception filter** plus **Next.js App Router and Pages Router** wrappers (with mocked HTTP).

Remaining gaps are mostly **branch coverage** inside Express body patching (`res.send` paths) and rarely hit Next helpers (`readResponseBodySafely` fallbacks, multipart hints).

---

## Basic Client Setup

```ts
import { createReplayStackClient } from '@replaystack/sdk';

const replayStack = createReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT || 'https://api.replaystack.co',
  serviceName: 'order-service',
  environment: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION,
  commitHash: process.env.COMMIT_HASH,
});
```

---

## Express Middleware Usage

Use the normal middleware before routes and the error middleware after routes.

```ts
import express from 'express';
import {
  createReplayStackClient,
  replayStackExpressMiddleware,
  replayStackExpressErrorMiddleware,
} from '@replaystack/sdk';

const app = express();

app.use(express.json());

const replayStack = createReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT || 'https://api.replaystack.co',
  serviceName: 'main-api',
  environment: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION,
  commitHash: process.env.COMMIT_HASH,
});

app.use(
  replayStackExpressMiddleware(replayStack, {
    captureRequestBody: true,
    captureResponseBody: true,
    captureHeaders: true,
    ignoredPaths: ['/health', '/metrics'],
  }),
);

app.post('/orders', async (req, res) => {
  replayStack.addBreadcrumb('Validating order payload', {
    category: 'order',
    metadata: { bodyKeys: Object.keys(req.body || {}) },
  });

  replayStack.addBreadcrumb('Fetching user before order creation', {
    category: 'order',
  });

  const user: any = undefined;

  // This throws TypeError and ReplayStack captures file, line, column, and function.
  const userId = user.id;

  res.json({ success: true, userId });
});

// Must be after all routes.
app.use(replayStackExpressErrorMiddleware(replayStack));

app.listen(3000);
```

---

## Exception Capture Result

When an exception happens, the SDK sends details like this:

```json
{
  "eventType": "api",
  "method": "POST",
  "endpoint": "/orders",
  "status": "failed",
  "statusCode": 500,
  "errorName": "TypeError",
  "errorMessage": "Cannot read properties of undefined (reading 'id')",
  "stackTrace": "TypeError: Cannot read properties...",
  "stackFrames": [
    {
      "functionName": "anonymous",
      "fileName": "/app/src/server.ts",
      "lineNumber": 32,
      "columnNumber": 23,
      "raw": "at /app/src/server.ts:32:23"
    }
  ],
  "breadcrumbs": [
    {
      "message": "HTTP request started",
      "category": "http",
      "level": "info",
      "timestamp": "2026-05-09T10:00:00.000Z"
    },
    {
      "message": "Validating order payload",
      "category": "order",
      "level": "info",
      "timestamp": "2026-05-09T10:00:01.000Z"
    }
  ]
}
```

This gives the dashboard enough detail to show:

```text
Exception occurred in:
File: /app/src/server.ts
Line: 32
Column: 23
Function: anonymous
```

---

## Breadcrumbs

Breadcrumbs are developer-defined steps that explain what happened before an error.

```ts
replayStack.addBreadcrumb('Started payment processing', {
  category: 'payment',
  level: 'info',
  metadata: { orderId: 'ord_123' },
});

replayStack.addBreadcrumb('Calling Stripe charge API', {
  category: 'payment',
  level: 'info',
});
```

If an exception happens later in the same Express request, breadcrumbs are attached to the failed event.

For Express, breadcrumbs are request-scoped using Node.js `AsyncLocalStorage`, so concurrent requests do not mix their breadcrumbs.

For non-Express/manual usage, breadcrumbs are kept on the client instance until you call:

```ts
replayStack.clearBreadcrumbs();
```

---

## Manual Exception Capture

Use this for queues, cron jobs, webhooks, background workers, or custom logic.

```ts
import { createTraceId } from '@replaystack/sdk';

async function processPaymentJob(job: any) {
  const traceId = createTraceId();
  const startedAt = Date.now();

  replayStack.addBreadcrumb('Payment job started', {
    category: 'queue',
    metadata: { jobId: job.id },
  });

  try {
    throw new Error('Stripe timeout');
  } catch (error) {
    await replayStack.captureException(error, {
      traceId,
      eventType: 'queue',
      endpoint: 'payment.process',
      requestPayload: job,
      statusCode: 500,
      executionTimeMs: Date.now() - startedAt,
      logs: [
        {
          level: 'error',
          message: 'Payment job failed',
          metadata: { jobId: job.id },
        },
      ],
    });

    replayStack.clearBreadcrumbs();
    throw error;
  }
}
```

---

## Manual Event Capture

Use manual capture for successful/failed custom events.

```ts
await replayStack.captureEvent({
  traceId: createTraceId(),
  eventType: 'custom',
  endpoint: 'inventory.sync',
  requestPayload: { sku: 'ABC-123' },
  responsePayload: { synced: true },
  status: 'success',
  statusCode: 200,
  executionTimeMs: 120,
});
```

---

## Stack Trace Parser

You can also parse stack traces directly:

```ts
import { parseStackTrace } from '@replaystack/sdk';

try {
  throw new Error('Something failed');
} catch (error: any) {
  const frames = parseStackTrace(error.stack);
  console.log(frames);
}
```

---

## Configuration

```ts
createReplayStackClient({
  apiKey: 'rs_live_xxxxx',
  endpoint: 'https://api.replaystack.co',
  serviceName: 'order-service',
  environment: 'production',
  appVersion: '1.2.0',
  commitHash: 'a7f91c',
  enabled: true,
  timeoutMs: 2500,
  retries: 1,
  sampleRate: 1,
  captureSuccess: true,
  maxPayloadSizeBytes: 512 * 1024,
  maxBreadcrumbs: 50,
  maskFields: ['password', 'token', 'authorization'],
  ignoredPaths: ['/health', '/metrics'],
  offlineQueueMax: 100,
  flushIntervalMs: 0,
});
```

| Option                | Description                                   | Default                      |
| --------------------- | --------------------------------------------- | ---------------------------- |
| `apiKey`              | Project API key from ReplayStack dashboard    | Required                     |
| `endpoint`            | ReplayStack backend base URL (optional)       | `https://api.replaystack.co` |
| `serviceName`         | Current backend service name                  | `undefined`                  |
| `environment`         | local/development/staging/production          | `NODE_ENV`                   |
| `appVersion`          | App release version                           | `undefined`                  |
| `commitHash`          | Deployment commit hash                        | `undefined`                  |
| `enabled`             | Enable or disable SDK                         | `true`                       |
| `timeoutMs`           | Request timeout for ingestion                 | `2500`                       |
| `retries`             | Retry count if ingestion fails                | `1`                          |
| `sampleRate`          | Capture percentage from `0` to `1`            | `1`                          |
| `captureSuccess`      | Capture successful events                     | `true`                       |
| `maxPayloadSizeBytes` | Payload truncation size                       | `524288`                     |
| `maxBreadcrumbs`      | Number of breadcrumbs kept per request/client | `50`                         |
| `maskFields`          | Custom fields to mask                         | `[]`                         |
| `ignoredPaths`        | Paths to ignore                               | `[]`                         |
| `offlineQueueMax`     | Max prepared events held in memory after ingest still fails after retries; oldest dropped when full. `0` disables the queue | `100` |
| `flushIntervalMs`     | If greater than `0`, periodically calls `flush()` to drain the offline queue | `0` (disabled) |
| `onQueueDrop`         | Callback when the queue drops the oldest event because `offlineQueueMax` was exceeded | none |

---

## Ingest reliability: offline queue, flush, and shutdown

When the ingest HTTP request fails after the configured retries, the SDK can keep a **bounded in-memory queue** of prepared events (`offlineQueueMax`, default `100`). Set `offlineQueueMax` to `0` to turn this off (failed sends are dropped immediately after retries).

- **`flush()`** — Sends queued events in order until the queue is empty or a send fails again.
- **`flushIntervalMs`** — If set to a positive number, the client runs `flush()` on that interval so events drain automatically when the API recovers.
- **`close()`** — Stops new automatic capture where applicable, cancels periodic flush, then drains the queue once (best effort).
- **`onQueueDrop`** — Optional hook when the queue is full and the oldest event is removed to make room.

In **Node.js**, you can register process hooks so the client attempts to flush before exit:

```ts
import { createReplayStackClient, installReplayStackProcessGuards } from '@replaystack/sdk';

const replayStack = createReplayStackClient({ apiKey: process.env.REPLAYSTACK_API_KEY! });
installReplayStackProcessGuards(replayStack);
```

This wires `unhandledRejection`, `uncaughtException`, and `beforeExit` to call `flush()` best effort. It does **not** guarantee delivery on hard crashes (for example `SIGKILL` or abrupt process death); for that you need an out-of-process buffer or WAL outside this SDK.

---

## Environment Variables

`REPLAYSTACK_ENDPOINT` is **optional**. If unset, the client uses **`https://api.replaystack.co`** (same as omitting `endpoint` in config). Set it for staging, self-hosted, or regional gateways.

```env
REPLAYSTACK_API_KEY=rs_live_xxxxxxxxxxxxxxxxx
# Optional — defaults to https://api.replaystack.co
# REPLAYSTACK_ENDPOINT=https://api.replaystack.co
REPLAYSTACK_SERVICE_NAME=order-service
REPLAYSTACK_APP_VERSION=1.2.0
REPLAYSTACK_COMMIT_HASH=a7f91c
REPLAYSTACK_ENABLED=true
REPLAYSTACK_TIMEOUT_MS=2500
REPLAYSTACK_RETRIES=1
REPLAYSTACK_SAMPLE_RATE=1
REPLAYSTACK_CAPTURE_SUCCESS=true
REPLAYSTACK_MAX_PAYLOAD_SIZE_BYTES=524288
REPLAYSTACK_MAX_BREADCRUMBS=50
# Optional — max events to buffer in memory after failed ingest (0 = disable queue)
# REPLAYSTACK_OFFLINE_QUEUE_MAX=100
# Optional — periodic flush interval in ms (0 = disabled)
# REPLAYSTACK_FLUSH_INTERVAL_MS=0
```

---

## Ingestion API Contract

The SDK sends events to:

```http
POST /api/v1/ingest/events
x-replaystack-api-key: rs_live_xxxxxxxxx
```

The backend should accept this shape:

```json
{
  "traceId": "uuid",
  "eventType": "api",
  "method": "POST",
  "endpoint": "/api/orders",
  "requestUrl": "https://orders.example.com/api/orders?page=1",
  "requestHeaders": {},
  "requestPayload": {},
  "responseHeaders": {},
  "responsePayload": {},
  "status": "failed",
  "statusCode": 500,
  "executionTimeMs": 840,
  "errorName": "TypeError",
  "errorMessage": "Cannot read properties of undefined",
  "stackTrace": "Error stack trace here",
  "stackFrames": [],
  "breadcrumbs": [],
  "serviceName": "order-service",
  "environment": "production",
  "appVersion": "1.2.0",
  "commitHash": "a7f91c",
  "sourceIp": "127.0.0.1",
  "userAgent": "Mozilla/5.0",
  "logs": []
}
```

---

## Sensitive Data Masking

The SDK masks these fields by default:

- authorization
- password
- passwd
- token
- access_token
- refresh_token
- apiKey
- api_key
- cookie
- set-cookie
- cardNumber
- card_number
- cvv
- otp
- secret
- client_secret

Custom fields can be added:

```ts
createReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  maskFields: ['patientId', 'nationalId', 'sessionId'],
});
```

## Build

```bash
npm install
npm run build
```

---

## Publish

```bash
npm publish --access public
```

---

## License

MIT

---

## Framework support

ReplayStack now supports four integration styles:

| Framework / Use Case       | Integration Method                                                          |
| -------------------------- | --------------------------------------------------------------------------- |
| Express                    | `replayStackExpressMiddleware` + `replayStackExpressErrorMiddleware`        |
| Next.js App Router         | `withReplayStackNext`                                                       |
| Next.js Pages Router       | `withReplayStackNextApi`                                                    |
| NestJS                     | `createReplayStackNestInterceptor` + `createReplayStackNestExceptionFilter` |
| Any backend / queue / cron | `captureEvent()` / `captureException()`                                     |
| Unsupported language       | Direct HTTP API: `POST /api/v1/ingest/events`                               |

### Express

```ts
import express from 'express';
import { ReplayStackClient, replayStackExpressMiddleware, replayStackExpressErrorMiddleware } from '@replaystack/sdk';

const app = express();
app.use(express.json());

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT!,
  serviceName: 'express-api',
  environment: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION,
  commitHash: process.env.COMMIT_HASH,
});

app.use(replayStackExpressMiddleware(replayStack));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(replayStackExpressErrorMiddleware(replayStack));
```

### Next.js App Router

Use this in files such as `app/api/orders/route.ts`.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ReplayStackClient } from '@replaystack/sdk';
import { withReplayStackNext } from '@replaystack/sdk/nextjs';

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT!,
  serviceName: 'nextjs-api',
  environment: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION,
  commitHash: process.env.COMMIT_HASH,
});

export const POST = withReplayStackNext(
  async function POST(req: NextRequest) {
    const body = await req.json();

    return NextResponse.json({
      success: true,
      order: { id: 'ord_123', ...body },
    });
  },
  {
    client: replayStack,
    endpoint: '/api/orders',
  },
);
```

### Next.js Pages Router

Use this in files such as `pages/api/orders.ts`.

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { ReplayStackClient } from '@replaystack/sdk';
import { withReplayStackNextApi } from '@replaystack/sdk/nextjs';

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT!,
  serviceName: 'nextjs-pages-api',
  environment: process.env.NODE_ENV || 'development',
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ success: true });
}

export default withReplayStackNextApi(handler, {
  client: replayStack,
});
```

### Next.js Server Actions

Server Actions should use manual capture because they do not behave like normal HTTP middleware.

```ts
'use server';

import { replayStack } from '@/lib/replaystack';

export async function createOrderAction(formData: FormData) {
  const startedAt = Date.now();

  try {
    replayStack.addBreadcrumb('Server action started');
    replayStack.addBreadcrumb('Validating order form data');

    const order = { id: 'ord_123' };

    await replayStack.captureEvent({
      eventType: 'custom',
      endpoint: 'createOrderAction',
      status: 'success',
      statusCode: 200,
      executionTimeMs: Date.now() - startedAt,
      requestPayload: Object.fromEntries(formData),
      responsePayload: order,
    });

    return order;
  } catch (error) {
    await replayStack.captureException(error, {
      eventType: 'custom',
      endpoint: 'createOrderAction',
      executionTimeMs: Date.now() - startedAt,
    });

    throw error;
  }
}
```

### NestJS

NestJS integration uses an interceptor for normal request/response capture and an exception filter for errors.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ReplayStackClient } from '@replaystack/sdk';
import { createReplayStackNestExceptionFilter, createReplayStackNestInterceptor } from '@replaystack/sdk/nestjs';

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT!,
  serviceName: 'nestjs-api',
  environment: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION,
  commitHash: process.env.COMMIT_HASH,
});

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: createReplayStackNestInterceptor({ client: replayStack }),
    },
    {
      provide: APP_FILTER,
      useClass: createReplayStackNestExceptionFilter({ client: replayStack }),
    },
  ],
})
export class AppModule {}
```

### What Next.js/NestJS Adapters Capture

The adapters capture:

- HTTP method
- endpoint/path
- request headers and payload
- response headers and payload
- status code
- execution time
- error name and message
- stack trace
- parsed stack frames with file/function/line/column
- breadcrumbs
- service name
- environment
- app version
- commit hash

### Backend Requirement

All adapters send captured data to the same ReplayStack ingestion endpoint:

```http
POST /api/v1/ingest/events
x-replaystack-api-key: rs_live_xxxxxxxxx
```

Your ReplayStack backend should validate the project API key, resolve `project_id`, check plan limits, store/process the event, then publish real-time dashboard updates using SSE.
