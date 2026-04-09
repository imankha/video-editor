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

### Epic: For Alpha (IN_PROGRESS)
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1040 | [Force Login on Add Game](tasks/for-alpha/T1040-force-login-add-game.md) | DONE | 3.5 | Guest clicks "Add Game" -> auth gate appears first; ensures persistent identity before investing effort |
| T1030 | [Quest UI Relocation](tasks/for-alpha/T1030-quest-ui-relocation.md) | DONE | 2.0 | Move quest panel out of floating overlay into dedicated area; currently covers controls user needs (e.g., playback button for Q1S3) |
| T980 | [Clip-Scoped Scrub Bar](tasks/T980-clip-scoped-scrub-playback.md) | DONE | 1.3 | In Play Annotations mode, add a per-clip scrub bar so users can seek within each clip |

### Standalone Tasks

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T1150 | [Fix Pending Sync Retry No-Op](tasks/T1150-fix-pending-sync-retry-noop.md) | TODO | 3.0 | T930 retry calls `_if_writes` before `init_request_context` — always short-circuits, never actually uploads |
| T1160 | [Clean Up Unused DB Rows](tasks/T1160-cleanup-unused-db-rows.md) | TODO | 2.5 | Prune old working_clips versions, orphaned before_after_tracks, stale modal_tasks to keep DB small for R2 sync |
| T1170 | [Size-Based VACUUM on Init](tasks/T1170-size-based-vacuum-on-init.md) | TODO | 2.5 | Only VACUUM profile.sqlite when size exceeds 400KB threshold; skip for small DBs |
| T1140 | [Production Deploy Script](tasks/T1140-production-deploy-script.md) | TODO | 2.0 | Single command to deploy frontend/backend to production with pre-flight checks and health verification |
| T1200 | [Modal Job ID Logging & Retry](tasks/T1200-modal-job-logging-retry.md) | TESTING | 1.4 | Log Modal call IDs across all paths (framing/overlay); classify failures and retry transient ones only |

### Epic: For Launch (TODO)
[tasks/for-launch/EPIC.md](tasks/for-launch/EPIC.md)

Goal: Make money, virality, super polished. Most tasks here are yet to be generated based on alpha feedback.

| ID | Task | Status | Pri | Description |
|----|------|--------|-----|-------------|
| T445 | [Business Cards](tasks/T445-business-cards.md) | TODO | 2.5 | Design + print physical cards with QR code for handing out at games |
| T420 | [Session & Return Visits](tasks/user-auth/T420-session-return-visits.md) | TODO | 2.3 | Expire sessions after inactivity, enforce single active session per user |
| T1110 | [Never Block Server on Export](tasks/for-launch/T1110-never-block-server.md) | TODO | 1.8 | Export processing blocks single Fly.io instance for minutes; must return 202 immediately |
| T1120 | [Framing Video Cold Cache](tasks/for-launch/T1120-framing-video-cold-cache.md) | TESTING | 1.8 | Framing editor slow to load videos; warm R2 cache on Framing entry, not just app init |
| T1130 | [Multi-Clip Stream Not Download](tasks/for-launch/T1130-multiclip-stream-not-download.md) | DONE | 1.6 | Multi-clip export downloads full 3GB game videos; should use presigned URLs + FFmpeg range requests like single-clip |
| T1080 | [Gallery Player Scrub Controls](tasks/for-launch/T1080-gallery-player-scrub-controls.md) | TODO | 2.0 | Scrub/seek controls in gallery video player are non-functional; users can't seek through exported videos |
| T440 | [Progressive Web App](tasks/T440-progressive-web-app.md) | TODO | 2.0 | "Install app" prompt, offline shell, home screen icon — feels native on phones |
| T1020 | [Fast R2 Sync](tasks/T1020-fast-r2-sync.md) | TESTING | 1.8 | Every save/export waits 1.7-3s for R2 upload to finish before responding; profile and speed up |
| T1070 | [Team & Profiles Quest](tasks/for-launch/T1070-team-profiles-quest.md) | TODO | 1.8 | New quest teaching profiles + team uploads; encourages inviting teammates for credits |
| T1010 | [Slow fetchProgress Response](tasks/T1010-slow-fetchprogress.md) | TESTING | 1.7 | Quest progress endpoint takes 1.2s (20+ individual SQLite queries); batch or cache |
| T1050 | [Team Invitations](tasks/for-launch/T1050-team-invitations.md) | TODO | 1.3 | "Upload Team" — invite teammates by email; inviter earns credits per signup (viral loop) |
| T1090 | [Social Media Auto-Posting](tasks/for-launch/T1090-social-media-auto-posting.md) | TODO | 1.1 | "Share to Social" from gallery — one form posts to IG, TikTok, YouTube, FB via aggregator API; AI adapts captions per platform |
| T1060 | [Coaches View](tasks/for-launch/T1060-coaches-view.md) | TODO | 1.0 | Coach account type: roster uploads, assign annotations to players, track clip review status, own NUF flow. No "Projects" for coaches. |
| T1190 | [Session-to-Machine Pinning](tasks/for-launch/T1190-session-machine-pinning.md) | TODO | 1.6 | Pin user sessions to a single Fly.io machine via fly-replay headers; prevents DB conflicts, lost WS progress, stale reads |
| T1180 | [Binary Data Format](tasks/for-launch/T1180-binary-data-format.md) | TODO | 0.8 | Replace JSON columns (crop_data, segments_data, etc.) with MessagePack for ~30-50% size reduction; both Python and TS parse these |

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
