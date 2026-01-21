# Task 12: Workers API Routes

## Overview
Implement the API routes in Cloudflare Workers that mirror the FastAPI backend. Uses in-memory SQLite with R2 sync (from Task 04).

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 11 complete (Workers project setup)
- Task 04 complete (Database sync with R2)

## Testability
**After this task**: Workers can handle export requests, return presigned URLs, and manage job state.

---

## API Routes to Implement

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/export/overlay/start` | POST | Start overlay export |
| `/api/export/framing/start` | POST | Start framing export |
| `/api/export/annotate/start` | POST | Start annotate export |
| `/api/export/status/:jobId` | GET | Get job status |
| `/api/storage/presigned-url` | GET | Get download URL for R2 file |
| `/api/storage/upload-url` | POST | Get upload URL for R2 file |
| `/api/runpod/callback/:jobId` | POST | Receive progress from RunPod |

---

## Main Router (src/index.ts)

```typescript
import { handleExportStart, handleExportStatus } from './routes/jobs';
import { handlePresignedUrl, handleUploadUrl } from './routes/videos';
import { handleRunPodCallback } from './routes/callback';

export interface Env {
  USER_DATA: R2Bucket;
  ENVIRONMENT: string;
  RUNPOD_ENDPOINT: string;
  RUNPOD_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      let response: Response;

      // Health check
      if (path === '/health') {
        response = Response.json({ status: 'ok', env: env.ENVIRONMENT });
      }
      // Export routes
      else if (path.match(/^\/api\/export\/(overlay|framing|annotate)\/start$/) && method === 'POST') {
        response = await handleExportStart(request, env);
      }
      else if (path.match(/^\/api\/export\/status\/[\w-]+$/) && method === 'GET') {
        const jobId = path.split('/').pop()!;
        response = await handleExportStatus(jobId, env);
      }
      // Storage routes
      else if (path === '/api/storage/presigned-url' && method === 'GET') {
        response = await handlePresignedUrl(request, env);
      }
      else if (path === '/api/storage/upload-url' && method === 'POST') {
        response = await handleUploadUrl(request, env);
      }
      // RunPod callback
      else if (path.match(/^\/api\/runpod\/callback\/[\w-]+$/) && method === 'POST') {
        const jobId = path.split('/').pop()!;
        response = await handleRunPodCallback(request, jobId, env);
      }
      else {
        response = new Response('Not Found', { status: 404 });
      }

      // Add CORS headers to all responses
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });

    } catch (error) {
      console.error('Request error:', error);
      return Response.json(
        { error: String(error) },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
```

---

## Export Routes (src/routes/jobs.ts)

```typescript
import { Env } from '../index';
import { ExportJob, CreateJobRequest } from '../lib/types';

// In-memory job store (will move to DO in Task 13)
const jobStore = new Map<string, ExportJob>();

export async function handleExportStart(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as CreateJobRequest;
  const userId = request.headers.get('X-User-Id') || 'a'; // Default to 'a' for now

  const jobId = crypto.randomUUID();
  const exportType = new URL(request.url).pathname.split('/')[3]; // overlay, framing, or annotate

  // Determine output key
  const outputKey = `final_videos/${exportType}_${jobId}.mp4`;

  // Create job record
  const job: ExportJob = {
    id: jobId,
    project_id: body.project_id,
    type: exportType as ExportJob['type'],
    status: 'pending',
    progress: 0,
    input_key: body.input_key,
    output_key: outputKey,
    params: body.params,
    created_at: new Date().toISOString(),
  };

  jobStore.set(jobId, job);

  // Submit to RunPod
  try {
    const runpodResponse = await fetch(`${env.RUNPOD_ENDPOINT}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          job_id: jobId,
          user_id: userId,
          type: exportType,
          input_key: body.input_key,
          output_key: outputKey,
          params: body.params,
          callback_url: `https://your-worker.workers.dev/api/runpod/callback/${jobId}`,
        },
      }),
    });

    if (!runpodResponse.ok) {
      throw new Error(`RunPod error: ${runpodResponse.statusText}`);
    }

    const runpodData = await runpodResponse.json() as { id: string };
    job.runpod_job_id = runpodData.id;
    job.status = 'processing';
    job.started_at = new Date().toISOString();

    return Response.json({ job_id: jobId, status: 'processing' });

  } catch (error) {
    job.status = 'error';
    job.error = String(error);
    return Response.json({ job_id: jobId, status: 'error', error: job.error }, { status: 500 });
  }
}

export async function handleExportStatus(jobId: string, env: Env): Promise<Response> {
  const job = jobStore.get(jobId);

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  // If still processing, optionally check RunPod status
  if (job.status === 'processing' && job.runpod_job_id) {
    try {
      const statusResponse = await fetch(
        `${env.RUNPOD_ENDPOINT}/status/${job.runpod_job_id}`,
        {
          headers: { 'Authorization': `Bearer ${env.RUNPOD_API_KEY}` },
        }
      );

      if (statusResponse.ok) {
        const statusData = await statusResponse.json() as {
          status: string;
          output?: { status: string; output_key: string };
          error?: string;
        };

        if (statusData.status === 'COMPLETED') {
          job.status = 'complete';
          job.progress = 100;
          job.completed_at = new Date().toISOString();
        } else if (statusData.status === 'FAILED') {
          job.status = 'error';
          job.error = statusData.error || 'Job failed';
        }
      }
    } catch (e) {
      // Ignore polling errors, return cached status
    }
  }

  return Response.json({
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    output_key: job.status === 'complete' ? job.output_key : undefined,
    error: job.status === 'error' ? job.error : undefined,
  });
}
```

---

## Video Routes (src/routes/videos.ts)

```typescript
import { Env } from '../index';
import { AwsClient } from 'aws4fetch';

export async function handlePresignedUrl(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key) {
    return Response.json({ error: 'Missing key parameter' }, { status: 400 });
  }

  // Generate presigned URL using aws4fetch
  // Note: Requires R2 credentials to be set
  const presignedUrl = await generatePresignedUrl(env, key, 'GET', 3600);

  return Response.json({ url: presignedUrl });
}

export async function handleUploadUrl(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { key: string; content_type?: string };

  if (!body.key) {
    return Response.json({ error: 'Missing key in body' }, { status: 400 });
  }

  const presignedUrl = await generatePresignedUrl(env, body.key, 'PUT', 3600);

  return Response.json({ url: presignedUrl, key: body.key });
}

async function generatePresignedUrl(
  env: Env,
  key: string,
  method: 'GET' | 'PUT',
  expiresIn: number
): Promise<string> {
  // For R2 presigned URLs, you'll need to set up S3-compatible credentials
  // This is a simplified version - actual implementation requires aws4fetch

  // Option 1: Use R2's public URL if bucket is public (not recommended)
  // Option 2: Redirect through Worker (adds latency)
  // Option 3: Use aws4fetch with R2 S3-compatible API

  // For now, return a worker-proxied URL
  return `https://your-worker.workers.dev/api/storage/proxy?key=${encodeURIComponent(key)}`;
}
```

---

## RunPod Callback (src/routes/callback.ts)

```typescript
import { Env } from '../index';
import { ExportJob } from '../lib/types';

// Reference to the same job store (will be replaced with DO in Task 13)
declare const jobStore: Map<string, ExportJob>;

interface CallbackPayload {
  status: 'progress' | 'complete' | 'error';
  progress?: number;
  message?: string;
  output_key?: string;
  error?: string;
}

export async function handleRunPodCallback(
  request: Request,
  jobId: string,
  env: Env
): Promise<Response> {
  const body = await request.json() as CallbackPayload;
  const job = jobStore.get(jobId);

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  switch (body.status) {
    case 'progress':
      job.progress = body.progress || job.progress;
      // TODO: Broadcast to WebSocket subscribers (Task 13)
      break;

    case 'complete':
      job.status = 'complete';
      job.progress = 100;
      job.output_key = body.output_key;
      job.completed_at = new Date().toISOString();
      // TODO: Broadcast completion to WebSocket subscribers
      break;

    case 'error':
      job.status = 'error';
      job.error = body.error || 'Unknown error';
      // TODO: Broadcast error to WebSocket subscribers
      break;
  }

  return Response.json({ received: true });
}
```

---

## Testing

```bash
# Start Workers dev server
cd workers && npm run dev

# Test health
curl http://localhost:8787/health

# Test export start (requires RunPod to be configured)
curl -X POST http://localhost:8787/api/export/overlay/start \
  -H "Content-Type: application/json" \
  -H "X-User-Id: a" \
  -d '{
    "project_id": 1,
    "input_key": "working_videos/test.mp4",
    "params": {
      "highlight_regions": [],
      "effect_type": "blur"
    }
  }'

# Test status
curl http://localhost:8787/api/export/status/{job_id}
```

---

## Storage Layer (src/storage/)

### Storage Interface (src/storage/types.ts)

```typescript
export interface StorageBackend {
  // Read/write files
  get(key: string): Promise<ReadableStream | null>;
  put(key: string, data: ReadableStream | ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;

  // List files
  list(prefix: string): Promise<string[]>;

  // Signed URLs for direct upload/download
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  getUploadUrl(key: string, expiresIn: number): Promise<string>;
}
```

### R2 Storage Implementation (src/storage/r2.ts)

```typescript
export class R2Storage implements StorageBackend {
  constructor(private bucket: R2Bucket, private userId: string) {}

  private key(path: string): string {
    return `${this.userId}/${path}`;
  }

  async get(path: string): Promise<ReadableStream | null> {
    const obj = await this.bucket.get(this.key(path));
    return obj?.body ?? null;
  }

  async put(path: string, data: ReadableStream | ArrayBuffer): Promise<void> {
    await this.bucket.put(this.key(path), data);
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(this.key(path));
  }

  async list(prefix: string): Promise<string[]> {
    const fullPrefix = this.key(prefix);
    const listed = await this.bucket.list({ prefix: fullPrefix });
    return listed.objects.map(obj => obj.key.replace(`${this.userId}/`, ''));
  }

  async getSignedUrl(path: string, expiresIn: number): Promise<string> {
    // R2 presigned URLs require aws4fetch - see generatePresignedUrl in videos.ts
    throw new Error('Use generatePresignedUrl from videos.ts');
  }

  async getUploadUrl(path: string, expiresIn: number): Promise<string> {
    throw new Error('Use generatePresignedUrl from videos.ts');
  }
}
```

### SQLite in R2 (src/storage/sqlite.ts)

Load and save SQLite database from R2 using sql.js (WebAssembly SQLite):

```typescript
import initSqlJs, { Database } from 'sql.js';

export class R2SqliteDatabase {
  private db: Database | null = null;

  constructor(
    private bucket: R2Bucket,
    private userId: string
  ) {}

  private get key(): string {
    return `${this.userId}/database.sqlite`;
  }

  async load(): Promise<Database> {
    if (this.db) return this.db;

    // Initialize SQL.js (WebAssembly SQLite)
    const SQL = await initSqlJs();

    // Try to load existing database
    const existing = await this.bucket.get(this.key);
    if (existing) {
      const buffer = await existing.arrayBuffer();
      this.db = new SQL.Database(new Uint8Array(buffer));
    } else {
      // Create new database with schema
      this.db = new SQL.Database();
      this.initializeSchema();
    }

    return this.db;
  }

  async save(): Promise<void> {
    if (!this.db) return;
    const data = this.db.export();
    await this.bucket.put(this.key, data.buffer);
  }

  private initializeSchema(): void {
    // Same schema as local SQLite
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        video_path TEXT,
        thumbnail_path TEXT,
        duration REAL,
        fps REAL,
        width INTEGER,
        height INTEGER,
        opponent_name TEXT,
        game_date TEXT,
        game_type TEXT DEFAULT 'away',
        tournament_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS raw_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        video_path TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        rating INTEGER DEFAULT 3,
        tags TEXT DEFAULT '[]',
        notes TEXT,
        thumbnail_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        aspect_ratio TEXT DEFAULT '9:16',
        output_width INTEGER DEFAULT 1080,
        output_height INTEGER DEFAULT 1920,
        is_auto_created INTEGER DEFAULT 0,
        working_video_path TEXT,
        has_working_video INTEGER DEFAULT 0,
        has_overlay_edits INTEGER DEFAULT 0,
        has_final_video INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_opened_at TEXT
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS working_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        raw_clip_id INTEGER NOT NULL,
        clip_index INTEGER NOT NULL,
        crop_keyframes TEXT DEFAULT '[]',
        is_exported INTEGER DEFAULT 0,
        exported_path TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id)
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS highlight_regions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        start_frame INTEGER NOT NULL,
        end_frame INTEGER NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        radius_x REAL NOT NULL,
        radius_y REAL NOT NULL,
        opacity REAL DEFAULT 1.0,
        color TEXT DEFAULT '#ffffff',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    this.db!.run(`
      CREATE TABLE IF NOT EXISTS final_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        game_id INTEGER,
        name TEXT NOT NULL,
        video_path TEXT NOT NULL,
        thumbnail_path TEXT,
        source_type TEXT NOT NULL,
        duration REAL,
        file_size INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
      )
    `);
  }
}
```

### Request Pattern with Database

```typescript
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const userId = getUserId(request);  // From cookie or header

  // Load user's database from R2
  const db = new R2SqliteDatabase(env.USER_DATA, userId);
  await db.load();

  try {
    // Handle the request...
    const result = await processRequest(db, request);

    // Save database back to R2 if modified
    await db.save();

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

### Dependencies

Add to `workers/package.json`:

```json
{
  "dependencies": {
    "sql.js": "^1.10.0"
  }
}
```

**Note**: The SQL.js WASM file needs to be bundled or loaded from CDN.

---

## Handoff Notes

**For Task 13 (Durable Objects):**
- Current job store is in-memory (loses state on restart)
- Need to move to Durable Objects for persistence
- DO will also handle WebSocket connections for real-time updates

**For Task 14 (Backend Migration):**
- Workers API matches FastAPI structure
- Frontend can switch between backends via config
