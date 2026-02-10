# Project Plan

## Current Focus

**Phase: Feedback Velocity** - Modal and R2 infrastructure complete. Prioritizing simple, high-impact tasks.

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
| T30 | [Performance Profiling](tasks/T30-performance-profiling.md) | TODO | MEDIUM | MEDIUM |
| T50 | [Modal Cost Optimization](tasks/T50-modal-cost-optimization.md) | DONE | MEDIUM | MEDIUM |

---

## Epics

### Refactoring to Standards (SCANS DONE)

[tasks/refactoring-standards/EPIC.md](tasks/refactoring-standards/EPIC.md) - Scan codebase, rate violations, refactor by priority

**Scans Complete** - Found violations, refactor tasks prioritized:

| ID | Task | Priority | Status |
|----|------|----------|--------|
| T301 | Refactor editorMode to EDITOR_MODES | 25 | TODO |
| T311 | Remove workingVideo from overlayStore | 25 | TODO |
| T312 | Remove clipMetadata from overlayStore | 25 | TODO |
| T331 | Refactor ExportButton to container | 25 | TODO |
| T302 | Refactor statusFilter to constants | 16 | TODO |
| T303 | Refactor keyframe origin to constants | 16 | TODO |

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

---

## Completed

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
