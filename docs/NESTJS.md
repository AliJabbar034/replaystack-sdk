# ReplayStack NestJS Integration

ReplayStack supports NestJS through:

- `createReplayStackNestInterceptor()` for request/response capture
- `createReplayStackNestExceptionFilter()` for exception capture

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ReplayStackClient } from '@replaystack/sdk';
import { createReplayStackNestExceptionFilter, createReplayStackNestInterceptor } from '@replaystack/sdk/nestjs';

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  // Optional — omit or leave env unset; SDK defaults to https://api.replaystack.co
  endpoint: process.env.REPLAYSTACK_ENDPOINT,
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

`REPLAYSTACK_ENDPOINT` and the `endpoint` option are optional; when missing, ingest uses **`https://api.replaystack.co`**.

The exception filter captures stack traces, parsed stack frames, error name, error message, request payload, and breadcrumbs.
