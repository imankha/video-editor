# Video Editor - AI Guidelines

## Project Overview
Browser-based video editor with three-mode workflow: **Annotate** (clip extraction from game footage) → **Framing** (crop/upscale) → **Overlay** (highlight effects) → **Gallery** (downloads).

## Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Zustand + Tailwind (port 5173) |
| Backend | FastAPI + Python 3.11 (port 8000) |
| Database | SQLite per-user, synced to R2 |
| Storage | Cloudflare R2 |
| GPU | Modal (cloud) or local FFmpeg + Real-ESRGAN |

## Commands
```bash
# Dev servers
cd src/frontend && npm run dev
cd src/backend && uvicorn app.main:app --reload

# Frontend tests
cd src/frontend && npm test           # Unit tests (Vitest)
cd src/frontend && npm run test:e2e   # E2E (Playwright) - start servers first
cd src/frontend && npm run test:e2e -- --ui  # E2E with visual UI

# Backend tests
cd src/backend && .venv/Scripts/python.exe run_tests.py  # All tests (use this, not pytest)
cd src/backend && pytest tests/test_clips.py -v          # Specific file
cd src/backend && pytest tests/ -k "test_name" -v        # By name
```

## Git Workflow
- **Never commit to master** - Only the user commits to master after testing
- **Feature branches** - Create branches like `feature/progress-bar-improvements`
- **Commit when you add value** - Commit whenever you believe you've improved the product state
  - Don't wait for manual testing - commit once there's reason to believe the change adds value toward the roadmap
  - Never commit broken code - the codebase must remain functional after each commit
  - Run relevant tests before committing (minimal tests that activate changed code paths to verify they work as intended)
- **Signal readiness** - Tell user when work is ready for testing and merge
- **Task status** - Mark tasks as TESTING when implementation is complete; only the user marks tasks as DONE after testing

## Core Principles
| Principle | Summary |
|-----------|---------|
| **Data Always Ready** | Frontend assumes data loaded before render (see frontend skills) |
| **MVC Pattern** | Screens own data, Containers logic, Views presentation |
| **Single Source of Truth** | All persistence via SQLite → R2, never localStorage |
| **No Band-Aid Fixes** | Understand root cause, don't mask symptoms |
| **Heavy Testing** | Unit tests co-located, E2E with Playwright |
| **Type Safety** | No magic strings (see frontend/backend type-safety skills) |
| **Derive, Don't Duplicate** | See detailed section below |
| **Minimize Code Paths** | See detailed section below |

## Derive, Don't Duplicate

When multiple variables represent the same underlying state, bugs happen when they get out of sync.

**Bad** - Multiple independent variables:
```python
def send_progress(phase, done, status, progress):  # 4 ways to say "complete"
    if done or phase == 'complete' or status == 'complete' or progress >= 100:
        ...  # Which one is right? They can disagree!
```

**Good** - One source of truth, derive the rest:
```python
def send_progress(phase):  # phase is the ONLY input
    status = phase_to_status(phase)  # Derived - can't be wrong
    done = phase in (Phase.COMPLETE, Phase.ERROR)  # Derived
```

**Rules:**
1. **Pick ONE authoritative variable** - Usually the most granular one (e.g., `phase` not `done`)
2. **Derive everything else** - Write functions that compute derived values
3. **Never pass derived values as parameters** - If it can be computed, compute it
4. **Use enums, not strings** - `ExportPhase.COMPLETE` catches typos at import time

## Minimize Code Paths (DRY Architecture)

When developing new features or modifying existing ones:

1. **Search First**: Before writing new code, search for similar functionality in the codebase. Use existing utilities rather than creating duplicates.

2. **Extract Shared Logic**: When you see the same pattern in 2+ places, extract it to a shared helper.

3. **Unified Interfaces**: When code has production vs development modes (cloud vs local, API vs mock), create unified interfaces that work identically for both. Never have large if/else blocks based on environment - route internally instead.

4. **Cross-Feature Consistency**: When multiple features (annotate, framing, overlay) do similar things, extract shared helpers rather than duplicating logic across files.

## Database
- Location: `user_data/{user_id}/database.sqlite`
- Dev default: `user_data/a/database.sqlite`
- R2 bucket: `reel-ballers-users` at `{user_id}/database.sqlite`
- Sync: Download from R2 on startup if newer, upload on mutations with version check

## Task Management

Use the [task-management skill](.claude/skills/task-management/SKILL.md) for:
- Creating new tasks (file + PLAN.md entry)
- Prioritizing by feedback velocity
- Organizing epics (bundled infrastructure moves)
- AI handoff context in task files

Current plan: [docs/plans/PLAN.md](docs/plans/PLAN.md)

## Documentation
- [src/frontend/CLAUDE.md](src/frontend/CLAUDE.md) - Frontend skills and patterns
- [src/backend/CLAUDE.md](src/backend/CLAUDE.md) - Backend skills and patterns
- [README.md](README.md) - Full architecture and API reference
