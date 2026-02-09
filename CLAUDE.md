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
| 0 | Task Classification | [0-task-classification.md](.claude/workflows/0-task-classification.md) | - | - |
| 1 | Task Start | [1-task-start.md](.claude/workflows/1-task-start.md) | Code Expert | - |
| 2 | Architecture | [2-architecture.md](.claude/workflows/2-architecture.md) | Architect | **Approval Required** |
| 3 | Test First | [3-test-first.md](.claude/workflows/3-test-first.md) | Tester (Phase 1) | - |
| 4 | Implementation | [4-implementation.md](.claude/workflows/4-implementation.md) | Implementor | - |
| 4.5 | Review | - | Reviewer | - |
| 5 | Automated Testing | [5-automated-testing.md](.claude/workflows/5-automated-testing.md) | Tester (Phase 2) | - |
| 6 | Manual Testing | [6-manual-testing.md](.claude/workflows/6-manual-testing.md) | - | **Approval Required** |
| 7 | Task Complete | [7-task-complete.md](.claude/workflows/7-task-complete.md) | - | - |

**Note**: Trivial/Simple tasks skip some stages. See [0-task-classification.md](.claude/workflows/0-task-classification.md).

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
| **Architect** | Design with DRY, patterns, code smells; requires approval | [architect.md](.claude/agents/architect.md) |
| **Tester** | Phase 1: create failing tests. Phase 2: run tests until pass | [tester.md](.claude/agents/tester.md) |
| **Implementor** | Execute approved design with MVC, no state duplication | [implementor.md](.claude/agents/implementor.md) |
| **Reviewer** | Verify implementation matches approved design | [reviewer.md](.claude/agents/reviewer.md) |

**Orchestration**: See [ORCHESTRATION.md](.claude/ORCHESTRATION.md) for agent spawning, handoffs, and skill access.

## References

| Reference | Content |
|-----------|---------|
| [Code Smells](.claude/references/code-smells.md) | Fowler's refactoring catalog with examples |
| [Design Patterns](.claude/references/design-patterns.md) | GoF patterns relevant to React + FastAPI |
| [Testing Matrix](.claude/references/testing-matrix.md) | Coverage guidance by change type |
| [Handoff Schemas](.claude/schemas/handoffs.md) | Structured context passing between agents |
| [Error Recovery](.claude/workflows/error-recovery.md) | Recovery procedures when things go wrong |
| [Retrospectives](.claude/retrospectives/README.md) | Template for task retrospectives |

## Design Document

Created at Stage 2: `docs/plans/tasks/T{id}-design.md`

Contains:
- **Current State** - Mermaid diagrams + pseudo code of how it works now
- **Target State** - Mermaid diagrams + pseudo code of the goal
- **Implementation Plan** - Files to change, pseudo code changes
- **Risks & Open Questions**

**Must be approved before implementation begins.**

## Task Management

Use the [task-management skill](.claude/skills/task-management/SKILL.md) for:
- Creating new tasks (file + PLAN.md entry)
- Prioritizing by feedback velocity
- Organizing epics (bundled infrastructure moves)
- AI handoff context in task files

For roadmap decisions, use the [Project Manager agent](.claude/agents/project-manager.md):
- Adding tasks (knows where to place them)
- Suggesting next task (based on development phase)
- Development cycles: **INFRA → FEATURES → POLISH → repeat**

Current plan: [docs/plans/PLAN.md](docs/plans/PLAN.md)

## Resources
- [src/frontend/CLAUDE.md](src/frontend/CLAUDE.md) - Frontend skills and patterns
- [src/backend/CLAUDE.md](src/backend/CLAUDE.md) - Backend skills and patterns
- [README.md](README.md) - Full architecture reference
