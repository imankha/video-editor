# Pod Architecture Plan for GPU-Accelerated Video Processing

## Overview

This document outlines the migration to a Cloudflare-native, pod-based architecture for GPU video processing. The architecture prioritizes:
- **Resilience**: Jobs survive spot instance interruptions and complete even when users are away
- **Cost efficiency**: Optimized instance selection and spot pricing
- **Real-time status**: Users always see actual job status when they return
- **Local development**: Full simulation with Wrangler

## Cloudflare Tech Stack

| Component | Cloudflare Service | Purpose |
|-----------|-------------------|---------|
| API Gateway | Workers | Request routing, auth, job submission |
| Database | D1 (SQLite) | Job queue, project data, persistent state |
| Object Storage | R2 | Video file storage (input/output) |
| Job Queue | Queues | Reliable job dispatch to GPU pods |
| Real-time State | Durable Objects | Per-job state machine, WebSocket connections |
| Cache | KV | Encoder configs, frequently accessed data |

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                    │
│                     (React + ExportWebSocketManager)                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │         Cloudflare            │
                    │   ┌─────────────────────┐     │
                    │   │      Workers        │     │
                    │   │  - /api/jobs/*      │     │
                    │   │  - WebSocket proxy  │     │
                    │   └──────────┬──────────┘     │
                    │              │                │
                    │   ┌──────────┴──────────┐     │
                    │   │   Durable Objects   │     │
                    │   │  (ExportJobState)   │     │
                    │   │  - State machine    │     │
                    │   │  - WebSocket hub    │     │
                    │   └──────────┬──────────┘     │
                    │              │                │
                    │   ┌──────────┴──────────┐     │
                    │   │    D1 Database      │     │
                    │   │  - export_jobs      │     │
                    │   │  - projects         │     │
                    │   └──────────┬──────────┘     │
                    │              │                │
                    │   ┌──────────┴──────────┐     │
                    │   │      Queues         │     │
                    │   │  - gpu-jobs-queue   │     │
                    │   └──────────┬──────────┘     │
                    │              │                │
                    │   ┌──────────┴──────────┐     │
                    │   │    R2 Storage       │     │
                    │   │  - videos/raw/      │     │
                    │   │  - videos/output/   │     │
                    │   └─────────────────────┘     │
                    └───────────────┬───────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
    │  GPU Pod 1    │       │  GPU Pod 2    │       │  GPU Pod N    │
    │  (Spot)       │       │  (Spot)       │       │  (Spot)       │
    │               │       │               │       │               │
    │  ┌─────────┐  │       │  ┌─────────┐  │       │  ┌─────────┐  │
    │  │  T4 GPU │  │       │  │  T4 GPU │  │       │  │  T4 GPU │  │
    │  └─────────┘  │       │  └─────────┘  │       │  └─────────┘  │
    │               │       │               │       │               │
    │  Worker:      │       │  Worker:      │       │  Worker:      │
    │  - Poll Queue │       │  - Poll Queue │       │  - Poll Queue │
    │  - Process    │       │  - Process    │       │  - Process    │
    │  - Checkpoint │       │  - Checkpoint │       │  - Checkpoint │
    │  - Upload R2  │       │  - Upload R2  │       │  - Upload R2  │
    └───────────────┘       └───────────────┘       └───────────────┘
```

## Spot Instance Resilience

### The Challenge

Spot instances can be terminated with 2-minute warning. Without proper handling:
- In-progress jobs would be lost
- Users would see "processing" forever
- Re-processing from scratch wastes money

### Solution: Checkpoint-Based Processing

```
Job Lifecycle with Checkpointing:

1. PENDING → Job created in D1, message in Queue
2. PROCESSING → Pod picks up job, updates Durable Object
3. CHECKPOINT → Every N frames, save progress to R2
   - checkpoint.json: { frame: 450, total: 900 }
   - partial_output.mp4: Frames 0-450 encoded
4. If spot interruption:
   - Pod has 2 min warning (AWS) or 30 sec (GCP)
   - Save final checkpoint
   - Job returns to PENDING in Queue
5. New pod picks up job:
   - Reads checkpoint from R2
   - Resumes from frame 451
   - Appends to partial_output.mp4
6. COMPLETE → Final video in R2, D1 updated
```

### Durable Object: ExportJobState

Each export job gets a Durable Object that:
- Maintains authoritative job state
- Handles WebSocket connections from frontend
- Receives progress updates from GPU pods
- Survives pod interruptions

```typescript
// Durable Object for job state
export class ExportJobState {
  state: DurableObjectState;
  connections: Set<WebSocket>;

  // Job state
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress: number;
  checkpoint: { frame: number; total: number } | null;
  podId: string | null;
  lastHeartbeat: number;

  async fetch(request: Request) {
    // Handle WebSocket upgrade for frontend
    // Handle progress updates from pods
    // Handle heartbeat monitoring
  }

  async alarm() {
    // Check for stale jobs (no heartbeat for 3 min)
    // Re-queue if pod died without checkpoint
  }
}
```

### User Away Scenario

**Q: If an export gets interrupted, the user leaves, will the job still show up as complete after it finally completes?**

**A: Yes, absolutely.** Here's how:

1. **Job state lives in Durable Objects + D1**, not in the pod or frontend
2. When job completes, pod updates:
   - Durable Object: `status = 'complete'`
   - D1: `UPDATE export_jobs SET status = 'complete', completed_at = NOW()`
   - R2: Final video uploaded
3. When user returns (even days later):
   - `useExportRecovery` calls `/api/exports/active`
   - Worker queries D1 for job status
   - Frontend's `syncWithServer()` updates local state
   - User sees "Export Complete" toast

```
Timeline Example:

10:00 - User starts overlay export, leaves tab
10:01 - Spot instance interrupted
10:02 - Job checkpointed, re-queued
10:05 - New pod picks up job
10:08 - Job completes (user still away)
        → D1: status='complete'
        → Durable Object: broadcasts to 0 connections (none active)
        → R2: final video stored

14:00 - User returns to app
        → useExportRecovery fetches /api/exports/active
        → Finds completed job
        → Shows "Export Completed While Away" toast
        → Project list shows download button
```

## Instance Selection Analysis

### Workload Characteristics

Our overlay export pipeline:
```python
# Current bottlenecks (overlay.py)
1. cv2.VideoCapture.read()     # ~2ms/frame (I/O bound)
2. KeyframeInterpolator        # ~5ms/frame (CPU bound)
3. FFmpeg NVENC encoding       # ~1ms/frame (GPU bound)
```

For a 30-second, 30fps video (900 frames):
- Frame reading: ~1.8 seconds
- Overlay processing: ~4.5 seconds (single-threaded)
- NVENC encoding: ~0.9 seconds
- **Total: ~7-8 seconds** (dominated by CPU)

### Parallelization Opportunity

With multi-threaded overlay processing:
```python
# Parallel processing (proposed)
with ThreadPoolExecutor(max_workers=N) as executor:
    futures = []
    for frame_batch in batches(frames, batch_size=30):
        futures.append(executor.submit(process_batch, frame_batch))
```

| vCPUs | Parallel Workers | Overlay Time | Speedup |
|-------|-----------------|--------------|---------|
| 4     | 3 (1 for I/O)   | ~1.8s        | 2.5x    |
| 8     | 7               | ~0.9s        | 5x      |
| 16    | 15              | ~0.5s        | 9x      |

### Cost Analysis (AWS Spot Pricing, us-east-1)

| Instance | GPU | vCPU | RAM | Spot $/hr | Job Time | Cost/Job |
|----------|-----|------|-----|-----------|----------|----------|
| g4dn.xlarge | T4 | 4 | 16GB | $0.16 | 8s | $0.00036 |
| g4dn.2xlarge | T4 | 8 | 32GB | $0.23 | 4s | $0.00026 |
| g4dn.4xlarge | T4 | 16 | 64GB | $0.36 | 2.5s | $0.00025 |
| g5.xlarge | A10G | 4 | 16GB | $0.30 | 6s | $0.00050 |

**Winner: g4dn.4xlarge** at $0.00025/job

However, considering:
- Spot availability (larger instances have less capacity)
- Startup time amortization
- Memory for 4K videos

**Recommendation: g4dn.2xlarge**
- Best balance of cost ($0.00026/job) and availability
- 32GB RAM handles 4K videos comfortably
- Good spot capacity in most regions
- 8 vCPU allows 7 parallel workers

### Multi-Region Spot Strategy

```yaml
# Kubernetes spot node selector with fallback
nodeSelector:
  node.kubernetes.io/instance-type: g4dn.2xlarge
topologySpreadConstraints:
  - topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
# Fallback order: g4dn.2xlarge → g4dn.xlarge → g5.xlarge
```

## Local Development with Wrangler

### Setup

```bash
# Install Wrangler
npm install -g wrangler

# Project structure
reel-ballers/
├── src/
│   ├── backend/          # Existing FastAPI (runs locally)
│   └── frontend/         # Existing React
├── workers/              # NEW: Cloudflare Workers
│   ├── api/              # API Worker
│   ├── durable-objects/  # Durable Objects
│   └── wrangler.toml
└── gpu-worker/           # NEW: GPU pod code
    ├── Dockerfile
    └── worker.py
```

### wrangler.toml

```toml
name = "reel-ballers-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "reel-ballers"
database_id = "local"  # Uses local SQLite in dev

# R2 Storage
[[r2_buckets]]
binding = "VIDEOS"
bucket_name = "reel-ballers-videos"

# Queues
[[queues.producers]]
queue = "gpu-jobs"
binding = "GPU_QUEUE"

[[queues.consumers]]
queue = "gpu-jobs"
max_batch_size = 1
max_retries = 3

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

# Local development
[dev]
port = 8787
local_protocol = "http"
```

### Local Simulation

```bash
# Terminal 1: Wrangler (simulates Cloudflare)
cd workers/
wrangler dev --local --persist

# Terminal 2: GPU Worker (simulates pod)
cd gpu-worker/
python worker.py --local --queue-url http://localhost:8787

# Terminal 3: Frontend
cd src/frontend/
npm run dev

# Terminal 4: Backend (existing FastAPI for non-migrated routes)
cd src/backend/
uvicorn app.main:app --reload
```

### Local vs Production

| Component | Local (Wrangler) | Production |
|-----------|-----------------|------------|
| D1 | SQLite file | Cloudflare D1 |
| R2 | Local directory | Cloudflare R2 |
| Queues | In-memory | Cloudflare Queues |
| Durable Objects | Local SQLite | Cloudflare edge |
| GPU Pods | Single Python process | Kubernetes pods |

## Files That Need Changes

### Backend (src/backend/app/)

| File | Changes Required |
|------|-----------------|
| `routers/exports.py` | Replace local processing with Queue submission; add job status endpoint that reads from D1 |
| `routers/export/overlay.py` | Extract processing logic to gpu-worker; keep endpoint as thin wrapper |
| `routers/export/framing.py` | Extract processing logic to gpu-worker |
| `routers/export/multi_clip.py` | Extract processing logic to gpu-worker |
| `services/export_worker.py` | **DELETE** - Logic moves to gpu-worker |
| `services/ffmpeg_service.py` | Move to gpu-worker; add R2 upload after encoding |
| `websocket.py` | Replace with Durable Object WebSocket proxy |
| `database.py` | Add D1 client alongside SQLite for migration period |
| `models.py` | Add checkpoint schema, R2 path fields |

### New Backend Files

| File | Purpose |
|------|---------|
| `services/cloudflare_client.py` | D1, R2, Queue client wrappers |
| `services/job_queue.py` | Queue submission helper |
| `services/r2_storage.py` | R2 upload/download with presigned URLs |

### Frontend (src/frontend/src/)

| File | Changes Required |
|------|-----------------|
| `stores/exportStore.js` | Add `checkpoint` field; update `syncWithServer` for new response format |
| `services/ExportWebSocketManager.js` | Update WebSocket URL to Cloudflare Worker endpoint |
| `hooks/useExportRecovery.js` | Add checkpoint display; handle resumed jobs |
| `hooks/useExportManager.js` | Update job submission for new API |
| `components/GlobalExportIndicator.jsx` | Show checkpoint progress ("Resumed from 50%") |
| `config.js` | Add Cloudflare Worker URL for production |

### New Cloudflare Workers (workers/)

| File | Purpose |
|------|---------|
| `api/src/index.ts` | Main API router |
| `api/src/routes/jobs.ts` | Job CRUD endpoints |
| `api/src/routes/videos.ts` | R2 presigned URL generation |
| `durable-objects/ExportJobState.ts` | Job state machine + WebSocket hub |
| `wrangler.toml` | Cloudflare configuration |

### New GPU Worker (gpu-worker/)

| File | Purpose |
|------|---------|
| `Dockerfile` | CUDA + FFmpeg + Python image |
| `worker.py` | Main worker loop |
| `processors/overlay.py` | Overlay processing (from overlay.py) |
| `processors/framing.py` | Framing processing (from framing.py) |
| `checkpoint.py` | Checkpoint save/restore logic |
| `cloudflare_client.py` | Queue polling, D1/R2 access |
| `requirements.txt` | Python dependencies |

### Configuration Files

| File | Purpose |
|------|---------|
| `workers/wrangler.toml` | Cloudflare Worker config |
| `gpu-worker/k8s/deployment.yaml` | Kubernetes deployment |
| `gpu-worker/k8s/spot-node-pool.yaml` | Spot instance configuration |
| `.github/workflows/deploy-workers.yml` | CI/CD for Workers |
| `.github/workflows/deploy-gpu.yml` | CI/CD for GPU pods |

## API Changes

### Job Submission (Worker)

```typescript
// POST /api/jobs
interface CreateJobRequest {
  project_id: number;
  type: 'framing' | 'overlay' | 'multi_clip';
  input_video_key: string;  // R2 key
  params: {
    highlight_regions?: HighlightRegion[];
    effect_type?: string;
    crop_keyframes?: CropKeyframe[];
  };
}

interface CreateJobResponse {
  job_id: string;
  status: 'pending';
  websocket_url: string;  // Durable Object WebSocket
  estimated_wait_seconds: number;
}
```

### Job Status (Worker)

```typescript
// GET /api/jobs/:id
interface JobStatusResponse {
  job_id: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress: number;  // 0-100
  checkpoint?: {
    frame: number;
    total: number;
    resumed_count: number;  // How many times resumed
  };
  output_video_url?: string;  // Presigned R2 URL
  error?: string;
  timing: {
    created_at: string;
    started_at?: string;
    completed_at?: string;
    processing_seconds?: number;
  };
}
```

### Video Upload (Worker)

```typescript
// POST /api/videos/upload-url
interface UploadUrlRequest {
  filename: string;
  content_type: string;
  size_bytes: number;
}

interface UploadUrlResponse {
  upload_url: string;  // Presigned R2 PUT URL
  video_key: string;   // R2 key to use in job submission
  expires_at: string;
}
```

### WebSocket Protocol (Durable Object)

```typescript
// Client → Server
{ type: 'subscribe', job_id: string }
{ type: 'ping' }

// Server → Client
{ type: 'progress', job_id: string, progress: number, message: string }
{ type: 'checkpoint', job_id: string, frame: number, total: number }
{ type: 'complete', job_id: string, output_url: string }
{ type: 'error', job_id: string, error: string }
{ type: 'resumed', job_id: string, from_frame: number }  // Job resumed after interruption
{ type: 'pong' }
```

## Migration Plan

### Phase 1: Cloudflare Infrastructure (Week 1-2)

1. Set up Cloudflare account with Workers Paid plan
2. Create D1 database with schema migration
3. Create R2 bucket with CORS configuration
4. Create Queue for GPU jobs
5. Deploy basic Worker with health check
6. Set up Wrangler local development

### Phase 2: Durable Objects + WebSocket (Week 2-3)

1. Implement ExportJobState Durable Object
2. Migrate WebSocket connections to Durable Objects
3. Update frontend ExportWebSocketManager
4. Test job state persistence across reconnections

### Phase 3: GPU Worker + Queue (Week 3-4)

1. Create GPU worker Docker image
2. Implement queue polling and job processing
3. Add checkpoint save/restore logic
4. Deploy to Kubernetes with spot instances
5. Test spot interruption recovery

### Phase 4: Full Migration (Week 4-5)

1. Migrate job submission to Cloudflare Queue
2. Migrate video storage to R2
3. Update frontend for new API endpoints
4. Deprecate local export_worker.py
5. Load testing and optimization

### Phase 5: Monitoring + Optimization (Week 5-6)

1. Add GPU utilization metrics (DCGM)
2. Implement auto-scaling based on queue depth
3. Add cost tracking per job
4. Optimize checkpoint frequency
5. Production rollout

## Checkpoint Implementation Detail

### When to Checkpoint

```python
# gpu-worker/checkpoint.py

CHECKPOINT_INTERVAL_FRAMES = 300  # Every 10 seconds at 30fps
CHECKPOINT_INTERVAL_SECONDS = 30  # Or every 30 seconds, whichever first

def should_checkpoint(frame_idx: int, last_checkpoint_time: float) -> bool:
    frames_since = frame_idx - last_checkpoint_frame
    time_since = time.time() - last_checkpoint_time

    return (frames_since >= CHECKPOINT_INTERVAL_FRAMES or
            time_since >= CHECKPOINT_INTERVAL_SECONDS)
```

### Checkpoint Data Structure

```python
# Stored in R2: checkpoints/{job_id}/checkpoint.json
{
    "job_id": "abc123",
    "frame": 450,
    "total_frames": 900,
    "partial_video_key": "checkpoints/abc123/partial.mp4",
    "created_at": "2024-01-15T10:30:00Z",
    "pod_id": "gpu-worker-xyz",
    "resume_count": 1
}
```

### Resume Logic

```python
async def process_job(job: Job):
    # Check for existing checkpoint
    checkpoint = await r2.get_json(f"checkpoints/{job.id}/checkpoint.json")

    if checkpoint:
        logger.info(f"Resuming job {job.id} from frame {checkpoint['frame']}")
        start_frame = checkpoint['frame']
        partial_video = await r2.download(checkpoint['partial_video_key'])
        resume_count = checkpoint['resume_count'] + 1

        # Notify Durable Object
        await notify_durable_object(job.id, {
            'type': 'resumed',
            'from_frame': start_frame,
            'resume_count': resume_count
        })
    else:
        start_frame = 0
        partial_video = None
        resume_count = 0

    # Process from start_frame
    # ... processing logic ...
```

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Export time (30s video) | ~45s | <15s |
| Cost per export | N/A (server cost) | <$0.001 |
| Job completion rate | ~95% | >99.9% |
| Recovery from interruption | Manual | Automatic |
| Max concurrent exports | 2 | 20+ |
| User status accuracy | Sometimes stale | Always accurate |

## Cost Projection

### Monthly Cost Estimate (1000 exports/month)

| Component | Cost |
|-----------|------|
| Cloudflare Workers | $5 (included in paid plan) |
| Cloudflare D1 | $5 (5M reads/writes) |
| Cloudflare R2 | $5 (50GB storage, 1M operations) |
| Cloudflare Queues | $1 (1M messages) |
| GPU Spot Instances | $15 (1000 jobs × $0.00026 + idle) |
| **Total** | **~$31/month** |

vs. Current: Dedicated server with GPU ~$200-400/month

## Next Steps

1. [ ] Review and approve architecture
2. [ ] Set up Cloudflare account with required services
3. [ ] Create `workers/` directory with initial wrangler.toml
4. [ ] Implement ExportJobState Durable Object
5. [ ] Create GPU worker Docker image
6. [ ] Set up Kubernetes cluster with spot nodes
7. [ ] Migrate first export type (overlay) end-to-end
8. [ ] Load test with simulated spot interruptions
