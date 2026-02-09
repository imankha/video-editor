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

| # | Stage | Workflow | Agent | User Gate |
|---|-------|----------|-------|-----------|
| 1 | Task Start | [1-task-start.md](.claude/workflows/1-task-start.md) | Code Expert | - |
| 2 | Architecture | [2-architecture.md](.claude/workflows/2-architecture.md) | Architect | **Approval Required** |
| 3 | Test First | [3-test-first.md](.claude/workflows/3-test-first.md) | Tester (Phase 1) | - |
| 4 | Implementation | [4-implementation.md](.claude/workflows/4-implementation.md) | - | - |
| 5 | Automated Testing | [5-automated-testing.md](.claude/workflows/5-automated-testing.md) | Tester (Phase 2) | - |
| 6 | Manual Testing | [6-manual-testing.md](.claude/workflows/6-manual-testing.md) | - | **Approval Required** |
| 7 | Task Complete | [7-task-complete.md](.claude/workflows/7-task-complete.md) | - | - |

## Stage Detection Rules

| User Says | Action |
|-----------|--------|
| "Implement T{id}..." / assigns task | → Stage 1 (task start) → Stage 2 (architecture) |
| Reviews design doc | → Wait for "approved" or feedback |
| "Approved" / "looks good" (design) | → Stage 3 (test-first) → Stage 4 (implement) |
| "I think this works" / code complete | → Stage 5 (automated testing) |
| All tests pass | → Stage 6 (manual testing instructions) |
| "Approved" / "that worked" (testing) | → Stage 7 (task complete) |

## Agents

| Agent | Purpose | Definition |
|-------|---------|------------|
| **Code Expert** | Audit codebase: entry points, data flow, similar patterns | [code-expert.md](.claude/agents/code-expert.md) |
| **Architect** | Create design doc with diagrams, pseudo code, requires approval | [architect.md](.claude/agents/architect.md) |
| **Tester** | Phase 1: create failing tests. Phase 2: run tests until pass | [tester.md](.claude/agents/tester.md) |

## Design Document

Created at Stage 2: `docs/plans/tasks/T{id}-design.md`

Contains:
- **Current State** - Mermaid diagrams + pseudo code of how it works now
- **Target State** - Mermaid diagrams + pseudo code of the goal
- **Implementation Plan** - Files to change, pseudo code changes
- **Risks & Open Questions**

**Must be approved before implementation begins.**

## Resources
- [Current Plan](docs/plans/PLAN.md)
- [Task Management Skill](.claude/skills/task-management/SKILL.md)
- [README.md](README.md) - Full architecture reference
