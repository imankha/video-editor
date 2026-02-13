# Project Plan

## Current Focus

**Phase: Deployment** - All feature tasks complete. Now deploying to staging, then adding auth/payments before production.

**Landing Page:** Already live at `reelballers.com`

---

## CRITICAL: Pre-Deployment Blockers

These tasks MUST be completed before deployment to avoid storage waste and re-migration.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| **T80** | [**Global Game Deduplication + 4GB Uploads**](tasks/T80-global-game-deduplication.md) | **TODO** | Games to global storage, multipart uploads |
| **T85** | [**Multi-Athlete Profiles**](tasks/T85-multi-athlete-profiles.md) | **TODO** | Per-athlete data isolation (depends on T80) |

**Why these block deployment:**
- **T80:** Per-user game storage wastes R2 costs, 4GB uploads needed
- **T85:** Storage structure changes significantly, easier before real users
- Both involve migrations that are painful after users have data

---

## Deployment Roadmap

### Phase 1: Staging Infrastructure

Get the app running on staging URLs for testing.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T100 | [Fly.io Staging Backend](tasks/deployment/T100-flyio-backend.md) | TODO | Scale-to-zero, ~$0-2/mo |
| T110 | [Cloudflare Pages Staging](tasks/deployment/T110-cloudflare-pages.md) | TODO | Frontend at `*.pages.dev` |

**Staging URLs:**
- API: `reel-ballers-api-staging.fly.dev`
- App: `reel-ballers-staging.pages.dev`

### Phase 2: Staging Features

Test auth and payments with Stripe test mode before production.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T200 | [User Management](tasks/T200-user-management.md) | TODO | Email magic link auth |
| T210 | [Wallet & Payments](tasks/T210-wallet-payments.md) | TODO | Stripe test keys |

### Phase 3: Production Infrastructure

Deploy to production domains with proper scaling.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T105 | [Production Backend Scaling](tasks/deployment/T105-production-backend-scaling.md) | TODO | Capacity planning |
| T115 | [Cloudflare Pages Production](tasks/deployment/T115-cloudflare-pages-production.md) | TODO | `app.reelballers.com` |
| T120 | [DNS & SSL](tasks/deployment/T120-dns-ssl.md) | TODO | Custom domains |

**Production URLs:**
- Landing: `reelballers.com` (already live)
- App: `app.reelballers.com`
- API: `api.reelballers.com`

### Phase 4: Post-Launch Polish

Improvements after real user traffic.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T40 | [Stale Session Detection](tasks/T40-stale-session-detection.md) | TODO | Multi-tab conflict handling |
| T230 | [Pre-warm R2 on Login](tasks/T230-prewarm-r2-on-login.md) | TODO | Faster video loads (needs T200) |
| T74 | [Incremental Framing Export](tasks/T74-incremental-framing-export.md) | TODO | Cache rendered clips |
| T220 | [Future GPU Features](tasks/T220-future-gpu-features.md) | TODO | Advanced AI features |

---

## Environment Configuration

### Credentials (Found)

**R2 Storage** (in `.env`):
```
R2_ENABLED=true
R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4
R2_SECRET_ACCESS_KEY=***
R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com
R2_BUCKET=reel-ballers-users
```

**Modal GPU** (in `~/.modal.toml`):
```
token_id=ak-Gr72Vz5gr7MYVpcUowSeDB
token_secret=***
```

### Fly.io Secrets (for T100)

```bash
fly secrets set --app reel-ballers-api-staging \
  R2_ENABLED=true \
  R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4 \
  R2_SECRET_ACCESS_KEY=<from .env> \
  R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com \
  R2_BUCKET=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=ak-Gr72Vz5gr7MYVpcUowSeDB \
  MODAL_TOKEN_SECRET=<from ~/.modal.toml> \
  ENV=staging
```

---

## Completed Tasks

### Pre-Deployment Features (All DONE)

| ID | Task |
|----|------|
| T75 | Annotate Fullscreen Add Clip Button |
| T72 | Overlay Keyframe Delete Bug |
| T73 | Project Card Clip Count Mismatch |
| T69 | Mode Switch Save Reset |
| T58 | Dim Tracking Squares When Disabled |
| T61 | Annotate Default Good |
| T62 | Tag Changes |
| T65 | Logo from Landing Page |

### Earlier Completed

| ID | Task |
|----|------|
| T05 | Optimize Load Times |
| T06 | Move Tracking Toggle to Layer Icon |
| T07 | Video Load Times |
| T10 | Progress Bar Improvements |
| T11 | Local GPU Progress Bar |
| T12 | Progress State Recovery |
| T20 | E2E Test Reliability |
| T30 | Performance Profiling |
| T50 | Modal Cost Optimization |
| T53 | Fix Tracking Marker Navigation |
| T54 | Fix useOverlayState Test Failures |
| T55 | Slow Video Loading |
| T57 | Stale Tracking Rectangles |
| T60 | Consolidate Video Controls |
| T63 | Project Filter Persistence |
| T64 | Gallery Playback Controls |
| T66 | Database Completed Projects Split |
| T67 | Overlay Color Selection |
| T68 | Console Error Cleanup |
| T70 | Multi-clip Overlay Shows Single Clip |
| T71 | Gallery Show Proper Names |
| T56 | Gallery Show Duration |

### Won't Do

| ID | Task | Reason |
|----|------|--------|
| T51 | Overlay Parallelization | Analysis showed parallel costs more |
| T52 | Annotate Parallelization | CPU-bound, won't help |
| T130 | Modal Production Workspace | Not needed - personal workspace is fine |

---

## Task ID Reference

IDs use gaps of 10 to allow insertions:
- `T10-T79` - Feature tasks (complete)
- `T80-T99` - Pre-deployment blockers
- `T100-T199` - Deployment epic
- `T200-T299` - Post-launch features

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
