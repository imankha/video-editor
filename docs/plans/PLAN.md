# Project Plan

## Current Focus

**Phase: Feedback Velocity** - Modal and R2 infrastructure complete. Prioritizing simple, high-impact tasks.

**Refactoring:** Automated via [Refactor Agent](../../.claude/agents/refactor.md) - runs before each task on affected files.

---

## Active Tasks

| ID | Task | Status | Impact | Complexity |
|----|------|--------|--------|------------|
| T05 | [Optimize Load Times](tasks/T05-optimize-load-times.md) | DONE | HIGH | MEDIUM |
| T06 | [Move Tracking Toggle to Layer Icon](tasks/T06-remove-player-tracking-button.md) | DONE | LOW | LOW |
| T07 | [Video Load Times](tasks/T07-video-load-times.md) | DONE | MEDIUM | LOW |
| T10 | [Progress Bar Improvements](tasks/T10-progress-bar.md) | DONE | HIGH | MEDIUM |
| T11 | [Local GPU Progress Bar](tasks/T11-local-gpu-progress.md) | DONE | MEDIUM | LOW |
| T12 | [Progress State Recovery](tasks/T12-progress-state-recovery.md) | DONE | HIGH | MEDIUM |
| T20 | [E2E Test Reliability](tasks/T20-e2e-test-reliability.md) | DONE | MEDIUM | MEDIUM |

---

## Upcoming Tasks

| ID | Task | Status | Impact | Complexity |
|----|------|--------|--------|------------|
| T30 | [Performance Profiling](tasks/T30-performance-profiling.md) | DONE (local) | MEDIUM | MEDIUM |
| T50 | [Modal Cost Optimization](tasks/T50-modal-cost-optimization.md) | DONE | MEDIUM | MEDIUM |
| T51 | [Overlay Parallelization](tasks/T51-overlay-parallelization.md) | WON'T DO | MEDIUM | MEDIUM |
| T52 | [Annotate Parallelization](tasks/T52-annotate-parallelization.md) | WON'T DO | MEDIUM | MEDIUM |
| T53 | [Fix Tracking Marker Navigation](tasks/T53-tracking-marker-navigation.md) | DONE | HIGH | LOW |
| T54 | [Fix useOverlayState Test Failures](tasks/T54-fix-overlay-state-tests.md) | DONE | LOW | LOW |
| T55 | [Slow Video Loading](tasks/T55-slow-video-loading.md) | DONE | HIGH | MEDIUM |
| T56 | [Gallery Show Duration](tasks/T56-gallery-show-duration.md) | TODO | LOW | LOW |
| T57 | [Stale Tracking Rectangles](tasks/T57-stale-tracking-rectangles.md) | DONE | MEDIUM | MEDIUM |
| T58 | [Dim Tracking Squares When Disabled](tasks/T58-dim-tracking-squares-when-disabled.md) | TODO | LOW | LOW |
| T60 | [Consolidate Video Controls](tasks/T60-consolidate-video-controls.md) | DONE | MEDIUM | MEDIUM |
| T61 | [Annotate Default Good](tasks/T61-annotate-default-good.md) | TODO | LOW | LOW |
| T62 | [Tag Changes](tasks/T62-tag-changes.md) | TODO | LOW | LOW |
| T63 | [Project Filter Persistence](tasks/T63-project-filter-persistence.md) | DONE | MEDIUM | LOW |
| T64 | [Gallery Playback Controls](tasks/T64-gallery-playback-controls.md) | DONE | MEDIUM | MEDIUM |
| T65 | [Logo from Landing Page](tasks/T65-logo-from-landing-page.md) | TODO | LOW | LOW |
| T66 | [Database Completed Projects Split](tasks/T66-database-completed-projects-split.md) | TODO | MEDIUM | MEDIUM |
| T67 | [Overlay Color Selection](tasks/T67-overlay-color-selection.md) | DONE | MEDIUM | LOW |
| T68 | [Console Error Cleanup](tasks/T68-console-error-cleanup.md) | DONE | LOW | LOW |

---

## Epics

### Deployment (TODO)

[tasks/deployment/EPIC.md](tasks/deployment/EPIC.md) - Deploy to production

| ID | Task | Status |
|----|------|--------|
| T100 | [Fly.io Backend](tasks/deployment/T100-flyio-backend.md) | TODO |
| T110 | [Cloudflare Pages](tasks/deployment/T110-cloudflare-pages.md) | TODO |
| T120 | [DNS & SSL](tasks/deployment/T120-dns-ssl.md) | TODO |
| T130 | [Modal Production Workspace](tasks/deployment/T130-modal-production-workspace.md) | TODO |

---

## Backlog

| ID | Task | Impact | Complexity | Notes |
|----|------|--------|------------|-------|
| T40 | [Stale Session Detection](tasks/T40-stale-session-detection.md) | HIGH | MEDIUM | After staging; not feeling the pinch yet |
| T200 | [User Management](tasks/T200-user-management.md) | MEDIUM | HIGH | Auth, multi-tenant |
| T210 | [Wallet & Payments](tasks/T210-wallet-payments.md) | MEDIUM | HIGH | Stripe integration |
| T220 | [Future GPU Features](tasks/T220-future-gpu-features.md) | LOW | HIGH | Advanced AI features |
| T230 | [Pre-warm R2 on Login](tasks/T230-prewarm-r2-on-login.md) | MEDIUM | LOW | Depends on T200 |

---

## Completed

### Performance Analysis (2026-02)
- T51: [Modal Parallelization Analysis](tasks/T51-modal-parallelization-analysis.md) - **DONE**
  - Overlay: E7 showed parallel costs 62-248% MORE (25ms/frame too low)
  - Detection: Batch API already exists and is used during export
  - Annotate: CPU-bound FFmpeg, parallelization won't help
  - Model loading: Already baked into Modal images (no runtime downloads)

### Infrastructure: Modal Integration (2026-01)
- Modal account setup
- GPU functions deployed (framing, overlay, detection)
- Backend Modal integration with progress callbacks
- Frontend export updates with WebSocket progress
- Multi-clip Modal migration
- Modal job recovery (Phase 1)

### Infrastructure: R2 Storage (2026-01)
- Cloudflare account setup
- R2 bucket setup with CORS
- R2 storage integration with presigned URLs
- Database sync with version tracking

### UX Polish (2026-01)
- Player detection keyframes
- Auto player detection after framing
- Logging cleanup for production
- Project filter persistence
- Project status regression fix
- Framing export validation UX
- Overlay video sync fix
- Gallery download fix
- Framing→Annotate navigation

---

## Task ID Reference

IDs use gaps of 10 to allow insertions:
- `T10, T20, T30...` - Active/upcoming tasks
- `T100, T110, T120...` - Deployment epic
- `T200, T210, T220...` - Backlog
- Insert `T15` between `T10` and `T20`

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
