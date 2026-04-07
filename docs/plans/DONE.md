# Completed Tasks

All completed, superseded, and won't-do tasks moved from PLAN.md.

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

**Why these blocked deployment:**
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

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| T400 | [Auth Gate + Google OAuth](tasks/user-auth/T400-auth-gate-ui.md) | DONE | 9 | 4 | Modal + real Google sign-in (per-user SQLite) |
| T401 | [Email OTP Auth](tasks/user-auth/T401-email-otp.md) | DONE | 9 | 4 | Real Resend integration (per-user SQLite) |
| T405 | [Central Auth + Cross-Device](tasks/user-auth/T405-central-auth-db.md) | DONE | 7 | 5 | Shared auth.sqlite+R2, server-issued UUIDs, session cookies, remove ?user= param |
| T410 | [Guest Progress Migration](tasks/user-auth/T410-guest-progress-migration.md) | DONE | 6 | 5 | On login, migrate guest profile (if has games) as "second" profile on recovered account |
| T415 | [Smart Guest Merge](tasks/user-auth/T415-smart-guest-merge.md) | DONE | 7 | 3 | Merge guest games into default profile (never branch); fix auth return context |
| T430 | [Account Settings](tasks/user-auth/T430-account-settings.md) | DONE | 4 | 2 | Email display, linking, logout |
| T435 | [Google One Tap Auto-Prompt](tasks/user-auth/T435-google-one-tap-auto-prompt.md) | DONE | 7 | 2 | Auto-show Google sign-in prompt for guests on page load |
| T450 | [Remove DEFAULT_USER_ID Fallback](tasks/user-auth/T450-remove-default-user-id.md) | DONE | 8 | 4 | Eliminate legacy `user=a`; 401 for unauthenticated non-auth requests |

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
| T526 | [Embedded Stripe Payment](tasks/monetization/T526-embedded-stripe-payment.md) | DONE | 7 | 4 | Inline Payment Element, no redirect, auto-export after purchase |

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

1. **T400** — Auth gate + Google OAuth (real sign-in, testable immediately) DONE
2. **T530** — Credit system (per-second pricing, first-time-free, credit balance UI)
3. **T540** — Quest system (onboarding tutorial, earns credits)
4. **T550** — Admin panel (user stats, credit grants, GPU tracking)
5. **T405** — Central auth DB + cross-device recovery DONE
6. **T401** — Email OTP (real Resend, second auth method)
7. **T420** — Session management (single-session, expiry)
8. **T525** — Stripe integration (LAST — after credits + quests are working)
9. **T430** — Account settings (polish)

### Phase 3: Production Infrastructure

Deploy to production domains with proper scaling.

| ID | Task | Status | Impact | Cmplx | Notes |
|----|------|--------|--------|-------|-------|
| **T590** | [**Prod Environment Launch**](tasks/T590-prod-environment-launch.md) | **DONE** | **10** | **5** | CF Pages + Fly.io prod deploy, custom domain, feature gates, analytics verify, v1.0.0 tag |
| T105 | [Production Backend Scaling](tasks/deployment/T105-production-backend-scaling.md) | SUPERSEDED | 6 | 7 | Covered by T590 |
| T115 | [Cloudflare Pages Production](tasks/deployment/T115-cloudflare-pages-production.md) | SUPERSEDED | — | — | Covered by T590 |
| T120 | [DNS & SSL](tasks/deployment/T120-dns-ssl.md) | SUPERSEDED | — | — | Covered by T590 |

**Production URLs:**
- Landing: `reelballers.com` (already live)
- App: `app.reelballers.com`
- API: `api.reelballers.com`

---

## Known Bugs

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
| T730 | [Missing End Detection Point](tasks/T730-missing-end-detection-point.md) | DONE | 5 | 4 | Short clips missing last player tracking point at end of overlay region (fence-post error in local detection) |
| T740 | [Merge Extraction into Framing](tasks/T740-merge-extraction-into-framing.md) | DONE | 8 | 7 | Eliminate separate extraction step; framing takes source video + time range, extracts + processes in single pass |
| T750 | [R2 Retry Resilience](tasks/T750-r2-retry-resilience.md) | DONE | 8 | 5 | Add retry with exponential backoff to all R2 operations; transient network failures currently cause immediate 500s |
| T755 | [Add Clip Panel Z-Order](tasks/T755-add-clip-panel-z-order.md) | DONE | 6 | 4 | Video GPU layer paints over Add Clip overlay; move overlay out of video container to avoid compositing conflict |
| T760 | [Background Local Processing](tasks/T760-background-local-processing.md) | DONE | 7 | 4 | Local exports block the web server; return 202 immediately and run GPU work in background task |
| T770 | [Navigate Home After Overlay Export](tasks/T770-overlay-complete-navigate-home.md) | DONE | 5 | 2 | After overlay export completes, auto-navigate user back to home/projects screen |
| T775 | [navigationStore Unused for Routing](tasks/T775-navigationStore-unused.md) | DONE | 4 | 3 | navigationStore.navigate() doesn't control screen rendering — editorMode is the real source of truth; dead code |
| T780 | [Quest Redesign + Credit Pack Pricing](tasks/T780-quest-redesign-credit-packs.md) | DONE | 8 | 5 | Redesign quests 3 & 4 (habit-building -> multi-game reel), update rewards (15/25/40/45), set credit packs ($3.99/40, $6.99/85, $12.99/180) |
| T790 | [Custom Project Triggers Extraction](tasks/T790-custom-project-extraction-bug.md) | DONE | 7 | 5 | Custom project creation triggers old extraction pipeline (removed in T740). Downloads full game video per clip — 35 clips = 35 downloads of a 3GB file. |
| T800 | [Remove Legacy Extraction Infrastructure](tasks/T800-remove-extraction-infrastructure.md) | DONE | 5 | 5 | Dead extraction code across ~15 files: response models, retry endpoint, WebSocket manager, modal_queue functions, tests, stale comments. T790 removed triggers; this removes everything else. |
| T1000 | [DRY Quest Definitions](tasks/T1000-dry-quest-definitions.md) | DONE | 6 | 4 | Quest defs duplicated in 3 files (frontend, quests.py, admin.py); admin copy is stale/wrong. Single source of truth in backend, derive everything else. |
| T810 | [Multi-Clip Export Fails for Game Video Clips](tasks/T810-multi-clip-export-game-video.md) | DONE | 9 | 6 | Multi-clip export downloads each clip's file from frontend, but game-video clips have no standalone files (T740). Backend needs to resolve clips from DB like single-clip export does. |
| T830 | [Clip Preview Timeline Shows Full Video](tasks/T830-clip-preview-timeline-full-video.md) | DONE | 6 | 4 | New Project modal clip preview shows full game video timeline instead of clip range |
| T840 | [Annotate Drag/Play Conflict](tasks/T840-annotate-drag-play-conflict.md) | DONE | 7 | 3 | Dragging start/end time handles while video is playing causes playback to fight with drag preview |
| T850 | [Annotate Duplicate Scrub UI](tasks/T850-annotate-duplicate-scrub-ui.md) | DONE | 5 | 4 | Two scrub/timeline UI instances visible during clip playback in annotate mode |
| T860 | [Keyframe Invariant Render Loop](tasks/T860-keyframe-invariant-render-loop.md) | DONE | 9 | 5 | Keyframe invariant check in render body causes 500+ re-renders, making framing unresponsive |
| T870 | [Export Progress Stuck During Download](tasks/T870-export-progress-stuck-during-download.md) | DONE | 5 | 3 | Export shows 0% for ~48s while backend downloads game video from R2 |

---

## Data Integrity & Persistence Hardening
[tasks/data-integrity/EPIC.md](tasks/data-integrity/EPIC.md)

Restructure persistence to eliminate silent data loss, credit race conditions, and non-atomic transactions. Must complete before production launch.

| # | ID | Task | Status | Impact | Cmplx | Depends On | Notes |
|---|-----|------|--------|--------|-------|------------|-------|
| 1 | T920 | [User-Level DB](tasks/data-integrity/T920-user-level-db.md) | DONE | 9 | 6 | — | Move credits/stripe/transactions from shared auth.sqlite to per-user user.sqlite |
| 2 | T880 | [Quest Reward Double-Grant](tasks/T880-quest-reward-double-grant.md) | DONE | 8 | 2 | T920 | UNIQUE index in user.sqlite prevents race condition |
| 3 | T890 | [Export Transaction Atomicity](tasks/T890-export-transaction-atomicity.md) | DONE | 7 | 4 | T920 | Credit reservation pattern + combine split transactions |
| 4 | T820 | [Guest Migration Data Loss](tasks/T820-guest-migration-data-loss.md) | DONE | 10 | 6 | T920 | Block login on failure, pending_migrations, credit transfer |
| 5 | T910 | [R2 Restore Retry](tasks/T910-r2-restore-retry.md) | DONE | 8 | 3 | T920 | Distinguish 404 from transient error, retry with cooldown |
| 6 | T900 | [FK Cascade Gaps](tasks/data-integrity/T900-fk-cascade-gaps.md) | DONE | 5 | 3 | — | 5 missing CASCADE/SET NULL constraints in profile DB |
| 7 | T930 | [Resilient R2 Sync](tasks/data-integrity/T930-resilient-r2-sync.md) | DONE | 9 | 4 | T920 | Persist sync failure state, retry on next request |
| 8 | T940 | [Export Worker R2 Sync](tasks/data-integrity/T940-export-worker-r2-sync.md) | DONE | 8 | 2 | T920 | Background export writes now synced to R2 |
| 9 | T950 | [Version Conflict Detection](tasks/data-integrity/T950-version-conflict-detection.md) | DONE | 7 | 3 | T920 | Fail on conflict, re-download newer version |

---

## User-Level Data Consolidation
[tasks/user-data-consolidation/EPIC.md](tasks/user-data-consolidation/EPIC.md)

Move profile metadata and quest achievements from per-profile storage into user.sqlite. Prevents cross-profile quest exploit (double credits) and centralizes user identity data.

| # | ID | Task | Status | Impact | Cmplx | Depends On | Notes |
|---|-----|------|--------|--------|-------|------------|-------|
| 1 | T960 | [Profiles to User DB](tasks/user-data-consolidation/T960-profiles-to-user-db.md) | DONE | 6 | 5 | T920 | Move profile CRUD from R2 JSON to user.sqlite profiles table |
| 2 | T970 | [User-Scoped Quest Achievements](tasks/user-data-consolidation/T970-user-scoped-quest-achievements.md) | DONE | 8 | 4 | T920 | Move achievements from per-profile DB to user.sqlite; prevents double quest completion |
| 3 | T985 | [Settings to User DB](tasks/user-data-consolidation/T985-settings-to-user-db.md) | DONE | 6 | 4 | T920 | Move user preferences from per-profile DB to user.sqlite; prevents loss on profile delete |
| 4 | T990 | [Rename database.sqlite to profile.sqlite](tasks/user-data-consolidation/T990-rename-database-to-profile-sqlite.md) | DONE | 4 | 5 | T985 | Rename per-profile DB file for clarity alongside user.sqlite |

---

## Mobile Responsive
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

---

## Completed Features & Polish

| ID | Task | Notes |
|----|------|-------|
| T600 | Auto-Generate Annotation Titles (TF-IDF) | Extract keyword titles from notes |
| T610 | Track last_seen_at on Every Visit | Update on /auth/me and /init-guest |
| T710 | Play Annotations Mode | Frontend-only playback; virtual timeline |
| T640 | Game Upload Drop Zone | Drag-and-drop onto file upload |
| T670 | Consistent Game Terminology | Standardize "Add a Game" vs "Upload" |
| T680 | Upload Progress Bar Visibility | Progress bar exists but wasn't noticed |
| T650 | Clip Scrub Region UI | Visual scrub handles for clip start/end |
| T660 | Clip Edit Button Clarity | "Add Clip" -> "Edit Clip" when selected |
| T690 | Clip Selection State Machine | Fix deselect races, fullscreen sync |
| T700 | Quest Panel Smart Positioning | CSS-first positioning |
| T340 | Keyframe Integrity Guards | Min spacing, selection disambiguation |
| T630 | Startup Request Optimization | Parallelize post-auth fetches |
| T635 | Startup Dedup — Remaining | Dedup profiles/settings/downloads |
| T240 | Consistent Logo Placement | Logo only on Projects screen |
| T241 | Annotate Arrow Key Seek | Forward/backward arrows seek 4s |
| T242 | Rename Project from Card | Inline rename on project card |
| T244 | Game Card Clip Statistics | Brilliant/good counts + composite score |
| T251 | Game View Progress Tracking | Watched duration, progress on game card |

---

## Pre-Deployment Features (All DONE)

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

---

## Earlier Completed

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

---

## Won't Do

| ID | Task | Reason |
|----|------|--------|
| T51 | Overlay Parallelization | Analysis showed parallel costs more |
| T52 | Annotate Parallelization | CPU-bound, won't help |
| T130 | Modal Production Workspace | Not needed - personal workspace is fine |
