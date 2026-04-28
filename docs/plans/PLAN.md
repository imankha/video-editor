# Project Plan

## Current Focus

**Phase: Bug fix** — T1540 is P0 data loss (clips lost during upload). Fix before resuming performance milestone.

**Landing Page:** Already live at `reelballers.com`

### Bug Fix (P0)

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T1100 | [Remove Dead Overlay Debounce](tasks/T1100-remove-dead-overlay-debounce.md) | 5 | 2 | P0 | DONE | [x] | Dead `saveOverlayData` with 2s debounce in OverlayContainer; remove + audit overlay persistence |
| T1540 | [Gesture Persistence During Upload](tasks/T1540-gesture-persistence-during-upload.md) | 9 | 5 | P0 | DONE | [ ] | Clips added during game upload are silently not saved — `annotateGameId` gate prevents all persistence until upload completes + game is created. User loses clips on navigation. |
| T1570 | [Admin Panel Missing Users](tasks/T1570-admin-panel-missing-users.md) | 5 | 3 | P1 | DONE | [ ] | Some users (e.g., sarkarati@gmail.com) don't appear in admin panel even though they exist in auth.sqlite |
| T1590 | [Admin Panel Data Accuracy](tasks/T1590-admin-panel-data-accuracy.md) | 5 | 4 | P2 | DONE | [ ] | Activity/quest/GPU stats wrong on staging/prod: admin endpoint reads local filesystem but user DBs only sync from R2 on user request. Display bug (0 shown as dash) fixed. |
| T1660 | [Framing Gesture Persistence](tasks/T1660-framing-gesture-persistence-audit.md) | 8 | 4 | P1 | DONE | [ ] | All framing gesture API calls are fire-and-forget with no error recovery. Deleted keyframes reappear on reload if backend rejects the delete. Also: delete/paste/split/detrim don't sync clip store. |
| | **[Post-Export Video Loading](tasks/post-export-video-loading/EPIC.md)** | | | | | | **Fix "video not loading" after framing export: broken proxy 206 + frontend race condition** |
| T1690 | ↳ [Video Stream Proxy Error Masking](tasks/post-export-video-loading/T1690-video-stream-proxy-error-masking.md) | 7 | 4 | P1 | DONE | [ ] | Stream proxies commit to 206+video/mp4 headers before R2 responds. R2 failures produce broken streams browser reports as "format not supported". Diagnostic logging added, needs deploy. |
| T1670 | ↳ [Overlay Stuck Loading After Export](tasks/post-export-video-loading/T1670-overlay-stuck-loading-after-framing-export.md) | 8 | 5 | P1 | DONE | [ ] | After framing export, overlay shows "Loading working video..." forever. Race between onProceedToOverlay and onExportComplete; retry path skips overlay transition; effect has dead zone with stable proxy URL. |
| T1710 | [Export R2 Sync Never Fires](tasks/T1710-export-r2-sync-never-fires.md) | 10 | 2 | P0 | DONE | [ ] | Duplicate `_sync_after_export` definition shadows working version; every export silently fails R2 sync. Framing data lost on machine restart. |
| T1720 | [Gallery Badge Count Clobbered](tasks/T1720-gallery-badge-count-clobbered.md) | 4 | 2 | P2 | DONE | [ ] | DownloadsPanel useEffect overwrites gallery store count with empty `downloads.length` on mount, clobbering fetchCount result. Badge shows 0 until panel opened. |
| T1870 | [Video Stream Cache-Control](tasks/T1870-video-stream-cache-control.md) | 6 | 2 | P1 | DONE | [ ] | Stream proxy responses missing `Cache-Control: no-store` — browser caches error responses (502/timeout), "Retry" button fails, user must hard-refresh |
| T1880 | [Video Load Error Diagnostics](tasks/T1880-video-load-error-diagnostics.md) | 5 | 3 | P2 | DONE | [ ] | "Video format not supported" error logs raw code but not HTTP status/content-type/body — can't distinguish server error page from actual codec issue |
| T1890 | [Multi-Clip Cache Warming](tasks/T1890-multiclip-cache-warming.md) | 7 | 4 | P1 | DONE | [ ] | FOREGROUND_ACTIVE latch kills warming worker before clips 2-5 are warmed; switching clips in multi-clip project causes 10-48s cold loads |

### Milestone: Performance (NEXT UP)

Ordered: instrumentation first so we can measure what we fix; then the two user-visible stalls we already traced; then the structural infra wins.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T1530 | [Comprehensive Profiling Strategy](tasks/T1530-comprehensive-profiling-strategy.md) | 8 | 5 | 1.6 | DONE | [ ] | Backend cProfile-on-breach + R2 call timing + frontend User Timing API for function-level attribution of slow requests. Backend landed T1531, frontend landed T1570. |
| T1531 | [Quests Achievement 60s Stall](tasks/T1531-quests-achievement-60s-stall.md) | 9 | 3 | 3.0 | DONE | [ ] | Achievement routes skip R2 sync entirely (SKIP_SYNC_PATHS). Frontend fire-and-forget already landed. |
| T1533 | [Overlay Working Video Slow First-Load](tasks/T1533-overlay-working-video-slow-load.md) | 7 | 3 | 2.0 | DONE | [ ] | Root cause was Chrome's Low-priority `<video>` defer (~15s `_blocked_queueing`), NOT moov placement. Fixed by `fetchpriority="high"` on VideoPlayer + fetch-based metadata extractor (bypasses video-element defer entirely). Desktop verified via HAR. |
| T1535 | [Mobile Video Load Verify](tasks/T1535-mobile-video-load-verify.md) | 7 | 2 | 2.0 | DONE | [ ] | Verified on Chrome Android (1.7Mbps 4G): time-to-first-frame 2.0s, metadata fetch 716ms (moov at head), no 15s stall. Metadata extractor + video element run concurrently. No iOS Safari device available. |
| T1539 | [R2 Concurrent-Write Rate Limit](tasks/T1539-r2-concurrent-write-rate-limit.md) | 7 | 2 | 3.5 | DONE | [ ] | Per-user per-key upload lock (`threading.Lock`) inside `sync_database_to_r2_with_version` and `sync_user_db_to_r2_with_version` serializes PutObject calls. Prevents export worker vs middleware sync race (the actual 429 source -- not request-to-request races, which the asyncio write lock already prevents). tryLock optimization skips redundant retry_pending_sync when upload already in progress. |
| T1538 | [Per-Resource Locks](tasks/T1538-per-resource-locks.md) | 4 | 4 | 1.0 | DONE | [ ] | T1539 shipped the R2 push lock; remaining handler-level parallelism gated on `[WRITE_LOCK_WAIT]` evidence that hasn't materialized. |

---

## Priority Policy

**Bugs are always the first priority, especially infrastructure bugs (sync, data integrity, schema).** New features and structural changes should not begin until known bugs are resolved. The order is:

1. **Infrastructure bugs** - Sync failures, data loss, orphaned records, schema issues
2. **Test failures** - Broken tests indicate regressions; fix before adding more code
3. **UI/UX bugs** - Visible issues that affect the user experience
4. **Pre-deployment blockers** - Structural changes (T85) that must happen before real users
5. **New features** - Only after the above are clear

**Bug prioritization within a tier:** Rank by **infrastructure depth** — the deeper the bug (more systems depend on the affected layer), the higher the priority. A silent sync failure is worse than a slow sync, which is worse than a broken test.

When suggesting the next task, always check the Bug Fix Sprint section first. Do not recommend feature work while bugs remain open.

### Epic Prioritization

**Epics compete with other epics and standalone tasks at the milestone level.** Each epic gets aggregate Impact/Complexity/Priority scores based on the collective value and effort of its tasks.

- **Milestone level:** Epics and standalone tasks are ordered by Priority (Impact / Complexity). Higher priority = do first.
- **Within-epic level:** Tasks are ordered by **dependency** — foundational layers first, since all tasks in an epic touch similar code. DB/model changes before API, API before UI.
- **Impact over complexity:** When prioritizing within a milestone, favor high-impact work even if it's harder. The priority formula (Impact / Complexity) naturally rewards this.

---

## Completed Tasks

See [DONE.md](DONE.md) for all completed, superseded, and won't-do tasks.

---

### Epic: Auth Integrity (IN_PROGRESS) -- BUG FIX
[tasks/auth-integrity/EPIC.md](tasks/auth-integrity/EPIC.md)

Goal: Eliminate orphaned accounts by removing guest accounts entirely. Users must sign in (Google or OTP) before using the app.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T1270 | [Cookie Path + SameSite Fix](tasks/auth-integrity/T1270-cookie-path-fix.md) | 9 | 1 | 9.0 | DONE | [ ] | Add `path="/"` to cookies, fix SameSite to `lax` |
| T1290 | [Auth DB Restore Must Succeed](tasks/auth-integrity/T1290-auth-db-restore-must-succeed.md) | 9 | 4 | 2.3 | DONE | [ ] | Fail startup if auth.sqlite can't restore from R2 |
| T1330 | [Remove Guest Accounts](tasks/auth-integrity/T1330-remove-guest-accounts.md) | 10 | 6 | 1.7 | DONE | [x] | Shipped earlier — init-guest + migration helpers removed; tests/test_auth_no_guest.py guards the removal |

### For Alpha - Infrastructure

Scale, reliability, and data format changes that must land before alpha users arrive.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| | **[Session Reliability Epic](tasks/session-reliability/EPIC.md)** | 9 | 5 | 1.8 | | | **Sessions survive deploys and route to correct machine** |
| T1195 | ↳ [Session Durability on Deploy](tasks/session-reliability/T1195-session-durability-on-deploy.md) | 8 | 3 | 2.7 | TESTING | [ ] | Persist sessions as individual R2 objects on login so sessions survive machine restarts (scales independently of auth.sqlite size) |
| T1190 | ↳ [Session & Machine Pinning](tasks/for-launch/T1190-session-machine-pinning.md) | 9 | 6 | 1.5 | TODO | [x] | Pin sessions to machines via fly-replay; includes session expiry (absorbs T420) |
| T1180 | [Binary Data Format](tasks/for-launch/T1180-binary-data-format.md) | 3 | 4 | 0.8 | TODO | [x] | Replace JSON columns with MessagePack for ~30-50% size reduction |

### Epic: For Alpha (IN_PROGRESS)
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T1950 | [Rename Reels/Gallery Terminology](tasks/for-alpha/T1950-rename-reels-gallery-terminology.md) | 6 | 2 | 3.0 | TESTING | [ ] | Rename "Reels" → "Reel Drafts" and "Gallery" → "My Reels" across all UI to clarify that finished reels move to a final collection |
| T1940 | [Remove Redundant Progress Bars](tasks/for-alpha/T1940-remove-redundant-progress-bars.md) | 6 | 2 | 3.0 | TESTING | [ ] | Upload progress shown in 3 places. Remove from annotate, framing, overlay main UIs. Keep in toasts and on project cards only. |
| T1900 | [Explicit Create Reel Toggle](tasks/for-alpha/T1900-explicit-create-project-toggle.md) | 7 | 3 | 2.3 | DONE | [x] | Replace auto-5-star reel creation with explicit "Create Reel" toggle in add clip dialog. Defaults ON for 5-star, OFF for others. Disabled once reel exists. |
| | **[Core Sharing Epic](tasks/sharing/EPIC.md)** | 8 | 4 | 1.9 | | | **End-to-end share loop: create share, send link, recipient watches** |
| T1750 | ↳ [Share Backend Model & API](tasks/sharing/T1750-share-backend-model.md) | 8 | 4 | 2.0 | TODO | [x] | shared_videos table, CRUD storage ops, share/revoke/list/toggle-visibility endpoints. Foundation for all sharing tasks. |
| T1770 | ↳ [Gallery Share UI](tasks/sharing/T1770-gallery-share-ui.md) | 8 | 4 | 2.0 | TODO | [ ] | Share modal: email input, public/private visibility toggle, copy link, "People with access" list |
| T1780 | ↳ [Shared Video Player Page](tasks/sharing/T1780-shared-video-page.md) | 8 | 5 | 1.6 | TODO | [ ] | /shared/:shareToken route — public links play immediately; private links show auth gate with email pre-fill |
| | **[Share Engagement Epic](tasks/sharing/EPIC.md)** | 6 | 3 | 1.8 | | | **Recipient discovery, email notifications, watch tracking — polish on core sharing** |
| T1800 | ↳ [User Picker Component](tasks/sharing/T1800-user-picker-component.md) | 6 | 3 | 2.0 | TODO | [ ] | Email autocomplete from prior shares, account lookup (green/yellow). Upgrades core share modal input. |
| T1760 | ↳ [Share Email Delivery](tasks/sharing/T1760-share-email-delivery.md) | 7 | 3 | 2.3 | TODO | [ ] | Resend integration for share emails (reused by player tagging); fire-and-forget |
| T1790 | ↳ [Watch Tracking & Share Status](tasks/sharing/T1790-watch-tracking-share-status.md) | 6 | 4 | 1.5 | TODO | [ ] | Watched event on play, share status panel on gallery cards per recipient |
| | **[Storage Credits Epic](tasks/storage-credits/EPIC.md)** | 10 | 5 | 2.0 | | | **Gates virality -- every shared/invited user adds unmetered R2 cost without this. Must ship before sharing goes live.** |
| T1580 | ↳ [Game Storage Credits](tasks/storage-credits/T1580-game-storage-credits.md) | 10 | 5 | 2.0 | TODO | [x] | Size-based upload cost, 30-day expiry, 8cr new accounts |
| T1581 | ↳ [Storage Extension UX](tasks/storage-credits/T1581-storage-extension-ux.md) | 9 | 4 | 2.3 | TODO | [x] | ExpirationBadge on game cards + date-slider extension modal |
| | **[Athlete Profile Epic](tasks/athlete-profile/EPIC.md)** | 6 | 4 | 1.5 | | | **Profile stores athlete name, team name, sport. Sport drives annotation tags.** |
| T1610 | ↳ [Profile Fields](tasks/athlete-profile/T1610-profile-fields.md) | 6 | 3 | 2.0 | TODO | [x] | DB schema: athlete_name, team_name, sport + profile UI. Foundation for T1620/T1630. (Absorbs T1073) |
| T1620 | ↳ [Sport-Specific Tag Definitions](tasks/athlete-profile/T1620-sport-specific-tag-definitions.md) | 5 | 3 | 1.7 | TODO | [ ] | Research and define position categories + tags for Football, Basketball, Lacrosse, Rugby |
| T1630 | ↳ [Sport-Driven Tag Selection](tasks/athlete-profile/T1630-sport-driven-tag-selection.md) | 6 | 4 | 1.5 | TODO | [ ] | Annotation UI loads tags based on active profile's sport instead of hardcoded soccer tags |
| T1040 | [Force Login on Add Game](tasks/for-alpha/T1040-force-login-add-game.md) | 7 | 2 | 3.5 | DONE | [ ] | Guest clicks "Add Game" -> auth gate appears first; ensures persistent identity before investing effort |
| T1030 | [Quest UI Relocation](tasks/for-alpha/T1030-quest-ui-relocation.md) | 6 | 3 | 2.0 | DONE | [ ] | Move quest panel out of floating overlay into dedicated area; currently covers controls user needs (e.g., playback button for Q1S3) |
| T980 | [Clip-Scoped Scrub Bar](tasks/T980-clip-scoped-scrub-playback.md) | 4 | 3 | 1.3 | DONE | [ ] | In Play Annotations mode, add a per-clip scrub bar so users can seek within each clip |
| T1390 | [Rename Projects to Reels](tasks/for-alpha/T1390-rename-projects-to-reels.md) | 6 | 2 | 3.0 | DONE | [ ] | Users understood "Games" but not "Projects" -- rename to "Reels" (UI labels only) |
| T1400 | [Framing Keyframe Dedup](tasks/for-alpha/T1400-framing-keyframe-dedup.md) | 6 | 2 | 3.0 | DONE | [x] | Snap to nearby keyframe within MIN_KEYFRAME_SPACING instead of creating duplicates |
| T1520 | [Export Disconnect/Retry UX](tasks/for-alpha/T1520-export-disconnect-retry-ux.md) | 7 | 3 | 2.3 | DONE | [ ] | Misclassifies WS disconnect as "Export failed"; add retry button and reconcile with Modal job state on reconnect |
| T1650 | [Report a Problem Button](tasks/T1650-report-problem-button.md) | 5 | 3 | 1.8 | DONE | [ ] | "Report a problem" button on auth modal sends browser console errors/warnings + user agent to all admins via Resend |
| T1660 | [Export Failure Card State](tasks/for-alpha/T1660-export-failure-card-state.md) | 3 | 3 | 1.0 | DONE | [ ] | After export fails, project card reverts to blue "Editing" with no failure indication; add distinct failed state to progress strip |
| T1600 | [Mobile Responsive](tasks/for-alpha/T1600-mobile-responsive.md) | 4 | 3 | 1.3 | DONE | [ ] | Make all screens work on mobile (360-428px); move new user flow below the fold on mobile so users scroll to it |
| T1140 | [Production Deploy Script](tasks/T1140-production-deploy-script.md) | 6 | 3 | 2.0 | DONE | [ ] | Single command to deploy frontend/backend to production with pre-flight checks and health verification |
| T1510 | [Admin Impersonate User](tasks/T1510-admin-impersonate-user.md) | 5 | 2 | 2.5 | DONE | [ ] | Clickable email in admin user list -> "login as user" session with banner, audit log, reversible stop. Unblocks support debugging |
| T1640 | [Archive on Approve](tasks/T1640-archive-on-approve.md) | 4 | 3 | 1.3 | DONE | [ ] | Auto-archive completed projects on login; default to Framing when opening completed reels |
| T1550 | [Unified Navigation](tasks/T1550-unified-mode-navigation.md) | 6 | 3 | 2.0 | DONE | [ ] | Clickable breadcrumbs (Games/Reels -> Home), unified 3-mode tab bar (Annotate/Framing/Overlay), single shared header component |
| T1532 | [Working Clips Deleted After Restart](tasks/T1532-working-clips-deleted-after-restart.md) | 4 | 3 | 1.3 | DONE | [ ] | Fixed: added project_id to PARTITION BY in latest_working_clips_subquery + regression test covering cross-project shared raw_clip. |
| T1534 | [Overlay Render Broken Pipe at Frame 299](tasks/T1534-overlay-render-broken-pipe.md) | 6 | 2 | 3.0 | DONE | [ ] | Fixed: removed `-shortest` from overlay ffmpeg cmd. Mixed-audio concat caused audio (~8s) to truncate output below video length (24s), ffmpeg exited mid-stdin -> BrokenPipe. |

### Epic: Video Load Reliability (IN_PROGRESS) -- BUG FIX
[tasks/video-load-reliability/EPIC.md](tasks/video-load-reliability/EPIC.md)

Goal: Robust video loading — no misleading format errors, no oversized preloads, no CORS spam. Ordered by severity to user experience. Orchestrator-driven; each task gets its own branch and merges only after its before/after test proves effectiveness.

| ID | Task | Status | Pri | Migr | Description |
|----|------|--------|-----|------|-------------|
| T1360 | [Blob URL Error Recovery](tasks/video-load-reliability/T1360-blob-url-error-recovery.md) | DONE | 4.0 | [ ] | Stale blob URL auto-recovers to streaming URL; no misleading "Video format not supported" overlay |
| T1370 | [Blob Preload Size Gate + Unmount Safety](tasks/video-load-reliability/T1370-blob-preload-size-gate.md) | OBSOLETE | 3.5 | [ ] | 200MB gate on T1262 preload; AbortController + revoke on unmount -- removes root cause of T1360 recurrence |
| T1350 | [Cache Warming CORS Cleanup](tasks/video-load-reliability/T1350-cache-warming-cors-fix.md) | DONE | 3.0 | [ ] | Switch warmUrl to `no-cors`; eliminates console spam on every page load |
| T1400 | [Video Load Contention](tasks/video-load-reliability/T1400-video-load-contention.md) | DONE | 4.5 | [ ] | Narrowed post-T1410: range-fallback watchdog + `[VIDEO_LOAD]` structured logs for prod measurement |
| T1410 | [Video Load Regression Since 04-08](tasks/video-load-reliability/T1410-video-load-regression-since-0408.md) | DONE | 5.0 | [ ] | Warmer aborts on foreground load, StrictMode dedup -- 35-56s -> ~400-950ms cold load |
| T1420 | [Warmup Abort Polish](tasks/video-load-reliability/T1420-warmup-polish.md) | DONE | 2.0 | [ ] | Silence AbortError-as-failure log; dedupe StrictMode double-invoke of init load |
| T1430 | [Range Overbuffer (2151s for 8s clip)](tasks/video-load-reliability/T1430-range-overbuffer.md) | DONE | 1.5 | [ ] | Observability + two-window proxy: cold 20.5s->2.0s, warm 2.2s->0.6s; Step 3 MSE unnecessary |
| T1440 | [Trace multi-video games fail in framing](tasks/video-load-reliability/T1440-trace-multi-video-games.md) | DONE | 1.0 | [ ] | Clips endpoint joined only `games` for blake3_hash; multi-video games store it per-sequence in `game_videos` -> `game_video_url` null -> framing 404 |
| T1450 | [Trace load parity via R2 faststart migration](tasks/video-load-reliability/T1450-trace-load-parity.md) | DONE | 1.5 | [x] | One-shot `ffmpeg -movflags +faststart` rewrite of 13 moov-at-end games on R2; all verified faststart; Trace load 3.2s->2.95s (remaining gap to Veo parity tracked in T1460) |
| T1470 | [R2 objects missing Content-Type](tasks/video-load-reliability/T1470-r2-content-type-missing.md) | DONE | 4.0 | [x] | `CopyObject`-stamp ContentType=video/mp4 on all `games/*.mp4`; fix faststart script to preserve header. Staging: 22/23 migrated |
| T1460 | [Warm-path parity + faststart route choice](tasks/video-load-reliability/T1460-warm-path-parity-faststart.md) | DONE | 1.5 | [ ] | Move direct-vs-proxy decision into `useVideo` so freshest warm state wins; `warm_status` keyed on R2 URL; backend warmup payload includes `clip.id`; `?direct=1` A/B flag for faststart route measurement |
| T1480 | [cacheWarming test asserts stale fetch count](tasks/T1480-cachewarming-test-stale-fetch-count.md) | DONE | 4.0 | [ ] | Pre-existing: T1410 test expects 1 fetch but warmClipRange fires 2 (head-prewarm + body) since T1430. Assertion needs updating. Found during T1460 |
| T1490 | [First clip-stream request returns 401, frontend hangs](tasks/T1490-video-stream-first-request-401.md) | DONE | 5.0 | [ ] | Fix: crossOrigin=use-credentials on same-origin proxy URLs in detached video probe; cacheWarming fetches branched on origin. Backend log confirmed zero 401s on /stream |
| T1500 | [Persist clip dimensions, eliminate metadata probe](tasks/video-load-reliability/T1500-persist-clip-dimensions.md) | DONE | 2.5 | [x] | Follow-up to T1490: persist width/height/fps on working_clips, backfill existing rows, skip frontend metadata probe when fields present. Removes N media probes per project load |

### Epic: For Launch (IN_PROGRESS)
[tasks/for-launch/EPIC.md](tasks/for-launch/EPIC.md)

Goal: Make money, virality, super polished. Most tasks here are yet to be generated based on alpha feedback.

#### Infrastructure (prioritized first)

Scale, performance, and reliability — must be solid before feature work.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T1210 | [Clip-Scoped Video Loading](tasks/for-launch/T1210-clip-scoped-video-loading.md) | 7 | 4 | 1.8 | DONE | [ ] | Framing loads full 90-min video; preload on project creation, only buffer clip time ranges |
| T1260 | [Video Seek Optimization](tasks/for-launch/T1260-video-seek-optimization.md) | 8 | 5 | 1.6 | ICE | [ ] | Epic on ice 2026-04-12 -- T1380 shipped the big win (TTFP seconds->359ms). Revisit only if users report seek problems. |
| T1261 | [Seek Perf Instrumentation](tasks/for-launch/T1261-seek-perf-instrumentation.md) | 8 | 2 | 4.0 | ICE | [ ] | Parent epic on ice. |
| T1262 | [Service Worker Video Cache](tasks/for-launch/T1262-service-worker-video-cache.md) | 8 | 4 | 2.0 | ICE | [ ] | Parent epic on ice. |
| T1263 | [SW Quota Management](tasks/for-launch/T1263-sw-quota-management.md) | 5 | 2 | 2.5 | ICE | [ ] | Parent epic on ice. |
| T1264 | [Moov Atom Parsing](tasks/for-launch/T1264-moov-atom-parsing.md) | 6 | 3 | 2.0 | ICE | [ ] | Parent epic on ice. |
| T1265 | [Predictive Prefetch](tasks/for-launch/T1265-predictive-prefetch.md) | 6 | 3 | 2.0 | ICE | [ ] | Parent epic on ice. |
| T1380 | [Upload Moov Faststart](tasks/for-launch/T1380-upload-moov-faststart.md) | 7 | 3 | 2.3 | DONE | [ ] | Client-side moov relocation on upload; TTFP ~seconds->359ms, seek network 6-16ms (moov no longer bottleneck) |
| T1385 | [Decode-Phase Seek Optimization](tasks/for-launch/T1385-decode-phase-seek-optimization.md) | 6 | 5 | 1.2 | ICE | [ ] | Parent epic on ice. |
| T1220 | [Modal Range Requests](tasks/for-launch/T1220-modal-range-requests.md) | 7 | 5 | 1.4 | DONE | [ ] | Modal downloads full 3GB video for 10s clip; use presigned URLs + FFmpeg pre-input seek |
| T1221 | [Dead Modal Code Removal](tasks/for-launch/T1221-dead-modal-code-removal.md) | 3 | 2 | 1.5 | DONE | [ ] | Delete extract_clip_modal, process_multi_clip_modal, create_annotated_compilation -- no callers (follow-up from T1220 audit) |
| T1222 | [game_videos JOIN Audit](tasks/for-launch/T1222-game-videos-join-audit.md) | 5 | 3 | 1.7 | DONE | [ ] | Multi-video games have NULL games.blake3_hash; audit storage.py/games_upload.py/other exporters to JOIN game_videos instead |
| | **[Export Pipeline](tasks/export-pipeline/EPIC.md)** | 5 | 4 | 1.3 | | | **Non-blocking I/O + unify single/multi-clip export paths** |
| T1110 | ↳ [Non-Blocking Export I/O](tasks/export-pipeline/T1110-never-block-server.md) | 5 | 3 | 1.0 | DONE | [ ] | Wrap sync subprocess/R2 calls in `asyncio.to_thread()` — Modal calls already async, surrounding I/O blocks event loop |
| T1116 | ↳ [Extract Shared Pipeline](tasks/export-pipeline/T1116-extract-shared-pipeline.md) | 4 | 4 | 1.0 | DONE | [ ] | Extract `_export_clips()` + `ClipExportData` from multi_clip.py; `export_multi_clip` becomes thin adapter. No behavior change. |
| T1117 | ↳ [Route Single-Clip Through Pipeline](tasks/export-pipeline/T1117-route-single-clip.md) | 4 | 5 | 0.8 | DONE | [ ] | `render_project` delegates to `_export_clips([clip])`. Delete 800 lines of duplicated logic. Unify response shapes. |
| T1240 | [R2 Restore Retry Tests](tasks/T1240-r2-restore-retry-tests.md) | 5 | 2 | 2.3 | DONE | [x] | Test coverage for R2 restore retry/cooldown -- NOT_FOUND vs ERROR handling, cooldown expiry |
| T1700 | [Harden Analytics](tasks/for-launch/T1700-harden-analytics.md) | 6 | 4 | 1.5 | TODO | [ ] | Audit and harden analytics pipeline: ensure events are reliably captured, stored, and queryable; add missing instrumentation for key user flows |
| T1730 | [Performance Optimization Pass](tasks/for-launch/T1730-performance-optimization-pass.md) | 7 | 5 | 1.4 | TODO | [ ] | Pre-launch audit: slow endpoints, UI jank, bundle size, slow queries, unnecessary R2 round-trips |
| T1740 | [Privacy & Regulatory Compliance](tasks/for-launch/T1740-privacy-regulatory-compliance.md) | 10 | 6 | 1.7 | TODO | [ ] | Privacy policy, ToS, COPPA/CCPA/CalOPPA compliance, age verification, consumer rights (data export/deletion), vendor DPAs, incident response plan. No biometric processing — BIPA/CUBI not applicable. Must ship before launch. |
| T1960 | [Migrate Auth to Fly Postgres](tasks/for-launch/T1960-migrate-auth-to-fly-postgres.md) | 8 | 6 | 1.3 | TODO | [ ] | Move auth.sqlite (users, sessions, otp_codes, admin) to Fly Postgres. Eliminates restart fragility, concurrent write contention, and O(users) R2 syncs. Makes T1195 unnecessary. |

#### Features

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T1080 | [Gallery Player Scrub Controls](tasks/for-launch/T1080-gallery-player-scrub-controls.md) | 6 | 3 | 2.0 | DONE | [ ] | Scrub/seek controls in gallery video player are non-functional; users can't seek through exported videos |
| T440 | [Progressive Web App](tasks/T440-progressive-web-app.md) | 6 | 3 | 2.0 | TODO | [ ] | "Install app" prompt, offline shell, home screen icon -- feels native on phones |
| | **[Player Tagging & Team Sharing](tasks/sharing/EPIC.md)** | 8 | 6 | 1.3 | | | **Player tagging, team game sharing, cross-user clip delivery** |
| T1810 | ↳ [Player Tag Data Model & API](tasks/sharing/T1810-player-tag-data-model.md) | 7 | 3 | 2.3 | TODO | [x] | clip_player_tags table, CRUD endpoints, player tags on clips by email |
| T1820 | ↳ [Annotation Player Tagging UI](tasks/sharing/T1820-annotation-player-tagging-ui.md) | 8 | 4 | 2.0 | TODO | [ ] | "Players" section in add clip dialog; auto-tag for 4+ star; UserPicker for teammates |
| T1830 | ↳ [Shared Content Inbox & Claim](tasks/sharing/T1830-shared-content-inbox.md) | 8 | 5 | 1.6 | TODO | [x] | pending_shares in auth.sqlite, inbox UI, profile picker with per-sharer default |
| T1840 | ↳ [Cross-User Clip Delivery](tasks/sharing/T1840-cross-user-clip-delivery.md) | 9 | 5 | 1.8 | TODO | [ ] | Player tag → pending share → email → claim → materialize game+clip in recipient DB |
| T1850 | ↳ [Share Game with Team](tasks/sharing/T1850-share-game-with-team.md) | 8 | 4 | 2.0 | TODO | [ ] | "Share with Team" on game cards, game materialization on claim |
| T1860 | ↳ [Reel Creation Player Filter](tasks/sharing/T1860-reel-creation-player-filter.md) | 7 | 3 | 2.3 | TODO | [ ] | Player filter in GameClipSelectorModal; user's athlete default; OR logic |
| T1910 | [Tutorial Video](tasks/for-launch/T1910-tutorial-video.md) | 8 | 3 | 2.7 | TODO | [ ] | Record walkthrough video: upload game, annotate clips, frame, overlay, export. Embeddable on landing page and in-app onboarding. |
| T1920 | [Landing Page Update](tasks/for-launch/T1920-landing-page-update.md) | 7 | 3 | 2.3 | TODO | [ ] | Add tutorial video embed and PWA install link to reelballers.com landing page. Depends on T1910 (tutorial) and T440 (PWA). |
| T1090 | [Social Media Auto-Posting](tasks/for-launch/T1090-social-media-auto-posting.md) | 4 | 4 | 1.1 | TODO | [ ] | "Share to Social" from gallery -- one form posts to IG, TikTok, YouTube, FB via aggregator API |

#### Completed

- T1150 Fix Pending Sync Retry No-Op — DONE
- T1152 Persist Sync-Failed State — DONE
- T1160 Clean Up Unused DB Rows — DONE
- T1170 Size-Based VACUUM on Init — DONE
- T1180 Fix NULL video_filename Root Cause — DONE
- T1200 Modal Job ID Logging & Retry — DONE
- T1380 Recover Orphaned Jobs Per-User at Startup — DONE
- T1390 Process Modal Queue Per-User at Startup — DONE
- T1130 Multi-Clip Stream Not Download — DONE
- T1120 Framing Video Cold Cache — DONE
- T1020 Fast R2 Sync — DONE
- T1010 Slow fetchProgress Response -- DONE

### Milestone: Marketing

Target audience: highly engaged soccer parents with enough technical ability to use the app. Reach them where they already spend attention.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|----|------|--------|-------|-----|--------|------|-------------|
| T445 | [Vehicle Window Cards](tasks/T445-business-cards.md) | 6 | 2 | 3.0 | TODO | [ ] | Design + print cards to place on vehicle windows at games promoting reelballers.com with QR code. Targets parents already at the field. |
| T1930 | [Influencer Marketing](tasks/marketing/T1930-influencer-marketing.md) | 8 | 4 | 2.0 | TODO | [ ] | Identify top influencers that youth soccer parents follow who align with video technology use. Outreach strategy + partnership plan. |

### Epic: Post Launch (TODO)
[tasks/post-launch/EPIC.md](tasks/post-launch/EPIC.md)

Improvements after real user traffic.

| ID | Task | Status | Pri | Migr | Description |
|----|------|--------|-----|------|-------------|
| T40 | [1 User 2 Tabs](tasks/T40-stale-session-detection.md) | TODO | 1.3 | [ ] | If two tabs edit the same data, second tab's save overwrites the first; detect and warn |
| T710 | [Share with Coach](tasks/post-launch/T710-share-with-coach.md) | TODO | 1.2 | [x] | Coach account type + sharing: roster uploads, assign annotations to players, clip ratings, notes, send-back flow. Absorbs T1060 (Coaches View) |
| T720 | [Art Frames](tasks/T720-art-frames.md) | TODO | 1.1 | [x] | Draw on frozen clip frames (like a telestrator); shown during Play Annotations with a pause |

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

## Task ID Reference

IDs use gaps of 10 to allow insertions:
- `T10-T79` - Feature tasks (complete)
- `T80-T99` - Pre-deployment blockers + bug fix sprint
- `T100-T199` - Deployment epic
- `T200-T299` - Post-launch features + polish
- `T400-T430` - User Auth epic (T400=Google, T401=OTP, T405=D1, T420=sessions, T430=settings)
- `T500-T525` - Monetization epic

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
