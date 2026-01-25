# Deployment Migration Plan

## Overview

Migrate from local development to production deployment:
- **Fly.io**: FastAPI backend (scales to zero, WebSocket support)
- **Cloudflare Pages**: Frontend hosting (free, global CDN)
- **Cloudflare R2**: User data storage (already implemented)
- **Modal**: GPU video processing (Python-native, pay-per-second)

**Key Principle**: The app must remain fully testable after every task. We migrate incrementally, always keeping a working system.

## Current State (Already Implemented)

| Component | Status | Notes |
|-----------|--------|-------|
| R2 Storage | **DONE** | User data stored in R2, presigned URLs working |
| Database Sync | **DONE** | Version-based sync, batched writes, slow sync warnings |
| File Endpoints | **DONE** | All endpoints redirect to R2 presigned URLs |
| Connection Status | **DONE** | Frontend shows banner when backend unavailable |

## Architecture

### Local Development
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐
│ Frontend        │────►│ FastAPI         │────►│ R2 Storage  │
│ (localhost:5173)│     │ (localhost:8000)│     │ (Cloudflare)│
└─────────────────┘     └────────┬────────┘     └─────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Local FFmpeg    │
                        └─────────────────┘
```

### Production (After Migration)
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐
│ Frontend        │────►│ FastAPI         │────►│ R2 Storage  │
│ (CF Pages)      │     │ (Fly.io)        │     │ (Cloudflare)│
└─────────────────┘     └────────┬────────┘     └─────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Modal GPU       │
                        └─────────────────┘
```

## Domain Structure

```
reelballers.com       → Cloudflare Pages (landing)
app.reelballers.com   → Cloudflare Pages (React app)
api.reelballers.com   → Fly.io (FastAPI backend)
```

## User Data Structure (Implemented)

All user data stored in R2 (no local video storage):

```
R2 Bucket: reel-ballers-users/
└── {user_id}/
    ├── database.sqlite    ← Version tracked, synced per request
    ├── games/
    ├── raw_clips/
    ├── working_videos/
    ├── final_videos/
    ├── highlights/
    └── downloads/
```

## Database Strategy

### Current Implementation (SQLite + R2 Sync)

- SQLite database stored in R2 as `{user_id}/database.sqlite`
- Version-based sync: only download if R2 version is newer
- Batched writes: multiple writes per request = single R2 upload
- Delay-based warnings: logs when sync takes >500ms
- Conflict resolution: last-write-wins with logging

### Future Optimization (CONDITIONAL)

**Only consider changes when:**
- Sync consistently takes >500ms (monitor via logs)
- Database exceeds 1MB
- Need real-time collaboration features

Current DB is ~204KB - no optimization needed yet.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend Hosting | Fly.io | Scales to zero, WebSockets, Python native |
| Frontend Hosting | Cloudflare Pages | Free, fast CDN, same platform as R2 |
| GPU Provider | Modal | Python-native, pay-per-second, no Docker needed |
| Database | SQLite in R2 | Simple, working, no WASM overhead |
| Local Dev | Same as always | 2 terminals, real R2 connection |

---

## Task Status

| # | Task | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 01 | [Cloudflare Account Setup](tasks/01-cloudflare-account-setup.md) | `DONE` | User | Account created, R2 bucket exists |
| -- | R2 Bucket Setup | `DONE` | User | CORS configured, credentials created |
| -- | R2 Storage Integration | `DONE` | Claude | Presigned URLs, file redirects |
| 04 | [Database Sync](tasks/04-database-sync.md) | `DONE` | Claude | Version tracking, batched writes |
| 05 | [Modal Account Setup](tasks/05-modal-account-setup.md) | `TODO` | User | Create account, add credits |
| 06 | [GPU Functions Code](tasks/06-gpu-functions.md) | `TODO` | Claude | Modal functions with FFmpeg |
| 07 | [Backend Modal Integration](tasks/07-backend-modal-integration.md) | `TODO` | Claude | FastAPI calls Modal for exports |
| 08 | [Frontend Export Updates](tasks/08-frontend-export-updates.md) | `TODO` | Claude | Progress UI for Modal jobs |
| 09 | [Testing Modal Integration](tasks/09-testing-modal.md) | `TODO` | Both | End-to-end export testing |
| 10 | [Fly.io Backend Deployment](tasks/10-flyio-deployment.md) | `TODO` | Claude | fly.toml, Dockerfile, deploy |
| 11 | [Cloudflare Pages Frontend](tasks/11-cloudflare-pages.md) | `TODO` | Claude | Build & deploy React app |
| 12 | [Production DNS & SSL](tasks/12-dns-ssl-setup.md) | `TODO` | User | Configure domains |
| 16 | [Performance Profiling](tasks/16-performance-profiling.md) | `TODO` | Claude | Memory/latency profiling, fix slow endpoints |
| 17 | [Stale Session Detection](tasks/17-stale-session-detection.md) | `TODO` | Claude | Reject conflicting writes, UI for stale sessions |
| 13 | [User Management](tasks/13-user-management.md) | `OPTIONAL` | Both | Auth, multi-tenancy |
| 14 | [Wallet & Payments](tasks/14-wallet-payments.md) | `OPTIONAL` | Both | Stripe integration |
| 15 | [Future GPU Features](tasks/15-future-gpu-features.md) | `FUTURE` | Claude | AI upscaling, tracking |

**Status Key**: `DONE` | `TODO` | `IN_PROGRESS` | `BLOCKED` | `OPTIONAL` | `FUTURE`

---

## Execution Order

```
Phase 1: R2 Storage (COMPLETE)
├── 01-cloudflare-account-setup ✓
├── R2 bucket setup ✓
├── R2 storage integration ✓
└── 04-database-sync ✓

Phase 2: Modal GPU Processing (CURRENT FOCUS)
├── 05-modal-account-setup
├── 06-gpu-functions
├── 07-backend-modal-integration
├── 08-frontend-export-updates
└── 09-testing-modal
    ↓
    APP IS TESTABLE: Local backend + Modal GPU + R2 storage

Phase 3: Production Deployment
├── 10-flyio-deployment
├── 11-cloudflare-pages
├── 12-dns-ssl-setup
├── 16-performance-profiling
└── 17-stale-session-detection
    ↓
    APP IS LIVE & ROBUST: Fly.io backend + CF Pages frontend + Modal GPU + R2 storage

Phase 4: Users & Monetization (OPTIONAL)
├── 13-user-management
└── 14-wallet-payments

Phase 5: Future Features
└── 15-future-gpu-features (AI upscaling, player tracking)
```

---

## Testability Checkpoints

### After Phase 1 (R2 Storage) - COMPLETE ✓
- [x] Videos load from R2 presigned URLs
- [x] Database syncs between requests
- [x] New uploads go to R2
- [x] Slow sync warnings appear in logs when >500ms

### After Phase 2 (Modal)
- [ ] Framing export works via Modal
- [ ] Overlay export works via Modal
- [ ] Annotate export works via Modal
- [ ] Progress updates show in UI
- [ ] Failed jobs retry correctly
- [ ] Local FFmpeg fallback works when MODAL_ENABLED=false

### After Phase 3 (Production)
- [ ] Frontend loads from Cloudflare Pages
- [ ] API calls work to Fly.io backend
- [ ] WebSocket progress updates work
- [ ] Cold start is acceptable (<3s)
- [ ] Scale to zero works (no charges when idle)

### After Performance Profiling (Task 16)
- [ ] All endpoints respond in <200ms (excluding exports)
- [ ] Memory usage stays under 256MB baseline
- [ ] No N+1 query patterns in hot paths
- [ ] Database sync <500ms (per existing warning threshold)
- [ ] Slow endpoints identified and fixed

### After Stale Session Detection (Task 17)
- [ ] Conflicting writes are rejected (not last-write-wins)
- [ ] Stale session returns HTTP 409 Conflict
- [ ] Frontend shows "Session stale" banner with refresh button
- [ ] User can recover by refreshing (gets latest data)
- [ ] E2E test simulates conflict scenario

---

## Cost Estimate (1000 exports/month)

| Component | Monthly Cost |
|-----------|--------------|
| Fly.io (scales to zero) | ~$5-7 |
| Cloudflare Pages | Free |
| Cloudflare R2 (50GB) | ~$0.75 |
| Modal GPU | ~$3-8 |
| **Total** | **~$11-18/month** |

---

## Quick Reference

### Local Development (Same as Always)
```bash
# Terminal 1: Frontend
cd src/frontend && npm run dev

# Terminal 2: Backend (with R2)
cd src/backend && uvicorn app.main:app --reload
```

Environment variables for local dev:
```bash
R2_ENABLED=true
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
R2_BUCKET_NAME=reel-ballers-users

# Optional: Enable Modal for GPU exports
MODAL_ENABLED=true
MODAL_TOKEN_ID=xxx
MODAL_TOKEN_SECRET=xxx
```

### Production Deployment
```bash
# Deploy backend
cd src/backend && fly deploy

# Deploy frontend
cd src/frontend && npm run build
npx wrangler pages deploy dist --project-name=reel-ballers
```

### File Locations
```
video-editor/
├── cloudflare-runpod-migration/   # This plan
│   ├── PLAN.md                    # You are here
│   └── tasks/                     # Detailed task files
├── modal_functions/               # NEW (Phase 2): Modal GPU functions
│   ├── __init__.py
│   ├── video_processing.py        # Modal functions with FFmpeg
│   └── processors/
└── src/
    ├── backend/                   # FastAPI (add fly.toml)
    │   ├── fly.toml              # NEW: Fly.io config
    │   ├── Dockerfile            # NEW: Production container
    │   └── app/
    └── frontend/                  # React (deploy to CF Pages)
```

---

## Development & Deployment Workflow

### Environment Strategy

**Key insight**: We use ONE R2 bucket (data is isolated by user ID) and ONE Modal deployment (stateless functions). The "environment" is defined by the backend app and frontend deployment.

### When Each Environment is Created

| Environment | Created During | First Usable After |
|-------------|----------------|-------------------|
| **Local** | Phase 1 (already done) | Now |
| **Staging** | Task 10 (Fly.io deployment) | Phase 3 Task 10 |
| **Production** | Task 12 (DNS setup) | Phase 3 Task 12 |

### Environment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           SHARED RESOURCES                          │
├─────────────────────────────────────────────────────────────────────┤
│  R2 Bucket: reel-ballers-users     Modal: reel-ballers-video        │
│  └── {user_id}/...                 └── process_video function       │
│  (Same bucket, user-isolated)      (Same function, stateless)       │
└─────────────────────────────────────────────────────────────────────┘
          │                                      │
          ▼                                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     LOCAL       │  │    STAGING      │  │   PRODUCTION    │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ Backend:        │  │ Backend:        │  │ Backend:        │
│ localhost:8000  │  │ Fly.io staging  │  │ Fly.io prod     │
│                 │  │                 │  │                 │
│ Frontend:       │  │ Frontend:       │  │ Frontend:       │
│ localhost:5173  │  │ CF Pages preview│  │ CF Pages prod   │
│                 │  │                 │  │                 │
│ GPU: local      │  │ GPU: Modal      │  │ GPU: Modal      │
│ FFmpeg          │  │ (shared)        │  │ (shared)        │
│                 │  │                 │  │                 │
│ Stripe: N/A     │  │ Stripe: test    │  │ Stripe: live    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Environment Details

| Component | Local | Staging | Production |
|-----------|-------|---------|------------|
| **Backend URL** | localhost:8000 | reel-ballers-api-staging.fly.dev | api.reelballers.com |
| **Frontend URL** | localhost:5173 | *.reel-ballers-app.pages.dev | app.reelballers.com |
| **R2 Bucket** | reel-ballers-users | reel-ballers-users | reel-ballers-users |
| **Modal** | MODAL_ENABLED=false | MODAL_ENABLED=true | MODAL_ENABLED=true |
| **Stripe Keys** | N/A | sk_test_xxx | sk_live_xxx |
| **User Data** | user: "dev-local" | user: "dev-staging" | Real user IDs |

### Local Development (Phase 1-2)

```bash
# Terminal 1: Frontend
cd src/frontend && npm run dev

# Terminal 2: Backend
cd src/backend && uvicorn app.main:app --reload
```

**What's real**: R2 storage (same bucket as prod, isolated by user ID)
**What's local**: FFmpeg processing (unless `MODAL_ENABLED=true`)
**User ID**: Defaults to "a" (or whatever you set in cookie)

### Code Promotion Flow

```
Feature Branch
     │
     ├── 1. Develop locally (MODAL_ENABLED=false, local FFmpeg)
     ├── 2. Test with R2 storage
     ├── 3. Optionally test with Modal (MODAL_ENABLED=true)
     │
     ▼
Merge to main
     │
     ├── 4. Deploy to Fly.io staging: fly deploy --app reel-ballers-api-staging
     ├── 5. CF Pages auto-deploys preview URL
     ├── 6. Test full flow on staging (Modal + R2)
     │
     ▼
Promote to Production
     │
     ├── 7. Deploy to Fly.io prod: fly deploy --app reel-ballers-api
     └── 8. CF Pages: promote preview to production
```

### Deployment Commands

```bash
# === STAGING ===
# Deploy backend to staging
cd src/backend && fly deploy --app reel-ballers-api-staging

# Frontend auto-deploys on push to main
# Preview URL: https://<commit-hash>.reel-ballers-app.pages.dev

# === PRODUCTION ===
# Deploy backend to production (after staging verified)
cd src/backend && fly deploy --app reel-ballers-api

# Promote frontend to production
cd src/frontend
npm run build
npx wrangler pages deploy dist --project-name=reel-ballers-app --branch=production
```

### Environment Variables

**Local (.env file)**:
```bash
R2_ENABLED=true
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
R2_BUCKET_NAME=reel-ballers-users
MODAL_ENABLED=false  # Use local FFmpeg by default
```

**Staging (Fly.io secrets)**:
```bash
fly secrets set --app reel-ballers-api-staging \
  R2_ENABLED=true \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_BUCKET_NAME=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=xxx \
  MODAL_TOKEN_SECRET=xxx \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_test_xxx
```

**Production (Fly.io secrets)**:
```bash
fly secrets set --app reel-ballers-api \
  R2_ENABLED=true \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_BUCKET_NAME=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=xxx \
  MODAL_TOKEN_SECRET=xxx \
  STRIPE_SECRET_KEY=sk_live_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_live_xxx
```

### Testing Checklist

**Before merging to main (local testing):**
- [ ] App works locally with R2 storage
- [ ] Exports complete with local FFmpeg
- [ ] No console errors in frontend
- [ ] Backend tests pass

**Before promoting to production (staging testing):**
- [ ] Staging deployment works end-to-end
- [ ] Exports complete via Modal on staging
- [ ] Progress updates work in UI
- [ ] No errors in Fly.io staging logs

**After production deploy:**
- [ ] Production URLs resolve correctly
- [ ] API health check passes
- [ ] One test export completes successfully

---

## Why This Architecture?

### Why Fly.io instead of Cloudflare Workers?

| Factor | Fly.io | Workers |
|--------|--------|---------|
| Language | Python (native) | JavaScript only |
| Rewrite needed | None | Complete rewrite |
| WebSockets | Full support | Limited |
| SQLite | Native filesystem | Requires WASM |
| Cold start | ~2-3s | ~50ms |
| Scale to zero | Yes | Yes |

**Decision**: Keep Python, avoid rewrite, accept slightly slower cold starts.

### Why Cloudflare Pages for Frontend?

- Already using Cloudflare for R2
- Free tier is generous
- Fastest global CDN
- Automatic HTTPS
- GitHub integration for CI/CD

### Why Modal for GPU Processing?

| Factor | Modal | RunPod | Fly.io GPU | Workers AI |
|--------|-------|--------|------------|------------|
| Cost | ~$0.0001-0.0002/sec | ~$0.0002/sec | ~$0.00027/sec | N/A |
| Scale to zero | True | True | Yes | Yes |
| Setup complexity | **Low (Python)** | Medium (Docker) | Medium | N/A |
| FFmpeg support | Yes | Yes | Yes | **No** |
| Idle costs | None | None | None | None |

**Decision**: Modal is Python-native (no Docker needed), cheaper than RunPod, excellent DX.

```python
# Modal: Just Python decorators - no Dockerfile needed
@app.function(gpu="T4", timeout=300)
def process_video(input_url: str, params: dict):
    # FFmpeg code runs on GPU instance
    return output_url
```

**Note**: Workers AI is NOT suitable for video processing - it only supports AI inference (LLMs, image generation). Cannot run FFmpeg.

### Why Keep SQLite + R2 Sync?

- Already implemented and working
- No WASM overhead (native SQLite)
- Simple mental model
- Delay-based monitoring tells us when to optimize

---

## Monitoring & Alerts

Watch for these log messages:

```
# Normal operation
INFO: Database synced to R2 for user: a, version: 123

# Warning - sync getting slow
WARNING: [SLOW DB SYNC] POST /api/projects/5/state - sync took 0.65s

# Critical - user experience degraded
WARNING: [SLOW REQUEST] POST /api/export/upscale - total 5.23s (sync: 0.75s)
```

**Action**: If SLOW DB SYNC warnings appear frequently, consider:
1. Archiving old data
2. Adding Fly Volume for local caching
3. Investigating network issues

---

## How to Use This Plan

1. **Check current phase** in Execution Order above
2. **Work on tasks in order** within the current phase
3. **Run testability checkpoint** after completing each phase
4. **Only proceed to next phase** when current phase is testable
5. **Update task status** in this file after completing each task

**Next step**: Task 05 - Modal Account Setup (User task)
