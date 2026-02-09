# Video Editor - AI Guidelines

## Project Overview
Browser-based video editor: **Annotate** (clip extraction) → **Framing** (crop/upscale) → **Overlay** (highlights) → **Gallery** (downloads).

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
cd src/frontend && npm run test:e2e   # E2E (Playwright)

# Backend tests
cd src/backend && .venv/Scripts/python.exe run_tests.py  # All tests
cd src/backend && pytest tests/test_clips.py -v          # Specific file
```

## Workflow Stages

**Detect the current stage and load the appropriate workflow file:**

| Stage | Trigger | Workflow |
|-------|---------|----------|
| **Task Start** | User says "implement T{id}..." or assigns a task | [1-task-start.md](.claude/workflows/1-task-start.md) |
| **Implementation** | After task start, during active coding | [2-implementation.md](.claude/workflows/2-implementation.md) |
| **Testing Ready** | Implementation complete, ready for user testing | [3-testing-ready.md](.claude/workflows/3-testing-ready.md) |
| **Task Complete** | User approves after testing | [4-task-complete.md](.claude/workflows/4-task-complete.md) |

**Stage Detection Rules:**
1. New task assignment → Load `1-task-start.md`, then `2-implementation.md`
2. Active coding/debugging → Use `2-implementation.md`
3. "Ready for testing" / "I think this works" → Load `3-testing-ready.md`
4. User says "approved" / "that worked" / "merge it" → Load `4-task-complete.md`

## Resources
- [Current Plan](docs/plans/PLAN.md)
- [Task Management Skill](.claude/skills/task-management/SKILL.md)
- [README.md](README.md) - Full architecture reference
