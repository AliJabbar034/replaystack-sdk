# ReplayStack SDK Backend Contract

This document defines what the ReplayStack backend must support for the TypeScript SDK.

---

## Ingestion Endpoint

```http
POST /api/v1/ingest/events
x-tracereplay-api-key: tr_live_xxxxxxxxx
content-type: application/json
```

The SDK authenticates with a project API key (header `x-tracereplay-api-key`; `x-replaystack-api-key` is sent as a duplicate alias). This endpoint must not require user JWT authentication.

---

## Required Backend Steps

1. Extract `x-tracereplay-api-key` (or accept `x-replaystack-api-key` as an alias).
2. Hash the incoming key.
3. Match it with `project_api_keys.api_key_hash`.
4. Check `is_active = true`.
5. Resolve `project_id`.
6. Check project status is active.
7. Check user subscription status.
8. Check monthly usage limits.
9. Check project capture mode.
10. Check ignored endpoints.
11. Apply server-side masking as a second safety layer.
12. Push event into BullMQ queue.
13. Return event accepted response quickly.
14. Worker stores event in PostgreSQL.
15. Worker updates usage, error groups, alerts.
16. Worker publishes Redis Pub/Sub message.
17. SSE service sends real-time update to dashboard.

---

## Event Payload Shape

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
  "errorMessage": "Cannot read properties of undefined (reading 'id')",
  "stackTrace": "TypeError: Cannot read properties...",
  "stackFrames": [
    {
      "functionName": "createOrder",
      "fileName": "/app/src/controllers/order.controller.ts",
      "lineNumber": 42,
      "columnNumber": 15,
      "raw": "at createOrder (/app/src/controllers/order.controller.ts:42:15)"
    }
  ],
  "breadcrumbs": [
    {
      "message": "Validating order payload",
      "category": "order",
      "level": "info",
      "metadata": {},
      "timestamp": "2026-05-09T10:00:00.000Z"
    }
  ],
  "serviceName": "order-service",
  "environment": "production",
  "appVersion": "1.2.0",
  "commitHash": "a7f91c",
  "sourceIp": "127.0.0.1",
  "userAgent": "Mozilla/5.0",
  "logs": [
    {
      "level": "error",
      "message": "Database query failed",
      "metadata": {}
    }
  ],
  "metadata": {}
}
```

---

## Event Type Values

```text
api
queue
webhook
custom
cron
```

---

## Event Status Values

```text
success
failed
warning
pending
```

---

## Database Columns Required

The `events` table should persist SDK error detail:

```sql
ALTER TABLE events
ADD COLUMN error_name VARCHAR(255),
ADD COLUMN stack_frames JSONB;
```

`breadcrumbs` from the JSON body are typically stored as rows in `event_logs` (e.g. `metadata.source = 'breadcrumb'`) rather than a column on `events`.

Recommended full event-related fields:

```sql
request_payload JSONB,
response_payload JSONB,
error_name VARCHAR(255),
error_message TEXT,
stack_trace TEXT,
stack_frames JSONB
```

You can keep `event_headers` and `event_logs` as separate tables; the ingest API still accepts `logs` and `breadcrumbs` arrays in the JSON body.

---

## Required Response

```json
{
  "success": true,
  "message": "Event accepted",
  "data": {
    "eventId": "uuid"
  }
}
```

---

## Error Response Examples

### Invalid API Key

```json
{
  "success": false,
  "message": "Invalid API key"
}
```

### Event Limit Reached

```json
{
  "success": false,
  "message": "Monthly event limit reached. Please upgrade your plan."
}
```

### Project Disabled

```json
{
  "success": false,
  "message": "Project is disabled"
}
```

---

## SSE Event Types

The backend should publish these event types to frontend dashboards:

| Type                  | Purpose                        |
| --------------------- | ------------------------------ |
| `event.created`       | New event captured             |
| `event.failed`        | Failed event captured          |
| `error_group.updated` | Error group created or updated |
| `alert.triggered`     | Alert rule matched             |
| `usage.updated`       | Usage counter changed          |
| `replay.started`      | Replay job started             |
| `replay.completed`    | Replay job completed           |

---

## Example Redis Pub/Sub Payload

```json
{
  "type": "event.failed",
  "projectId": "proj_123",
  "eventId": "evt_456",
  "status": "failed",
  "endpoint": "/api/orders",
  "statusCode": 500,
  "errorName": "TypeError",
  "errorMessage": "Cannot read properties of undefined",
  "topFrame": {
    "fileName": "/app/src/server.ts",
    "lineNumber": 32,
    "columnNumber": 23
  },
  "createdAt": "2026-05-09T10:00:00Z"
}
```
