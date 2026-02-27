# Project Plan

## Current Focus

**Phase: Bug Fixes & Stability** - Clear out sync/data integrity bugs before T85 and deployment.

**Landing Page:** Already live at `reelballers.com`

## Priority Policy

**Bugs are always the first priority, especially infrastructure bugs (sync, data integrity, schema).** New features and structural changes should not begin until known bugs are resolved. The order is:

1. **Infrastructure bugs** - Sync failures, data loss, orphaned records, schema issues
2. **Test failures** - Broken tests indicate regressions; fix before adding more code
3. **UI/UX bugs** - Visible issues that affect the user experience
4. **Pre-deployment blockers** - Structural changes (T85) that must happen before real users
5. **New features** - Only after the above are clear

**Bug prioritization within a tier:** Rank by **infrastructure depth** — the deeper the bug (more systems depend on the affected layer), the higher the priority. A silent sync failure is worse than a slow sync, which is worse than a broken test.

When suggesting the next task, always check the Bug Fix Sprint section first. Do not recommend feature work while bugs remain open.

---

## Bug Fix Sprint (Before T85)

Fix data integrity and sync issues before making structural changes. Ordered by **infrastructure depth** — the deeper the bug (more systems depend on it), the higher the priority.

| ID | Task | Status | Depth | Cmplx | Notes |
|----|------|--------|-------|-------|-------|
| T86 | [FK Cascades on raw_clips](tasks/T86-raw-clips-fk-cascade.md) | DONE | Schema | 2 | Orphaned records on game/project delete |
| T87 | [Sync Connection Loss Handling](tasks/T87-sync-connection-loss.md) | DONE | Sync | 4 | Failed R2 sync causes permanent divergence |
| T243 | [Archive DB Not Reducing Size](tasks/T243-archive-db-not-reducing-size.md) | DONE | Storage | 4 | Prune old working_video versions + stale export_jobs on startup |
| T245 | [Fix Highlight Regions Test](tasks/T245-fix-highlight-regions-test.md) | DONE | Test | 2 | Pre-existing test failure on all branches |
| T246 | [Fix E2E TSV Import Failures](tasks/T246-fix-e2e-tsv-import-failures.md) | DONE | Test | 4 | Fixed: invalid tags in TSV fixture (10/15 tests resolved) |
| T247 | [Fix E2E Clip Extraction Timeout](tasks/T247-e2e-clip-extraction-timeout.md) | DONE | Test | 4 | Fixed: X-User-ID header on R2 presigned URLs caused CORS failure; 6/6 smoke tests pass |
| T20 | [E2E Test Reliability — Mock Export](tasks/T20-e2e-test-reliability.md) | DONE | Test | 3 | Mock framing export to skip GPU processing; fix all E2E failures |
| T248 | [Framing Export Sync Failure](tasks/T248-framing-export-sync-failure.md) | DONE | Sync | 3 | Fixed: threading.local not async-safe + fresh user version gap |

**Priority rationale (infrastructure depth):**
- T86: Schema integrity — FK enforcement is the foundation all CRUD operations sit on
- T87: Sync reliability — every write depends on sync for persistence. Silent failure = silent data loss. Deepest runtime bug.
- T243: Storage efficiency — large DB makes syncs slower and more failure-prone, compounding T87
- T245: Test baseline — no user impact, but clean tests needed before more changes
- T246: (DONE) Test baseline — fixed stale fixture tags, resolved 10/15 failures
- T247: (DONE) Test baseline — root cause was CORS, not FFmpeg; all 6 smoke tests pass
- T20: Mock export in E2E tests so full suite can pass without 10-min GPU waits
- T248: Real bug — framing export completes but DB update lost (likely sync overwrite). Depends on T20 for fast iteration

---

## CRITICAL: Pre-Deployment Blockers

These tasks MUST be completed before deployment to avoid storage waste and re-migration.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| **T80** | [**Global Game Deduplication + 4GB Uploads**](tasks/T80-global-game-deduplication.md) | **DONE** | Games to global storage, multipart uploads |
| **T81** | [Faster Upload Hash](tasks/T81-faster-upload-hash.md) | **DONE** | Sample-based hashing instead of full file (depends on T80) |
| **T82** | [Multi-Video Games](tasks/T82-multi-video-games.md) | **DONE** | First half/second half support (depends on T80) |
| **T85** | [**Multi-Athlete Profiles**](tasks/T85-multi-athlete-profiles.md) | **TODO** | Per-athlete data isolation — split into subtasks: |
| T85a | [R2 Restructure](tasks/T85a-r2-restructure.md) | DONE | Add `{env}/users/` prefix + default profile GUID paths (no UI changes) |
| T85b | [Profile Switching](tasks/T85b-profile-switching.md) | DONE | Profile CRUD API + frontend switcher (depends on T85a) |

**Why these block deployment:**
- **T80:** Per-user game storage wastes R2 costs, 4GB uploads needed
- **T82:** Game-to-video schema change (1:many) easier before real users have data
- **T85:** Storage structure changes significantly, easier before real users
- These involve migrations that are painful after users have data

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
| T240 | [Consistent Logo Placement](tasks/T240-consistent-logo-placement.md) | TODO | Logo in all modes, non-clickable position |
| T241 | [Annotate Arrow Key Seek](tasks/T241-annotate-arrow-key-seek.md) | TODO | Forward/backward arrows should seek 4s |
| T242 | [Rename Project from Card](tasks/T242-rename-project-from-card.md) | TODO | Easy inline rename on project card |
| T244 | [Game Card Clip Stats & View Progress](tasks/T244-game-card-clip-stats.md) | TODO | Brilliant/good counts, composite score, viewed indicator |

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
- `T80-T99` - Pre-deployment blockers + bug fix sprint
- `T100-T199` - Deployment epic
- `T200-T299` - Post-launch features

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
