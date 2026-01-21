# Task 02: Workers Project Setup

## Overview
Create the Cloudflare Workers project structure with wrangler.toml configuration.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 01 complete (Cloudflare account, D1 database ID, R2 bucket name)

## Time Estimate
15 minutes

---

## Required Information from User

Before starting, Claude needs:
```
D1 Database ID: _______________________
R2 Bucket Name: _______________________
Account ID: _______________________  (from Cloudflare dashboard URL)
```

---

## Directory Structure to Create

```
video-editor/
└── workers/
    ├── src/
    │   ├── index.ts                 # Main entry point
    │   ├── routes/
    │   │   ├── jobs.ts              # Job CRUD endpoints
    │   │   └── videos.ts            # R2 presigned URLs
    │   ├── durable-objects/
    │   │   └── ExportJobState.ts    # Job state machine
    │   └── lib/
    │       ├── types.ts             # TypeScript interfaces
    │       └── utils.ts             # Helper functions
    ├── wrangler.toml                # Cloudflare configuration
    ├── package.json
    └── tsconfig.json
```

---

## Files to Create

### wrangler.toml
```toml
name = "reel-ballers-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Account ID (get from dashboard URL: dash.cloudflare.com/<account_id>/...)
account_id = "YOUR_ACCOUNT_ID"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "reel-ballers"
database_id = "YOUR_D1_DATABASE_ID"

# R2 Storage
[[r2_buckets]]
binding = "VIDEOS"
bucket_name = "reel-ballers-videos"

# Durable Objects
[durable_objects]
bindings = [
  { name = "EXPORT_JOB", class_name = "ExportJobState" }
]

[[migrations]]
tag = "v1"
new_classes = ["ExportJobState"]

# Environment variables
[vars]
ENVIRONMENT = "development"
RUNPOD_ENDPOINT = ""  # Set after Task 07

# Local development settings
[dev]
port = 8787
local_protocol = "http"

# Production environment overrides
[env.production]
vars = { ENVIRONMENT = "production" }
```

### package.json
```json
{
  "name": "reel-ballers-workers",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev --local --persist",
    "dev:remote": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate": "wrangler d1 migrations apply reel-ballers",
    "db:migrate:local": "wrangler d1 migrations apply reel-ballers --local",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240117.0",
    "typescript": "^5.3.3",
    "wrangler": "^3.24.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ES2022",
    "moduleResolution": "node",
    "lib": ["ES2021"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### src/index.ts (Skeleton)
```typescript
import { ExportJobState } from './durable-objects/ExportJobState';

export { ExportJobState };

export interface Env {
  DB: D1Database;
  VIDEOS: R2Bucket;
  EXPORT_JOB: DurableObjectNamespace;
  ENVIRONMENT: string;
  RUNPOD_ENDPOINT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', env: env.ENVIRONMENT }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // TODO: Add routes in Task 06
    // - POST /api/jobs
    // - GET /api/jobs/:id
    // - POST /api/videos/upload-url
    // - WebSocket /api/jobs/:id/ws

    return new Response('Not Found', { status: 404 });
  },
};
```

### src/durable-objects/ExportJobState.ts (Skeleton)
```typescript
// Full implementation in Task 05
export class ExportJobState {
  state: DurableObjectState;
  env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response('ExportJobState - TODO', { status: 501 });
  }
}
```

### src/lib/types.ts
```typescript
export interface ExportJob {
  id: string;
  project_id: number;
  type: 'framing' | 'overlay' | 'annotate';
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress: number;
  input_video_key: string;
  output_video_key?: string;
  params: Record<string, any>;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  runpod_job_id?: string;
}

export interface CreateJobRequest {
  project_id: number;
  type: 'framing' | 'overlay' | 'annotate';
  input_video_key: string;
  params: {
    crop_keyframes?: CropKeyframe[];
    highlight_regions?: HighlightRegion[];
    effect_type?: string;
    clip_index?: number;
  };
}

export interface CropKeyframe {
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HighlightRegion {
  start_frame: number;
  end_frame: number;
  x: number;
  y: number;
  radius_x: number;
  radius_y: number;
  opacity: number;
  color: string;
}

export interface WebSocketMessage {
  type: 'subscribe' | 'progress' | 'complete' | 'error' | 'ping' | 'pong';
  job_id?: string;
  progress?: number;
  message?: string;
  output_url?: string;
  error?: string;
}
```

---

## Verification Steps

After creating files:

```bash
cd workers

# Install dependencies
npm install

# Verify TypeScript compiles
npx tsc --noEmit

# Start local dev server
npm run dev

# Test health endpoint
curl http://localhost:8787/health
# Should return: {"status":"ok","env":"development"}
```

---

## Handoff Notes

**For Task 03 (D1 Database Schema):**
- Workers project exists
- Need to create `migrations/` folder and SQL files

**For Task 05 (Durable Objects):**
- ExportJobState.ts skeleton exists
- Need to implement full state machine

**For Task 06 (API Routes):**
- index.ts skeleton exists
- Need to implement route handlers

---

## Common Issues

### "Cannot find module '@cloudflare/workers-types'"
Run `npm install` in the workers directory.

### "Durable Object not found"
Make sure wrangler.toml has the migration tag and class binding.

### Local dev not persisting data
Use `--persist` flag: `wrangler dev --local --persist`
