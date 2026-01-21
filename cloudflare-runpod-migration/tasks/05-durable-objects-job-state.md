# Task 05: Durable Objects - Job State

## Overview
Implement the ExportJobState Durable Object that manages job state and WebSocket connections.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 02 complete (workers/ directory exists)
- Task 03 complete (D1 schema defined)

## Time Estimate
45 minutes

---

## What Durable Objects Do

1. **Maintain authoritative job state** - Single source of truth
2. **Handle WebSocket connections** - Frontend subscribes for real-time updates
3. **Receive progress updates** - From RunPod worker via HTTP
4. **Survive disconnections** - State persists even if frontend disconnects

---

## Full Implementation

### src/durable-objects/ExportJobState.ts

```typescript
import { ExportJob, WebSocketMessage } from '../lib/types';

interface JobState {
  job: ExportJob | null;
  lastHeartbeat: number;
}

export class ExportJobState {
  state: DurableObjectState;
  env: any;
  connections: Set<WebSocket>;
  jobState: JobState;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.jobState = {
      job: null,
      lastHeartbeat: 0,
    };

    // Restore state from storage
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<JobState>('jobState');
      if (stored) {
        this.jobState = stored;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // HTTP endpoints for RunPod callbacks
    switch (url.pathname) {
      case '/init':
        return this.handleInit(request);
      case '/progress':
        return this.handleProgress(request);
      case '/complete':
        return this.handleComplete(request);
      case '/error':
        return this.handleError(request);
      case '/status':
        return this.handleStatus(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // WebSocket Handling
  // ─────────────────────────────────────────────────────────────

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.connections.add(server);

    // Send current state immediately
    if (this.jobState.job) {
      server.send(JSON.stringify({
        type: 'status',
        job_id: this.jobState.job.id,
        status: this.jobState.job.status,
        progress: this.jobState.job.progress,
      }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string) as WebSocketMessage;

      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'subscribe':
          // Already subscribed by connecting
          if (this.jobState.job) {
            ws.send(JSON.stringify({
              type: 'status',
              job_id: this.jobState.job.id,
              status: this.jobState.job.status,
              progress: this.jobState.job.progress,
            }));
          }
          break;
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.connections.delete(ws);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    this.connections.delete(ws);
  }

  private broadcast(message: WebSocketMessage) {
    const payload = JSON.stringify(message);
    for (const ws of this.connections) {
      try {
        ws.send(payload);
      } catch (e) {
        this.connections.delete(ws);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP Handlers (called by RunPod worker)
  // ─────────────────────────────────────────────────────────────

  private async handleInit(request: Request): Promise<Response> {
    const job = await request.json() as ExportJob;

    this.jobState = {
      job,
      lastHeartbeat: Date.now(),
    };

    await this.state.storage.put('jobState', this.jobState);

    this.broadcast({
      type: 'status',
      job_id: job.id,
      status: job.status,
      progress: 0,
    });

    return new Response(JSON.stringify({ success: true }));
  }

  private async handleProgress(request: Request): Promise<Response> {
    const { progress, message } = await request.json() as { progress: number; message?: string };

    if (!this.jobState.job) {
      return new Response('Job not initialized', { status: 400 });
    }

    this.jobState.job.progress = progress;
    this.jobState.job.status = 'processing';
    this.jobState.lastHeartbeat = Date.now();

    await this.state.storage.put('jobState', this.jobState);

    // Update D1
    await this.env.DB.prepare(`
      UPDATE export_jobs SET progress = ?, status = 'processing', started_at = COALESCE(started_at, datetime('now'))
      WHERE id = ?
    `).bind(progress, this.jobState.job.id).run();

    this.broadcast({
      type: 'progress',
      job_id: this.jobState.job.id,
      progress,
      message,
    });

    return new Response(JSON.stringify({ success: true }));
  }

  private async handleComplete(request: Request): Promise<Response> {
    const { output_video_key } = await request.json() as { output_video_key: string };

    if (!this.jobState.job) {
      return new Response('Job not initialized', { status: 400 });
    }

    this.jobState.job.status = 'complete';
    this.jobState.job.progress = 100;
    this.jobState.job.output_video_key = output_video_key;

    await this.state.storage.put('jobState', this.jobState);

    // Update D1
    await this.env.DB.prepare(`
      UPDATE export_jobs
      SET status = 'complete', progress = 100, output_video_key = ?, completed_at = datetime('now')
      WHERE id = ?
    `).bind(output_video_key, this.jobState.job.id).run();

    // Generate presigned URL for download
    const outputUrl = await this.generatePresignedUrl(output_video_key);

    this.broadcast({
      type: 'complete',
      job_id: this.jobState.job.id,
      output_url: outputUrl,
    });

    return new Response(JSON.stringify({ success: true }));
  }

  private async handleError(request: Request): Promise<Response> {
    const { error, should_retry } = await request.json() as { error: string; should_retry?: boolean };

    if (!this.jobState.job) {
      return new Response('Job not initialized', { status: 400 });
    }

    const job = this.jobState.job;
    const newRetryCount = (job.retry_count || 0) + 1;
    const maxRetries = 3;

    if (should_retry && newRetryCount < maxRetries) {
      // Reset to pending for retry
      job.status = 'pending';
      job.error = error;
      job.retry_count = newRetryCount;

      await this.env.DB.prepare(`
        UPDATE export_jobs
        SET status = 'pending', error = ?, retry_count = ?
        WHERE id = ?
      `).bind(error, newRetryCount, job.id).run();

      this.broadcast({
        type: 'progress',
        job_id: job.id,
        progress: 0,
        message: `Retrying (attempt ${newRetryCount + 1}/${maxRetries + 1})...`,
      });
    } else {
      // Mark as failed
      job.status = 'error';
      job.error = error;

      await this.env.DB.prepare(`
        UPDATE export_jobs
        SET status = 'error', error = ?, retry_count = ?
        WHERE id = ?
      `).bind(error, newRetryCount, job.id).run();

      this.broadcast({
        type: 'error',
        job_id: job.id,
        error,
      });
    }

    this.jobState.job = job;
    await this.state.storage.put('jobState', this.jobState);

    return new Response(JSON.stringify({ success: true, retrying: should_retry && newRetryCount < maxRetries }));
  }

  private async handleStatus(request: Request): Promise<Response> {
    if (!this.jobState.job) {
      return new Response(JSON.stringify({ status: 'not_found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      job: this.jobState.job,
      connections: this.connections.size,
      last_heartbeat: this.jobState.lastHeartbeat,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private async generatePresignedUrl(key: string): Promise<string> {
    // R2 presigned URLs require the S3 API
    // For now, return a Workers URL that proxies the download
    // In production, implement actual presigned URLs
    return `/api/videos/download/${encodeURIComponent(key)}`;
  }
}
```

---

## How It Works

### Job Lifecycle

```
1. Job Created (API Route)
   └── Create D1 record
   └── Call Durable Object /init

2. RunPod Starts Processing
   └── Call Durable Object /progress (0%)
   └── Broadcast to WebSocket clients
   └── Update D1

3. RunPod Sends Progress Updates
   └── Call Durable Object /progress (10%, 50%, etc.)
   └── Broadcast to WebSocket clients
   └── Update D1

4. RunPod Completes
   └── Call Durable Object /complete
   └── Broadcast to WebSocket clients
   └── Update D1

5. Frontend Receives 'complete' Message
   └── Shows download button
```

### WebSocket Connection Flow

```
Frontend                    Durable Object
   │                              │
   │──── WebSocket connect ──────>│
   │                              │ Add to connections set
   │<──── Current status ─────────│
   │                              │
   │        ... time passes ...   │
   │                              │
   │<──── progress update ────────│ (from RunPod callback)
   │<──── progress update ────────│
   │<──── complete ───────────────│
   │                              │
   │──── disconnect ─────────────>│
   │                              │ Remove from connections
```

---

## Testing

### Local Testing with Wrangler

```bash
# Start workers locally
cd workers
npm run dev

# In another terminal, test WebSocket
websocat ws://localhost:8787/api/jobs/test-job-123/ws

# Or use curl for HTTP endpoints
curl -X POST http://localhost:8787/api/jobs/test-job-123/do/init \
  -H "Content-Type: application/json" \
  -d '{"id":"test-job-123","status":"pending","progress":0}'

curl -X POST http://localhost:8787/api/jobs/test-job-123/do/progress \
  -H "Content-Type: application/json" \
  -d '{"progress":50,"message":"Processing..."}'
```

---

## Handoff Notes

**For Task 06 (API Routes):**
- Durable Object is ready to use
- Routes need to:
  - Create job in D1 first
  - Get Durable Object stub: `env.EXPORT_JOB.get(env.EXPORT_JOB.idFromName(jobId))`
  - Call `/init` to initialize state
  - Proxy WebSocket connections to Durable Object

**For Task 08 (GPU Worker):**
- RunPod worker calls these Durable Object endpoints:
  - `POST /progress` with `{ progress: number, message?: string }`
  - `POST /complete` with `{ output_video_key: string }`
  - `POST /error` with `{ error: string, should_retry?: boolean }`

---

## Common Issues

### "Durable Object not found"
Make sure wrangler.toml has the migration and binding configured.

### WebSocket immediately closes
Check that the route is correctly proxying to the Durable Object.

### State not persisting
Use `state.storage.put()` for persistence. In-memory state is lost on hibernation.
