# Project Plan

## Current Focus

**Phase: Feedback Velocity** - Modal and R2 infrastructure complete. Prioritizing simple, high-impact tasks.

**Refactoring:** Automated via [Refactor Agent](../../.claude/agents/refactor.md) - runs before each task on affected files.

---

## Active Tasks

*All active tasks are complete. See Upcoming Tasks for next work.*

| ID | Task | Status | Imp | Cpx |
|----|------|--------|-----|-----|
| T05 | [Optimize Load Times](tasks/T05-optimize-load-times.md) | DONE | 8 | 5 |
| T06 | [Move Tracking Toggle to Layer Icon](tasks/T06-remove-player-tracking-button.md) | DONE | 3 | 3 |
| T07 | [Video Load Times](tasks/T07-video-load-times.md) | DONE | 5 | 3 |
| T10 | [Progress Bar Improvements](tasks/T10-progress-bar.md) | DONE | 8 | 5 |
| T11 | [Local GPU Progress Bar](tasks/T11-local-gpu-progress.md) | DONE | 5 | 3 |
| T12 | [Progress State Recovery](tasks/T12-progress-state-recovery.md) | DONE | 8 | 5 |
| T20 | [E2E Test Reliability](tasks/T20-e2e-test-reliability.md) | DONE | 5 | 5 |

---

## Upcoming Tasks

*Priority = Impact / Complexity. Higher = do first.*

| ID | Task | Status | Imp | Cpx | Pri |
|----|------|--------|-----|-----|-----|
| T71 | [Gallery Show Proper Names](tasks/T71-gallery-show-proper-names.md) | TESTING | 5 | 3 | 1.7 |
| T72 | [Overlay Keyframe Delete Bug](tasks/T72-overlay-keyframe-delete-bug.md) | TODO | 5 | 3 | 1.7 |
| T56 | [Gallery Show Duration](tasks/T56-gallery-show-duration.md) | TESTING | 3 | 2 | 1.5 |
| T58 | [Dim Tracking Squares When Disabled](tasks/T58-dim-tracking-squares-when-disabled.md) | TODO | 3 | 2 | 1.5 |
| T61 | [Annotate Default Good](tasks/T61-annotate-default-good.md) | TODO | 3 | 2 | 1.5 |
| T65 | [Logo from Landing Page](tasks/T65-logo-from-landing-page.md) | TODO | 3 | 2 | 1.5 |
| T73 | [Project Card Clip Count Mismatch](tasks/T73-project-card-clip-count-mismatch.md) | TODO | 3 | 2 | 1.5 |
| T62 | [Tag Changes](tasks/T62-tag-changes.md) | TODO | 3 | 3 | 1.0 |
| T69 | [Mode Switch Save Reset](tasks/T69-mode-switch-save-reset.md) | TODO | 5 | 5 | 1.0 |

### Completed

| ID | Task | Imp | Cpx |
|----|------|-----|-----|
| T30 | [Performance Profiling](tasks/T30-performance-profiling.md) | 5 | 5 |
| T50 | [Modal Cost Optimization](tasks/T50-modal-cost-optimization.md) | 5 | 5 |
| T53 | [Fix Tracking Marker Navigation](tasks/T53-tracking-marker-navigation.md) | 8 | 3 |
| T54 | [Fix useOverlayState Test Failures](tasks/T54-fix-overlay-state-tests.md) | 3 | 3 |
| T55 | [Slow Video Loading](tasks/T55-slow-video-loading.md) | 8 | 5 |
| T57 | [Stale Tracking Rectangles](tasks/T57-stale-tracking-rectangles.md) | 5 | 5 |
| T60 | [Consolidate Video Controls](tasks/T60-consolidate-video-controls.md) | 5 | 5 |
| T63 | [Project Filter Persistence](tasks/T63-project-filter-persistence.md) | 5 | 3 |
| T64 | [Gallery Playback Controls](tasks/T64-gallery-playback-controls.md) | 5 | 5 |
| T66 | [Database Completed Projects Split](tasks/T66-database-completed-projects-split.md) | 5 | 5 |
| T67 | [Overlay Color Selection](tasks/T67-overlay-color-selection.md) | 5 | 3 |
| T68 | [Console Error Cleanup](tasks/T68-console-error-cleanup.md) | 3 | 3 |
| T70 | [Multi-clip Overlay Shows Single Clip](tasks/T70-multiclip-overlay-shows-single-clip.md) | 7 | 4 |

### Won't Do

| ID | Task | Reason |
|----|------|--------|
| T51 | [Overlay Parallelization](tasks/T51-overlay-parallelization.md) | Analysis showed parallel costs more |
| T52 | [Annotate Parallelization](tasks/T52-annotate-parallelization.md) | CPU-bound, won't help |

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

| ID | Task | Imp | Cpx | Pri | Notes |
|----|------|-----|-----|-----|-------|
| T230 | [Pre-warm R2 on Login](tasks/T230-prewarm-r2-on-login.md) | 5 | 3 | 1.7 | Blocked by T200 |
| T40 | [Stale Session Detection](tasks/T40-stale-session-detection.md) | 7 | 5 | 1.4 | After staging |
| T74 | [Incremental Framing Export](tasks/T74-incremental-framing-export.md) | 5 | 5 | 1.0 | Cache rendered clips |
| T200 | [User Management](tasks/T200-user-management.md) | 6 | 8 | 0.8 | Auth, multi-tenant |
| T210 | [Wallet & Payments](tasks/T210-wallet-payments.md) | 5 | 8 | 0.6 | Stripe integration |
| T220 | [Future GPU Features](tasks/T220-future-gpu-features.md) | 4 | 9 | 0.4 | Advanced AI features |

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
