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

## Completed Tasks

See [DONE.md](DONE.md) for all completed, superseded, and won't-do tasks.

---

### Epic: Auth Integrity (IN_PROGRESS) -- BUG FIX
[tasks/auth-integrity/EPIC.md](tasks/auth-integrity/EPIC.md)

Goal: Eliminate orphaned accounts by removing guest accounts entirely. Users must sign in (Google or OTP) before using the app.

| ID | Task | Impact | Cmplx | Pri | Status | Description |
|----|------|--------|-------|-----|--------|-------------|
| T1270 | [Cookie Path + SameSite Fix](tasks/auth-integrity/T1270-cookie-path-fix.md) | 9 | 1 | 9.0 | TODO | Add `path="/"` to cookies, fix SameSite to `lax` |
| T1290 | [Auth DB Restore Must Succeed](tasks/auth-integrity/T1290-auth-db-restore-must-succeed.md) | 9 | 4 | 2.3 | TODO | Fail startup if auth.sqlite can't restore from R2 |
| T1340 | [Auth-First Login Screen](tasks/auth-integrity/T1340-auth-first-login-screen.md) | 9 | 4 | 2.3 | TODO | Full-screen login page on first visit (blocks T1330) |
| T1330 | [Remove Guest Accounts](tasks/auth-integrity/T1330-remove-guest-accounts.md) | 10 | 6 | 1.7 | TODO | Rip out init-guest, migration, guest banners — ~400 LOC removed |

### Epic: For Alpha (IN_PROGRESS)
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1040 | [Force Login on Add Game](tasks/for-alpha/T1040-force-login-add-game.md) | DONE | 3.5 | Guest clicks "Add Game" -> auth gate appears first; ensures persistent identity before investing effort |
| T1030 | [Quest UI Relocation](tasks/for-alpha/T1030-quest-ui-relocation.md) | DONE | 2.0 | Move quest panel out of floating overlay into dedicated area; currently covers controls user needs (e.g., playback button for Q1S3) |
| T980 | [Clip-Scoped Scrub Bar](tasks/T980-clip-scoped-scrub-playback.md) | DONE | 1.3 | In Play Annotations mode, add a per-clip scrub bar so users can seek within each clip |
| T1230 | [Mobile Annotate Clips](tasks/for-alpha/T1230-mobile-annotate-clips.md) | TODO | 1.6 | Compact mode for ClipDetailsEditor on mobile — collapse scrub region, reduce tag/spacing sizes |
| T1250 | [Live Scrub in Annotate](tasks/for-alpha/T1250-annotate-live-scrub.md) | TODO | 2.0 | Video should update frame-by-frame during timeline/clip scrub drag, not just on release |
| T1390 | [Rename Projects to Reels](tasks/for-alpha/T1390-rename-projects-to-reels.md) | TODO | 3.0 | Users understood "Games" but not "Projects" — rename to "Reels" (UI labels only) |
| T1400 | [Framing Keyframe Dedup](tasks/for-alpha/T1400-framing-keyframe-dedup.md) | TODO | 3.0 | Snap to nearby keyframe within MIN_KEYFRAME_SPACING instead of creating duplicates |

### Epic: Video Load Reliability (IN_PROGRESS) -- BUG FIX
[tasks/video-load-reliability/EPIC.md](tasks/video-load-reliability/EPIC.md)

Goal: Robust video loading — no misleading format errors, no oversized preloads, no CORS spam. Ordered by severity to user experience. Orchestrator-driven; each task gets its own branch and merges only after its before/after test proves effectiveness.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1360 | [Blob URL Error Recovery](tasks/video-load-reliability/T1360-blob-url-error-recovery.md) | TODO | 4.0 | Stale blob URL auto-recovers to streaming URL; no misleading "Video format not supported" overlay |
| T1370 | [Blob Preload Size Gate + Unmount Safety](tasks/video-load-reliability/T1370-blob-preload-size-gate.md) | TODO | 3.5 | 200MB gate on T1262 preload; AbortController + revoke on unmount — removes root cause of T1360 recurrence |
| T1350 | [Cache Warming CORS Cleanup](tasks/video-load-reliability/T1350-cache-warming-cors-fix.md) | TODO | 3.0 | Switch warmUrl to `no-cors`; eliminates console spam on every page load |

### Standalone Tasks

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1150 | [Fix Pending Sync Retry No-Op](tasks/T1150-fix-pending-sync-retry-noop.md) | TODO | 3.0 | T930 retry calls `_if_writes` before `init_request_context` — always short-circuits, never actually uploads |
| T1160 | [Clean Up Unused DB Rows](tasks/T1160-cleanup-unused-db-rows.md) | TODO | 2.5 | Prune old working_clips versions, orphaned before_after_tracks, stale modal_tasks to keep DB small for R2 sync |
| T1170 | [Size-Based VACUUM on Init](tasks/T1170-size-based-vacuum-on-init.md) | TODO | 2.5 | Only VACUUM profile.sqlite when size exceeds 400KB threshold; skip for small DBs |
| T1140 | [Production Deploy Script](tasks/T1140-production-deploy-script.md) | TODO | 2.0 | Single command to deploy frontend/backend to production with pre-flight checks and health verification |
| T1200 | [Modal Job ID Logging & Retry](tasks/T1200-modal-job-logging-retry.md) | DONE | 1.4 | Log Modal call IDs across all paths (framing/overlay); classify failures and retry transient ones only |
| T1240 | [R2 Restore Retry Tests](tasks/T1240-r2-restore-retry-tests.md) | TODO | 2.3 | Test coverage for R2 restore retry/cooldown — NOT_FOUND vs ERROR handling, cooldown expiry |

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
| T1220 | [Modal Range Requests](tasks/for-launch/T1220-modal-range-requests.md) | 7 | 5 | 1.4 | TODO | Modal downloads full 3GB video for 10s clip; use presigned URLs + FFmpeg pre-input seek |
| T1110 | [Never Block Server on Export](tasks/for-launch/T1110-never-block-server.md) | 5 | 5 | 1.0 | TODO | Modal path is synchronous (async but holds connection); return 202 + background task |
| T1180 | [Binary Data Format](tasks/for-launch/T1180-binary-data-format.md) | 3 | 4 | 0.8 | TODO | Replace JSON columns with MessagePack for ~30-50% size reduction |

#### Features

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T445 | [Business Cards](tasks/T445-business-cards.md) | TODO | 2.5 | Design + print physical cards with QR code for handing out at games |
| T1080 | [Gallery Player Scrub Controls](tasks/for-launch/T1080-gallery-player-scrub-controls.md) | TODO | 2.0 | Scrub/seek controls in gallery video player are non-functional; users can't seek through exported videos |
| T440 | [Progressive Web App](tasks/T440-progressive-web-app.md) | TODO | 2.0 | "Install app" prompt, offline shell, home screen icon — feels native on phones |
| T1070 | [Team & Profiles Quest](tasks/for-launch/T1070-team-profiles-quest.md) | TODO | 1.8 | New quest teaching profiles + team uploads; encourages inviting teammates for credits |
| T1050 | [Team Invitations](tasks/for-launch/T1050-team-invitations.md) | TODO | 1.3 | "Upload Team" — invite teammates by email; inviter earns credits per signup (viral loop) |
| T1090 | [Social Media Auto-Posting](tasks/for-launch/T1090-social-media-auto-posting.md) | TODO | 1.1 | "Share to Social" from gallery — one form posts to IG, TikTok, YouTube, FB via aggregator API |
| T1060 | [Coaches View](tasks/for-launch/T1060-coaches-view.md) | TODO | 1.0 | Coach account type: roster uploads, assign annotations to players, own NUF flow |

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
| T220 | [Future GPU Features](tasks/T220-future-gpu-features.md) | TODO | 0.6 | Advanced AI features (auto-crop, auto-highlight detection, etc.) |

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
