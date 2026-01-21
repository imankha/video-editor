# Cloudflare + RunPod Migration Plan

## Overview

Migrate video export processing from local FastAPI to a serverless architecture:
- **RunPod Serverless**: GPU video processing (pay-per-second, no idle costs)
- **Cloudflare R2**: ALL user data storage (already implemented)
- **Cloudflare Workers**: API gateway (future - after RunPod works)

**Key Principle**: The app must remain fully testable after every task. We migrate incrementally, always keeping a working system.

## Current State (Already Implemented)

| Component | Status | Notes |
|-----------|--------|-------|
| R2 Storage | **DONE** | User data stored in R2, presigned URLs working |
| Database Sync | **DONE** | Version-based sync, batched writes, conflict detection |
| File Endpoints | **DONE** | All endpoints redirect to R2 presigned URLs |
| Connection Status | **DONE** | Frontend shows banner when backend unavailable |

## Architecture Evolution

### Phase 1: Current (FastAPI + R2)
```
Frontend ──► FastAPI Backend ──► R2 Storage
                    │
                    └──► Local GPU Processing
```

### Phase 2: After RunPod (FastAPI + R2 + RunPod)
```
Frontend ──► FastAPI Backend ──► R2 Storage
                    │                 ▲
                    └──► RunPod GPU ──┘
```
**App is testable: FastAPI orchestrates, RunPod processes, R2 stores**

### Phase 3: After Workers (Full Serverless)
```
Frontend ──► Cloudflare Workers ──► R2 Storage
                    │                    ▲
                    └──► RunPod GPU ─────┘
```
**App is testable: Workers orchestrates, RunPod processes, R2 stores**

## Domain Structure (Future)

```
reelballers.com       → Cloudflare Pages (landing)
app.reelballers.com   → Cloudflare Pages (main app)
api.reelballers.com   → Cloudflare Workers (API)
```

## User Data Structure (Implemented)

The local `user_data/` folder structure is mirrored exactly in R2:

```
Local:                              R2 Bucket:
user_data/                          reel-ballers-users/
└── {user_id}/                      └── {user_id}/
    ├── database.sqlite                 ├── database.sqlite    ← Version tracked!
    ├── games/                          ├── games/
    ├── raw_clips/                      ├── raw_clips/
    ├── working_videos/                 ├── working_videos/
    ├── final_videos/                   ├── final_videos/
    ├── highlights/                     ├── highlights/
    └── downloads/                      └── downloads/
```

## Database Strategy

### Current Implementation (In-Memory SQLite + R2)

- SQLite database stored in R2 as `{user_id}/database.sqlite`
- Version-based sync: only download if R2 version is newer
- Batched writes: multiple writes per request = single R2 upload
- Size monitoring: logs warnings at 512KB, recommends DO at 1MB
- Conflict resolution: last-write-wins with logging

### Future: Durable Objects (CONDITIONAL)

**Only migrate to DO when:**
- Database consistently exceeds 1MB
- Need real-time collaboration features
- Concurrent write conflicts become an issue

**The in-memory approach works well for small DBs (<1MB).** Current DB is ~204KB.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| GPU Provider | RunPod Serverless | No Kubernetes, pay-per-second, auto-scales to zero |
| Migration Order | RunPod THEN Workers | Keeps app testable - GPU must work before backend goes stateless |
| Database | SQLite in R2 | Simple, working, migrate to DO only if needed |
| Job Recovery | Retry from scratch | Jobs are short (10-30s), checkpoint complexity not worth it |
| Auth | Anonymous → Magic Link | Start frictionless, add email when needed |

---

## Task Status

| # | Task | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 01 | [Cloudflare Account Setup](tasks/01-cloudflare-account-setup.md) | `DONE` | User | Account created, R2 bucket exists |
| 02 | [R2 Bucket Setup](tasks/02-r2-bucket-setup.md) | `DONE` | User | CORS configured, credentials created |
| 03 | [R2 Storage Integration](tasks/03-r2-user-data-structure.md) | `DONE` | Claude | Presigned URLs, file redirects |
| 04 | [Database Sync](tasks/04-database-sync.md) | `DONE` | Claude | Version tracking, batched writes |
| 05 | [RunPod Account Setup](tasks/05-runpod-account-setup.md) | `TODO` | User | Create account, add credits |
| 06 | [RunPod Endpoint Setup](tasks/06-runpod-endpoint-setup.md) | `TODO` | User | Create serverless endpoint |
| 07 | [GPU Worker Code](tasks/07-gpu-worker-code.md) | `TODO` | Claude | Docker container with ffmpeg |
| 08 | [Backend RunPod Integration](tasks/08-backend-runpod-integration.md) | `TODO` | Claude | FastAPI calls RunPod for exports |
| 09 | [Frontend Export Updates](tasks/09-frontend-export-updates.md) | `TODO` | Claude | Progress UI for RunPod jobs |
| 10 | [Testing RunPod Integration](tasks/10-testing-runpod.md) | `TODO` | Both | End-to-end export testing |
| 11 | [Workers Project Setup](tasks/11-workers-project-setup.md) | `TODO` | Claude | wrangler.toml, directory structure |
| 12 | [Workers API Routes](tasks/12-workers-api-routes.md) | `TODO` | Claude | Job CRUD, video URLs |
| 13 | [Workers WebSocket/DO](tasks/13-workers-websocket-do.md) | `TODO` | Claude | Real-time progress updates |
| 14 | [Backend to Workers Migration](tasks/14-backend-workers-migration.md) | `TODO` | Claude | Switch from FastAPI to Workers |
| 15 | [Frontend Workers Integration](tasks/15-frontend-workers-integration.md) | `TODO` | Claude | Point to Workers API |
| 16 | [Wallet & Payments](tasks/16-wallet-payments.md) | `FUTURE` | Both | Stripe integration |
| 17 | [User Management](tasks/17-user-management.md) | `FUTURE` | Both | Auth, multi-tenancy |
| 18 | [DO+SQLite Migration](tasks/18-do-sqlite-migration.md) | `CONDITIONAL` | Claude | Only if DB > 1MB consistently |

**Status Key**: `DONE` | `TODO` | `IN_PROGRESS` | `BLOCKED` | `FUTURE` | `CONDITIONAL`

---

## Execution Order

```
Phase 1: R2 Storage (COMPLETE)
├── 01-cloudflare-account-setup ✓
├── 02-r2-bucket-setup ✓
├── 03-r2-user-data-structure ✓
└── 04-database-sync ✓

Phase 2: RunPod GPU Processing (CURRENT FOCUS)
├── 05-runpod-account-setup
├── 06-runpod-endpoint-setup
├── 07-gpu-worker-code
├── 08-backend-runpod-integration
├── 09-frontend-export-updates
└── 10-testing-runpod
    ↓
    APP IS TESTABLE: Local backend + RunPod GPU + R2 storage

Phase 3: Cloudflare Workers (After RunPod works)
├── 11-workers-project-setup
├── 12-workers-api-routes
├── 13-workers-websocket-do
├── 14-backend-workers-migration
└── 15-frontend-workers-integration
    ↓
    APP IS TESTABLE: Workers API + RunPod GPU + R2 storage

Phase 4: Monetization & Users (Optional)
├── 16-wallet-payments
└── 17-user-management

Phase 5: Conditional Optimization
└── 18-do-sqlite-migration (only if DB > 1MB)
```

---

## Testability Checkpoints

After each phase, the app must pass these tests:

### After Phase 1 (R2 Storage) - COMPLETE
- [ ] Videos load from R2 presigned URLs
- [ ] Database syncs between requests
- [ ] New uploads go to R2
- [ ] App works offline then syncs

### After Phase 2 (RunPod)
- [ ] Framing export works via RunPod
- [ ] Overlay export works via RunPod
- [ ] Annotate export works via RunPod
- [ ] Progress updates show in UI
- [ ] Failed jobs retry correctly
- [ ] App falls back gracefully if RunPod unavailable

### After Phase 3 (Workers)
- [ ] All API calls work via Workers
- [ ] WebSocket progress updates work
- [ ] Database operations work via Workers
- [ ] File uploads/downloads work
- [ ] App works with Workers + RunPod

---

## Cost Estimate (1000 exports/month)

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Workers Paid | $5 |
| Cloudflare R2 (50GB) | $0.75 |
| RunPod Serverless | $5-10 |
| **Total** | **~$11-16/month** |

---

## Quick Reference

### Local Development (Current)
```bash
# Terminal 1: Frontend
cd src/frontend && npm run dev

# Terminal 2: Backend (with R2 enabled)
cd src/backend && R2_ENABLED=true uvicorn app.main:app --reload
```

### Local Development (After Phase 2)
```bash
# Terminal 1: Frontend
cd src/frontend && npm run dev

# Terminal 2: Backend
cd src/backend && uvicorn app.main:app --reload

# GPU processing handled by RunPod (cloud)
```

### Local Development (After Phase 3)
```bash
# Terminal 1: Frontend
cd src/frontend && npm run dev

# Terminal 2: Cloudflare Workers (local)
cd workers && wrangler dev --local --persist

# GPU processing handled by RunPod (cloud)
```

### File Locations
```
video-editor/
├── cloudflare-runpod-migration/   # This plan
│   ├── PLAN.md                    # You are here
│   └── tasks/                     # Detailed task files
├── gpu-worker/                    # NEW (Phase 2): RunPod container
│   ├── Dockerfile
│   ├── handler.py
│   └── processors/
├── workers/                       # NEW (Phase 3): Cloudflare Workers
│   ├── src/
│   └── wrangler.toml
└── src/                          # EXISTING
    ├── backend/                  # FastAPI (modify in Phase 2)
    └── frontend/                 # React (modify in Phase 2 & 3)
```

---

## How to Use This Plan

1. **Check current phase** in Execution Order above
2. **Work on tasks in order** within the current phase
3. **Run testability checkpoint** after completing each phase
4. **Only proceed to next phase** when current phase is testable
5. **Update task status** in this file after completing each task

When asking Claude to work on a task:
> "Let's work on Task 05 - RunPod Account Setup. The app currently has R2 storage working. After this phase, exports should work via RunPod."

---

## Database Size Monitoring

The system automatically logs when database approaches migration thresholds:

```
INFO:  Database size notice: 600KB - approaching 1MB migration threshold
WARN:  DATABASE MIGRATION RECOMMENDED: Database size (1.2MB) exceeds 1MB.
       Consider migrating archived data to Durable Objects.
```

**Action**: When you see the WARNING consistently, schedule Task 18 (DO+SQLite Migration).
