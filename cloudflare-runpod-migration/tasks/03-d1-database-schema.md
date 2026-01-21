# Task 03: D1 Database Schema

## Overview
Define the D1 database schema for export jobs and create migration files.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 01 complete (D1 database exists)
- Task 02 complete (workers/ directory exists)

## Time Estimate
20 minutes

---

## Schema Design

### Tables

#### export_jobs
Tracks all video export jobs.

```sql
CREATE TABLE export_jobs (
    id TEXT PRIMARY KEY,                    -- UUID
    project_id INTEGER NOT NULL,            -- Reference to project (in existing SQLite)
    type TEXT NOT NULL,                     -- 'framing' | 'overlay' | 'annotate'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'complete' | 'error'
    progress INTEGER NOT NULL DEFAULT 0,    -- 0-100

    -- R2 keys
    input_video_key TEXT NOT NULL,          -- R2 path to input video
    output_video_key TEXT,                  -- R2 path to output video (set on completion)

    -- Job parameters (JSON)
    params TEXT NOT NULL,                   -- JSON: crop_keyframes, highlight_regions, etc.

    -- Error handling
    error TEXT,                             -- Error message if failed
    retry_count INTEGER NOT NULL DEFAULT 0, -- Number of retries

    -- RunPod tracking
    runpod_job_id TEXT,                     -- RunPod's job ID

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,

    -- Indexes will be created separately
    CHECK (status IN ('pending', 'processing', 'complete', 'error')),
    CHECK (type IN ('framing', 'overlay', 'annotate'))
);

-- Index for finding active jobs by project
CREATE INDEX idx_export_jobs_project_status ON export_jobs(project_id, status);

-- Index for finding pending jobs (queue processing)
CREATE INDEX idx_export_jobs_status_created ON export_jobs(status, created_at);

-- Index for RunPod job lookup
CREATE INDEX idx_export_jobs_runpod ON export_jobs(runpod_job_id);
```

---

## Migration Files

### Directory Structure
```
workers/
└── migrations/
    └── 0001_create_export_jobs.sql
```

### 0001_create_export_jobs.sql
```sql
-- Migration: Create export_jobs table
-- Created: 2024-XX-XX

CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('framing', 'overlay', 'annotate')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error')),
    progress INTEGER NOT NULL DEFAULT 0,
    input_video_key TEXT NOT NULL,
    output_video_key TEXT,
    params TEXT NOT NULL,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    runpod_job_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_project_status ON export_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status_created ON export_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_export_jobs_runpod ON export_jobs(runpod_job_id);
```

---

## D1 Query Examples

### Create Job
```typescript
const jobId = crypto.randomUUID();
await env.DB.prepare(`
  INSERT INTO export_jobs (id, project_id, type, input_video_key, params)
  VALUES (?, ?, ?, ?, ?)
`).bind(jobId, projectId, 'overlay', inputKey, JSON.stringify(params)).run();
```

### Get Job by ID
```typescript
const job = await env.DB.prepare(`
  SELECT * FROM export_jobs WHERE id = ?
`).bind(jobId).first<ExportJob>();
```

### Get Active Jobs for Project
```typescript
const jobs = await env.DB.prepare(`
  SELECT * FROM export_jobs
  WHERE project_id = ? AND status IN ('pending', 'processing')
  ORDER BY created_at DESC
`).bind(projectId).all<ExportJob>();
```

### Update Job Status
```typescript
await env.DB.prepare(`
  UPDATE export_jobs
  SET status = ?, progress = ?, started_at = datetime('now')
  WHERE id = ?
`).bind('processing', 0, jobId).run();
```

### Mark Job Complete
```typescript
await env.DB.prepare(`
  UPDATE export_jobs
  SET status = 'complete', progress = 100, output_video_key = ?, completed_at = datetime('now')
  WHERE id = ?
`).bind(outputKey, jobId).run();
```

### Mark Job Error (with Retry)
```typescript
await env.DB.prepare(`
  UPDATE export_jobs
  SET status = CASE WHEN retry_count < 3 THEN 'pending' ELSE 'error' END,
      error = ?,
      retry_count = retry_count + 1
  WHERE id = ?
`).bind(errorMessage, jobId).run();
```

### Get User's Recent Jobs
```typescript
const jobs = await env.DB.prepare(`
  SELECT * FROM export_jobs
  WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)
  ORDER BY created_at DESC
  LIMIT 20
`).bind(userId).all<ExportJob>();
```

---

## Running Migrations

### Local Development
```bash
cd workers

# Create migrations directory
mkdir -p migrations

# Apply migrations to local D1
wrangler d1 migrations apply reel-ballers --local

# Verify table exists
wrangler d1 execute reel-ballers --local --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### Production
```bash
# Apply migrations to production D1
wrangler d1 migrations apply reel-ballers

# Verify
wrangler d1 execute reel-ballers --command "SELECT name FROM sqlite_master WHERE type='table';"
```

---

## Handoff Notes

**For Task 05 (Durable Objects):**
- Database schema is ready
- Durable Objects will use D1 for persistence
- Job status updates go through Durable Object → D1

**For Task 06 (API Routes):**
- Use query examples above for CRUD operations
- Always wrap writes in try/catch for error handling

---

## Future Considerations

### When to Migrate Full Database to D1

Currently, the main database (projects, clips, games) stays in local SQLite. Consider migrating to D1 when:

1. You need multi-device access
2. You want cloud backup
3. You're deploying the full app (not just exports) to Cloudflare

### Schema for Full Migration (Future)
```sql
-- These would be added later if full migration needed
CREATE TABLE projects (...);
CREATE TABLE working_clips (...);
CREATE TABLE raw_clips (...);
CREATE TABLE games (...);
```

For now, only `export_jobs` lives in D1.
