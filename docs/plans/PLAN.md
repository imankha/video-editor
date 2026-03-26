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
| **T85** | [**Multi-Athlete Profiles**](tasks/T85-multi-athlete-profiles.md) | **DONE** | Per-athlete data isolation — split into subtasks: |
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
| T100 | [Fly.io Staging Backend](tasks/deployment/T100-flyio-backend.md) | DONE | Scale-to-zero, ~$0-2/mo |
| T110 | [Cloudflare Pages Staging](tasks/deployment/T110-cloudflare-pages.md) | DONE | Frontend at `reel-ballers-staging.pages.dev` |
| T125 | [CI/CD Auto-Deploy](tasks/deployment/T125-cicd-auto-deploy.md) | DONE | GitHub Actions: backend + frontend + landing with path filters |
| T126 | [Fly.io Suspend + Graceful Shutdown](tasks/deployment/T126-flyio-suspend-graceful-shutdown.md) | DONE | Suspend mode for faster wake, SIGTERM handler for clean shutdown |
| T127 | [R2 Database Restore on Startup](tasks/deployment/T127-r2-database-restore-on-startup.md) | DONE | Restore from R2 on cold start so data survives machine restarts |
| T128 | [WebSocket Reconnection Resilience](tasks/deployment/T128-websocket-reconnection-resilience.md) | DONE | Exponential backoff, suppress error spam during cold starts |

**Staging URLs:**
- API: `reel-ballers-api-staging.fly.dev`
- App: `reel-ballers-staging.pages.dev`

### Phase 2: User Auth & Monetization

Two epics, interleaved for feedback velocity. UI shells first (testable with users), then backend wiring, then Stripe last.

#### Epic: User Auth
[tasks/user-auth/EPIC.md](tasks/user-auth/EPIC.md)

Gate GPU operations behind email verification. Google OAuth primary, Email OTP secondary. Per-user SQLite first (T400/T401), central D1 later (T405).

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T400 | [Auth Gate + Google OAuth](tasks/user-auth/T400-auth-gate-ui.md) | DONE | 9 | 4 | Modal + real Google sign-in (per-user SQLite) |
| T401 | [Email OTP Auth](tasks/user-auth/T401-email-otp.md) | TODO | 9 | 4 | Real Resend integration (per-user SQLite) |
| T405 | [Central Auth + Cross-Device](tasks/user-auth/T405-central-auth-db.md) | DONE | 7 | 5 | Shared auth.sqlite+R2, server-issued UUIDs, session cookies, remove ?user= param |
| T410 | [Guest Progress Migration](tasks/user-auth/T410-guest-progress-migration.md) | DONE | 6 | 5 | On login, migrate guest profile (if has games) as "second" profile on recovered account |
| T420 | [Session & Return Visits](tasks/user-auth/T420-session-return-visits.md) | TODO | 7 | 3 | Single-session enforcement, expiry |
| T430 | [Account Settings](tasks/user-auth/T430-account-settings.md) | TODO | 4 | 2 | Email display, linking, logout |

#### Epic: Monetization
[tasks/monetization/EPIC.md](tasks/monetization/EPIC.md)

Per-second credit system for GPU operations. Credits earned through quests and admin grants, Stripe purchase planned separately.

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| **T530** | [**Credit System**](tasks/monetization/T530-credit-system.md) | **DONE** | **9** | **5** | **1 credit/sec for Framing; first-time-free; supersedes T500/T505/T510/T515** |
| T500 | [Credits UI Shell](tasks/monetization/T500-credits-ui-shell.md) | SUPERSEDED | 7 | 2 | Superseded by T530 (per-second model) |
| T505 | [Credit System Backend](tasks/monetization/T505-credit-system-backend.md) | SUPERSEDED | 8 | 4 | Superseded by T530 (auth.sqlite, not D1) |
| T510 | [GPU Cost Gate](tasks/monetization/T510-gpu-cost-gate.md) | SUPERSEDED | 9 | 3 | Superseded by T530 (per-second gate) |
| T515 | [Free Trial Credits](tasks/monetization/T515-free-trial-credits.md) | SUPERSEDED | 7 | 2 | Superseded by T530 (first-time-free) + T540 (quest rewards) |
| T520 | [Pricing Exploration](tasks/monetization/T520-pricing-exploration.md) | DONE | 6 | 1 | Completed as part of T530 cost analysis |
| T525 | [Stripe Integration](tasks/monetization/T525-stripe-integration.md) | DONE | 8 | 5 | Checkout, webhooks, credit packages (LAST) |
| T526 | [Embedded Stripe Payment](tasks/monetization/T526-embedded-stripe-payment.md) | TODO | 7 | 4 | Inline Payment Element, no redirect, auto-export after purchase |

#### Epic: Guided Tutorial
| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| **T540** | [**Quest System**](tasks/T540-quest-system.md) | **DONE** | **8** | **5** | **3 quests (4+6+10 steps), 175 credits; floating overlay with audio** |

#### Epic: Admin
| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| **T550** | [**Admin Panel**](tasks/T550-admin-panel.md) | **DONE** | **7** | **6** | **User stats, credit grants, GPU usage, Cloudflare analytics** |

#### Recommended Build Order (feedback velocity)

Each task delivers working functionality users can test:

1. **T400** — Auth gate + Google OAuth (real sign-in, testable immediately) ✅ DONE
2. **T530** — Credit system (per-second pricing, first-time-free, credit balance UI)
3. **T540** — Quest system (onboarding tutorial, earns credits)
4. **T550** — Admin panel (user stats, credit grants, GPU tracking)
5. **T405** — Central auth DB + cross-device recovery ✅ DONE
6. **T401** — Email OTP (real Resend, second auth method)
7. **T420** — Session management (single-session, expiry)
8. **T525** — Stripe integration (LAST — after credits + quests are working)
9. **T430** — Account settings (polish)

### Phase 3: Production Infrastructure

Deploy to production domains with proper scaling.

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| **T590** | [**Prod Environment Launch**](tasks/T590-prod-environment-launch.md) | **DONE** | **10** | **5** | CF Pages + Fly.io prod deploy, custom domain, feature gates, analytics verify, v1.0.0 tag |
| T105 | [Production Backend Scaling](tasks/deployment/T105-production-backend-scaling.md) | TODO | 6 | 7 | Capacity planning |
| T115 | [Cloudflare Pages Production](tasks/deployment/T115-cloudflare-pages-production.md) | TODO | `app.reelballers.com` |
| T120 | [DNS & SSL](tasks/deployment/T120-dns-ssl.md) | TODO | Custom domains |

**Production URLs:**
- Landing: `reelballers.com` (already live)
- App: `app.reelballers.com`
- API: `api.reelballers.com`

### Known Bugs

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T249 | [Extraction Recovery](tasks/T249-extraction-recovery.md) | DONE | 5 | 4 | Stuck extractions: no timeout, no retry, no failed UI state |
| T250 | [Clip Store Unification](tasks/T250-clip-store-unification.md) | DONE | 5 | 4 | Eliminate dual-store sync: merge useProjectClips into Zustand, compute flags, use backend IDs |
| T260 | [Framing Audio Toggle Ignored](tasks/T260-framing-audio-toggle-ignored.md) | DONE | 5 | 3 | Audio still present when toggle is off |
| T270 | [Overlay Renders Outside Region](tasks/T270-overlay-renders-outside-region.md) | DONE | 4 | 4 | Overlay extends beyond shrunk region bounds |
| T350 | [Sync Strategy Overhaul](tasks/T350-sync-strategy-overhaul.md) | DONE | 9 | 6 | DB writes only on user gestures; reactive sync effect corrupts keyframe data |
| T355 | [Permanent Keyframe Selection](tasks/T355-permanent-keyframe-selection.md) | DONE | 5 | 3 | Permanent keyframes (frame 0/end) can't be selected by clicking diamonds |
| T252 | [E2E Project Manager Default Tab](tasks/T252-e2e-project-manager-default-tab.md) | DONE | 3 | 1 | Test expects Projects tab but UI defaults to Games; blocks 8 downstream tests |
| T253 | [E2E Framing Export Working Video](tasks/T253-e2e-framing-export-working-video.md) | DONE | 3 | 2 | has_working_video undefined after export |
| T254 | [Export Network Resilience](tasks/T254-export-network-resilience.md) | DONE | 6 | 4 | Survive network disconnects during export — don't fail when server is still rendering |
| T570 | [Framing Clip Icon State](tasks/T570-framing-clip-icon-state.md) | DONE | 4 | 2 | "!" icon didn't clear after framing; optimistically update crop_data in store on keyframe add |
| T580 | [Can't Reframe — Shows Exported Video](tasks/T580-reframing-shows-exported-video.md) | DONE | 7 | 4 | Fix: reset shared videoStore on mode switch + useLayoutEffect guard in FramingScreen |
| T730 | [Missing End Detection Point](tasks/T730-missing-end-detection-point.md) | TESTING | 5 | 4 | Short clips missing last player tracking point at end of overlay region (fence-post error in local detection) |
| T740 | [Merge Extraction into Framing](tasks/T740-merge-extraction-into-framing.md) | TODO | 8 | 7 | Eliminate separate extraction step; framing takes source video + time range, extracts + processes in single pass |

### Mobile Responsive (TODO)
[tasks/mobile-responsive/EPIC.md](tasks/mobile-responsive/EPIC.md)

Make the app usable on mobile phones. Currently desktop-first layout breaks on narrow screens.

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T280 | [Mobile Navigation](tasks/mobile-responsive/T280-mobile-navigation.md) | DONE | 7 | 3 | Nav buttons truncated/clipped on all screens |
| T290 | [Mobile Home Screen](tasks/mobile-responsive/T290-mobile-home-screen.md) | DONE | 5 | 3 | Gallery button hidden, game card stats messy |
| T300 | [Mobile Annotate Screen](tasks/mobile-responsive/T300-mobile-annotate-screen.md) | DONE | 5 | 4 | Content bleeds off right edge |
| T310 | [Mobile Editor Layout](tasks/mobile-responsive/T310-mobile-editor-layout.md) | DONE | 8 | 6 | Two-column editor unusable, needs vertical stack |
| T320 | [Mobile Video Preview](tasks/mobile-responsive/T320-mobile-video-preview.md) | DONE | 6 | 4 | Tiny preview, crop handles too small for touch |
| T330 | [Mobile Video Players](tasks/mobile-responsive/T330-mobile-video-players.md) | DONE | 7 | 4 | Touch controls, scrubbing, iOS/Android quirks |
| T335 | [Mobile Annotate Clips](tasks/mobile-responsive/T335-mobile-annotate-clips.md) | DONE | 7 | 5 | Clips panel crushed to 0px, video wastes 60% screen, markers untappable |

### Phase 4: Post-Launch Features

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T600 | [Auto-Generate Annotation Titles (TF-IDF)](tasks/T600-auto-generate-annotation-titles.md) | DONE | 5 | 4 | Extract keyword titles from notes using scikit-learn TfidfVectorizer; zero API cost |
| T610 | [Track last_seen_at on Every Visit](tasks/T610-track-last-seen.md) | DONE | 6 | 1 | Update last_seen_at on /auth/me and /init-guest, not just Google login |
| T620 | [Account Cleanup (Trigger: high R2 fees)](tasks/T620-account-cleanup.md) | TODO | 5 | 5 | Auto-delete abandoned guests (7d), dormant free (90d), warn paid (180d). Blocked by T610 |
| T710 | [Play Annotations Mode](tasks/T710-play-annotations-mode.md) | DONE | 9 | 7 | Replace "Create Annotated Video" with frontend-only playback; virtual timeline, Phase 2 adds bridge segments |
| T720 | [Art Frames](tasks/T720-art-frames.md) | TODO | 8 | 7 | Pen drawing on frozen clip frames; displayed during Play Annotations with configurable pause (1–10s). Depends on T710 |

### UX Feedback (NUF Tester — 2026-03-23)

User feedback from first NUF session. Two groups: game addition flow and clip creation flow.

#### Game Addition Flow

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T640 | [Game Upload Drop Zone](tasks/T640-game-upload-drop-zone.md) | DONE | 4 | 2 | Drag-and-drop onto file upload area in GameDetailsModal |
| T670 | [Consistent Game Terminology](tasks/T670-consistent-game-terminology.md) | DONE | 5 | 1 | Standardize "Add a Game" vs "Upload" across UI |
| T680 | [Upload Progress Bar Visibility](tasks/T680-upload-progress-bar-visibility.md) | DONE | 4 | 2 | Investigate — progress bar exists but NUF user didn't notice it |

#### Clip Creation Flow

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T650 | [Clip Scrub Region UI](tasks/T650-clip-scrub-region-ui.md) | DONE | 8 | 5 | Visual scrub handles for clip start/end with real-time video preview; replaces time inputs |
| T660 | [Clip Edit Button Clarity](tasks/T660-clip-edit-button-clarity.md) | DONE | 5 | 1 | "Add Clip" → "Edit Clip" (amber) when clip selected; depends on T650 |
| T690 | [Clip Selection State Machine](tasks/T690-clip-selection-state-machine.md) | DONE | 7 | 5 | Redesign clip selection/edit mode as state machine; fix deselect races, fullscreen sync, overlay loading |

#### UI Polish

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T700 | [Quest Panel Smart Positioning](tasks/T700-quest-panel-smart-positioning.md) | DONE | 4 | 3 | CSS-first positioning to avoid sidebar overlap; replace JS elementsFromPoint approach |

### Phase 4: Post-Launch Polish

Improvements after real user traffic.

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T340 | [Keyframe Integrity Guards](tasks/T340-keyframe-integrity-guards.md) | DONE | Missing permanent keyframes, min spacing, selection disambiguation |
| T630 | [Startup Request Optimization](tasks/T630-startup-optimization.md) | DONE | Parallelize post-auth fetches, dedup /games calls, gate achievements, combine auth endpoints |
| T635 | [Startup Dedup — Remaining](tasks/T635-startup-dedup-remaining.md) | DONE | Dedup profiles/settings/downloads, gate pre-auth renders, fix duplicate achievement POST |
| T40 | [Stale Session Detection](tasks/T40-stale-session-detection.md) | TODO | Multi-tab conflict handling |
| T230 | [Pre-warm R2 on Login](tasks/T230-prewarm-r2-on-login.md) | TODO | Faster video loads (needs T415) |
| T74 | [Incremental Framing Export](tasks/T74-incremental-framing-export.md) | TODO | Cache rendered clips |
| T220 | [Future GPU Features](tasks/T220-future-gpu-features.md) | TODO | Advanced AI features |
| T240 | [Consistent Logo Placement](tasks/T240-consistent-logo-placement.md) | DONE | Logo removed from editor modes; only on Projects screen |
| T241 | [Annotate Arrow Key Seek](tasks/T241-annotate-arrow-key-seek.md) | DONE | Forward/backward arrows should seek 4s |
| T242 | [Rename Project from Card](tasks/T242-rename-project-from-card.md) | DONE | Easy inline rename on project card |
| T244 | [Game Card Clip Statistics](tasks/T244-game-card-clip-stats.md) | DONE | Display brilliant/good counts + composite score (frontend only, data already in API) |
| T251 | [Game View Progress Tracking](tasks/T251-game-view-progress.md) | DONE | Track watched duration in annotate mode, show progress on game card |

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
- `T200-T299` - Post-launch features + polish
- `T400-T430` - User Auth epic (T400=Google, T401=OTP, T405=D1, T420=sessions, T430=settings)
- `T500-T525` - Monetization epic

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
