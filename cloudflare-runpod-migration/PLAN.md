# Cloudflare + RunPod Migration Plan

## Overview

Migrate video export processing from local FastAPI to a serverless architecture:
- **Cloudflare Workers**: API gateway, job orchestration, WebSocket connections
- **Cloudflare D1**: Job queue and project data (SQLite-compatible)
- **Cloudflare R2**: Video file storage (input/output)
- **RunPod Serverless**: GPU video processing (pay-per-second, no idle costs)

## Domain Structure

```
reelballers.com       → Cloudflare Pages (landing)
app.reelballers.com   → Cloudflare Pages (main app)
api.reelballers.com   → Cloudflare Workers (API)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│                  (React + WebSocket client)                      │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │         Cloudflare            │
                │                               │
                │   ┌───────────────────────┐   │
                │   │       Workers         │   │
                │   │  - POST /api/jobs     │   │
                │   │  - GET /api/jobs/:id  │   │
                │   │  - WebSocket proxy    │   │
                │   └───────────┬───────────┘   │
                │               │               │
                │   ┌───────────┴───────────┐   │
                │   │   Durable Objects     │   │
                │   │   (ExportJobState)    │   │
                │   │   - State machine     │   │
                │   │   - WebSocket hub     │   │
                │   └───────────┬───────────┘   │
                │               │               │
                │   ┌───────────┴───────────┐   │
                │   │    D1 Database        │   │
                │   │  - export_jobs        │   │
                │   │  - projects (future)  │   │
                │   └───────────────────────┘   │
                │               │               │
                │   ┌───────────┴───────────┐   │
                │   │    R2 Storage         │   │
                │   │  - input videos       │   │
                │   │  - output videos      │   │
                │   └───────────────────────┘   │
                └───────────────┬───────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │     RunPod Serverless         │
                │                               │
                │  ┌─────────────────────────┐  │
                │  │  GPU Worker Container   │  │
                │  │  - Download from R2     │  │
                │  │  - Process video        │  │
                │  │  - Upload to R2         │  │
                │  │  - Notify completion    │  │
                │  └─────────────────────────┘  │
                │                               │
                │  Auto-scales, pay-per-second  │
                └───────────────────────────────┘
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| GPU Provider | RunPod Serverless | No Kubernetes, pay-per-second, auto-scales to zero |
| Job Recovery | Retry from scratch | Jobs are short (10-30s), checkpoint complexity not worth it |
| Database | Cloudflare D1 | SQLite-compatible, free tier covers small usage |
| File Storage | Cloudflare R2 | S3-compatible, no egress fees |
| Real-time Updates | Durable Objects | WebSocket hub survives reconnections |

## Cost Estimate (1000 exports/month)

| Component | Monthly Cost |
|-----------|--------------|
| Cloudflare Workers Paid | $5 |
| Cloudflare D1 | $0 (free tier) |
| Cloudflare R2 (50GB) | $0.75 |
| RunPod Serverless | $5-10 |
| **Total** | **~$11-16/month** |

---

## Task Status

| # | Task | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 01 | [Cloudflare Account Setup](tasks/01-cloudflare-account-setup.md) | `TODO` | User | Create account, enable services |
| 02 | [Workers Project Setup](tasks/02-workers-project-setup.md) | `TODO` | Claude | Create wrangler.toml, directory structure |
| 03 | [D1 Database Schema](tasks/03-d1-database-schema.md) | `TODO` | Claude | Define tables, migrations |
| 04 | [R2 Bucket Setup](tasks/04-r2-bucket-setup.md) | `TODO` | User | Create bucket, CORS config |
| 05 | [Durable Objects - Job State](tasks/05-durable-objects-job-state.md) | `TODO` | Claude | Implement ExportJobState |
| 06 | [Workers API Routes](tasks/06-workers-api-routes.md) | `TODO` | Claude | Job CRUD, video URLs |
| 07 | [RunPod Serverless Setup](tasks/07-runpod-serverless-setup.md) | `TODO` | User + Claude | Account, endpoint config |
| 08 | [GPU Worker Code](tasks/08-gpu-worker-code.md) | `TODO` | Claude | Port video processing |
| 09 | [Backend Migration](tasks/09-backend-migration.md) | `TODO` | Claude | Update FastAPI routes |
| 10 | [Frontend Migration](tasks/10-frontend-migration.md) | `TODO` | Claude | Update stores, WebSocket |
| 11 | [Testing & Deployment](tasks/11-testing-deployment.md) | `TODO` | Both | End-to-end testing |
| 12 | [Wallet & Payments](tasks/12-wallet-payments.md) | `TODO` | Both | Stripe integration, usage billing |
| 13 | [Future GPU Features](tasks/13-future-gpu-features.md) | `TODO` | Claude | Upscale, tracking, etc. |

**Status Key**: `TODO` | `IN_PROGRESS` | `BLOCKED` | `DONE`

---

## Execution Order

```
Phase 1: Infrastructure Setup (User tasks)
├── 01-cloudflare-account-setup
└── 04-r2-bucket-setup

Phase 2: Cloudflare Workers (Claude tasks, can start after Phase 1)
├── 02-workers-project-setup
├── 03-d1-database-schema
├── 05-durable-objects-job-state
└── 06-workers-api-routes

Phase 3: RunPod (Parallel with Phase 2)
├── 07-runpod-serverless-setup
└── 08-gpu-worker-code

Phase 4: Integration (After Phases 2 & 3)
├── 09-backend-migration
├── 10-frontend-migration
└── 11-testing-deployment

Phase 5: Monetization (Optional, after Phase 4)
└── 12-wallet-payments

Phase 6: Future Enhancements (Ongoing)
└── 13-future-gpu-features
```

---

## Quick Reference

### Local Development
```bash
# Terminal 1: Cloudflare Workers (local)
cd workers && wrangler dev --local --persist

# Terminal 2: Frontend
cd src/frontend && npm run dev

# Terminal 3: Existing FastAPI (during migration)
cd src/backend && uvicorn app.main:app --reload
```

### File Locations
```
video-editor/
├── cloudflare-runpod-migration/   # This plan
│   ├── PLAN.md                    # You are here
│   └── tasks/                     # Detailed task files
├── workers/                       # NEW: Cloudflare Workers
│   ├── src/
│   │   ├── index.ts              # Main entry
│   │   ├── routes/               # API routes
│   │   └── durable-objects/      # ExportJobState
│   └── wrangler.toml
├── gpu-worker/                    # NEW: RunPod container
│   ├── Dockerfile
│   ├── handler.py                # RunPod handler
│   └── processors/               # Video processing
└── src/                          # EXISTING
    ├── backend/                  # FastAPI (modify)
    └── frontend/                 # React (modify)
```

---

## How to Use This Plan

1. **Start with Task 01** - User creates Cloudflare account
2. **Check task status** in table above
3. **Load only the relevant task file** when working on it
4. **Update status** in this file after completing each task
5. **Handoff notes** in each task file explain dependencies

When asking Claude to work on a task:
> "Let's work on Task 03 - D1 Database Schema. Here's the current status: [paste relevant info]"
