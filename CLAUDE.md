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

| Stage | Trigger | Workflow | Agent |
|-------|---------|----------|-------|
| **1. Task Start** | "Implement T{id}..." | [1-task-start.md](.claude/workflows/1-task-start.md) | Code Expert |
| **2. Test First** | After task start | [2-test-first.md](.claude/workflows/2-test-first.md) | Tester (Phase 1) |
| **3. Implementation** | After tests created | [3-implementation.md](.claude/workflows/3-implementation.md) | - |
| **4. Automated Testing** | Implementation complete | [4-automated-testing.md](.claude/workflows/4-automated-testing.md) | Tester (Phase 2) |
| **5. Manual Testing** | All tests pass | [5-manual-testing.md](.claude/workflows/5-manual-testing.md) | - |
| **6. Task Complete** | User approves | [6-task-complete.md](.claude/workflows/6-task-complete.md) | - |

## Stage Detection Rules

| User Says | Action |
|-----------|--------|
| "Implement T{id}..." / assigns task | → Stages 1, 2, 3 (start → test-first → implement) |
| Active coding/debugging | → Use Stage 3 (implementation) |
| "I think this works" / "ready for testing" | → Stage 4 (automated testing) |
| All tests pass | → Stage 5 (manual testing instructions) |
| "Approved" / "that worked" / "merge it" | → Stage 6 (task complete) |

## Agents

| Agent | Purpose | Definition |
|-------|---------|------------|
| **Code Expert** | Audit codebase, find entry points, similar patterns | [.claude/agents/code-expert.md](.claude/agents/code-expert.md) |
| **Tester** | Find coverage, create tests, run tests, verify | [.claude/agents/tester.md](.claude/agents/tester.md) |

## Resources
- [Current Plan](docs/plans/PLAN.md)
- [Task Management Skill](.claude/skills/task-management/SKILL.md)
- [README.md](README.md) - Full architecture reference
