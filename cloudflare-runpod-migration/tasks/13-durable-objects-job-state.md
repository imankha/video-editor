# Task 13: Durable Objects for Job State

## Overview
Implement Durable Objects to manage export job state with WebSocket support for real-time progress updates.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 12 complete (Workers API routes)

## Testability
**After this task**: Jobs persist across Worker restarts. WebSocket connections show real-time progress.

---

## Why Durable Objects?

| Problem | How DO Solves It |
|---------|------------------|
| In-memory job store lost on restart | DO persists state automatically |
| Can't broadcast to multiple WebSockets | DO can hold WebSocket connections |
| Race conditions with concurrent updates | DO guarantees single-threaded execution |

---

## Architecture

```
Browser 1 ──WebSocket──┐
Browser 2 ──WebSocket──┼──► ExportJobState DO (job-123)
RunPod ────callback────┘         │
                                 ▼
                          Broadcasts progress
                          to all connected clients
```

---

## Files to Create/Modify

### Update wrangler.toml

```toml
name = "reel-ballers-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

account_id = "YOUR_ACCOUNT_ID"

[[r2_buckets]]
binding = "USER_DATA"
bucket_name = "reel-ballers-users"

# Add Durable Objects
[durable_objects]
bindings = [
  { name = "EXPORT_JOB", class_name = "ExportJobState" }
]

[[migrations]]
tag = "v1"
new_classes = ["ExportJobState"]

[vars]
ENVIRONMENT = "development"
RUNPOD_ENDPOINT = ""
```

### src/durable-objects/ExportJobState.ts

```typescript
import { ExportJob, WebSocketMessage } from '../lib/types';

interface JobData {
  job: ExportJob;
  userId: string;
}

export class ExportJobState {
  private state: DurableObjectState;
  private env: any;
  private sessions: Set<WebSocket> = new Set();
  private jobData: JobData | null = null;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // REST endpoints
    if (path === '/init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    if (path === '/status' && request.method === 'GET') {
      return this.handleGetStatus();
    }
    if (path === '/progress' && request.method === 'POST') {
      return this.handleProgress(request);
    }
    if (path === '/complete' && request.method === 'POST') {
      return this.handleComplete(request);
    }
    if (path === '/error' && request.method === 'POST') {
      return this.handleError(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * Initialize a new job
   */
  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json() as JobData;

    this.jobData = body;
    await this.state.storage.put('jobData', body);

    return Response.json({ success: true, job_id: body.job.id });
  }

  /**
   * Get current job status
   */
  private async handleGetStatus(): Promise<Response> {
    if (!this.jobData) {
      this.jobData = await this.state.storage.get('jobData') as JobData | null;
    }

    if (!this.jobData) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    return Response.json({
      job_id: this.jobData.job.id,
      status: this.jobData.job.status,
      progress: this.jobData.job.progress,
      output_key: this.jobData.job.output_key,
      error: this.jobData.job.error,
    });
  }

  /**
   * Update progress (called by RunPod callback)
   */
  private async handleProgress(request: Request): Promise<Response> {
    const body = await request.json() as { progress: number; message?: string };

    if (!this.jobData) {
      this.jobData = await this.state.storage.get('jobData') as JobData | null;
    }

    if (!this.jobData) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    this.jobData.job.progress = body.progress;
    this.jobData.job.status = 'processing';
    await this.state.storage.put('jobData', this.jobData);

    // Broadcast to WebSocket clients
    this.broadcast({
      type: 'progress',
      job_id: this.jobData.job.id,
      progress: body.progress,
      message: body.message,
    });

    return Response.json({ success: true });
  }

  /**
   * Mark job as complete
   */
  private async handleComplete(request: Request): Promise<Response> {
    const body = await request.json() as { output_key: string };

    if (!this.jobData) {
      this.jobData = await this.state.storage.get('jobData') as JobData | null;
    }

    if (!this.jobData) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    this.jobData.job.status = 'complete';
    this.jobData.job.progress = 100;
    this.jobData.job.output_key = body.output_key;
    this.jobData.job.completed_at = new Date().toISOString();
    await this.state.storage.put('jobData', this.jobData);

    // Broadcast completion
    this.broadcast({
      type: 'complete',
      job_id: this.jobData.job.id,
      output_url: `/api/storage/presigned-url?key=${encodeURIComponent(body.output_key)}`,
    });

    return Response.json({ success: true });
  }

  /**
   * Mark job as failed
   */
  private async handleError(request: Request): Promise<Response> {
    const body = await request.json() as { error: string };

    if (!this.jobData) {
      this.jobData = await this.state.storage.get('jobData') as JobData | null;
    }

    if (!this.jobData) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    this.jobData.job.status = 'error';
    this.jobData.job.error = body.error;
    await this.state.storage.put('jobData', this.jobData);

    // Broadcast error
    this.broadcast({
      type: 'error',
      job_id: this.jobData.job.id,
      error: body.error,
    });

    return Response.json({ success: true });
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.sessions.add(server);

    // Send current status immediately
    if (this.jobData) {
      server.send(JSON.stringify({
        type: 'status',
        job_id: this.jobData.job.id,
        status: this.jobData.job.status,
        progress: this.jobData.job.progress,
      }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * WebSocket message handler (for pings)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(message as string) as WebSocketMessage;

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  /**
   * WebSocket close handler
   */
  async webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws);
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  private broadcast(message: WebSocketMessage) {
    const payload = JSON.stringify(message);

    for (const ws of this.sessions) {
      try {
        ws.send(payload);
      } catch (e) {
        // Remove dead connections
        this.sessions.delete(ws);
      }
    }
  }
}
```

### Update src/index.ts to export DO and route to it

```typescript
import { ExportJobState } from './durable-objects/ExportJobState';

// Export the Durable Object class
export { ExportJobState };

export interface Env {
  USER_DATA: R2Bucket;
  EXPORT_JOB: DurableObjectNamespace;
  ENVIRONMENT: string;
  RUNPOD_ENDPOINT: string;
  RUNPOD_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ... existing routes ...

    // WebSocket route for job updates
    if (path.match(/^\/api\/jobs\/[\w-]+\/ws$/)) {
      const jobId = path.split('/')[3];
      const doId = env.EXPORT_JOB.idFromName(jobId);
      const stub = env.EXPORT_JOB.get(doId);
      return stub.fetch(request);
    }

    // ... rest of routes ...
  },
};
```

### Update jobs.ts to use Durable Objects

```typescript
export async function handleExportStart(request: Request, env: Env): Promise<Response> {
  // ... existing code to parse request ...

  const jobId = crypto.randomUUID();

  // Create job in Durable Object
  const doId = env.EXPORT_JOB.idFromName(jobId);
  const stub = env.EXPORT_JOB.get(doId);

  const job: ExportJob = {
    id: jobId,
    // ... job data ...
  };

  await stub.fetch(new Request('https://do/init', {
    method: 'POST',
    body: JSON.stringify({ job, userId }),
  }));

  // Submit to RunPod with DO callback URL
  // callback_url: `https://your-worker.workers.dev/api/jobs/${jobId}/do`

  return Response.json({ job_id: jobId, status: 'processing' });
}

export async function handleExportStatus(jobId: string, env: Env): Promise<Response> {
  const doId = env.EXPORT_JOB.idFromName(jobId);
  const stub = env.EXPORT_JOB.get(doId);
  return stub.fetch(new Request('https://do/status'));
}
```

---

## Testing

### Test WebSocket Connection

```javascript
// In browser console
const ws = new WebSocket('ws://localhost:8787/api/jobs/test-job-id/ws');
ws.onmessage = (e) => console.log('Received:', JSON.parse(e.data));
ws.onopen = () => console.log('Connected');
```

### Test Progress Updates

```bash
# Simulate RunPod callback
curl -X POST http://localhost:8787/api/jobs/test-job-id/do \
  -H "Content-Type: application/json" \
  -d '{"status": "progress", "progress": 50, "message": "Processing..."}'
```

---

## Job Lifecycle

```
1. Frontend calls POST /api/export/overlay/start
   └─► Worker creates DO, initializes job
   └─► Worker submits to RunPod
   └─► Returns { job_id, status: 'processing' }

2. Frontend connects WebSocket to /api/jobs/{id}/ws
   └─► DO sends current status immediately

3. RunPod calls POST /api/jobs/{id}/do with progress
   └─► DO updates state
   └─► DO broadcasts to all WebSocket clients

4. RunPod calls POST /api/jobs/{id}/do with completion
   └─► DO marks complete
   └─► DO broadcasts completion with output URL

5. Frontend receives completion, shows download button
```

---

## Handoff Notes

**For Task 14 (Backend Migration):**
- Jobs now persist in Durable Objects
- WebSocket support for real-time updates
- Ready to switch frontend from FastAPI to Workers

**For Task 15 (Frontend Updates):**
- Use WebSocket connection for progress
- Fall back to polling if WebSocket fails
