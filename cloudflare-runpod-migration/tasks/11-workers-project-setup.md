# Task 11: Workers Project Setup

## Overview
Create the Cloudflare Workers project structure with wrangler.toml configuration for the API backend.

## Owner
**Claude** - Code generation task

## Prerequisites
- Phase 2 complete (RunPod exports working)
- Cloudflare account ready (from Task 01)

## Testability
**After this task**: Workers dev server runs locally. Health check endpoint works.

---

## Required Information from User

Before starting, Claude needs:
```
D1 Database ID: _______________________ (or create new)
Account ID: _______________________ (from Cloudflare dashboard URL)
```

---

## Directory Structure to Create

```
video-editor/
└── workers/
    ├── src/
    │   ├── index.ts                 # Main entry point
    │   ├── routes/
    │   │   ├── jobs.ts              # Export job endpoints
    │   │   └── videos.ts            # R2 presigned URLs
    │   ├── durable-objects/
    │   │   └── ExportJobState.ts    # Job state machine (Task 13)
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

# R2 Storage (same bucket from Phase 1)
[[r2_buckets]]
binding = "USER_DATA"
bucket_name = "reel-ballers-users"

# Durable Objects (added in Task 13)
# [durable_objects]
# bindings = [
#   { name = "EXPORT_JOB", class_name = "ExportJobState" }
# ]

# Environment variables
[vars]
ENVIRONMENT = "development"
RUNPOD_ENDPOINT = ""  # Set from Task 06

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
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240117.0",
    "typescript": "^5.3.3",
    "wrangler": "^3.24.0"
  },
  "dependencies": {
    "sql.js": "^1.10.0"
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
export interface Env {
  USER_DATA: R2Bucket;
  ENVIRONMENT: string;
  RUNPOD_ENDPOINT: string;
  RUNPOD_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        env: env.ENVIRONMENT
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // TODO: Add routes in Task 12
    // - POST /api/export/start
    // - GET /api/export/status/:id
    // - GET /api/storage/presigned-url

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
```

### src/lib/types.ts
```typescript
export interface ExportJob {
  id: string;
  project_id: number;
  type: 'framing' | 'overlay' | 'annotate';
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress: number;
  input_key: string;
  output_key?: string;
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
  input_key: string;
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
  type: 'subscribe' | 'progress' | 'complete' | 'error' | 'status';
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

## Common Issues

### "Cannot find module '@cloudflare/workers-types'"
Run `npm install` in the workers directory.

### Local dev not persisting data
Use `--persist` flag: `wrangler dev --local --persist`

### R2 binding not working locally
Make sure wrangler.toml has the correct bucket name matching your actual R2 bucket.

---

## Handoff Notes

**For Task 12 (Workers API Routes):**
- Workers project exists with skeleton
- Need to implement actual route handlers
- Use same API shape as current FastAPI backend

**For Task 13 (Durable Objects):**
- Will add DO binding to wrangler.toml
- ExportJobState manages job lifecycle
