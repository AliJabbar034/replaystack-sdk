# ReplayStack Next.js Integration

ReplayStack supports both Next.js App Router and Pages Router.

`REPLAYSTACK_ENDPOINT` and the client `endpoint` option are optional; when missing, ingest uses **`https://api.replaystack.co`**.

## App Router

Use `withReplayStackNext` in `app/api/*/route.ts` files.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ReplayStackClient } from '@replaystack/sdk';
import { withReplayStackNext } from '@replaystack/sdk/nextjs';

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT,
  serviceName: 'nextjs-api',
  environment: process.env.NODE_ENV || 'development',
  appVersion: process.env.APP_VERSION,
  commitHash: process.env.COMMIT_HASH,
});

export const POST = withReplayStackNext(
  async (req: NextRequest) => {
    const body = await req.json();
    return NextResponse.json({ success: true, body });
  },
  { client: replayStack, endpoint: '/api/orders' },
);
```

## Pages Router

Use `withReplayStackNextApi` in `pages/api/*.ts` files.

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { ReplayStackClient } from '@replaystack/sdk';
import { withReplayStackNextApi } from '@replaystack/sdk/nextjs';

const replayStack = new ReplayStackClient({
  apiKey: process.env.REPLAYSTACK_API_KEY!,
  endpoint: process.env.REPLAYSTACK_ENDPOINT,
  serviceName: 'nextjs-pages-api',
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ success: true });
}

export default withReplayStackNextApi(handler, { client: replayStack });
```

## Server Actions

Server Actions should use `captureEvent()` or `captureException()` manually.
