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
- **Commit freely** - Commit often to feature branches
- **Signal readiness** - Tell user when work is ready for testing and merge

## Core Principles
| Principle | Summary |
|-----------|---------|
| **Data Always Ready** | Frontend assumes data loaded before render (see frontend skills) |
| **MVC Pattern** | Screens own data, Containers logic, Views presentation |
| **Single Source of Truth** | All persistence via SQLite → R2, never localStorage |
| **No Band-Aid Fixes** | Understand root cause, don't mask symptoms |
| **Heavy Testing** | Unit tests co-located, E2E with Playwright |

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
