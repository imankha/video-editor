# Task 06: Workers API Routes

## Overview
Implement the API routes in Cloudflare Workers for job management and video URLs.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 02 complete (workers/ directory exists)
- Task 03 complete (D1 schema defined)
- Task 05 complete (Durable Object implemented)

## Time Estimate
1 hour

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs` | Create new export job |
| GET | `/api/jobs/:id` | Get job status |
| GET | `/api/jobs` | List jobs for project |
| DELETE | `/api/jobs/:id` | Cancel/delete job |
| GET | `/api/jobs/:id/ws` | WebSocket connection |
| POST | `/api/videos/upload-url` | Get presigned upload URL |
| GET | `/api/videos/download/:key` | Download video from R2 |
| POST | `/api/runpod/callback` | RunPod completion webhook |

---

## Full Implementation

### src/index.ts

```typescript
import { ExportJobState } from './durable-objects/ExportJobState';
import { handleCreateJob, handleGetJob, handleListJobs, handleDeleteJob } from './routes/jobs';
import { handleUploadUrl, handleDownload } from './routes/videos';
import { handleRunPodCallback } from './routes/runpod';

export { ExportJobState };

export interface Env {
  DB: D1Database;
  VIDEOS: R2Bucket;
  EXPORT_JOB: DurableObjectNamespace;
  ENVIRONMENT: string;
  RUNPOD_ENDPOINT: string;
  RUNPOD_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response: Response;

      // Health check
      if (path === '/health') {
        response = new Response(JSON.stringify({ status: 'ok', env: env.ENVIRONMENT }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Job routes
      else if (path === '/api/jobs' && method === 'POST') {
        response = await handleCreateJob(request, env);
      }
      else if (path === '/api/jobs' && method === 'GET') {
        response = await handleListJobs(request, env);
      }
      else if (path.match(/^\/api\/jobs\/[\w-]+$/) && method === 'GET') {
        const jobId = path.split('/').pop()!;
        response = await handleGetJob(jobId, env);
      }
      else if (path.match(/^\/api\/jobs\/[\w-]+$/) && method === 'DELETE') {
        const jobId = path.split('/').pop()!;
        response = await handleDeleteJob(jobId, env);
      }
      // WebSocket route
      else if (path.match(/^\/api\/jobs\/[\w-]+\/ws$/)) {
        const jobId = path.split('/')[3];
        return handleWebSocket(jobId, request, env);
      }
      // Video routes
      else if (path === '/api/videos/upload-url' && method === 'POST') {
        response = await handleUploadUrl(request, env);
      }
      else if (path.startsWith('/api/videos/download/')) {
        const key = decodeURIComponent(path.replace('/api/videos/download/', ''));
        response = await handleDownload(key, env);
      }
      // RunPod callback
      else if (path === '/api/runpod/callback' && method === 'POST') {
        response = await handleRunPodCallback(request, env);
      }
      // Durable Object proxy (for internal use)
      else if (path.match(/^\/api\/jobs\/[\w-]+\/do\/.+$/)) {
        const parts = path.split('/');
        const jobId = parts[3];
        const doPath = '/' + parts.slice(5).join('/');
        return proxyToDurableObject(jobId, doPath, request, env);
      }
      else {
        response = new Response('Not Found', { status: 404 });
      }

      // Add CORS headers to response
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};

// WebSocket handling
async function handleWebSocket(jobId: string, request: Request, env: Env): Promise<Response> {
  const id = env.EXPORT_JOB.idFromName(jobId);
  const stub = env.EXPORT_JOB.get(id);
  return stub.fetch(request);
}

// Proxy requests to Durable Object
async function proxyToDurableObject(jobId: string, path: string, request: Request, env: Env): Promise<Response> {
  const id = env.EXPORT_JOB.idFromName(jobId);
  const stub = env.EXPORT_JOB.get(id);
  const url = new URL(request.url);
  url.pathname = path;
  return stub.fetch(new Request(url.toString(), request));
}
```

### src/routes/jobs.ts

```typescript
import { Env } from '../index';
import { ExportJob, CreateJobRequest } from '../lib/types';

export async function handleCreateJob(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as CreateJobRequest;

  // Validate request
  if (!body.project_id || !body.type || !body.input_video_key) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate job ID
  const jobId = crypto.randomUUID();

  // Create job in D1
  const job: ExportJob = {
    id: jobId,
    project_id: body.project_id,
    type: body.type,
    status: 'pending',
    progress: 0,
    input_video_key: body.input_video_key,
    params: body.params || {},
    created_at: new Date().toISOString(),
  };

  await env.DB.prepare(`
    INSERT INTO export_jobs (id, project_id, type, status, progress, input_video_key, params, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    job.id,
    job.project_id,
    job.type,
    job.status,
    job.progress,
    job.input_video_key,
    JSON.stringify(job.params),
    job.created_at
  ).run();

  // Initialize Durable Object
  const doId = env.EXPORT_JOB.idFromName(jobId);
  const stub = env.EXPORT_JOB.get(doId);
  await stub.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  }));

  // Trigger RunPod job
  const runpodResponse = await triggerRunPodJob(job, env);

  if (!runpodResponse.success) {
    // Mark job as error if RunPod fails to start
    await env.DB.prepare(`UPDATE export_jobs SET status = 'error', error = ? WHERE id = ?`)
      .bind('Failed to start processing', jobId).run();

    return new Response(JSON.stringify({ error: 'Failed to start processing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update with RunPod job ID
  await env.DB.prepare(`UPDATE export_jobs SET runpod_job_id = ? WHERE id = ?`)
    .bind(runpodResponse.runpod_job_id, jobId).run();

  return new Response(JSON.stringify({
    job_id: jobId,
    status: 'pending',
    websocket_url: `/api/jobs/${jobId}/ws`,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleGetJob(jobId: string, env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT * FROM export_jobs WHERE id = ?
  `).bind(jobId).first<any>();

  if (!result) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const job: ExportJob = {
    ...result,
    params: JSON.parse(result.params || '{}'),
  };

  // If complete, generate download URL
  let output_url: string | undefined;
  if (job.status === 'complete' && job.output_video_key) {
    output_url = `/api/videos/download/${encodeURIComponent(job.output_video_key)}`;
  }

  return new Response(JSON.stringify({ ...job, output_url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleListJobs(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') || '20');

  let query = 'SELECT * FROM export_jobs WHERE 1=1';
  const params: any[] = [];

  if (projectId) {
    query += ' AND project_id = ?';
    params.push(parseInt(projectId));
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const results = await env.DB.prepare(query).bind(...params).all<any>();

  const jobs = results.results?.map(result => ({
    ...result,
    params: JSON.parse(result.params || '{}'),
  })) || [];

  return new Response(JSON.stringify({ jobs }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleDeleteJob(jobId: string, env: Env): Promise<Response> {
  // Get job first
  const job = await env.DB.prepare(`SELECT * FROM export_jobs WHERE id = ?`)
    .bind(jobId).first<any>();

  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Don't allow deleting in-progress jobs
  if (job.status === 'processing') {
    return new Response(JSON.stringify({ error: 'Cannot delete job in progress' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete from D1
  await env.DB.prepare(`DELETE FROM export_jobs WHERE id = ?`).bind(jobId).run();

  // Clean up R2 files
  if (job.input_video_key) {
    await env.VIDEOS.delete(job.input_video_key);
  }
  if (job.output_video_key) {
    await env.VIDEOS.delete(job.output_video_key);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Trigger RunPod serverless job
async function triggerRunPodJob(job: ExportJob, env: Env): Promise<{ success: boolean; runpod_job_id?: string }> {
  if (!env.RUNPOD_ENDPOINT || !env.RUNPOD_API_KEY) {
    console.error('RunPod not configured');
    return { success: false };
  }

  try {
    const response = await fetch(`${env.RUNPOD_ENDPOINT}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          job_id: job.id,
          type: job.type,
          input_video_key: job.input_video_key,
          params: job.params,
          callback_url: `https://your-worker.your-subdomain.workers.dev/api/jobs/${job.id}/do`,
        },
      }),
    });

    if (!response.ok) {
      console.error('RunPod error:', await response.text());
      return { success: false };
    }

    const data = await response.json() as { id: string };
    return { success: true, runpod_job_id: data.id };

  } catch (error) {
    console.error('RunPod request failed:', error);
    return { success: false };
  }
}
```

### src/routes/videos.ts

```typescript
import { Env } from '../index';

interface UploadUrlRequest {
  filename: string;
  content_type: string;
  size_bytes: number;
  job_id?: string;
}

export async function handleUploadUrl(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as UploadUrlRequest;

  if (!body.filename || !body.content_type) {
    return new Response(JSON.stringify({ error: 'Missing filename or content_type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate a unique key
  const jobId = body.job_id || crypto.randomUUID();
  const videoKey = `input/${jobId}/${body.filename}`;

  // For R2, we'll use a different approach since Workers can't generate
  // traditional presigned URLs. Instead, we return a path that the
  // frontend can PUT to via a worker endpoint.

  return new Response(JSON.stringify({
    upload_url: `/api/videos/upload/${encodeURIComponent(videoKey)}`,
    video_key: videoKey,
    method: 'PUT',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleUpload(key: string, request: Request, env: Env): Promise<Response> {
  const body = await request.arrayBuffer();

  await env.VIDEOS.put(key, body, {
    httpMetadata: {
      contentType: request.headers.get('Content-Type') || 'video/mp4',
    },
  });

  return new Response(JSON.stringify({ success: true, key }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleDownload(key: string, env: Env): Promise<Response> {
  const object = await env.VIDEOS.get(key);

  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'video/mp4');
  headers.set('Content-Length', object.size.toString());
  headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);

  return new Response(object.body, { headers });
}
```

### src/routes/runpod.ts

```typescript
import { Env } from '../index';

interface RunPodCallback {
  job_id: string;
  status: 'completed' | 'failed';
  output?: {
    output_video_key: string;
  };
  error?: string;
}

export async function handleRunPodCallback(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as RunPodCallback;

  if (!body.job_id) {
    return new Response(JSON.stringify({ error: 'Missing job_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const doId = env.EXPORT_JOB.idFromName(body.job_id);
  const stub = env.EXPORT_JOB.get(doId);

  if (body.status === 'completed' && body.output?.output_video_key) {
    await stub.fetch(new Request('https://do/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_video_key: body.output.output_video_key }),
    }));
  } else if (body.status === 'failed') {
    await stub.fetch(new Request('https://do/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: body.error || 'Unknown error', should_retry: true }),
    }));
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## Testing

```bash
# Start local dev
cd workers
npm run dev

# Create a job
curl -X POST http://localhost:8787/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 1,
    "type": "overlay",
    "input_video_key": "input/test/video.mp4",
    "params": {}
  }'

# Get job status
curl http://localhost:8787/api/jobs/{job_id}

# List jobs
curl "http://localhost:8787/api/jobs?project_id=1"

# Test WebSocket (requires websocat)
websocat ws://localhost:8787/api/jobs/{job_id}/ws
```

---

## Handoff Notes

**For Task 08 (GPU Worker):**
- RunPod worker receives job via `RUNPOD_ENDPOINT/run`
- Worker should call back to:
  - `POST /api/jobs/{id}/do/progress` for progress updates
  - `POST /api/jobs/{id}/do/complete` when done
  - `POST /api/jobs/{id}/do/error` on failure

**For Task 10 (Frontend):**
- Create job: `POST /api/jobs`
- Poll status: `GET /api/jobs/{id}` or use WebSocket
- WebSocket: `ws://workers-url/api/jobs/{id}/ws`
- Download: `GET /api/videos/download/{key}`
