# Project Plan

## Current Focus

**Phase: Bug fix** — T1540 is P0 data loss (clips lost during upload). Fix before resuming performance milestone.

**Landing Page:** Already live at `reelballers.com`

### Bug Fix (P0)

| ID | Task | Impact | Cmplx | Pri | Status | Description |
|----|------|--------|-------|-----|--------|-------------|
| T1540 | [Gesture Persistence During Upload](tasks/T1540-gesture-persistence-during-upload.md) | 9 | 5 | P0 | TODO | Clips added during game upload are silently not saved — `annotateGameId` gate prevents all persistence until upload completes + game is created. User loses clips on navigation. |

### Milestone: Performance (NEXT UP)

Ordered: instrumentation first so we can measure what we fix; then the two user-visible stalls we already traced; then the structural infra wins.

| ID | Task | Impact | Cmplx | Pri | Status | Description |
|----|------|--------|-------|-----|--------|-------------|
| T1530 | [Comprehensive Profiling Strategy](tasks/T1530-comprehensive-profiling-strategy.md) | 8 | 5 | 1.6 | TODO | Backend cProfile-on-breach + R2 call timing + frontend User Timing API for function-level attribution of slow requests. **Do first — unblocks measurement for the rest.** |
| T1531 | [Quests Achievement 60s Stall](tasks/T1531-quests-achievement-60s-stall.md) | 9 | 3 | 3.0 | TODO | `POST /achievements/opened_framing_editor` took 60.65s handler, blocked `GET /projects/4` via per-user serializer — user-visible freeze on reel load |
| T1533 | [Overlay Working Video Slow First-Load](tasks/T1533-overlay-working-video-slow-load.md) | 7 | 3 | 2.0 | TESTING | Root cause was Chrome's Low-priority `<video>` defer (~15s `_blocked_queueing`), NOT moov placement. Fixed by `fetchpriority="high"` on VideoPlayer + fetch-based metadata extractor (bypasses video-element defer entirely). Desktop verified via HAR. |
| T1535 | [Mobile Video Load Verify](tasks/T1535-mobile-video-load-verify.md) | 7 | 2 | 2.0 | TODO | After staging push, verify T1533 fix holds on iOS Safari + Chrome Android — Priority Hints behave differently on mobile browsers. Fallback plan if regression: drop hidden extractor on mobile (T1500 persists dims). |
| T1539 | [R2 Concurrent-Write Rate Limit](tasks/T1539-r2-concurrent-write-rate-limit.md) | 7 | ? | ? | TODO | Cloudflare R2 returns 429 ("reduce concurrent request rate for the same object") when concurrent PutObjects hit the same `profile.sqlite` key, putting the user in degraded state. Must solve **without** breaking the gesture-based persistence paradigm (no debouncing, no batching, no background-only sync). Explore per-resource locks (T1538) and other approaches. |
| T1538 | [Per-Resource Locks](tasks/T1538-per-resource-locks.md) | 4 | 6 | 0.7 | TODO | Finer-grained writer serialization — writers to disjoint tables don't block each other. Built on T1531; gated on real `[WRITE_LOCK_WAIT]` evidence. May intersect T1539. |
| T1190 | [Session & Machine Pinning](tasks/for-launch/T1190-session-machine-pinning.md) | 9 | 6 | 1.5 | TODO | Pin sessions to machines via fly-replay; eliminates cold-DB-restore cost on every cross-machine request |
| T1110 | [Never Block Server on Export](tasks/for-launch/T1110-never-block-server.md) | 5 | 5 | 1.0 | TODO | Modal path is synchronous (async but holds connection); return 202 + background task so server stays responsive during exports |
| T1560 | [Fetch-First Video Loading](tasks/T1560-fetch-first-video-loading.md) | 8 | 4 | 2.0 | TODO | Use fetch() for initial video chunk to bypass Chrome's 15s media scheduler defer on cross-origin R2 videos in Annotate mode |
| T230 | [Pre-warm R2 on Login](tasks/T230-prewarm-r2-on-login.md) | 6 | 2 | 1.3 | TODO | Start downloading game videos from R2 as soon as user logs in, so they load instantly later |
| T1180 | [Binary Data Format](tasks/for-launch/T1180-binary-data-format.md) | 3 | 4 | 0.8 | TODO | Replace JSON columns with MessagePack for ~30-50% size reduction |

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

---

## Completed Tasks

See [DONE.md](DONE.md) for all completed, superseded, and won't-do tasks.

---

### Epic: Auth Integrity (IN_PROGRESS) -- BUG FIX
[tasks/auth-integrity/EPIC.md](tasks/auth-integrity/EPIC.md)

Goal: Eliminate orphaned accounts by removing guest accounts entirely. Users must sign in (Google or OTP) before using the app.

| ID | Task | Impact | Cmplx | Pri | Status | Description |
|----|------|--------|-------|-----|--------|-------------|
| T1270 | [Cookie Path + SameSite Fix](tasks/auth-integrity/T1270-cookie-path-fix.md) | 9 | 1 | 9.0 | DONE | Add `path="/"` to cookies, fix SameSite to `lax` |
| T1290 | [Auth DB Restore Must Succeed](tasks/auth-integrity/T1290-auth-db-restore-must-succeed.md) | 9 | 4 | 2.3 | DONE | Fail startup if auth.sqlite can't restore from R2 |
| T1330 | [Remove Guest Accounts](tasks/auth-integrity/T1330-remove-guest-accounts.md) | 10 | 6 | 1.7 | DONE | Shipped earlier — init-guest + migration helpers removed; tests/test_auth_no_guest.py guards the removal |

### Epic: For Alpha (IN_PROGRESS)
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1040 | [Force Login on Add Game](tasks/for-alpha/T1040-force-login-add-game.md) | DONE | 3.5 | Guest clicks "Add Game" -> auth gate appears first; ensures persistent identity before investing effort |
| T1030 | [Quest UI Relocation](tasks/for-alpha/T1030-quest-ui-relocation.md) | DONE | 2.0 | Move quest panel out of floating overlay into dedicated area; currently covers controls user needs (e.g., playback button for Q1S3) |
| T980 | [Clip-Scoped Scrub Bar](tasks/T980-clip-scoped-scrub-playback.md) | DONE | 1.3 | In Play Annotations mode, add a per-clip scrub bar so users can seek within each clip |
| T1390 | [Rename Projects to Reels](tasks/for-alpha/T1390-rename-projects-to-reels.md) | DONE | 3.0 | Users understood "Games" but not "Projects" — rename to "Reels" (UI labels only) |
| T1400 | [Framing Keyframe Dedup](tasks/for-alpha/T1400-framing-keyframe-dedup.md) | TODO | 3.0 | Snap to nearby keyframe within MIN_KEYFRAME_SPACING instead of creating duplicates |
| T1520 | [Export Disconnect/Retry UX](tasks/for-alpha/T1520-export-disconnect-retry-ux.md) | TODO | 2.3 | Misclassifies WS disconnect as "Export failed"; add retry button and reconcile with Modal job state on reconnect |
| T1550 | [Unified Navigation](tasks/T1550-unified-mode-navigation.md) | TODO | 2.0 | Clickable breadcrumbs (Games/Reels → Home), unified 3-mode tab bar (Annotate/Framing/Overlay), single shared header component |
| T1532 | [Working Clips Deleted After Restart](tasks/T1532-working-clips-deleted-after-restart.md) | DONE | 1.3 | Fixed: added project_id to PARTITION BY in latest_working_clips_subquery + regression test covering cross-project shared raw_clip. |
| T1534 | [Overlay Render Broken Pipe at Frame 299](tasks/T1534-overlay-render-broken-pipe.md) | DONE | 3.0 | Fixed: removed `-shortest` from overlay ffmpeg cmd. Mixed-audio concat caused audio (~8s) to truncate output below video length (24s), ffmpeg exited mid-stdin → BrokenPipe. |

### Epic: Video Load Reliability (IN_PROGRESS) -- BUG FIX
[tasks/video-load-reliability/EPIC.md](tasks/video-load-reliability/EPIC.md)

Goal: Robust video loading — no misleading format errors, no oversized preloads, no CORS spam. Ordered by severity to user experience. Orchestrator-driven; each task gets its own branch and merges only after its before/after test proves effectiveness.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1360 | [Blob URL Error Recovery](tasks/video-load-reliability/T1360-blob-url-error-recovery.md) | DONE | 4.0 | Stale blob URL auto-recovers to streaming URL; no misleading "Video format not supported" overlay |
| T1370 | [Blob Preload Size Gate + Unmount Safety](tasks/video-load-reliability/T1370-blob-preload-size-gate.md) | OBSOLETE | 3.5 | 200MB gate on T1262 preload; AbortController + revoke on unmount — removes root cause of T1360 recurrence |
| T1350 | [Cache Warming CORS Cleanup](tasks/video-load-reliability/T1350-cache-warming-cors-fix.md) | DONE | 3.0 | Switch warmUrl to `no-cors`; eliminates console spam on every page load |
| T1400 | [Video Load Contention](tasks/video-load-reliability/T1400-video-load-contention.md) | DONE | 4.5 | Narrowed post-T1410: range-fallback watchdog + `[VIDEO_LOAD]` structured logs for prod measurement |
| T1410 | [Video Load Regression Since 04-08](tasks/video-load-reliability/T1410-video-load-regression-since-0408.md) | DONE | 5.0 | Warmer aborts on foreground load, StrictMode dedup — 35–56s → ~400–950ms cold load |
| T1420 | [Warmup Abort Polish](tasks/video-load-reliability/T1420-warmup-polish.md) | DONE | 2.0 | Silence AbortError-as-failure log; dedupe StrictMode double-invoke of init load |
| T1430 | [Range Overbuffer (2151s for 8s clip)](tasks/video-load-reliability/T1430-range-overbuffer.md) | DONE | 1.5 | Observability + two-window proxy: cold 20.5s→2.0s, warm 2.2s→0.6s; Step 3 MSE unnecessary |
| T1440 | [Trace multi-video games fail in framing](tasks/video-load-reliability/T1440-trace-multi-video-games.md) | DONE | 1.0 | Clips endpoint joined only `games` for blake3_hash; multi-video games store it per-sequence in `game_videos` → `game_video_url` null → framing 404 |
| T1450 | [Trace load parity via R2 faststart migration](tasks/video-load-reliability/T1450-trace-load-parity.md) | DONE | 1.5 | One-shot `ffmpeg -movflags +faststart` rewrite of 13 moov-at-end games on R2; all verified faststart; Trace load 3.2s→2.95s (remaining gap to Veo parity tracked in T1460) |
| T1470 | [R2 objects missing Content-Type](tasks/video-load-reliability/T1470-r2-content-type-missing.md) | DONE | 4.0 | `CopyObject`-stamp ContentType=video/mp4 on all `games/*.mp4`; fix faststart script to preserve header. Staging: 22/23 migrated |
| T1460 | [Warm-path parity + faststart route choice](tasks/video-load-reliability/T1460-warm-path-parity-faststart.md) | DONE | 1.5 | Move direct-vs-proxy decision into `useVideo` so freshest warm state wins; `warm_status` keyed on R2 URL; backend warmup payload includes `clip.id`; `?direct=1` A/B flag for faststart route measurement |
| T1480 | [cacheWarming test asserts stale fetch count](tasks/T1480-cachewarming-test-stale-fetch-count.md) | DONE | 4.0 | Pre-existing: T1410 test expects 1 fetch but warmClipRange fires 2 (head-prewarm + body) since T1430. Assertion needs updating. Found during T1460 |
| T1490 | [First clip-stream request returns 401, frontend hangs](tasks/T1490-video-stream-first-request-401.md) | DONE | 5.0 | Fix: crossOrigin=use-credentials on same-origin proxy URLs in detached video probe; cacheWarming fetches branched on origin. Backend log confirmed zero 401s on /stream |
| T1500 | [Persist clip dimensions, eliminate metadata probe](tasks/video-load-reliability/T1500-persist-clip-dimensions.md) | DONE | 2.5 | Follow-up to T1490: persist width/height/fps on working_clips, backfill existing rows, skip frontend metadata probe when fields present. Removes N media probes per project load |

### Standalone Tasks

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1150 | [Fix Pending Sync Retry No-Op](tasks/T1150-fix-pending-sync-retry-noop.md) | DONE | 3.0 | T930 retry calls `_if_writes` before `init_request_context` — always short-circuits, never actually uploads |
| T1151 | [Background Sync Retry Worker](tasks/T1151-background-sync-retry-worker.md) | NOT RECOMMENDED | 0.8 | Sweep `.sync_pending` markers on an interval. Rejected: contention risk (SQLite writer lock, version races) outweighs narrow idle-after-failure benefit |
| T1152 | [Persist Sync-Failed State](tasks/T1152-persist-sync-failed-state.md) | DONE | 2.5 | `_sync_failed` dict resets on restart — use `.sync_pending` marker as source of truth so degraded state survives |
| T1153 | [Write-Ahead Sync Ordering (research)](tasks/T1153-write-ahead-sync-ordering.md) | TODO | 0.9 | Evaluate: should critical writes (exports/credits) block on R2 before returning 200? Research task, not impl |
| T1154 | [Atomic Dual-DB Sync](tasks/T1154-atomic-dual-db-sync.md) | MEASURING | 0.8 | precursor log line landed; wait 30d for partial-sync frequency data before recommending |
| T1160 | [Clean Up Unused DB Rows](tasks/T1160-cleanup-unused-db-rows.md) | DONE | 2.5 | Prune old working_clips versions, orphaned before_after_tracks, stale modal_tasks to keep DB small for R2 sync |
| T1170 | [Size-Based VACUUM on Init](tasks/T1170-size-based-vacuum-on-init.md) | DONE | 2.5 | Only VACUUM profile.sqlite when size exceeds 400KB threshold; skip for small DBs |
| T1180 | [Fix NULL video_filename Root Cause](tasks/T1180-design.md) | DONE | 3.0 | Root cause: frontend created `games` row with `videos=[]` then attached in separate step — orphaned on failure. Fix: backend rejects empty videos; frontend hashes first, then creates game atomically with video ref |
| T1140 | [Production Deploy Script](tasks/T1140-production-deploy-script.md) | TODO | 2.0 | Single command to deploy frontend/backend to production with pre-flight checks and health verification |
| T1200 | [Modal Job ID Logging & Retry](tasks/T1200-modal-job-logging-retry.md) | DONE | 1.4 | Log Modal call IDs across all paths (framing/overlay); classify failures and retry transient ones only |
| T1240 | [R2 Restore Retry Tests](tasks/T1240-r2-restore-retry-tests.md) | TODO | 2.3 | Test coverage for R2 restore retry/cooldown — NOT_FOUND vs ERROR handling, cooldown expiry |
| T1510 | [Admin Impersonate User](tasks/T1510-admin-impersonate-user.md) | DONE | 2.5 | Clickable email in admin user list → "login as user" session with banner, audit log, reversible stop. Unblocks support debugging |
| T1380 | [Recover Orphaned Jobs Per-User at Startup](tasks/T1380-startup-recover-orphaned-jobs-per-user.md) | DONE | 1.7 | Moved to lazy per-user recovery in user_session_init (once per user per process) — scales to millions of users |
| T1390 | [Process Modal Queue Per-User at Startup](tasks/T1390-startup-modal-queue-per-user.md) | DONE | 1.7 | Same fix as T1380: modal queue drain runs lazily on first request under correct user context |

### Epic: For Launch (IN_PROGRESS)
[tasks/for-launch/EPIC.md](tasks/for-launch/EPIC.md)

Goal: Make money, virality, super polished. Most tasks here are yet to be generated based on alpha feedback.

#### Infrastructure (prioritized first)

Scale, performance, and reliability — must be solid before feature work.

| ID | Task | Impact | Cmplx | Pri | Status | Description |
|----|------|--------|-------|-----|--------|-------------|
| T1190 | [Session & Machine Pinning](tasks/for-launch/T1190-session-machine-pinning.md) | 9 | 6 | 1.5 | TODO | Pin sessions to machines via fly-replay; includes session expiry (absorbs T420) |
| T1210 | [Clip-Scoped Video Loading](tasks/for-launch/T1210-clip-scoped-video-loading.md) | 7 | 4 | 1.8 | DONE | Framing loads full 90-min video; preload on project creation, only buffer clip time ranges |
| T1260 | [Video Seek Optimization](tasks/for-launch/T1260-video-seek-optimization.md) | 8 | 5 | 1.6 | ICE | Epic on ice 2026-04-12 — T1380 shipped the big win (TTFP seconds→359ms). Revisit only if users report seek problems. |
| T1261 | [↳ Seek Perf Instrumentation](tasks/for-launch/T1261-seek-perf-instrumentation.md) | 8 | 2 | 4.0 | ICE | Parent epic on ice. |
| T1262 | [↳ Service Worker Video Cache](tasks/for-launch/T1262-service-worker-video-cache.md) | 8 | 4 | 2.0 | ICE | Parent epic on ice. |
| T1263 | [↳ SW Quota Management](tasks/for-launch/T1263-sw-quota-management.md) | 5 | 2 | 2.5 | ICE | Parent epic on ice. |
| T1264 | [↳ Moov Atom Parsing](tasks/for-launch/T1264-moov-atom-parsing.md) | 6 | 3 | 2.0 | ICE | Parent epic on ice. |
| T1265 | [↳ Predictive Prefetch](tasks/for-launch/T1265-predictive-prefetch.md) | 6 | 3 | 2.0 | ICE | Parent epic on ice. |
| T1380 | [↳ Upload Moov Faststart](tasks/for-launch/T1380-upload-moov-faststart.md) | 7 | 3 | 2.3 | DONE | Client-side moov relocation on upload; TTFP ~seconds→359ms, seek network 6–16ms (moov no longer bottleneck) |
| T1385 | [↳ Decode-Phase Seek Optimization](tasks/for-launch/T1385-decode-phase-seek-optimization.md) | 6 | 5 | 1.2 | ICE | Parent epic on ice. |
| T1220 | [Modal Range Requests](tasks/for-launch/T1220-modal-range-requests.md) | 7 | 5 | 1.4 | DONE | Modal downloads full 3GB video for 10s clip; use presigned URLs + FFmpeg pre-input seek |
| T1221 | [Dead Modal Code Removal](tasks/for-launch/T1221-dead-modal-code-removal.md) | 3 | 2 | 1.5 | DONE | Delete extract_clip_modal, process_multi_clip_modal, create_annotated_compilation — no callers (follow-up from T1220 audit) |
| T1222 | [game_videos JOIN Audit](tasks/for-launch/T1222-game-videos-join-audit.md) | 5 | 3 | 1.7 | DONE | Multi-video games have NULL games.blake3_hash; audit storage.py/games_upload.py/other exporters to JOIN game_videos instead |
| T1110 | [Never Block Server on Export](tasks/for-launch/T1110-never-block-server.md) | 5 | 5 | 1.0 | TODO | Modal path is synchronous (async but holds connection); return 202 + background task |
| T1180 | [Binary Data Format](tasks/for-launch/T1180-binary-data-format.md) | 3 | 4 | 0.8 | TODO | Replace JSON columns with MessagePack for ~30-50% size reduction |

#### Features

| ID | Task | Impact | Cmplx | Pri | Status | Description |
|----|------|--------|-------|-----|--------|-------------|
| T1080 | [Gallery Player Scrub Controls](tasks/for-launch/T1080-gallery-player-scrub-controls.md) | 6 | 3 | 2.0 | DONE | Scrub/seek controls in gallery video player are non-functional; users can't seek through exported videos |
| T445 | [Business Cards](tasks/T445-business-cards.md) | 5 | 2 | 2.5 | TODO | Design + print physical cards with QR code for handing out at games |
| T440 | [Progressive Web App](tasks/T440-progressive-web-app.md) | 6 | 3 | 2.0 | TODO | "Install app" prompt, offline shell, home screen icon — feels native on phones |
| T1073 | [Team + Athlete Name on Profile](tasks/for-launch/T1073-team-athlete-name-profile.md) | 7 | 2 | 3.5 | TODO | Let users set team name and athlete name per profile; feeds downstream branding/overlays and personalizes quest copy |
| T1050 | [Team Invitations](tasks/for-launch/T1050-team-invitations.md) | 6 | 5 | 1.3 | TODO | "Upload Team" — invite teammates by email; inviter earns credits per signup (viral loop) |
| T1090 | [Social Media Auto-Posting](tasks/for-launch/T1090-social-media-auto-posting.md) | 4 | 4 | 1.1 | TODO | "Share to Social" from gallery — one form posts to IG, TikTok, YouTube, FB via aggregator API |
| T1060 | [Coaches View](tasks/for-launch/T1060-coaches-view.md) | 5 | 6 | 1.0 | TODO | Coach account type: roster uploads, assign annotations to players, own NUF flow |

#### Completed

- T1130 Multi-Clip Stream Not Download — DONE
- T1120 Framing Video Cold Cache — DONE
- T1020 Fast R2 Sync — DONE
- T1010 Slow fetchProgress Response — DONE

### Epic: Post Launch (TODO)
[tasks/post-launch/EPIC.md](tasks/post-launch/EPIC.md)

Improvements after real user traffic.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T40 | [Stale Session Detection](tasks/T40-stale-session-detection.md) | TODO | 1.3 | If two tabs edit the same data, second tab's save overwrites the first; detect and warn |
| T230 | [Pre-warm R2 on Login](tasks/T230-prewarm-r2-on-login.md) | TODO | 1.3 | Start downloading game videos from R2 as soon as user logs in, so they load instantly later |
| T720 | [Art Frames](tasks/T720-art-frames.md) | TODO | 1.1 | Draw on frozen clip frames (like a telestrator); shown during Play Annotations with a pause |
| T620 | [Account Cleanup](tasks/T620-account-cleanup.md) | TODO | 1.0 | Auto-delete abandoned guest accounts and dormant free accounts to reduce R2 storage costs |
| T1100 | [Remove Dead Overlay Debounce](tasks/T1100-remove-dead-overlay-debounce.md) | TODO | 1.5 | Dead `saveOverlayData` with 2s debounce in OverlayContainer; remove + audit overlay persistence |

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
