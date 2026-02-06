# Video Editor - AI Guidelines

## Project Overview
Browser-based video editor with three-mode workflow: **Annotate** (clip extraction from game footage) → **Framing** (crop/upscale) → **Overlay** (highlight effects) → **Gallery** (downloads).

## Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Zustand + Tailwind (port 5173) |
| Backend | FastAPI + Python (port 8000) |
| Database | SQLite per-user, synced to R2 |
| Storage | Cloudflare R2 |
| GPU | Modal (cloud) or local FFmpeg + Real-ESRGAN |

## Quick Commands
```bash
# Dev servers
cd src/frontend && npm run dev
cd src/backend && uvicorn app.main:app --reload

# Tests
cd src/frontend && npm test           # Unit tests
cd src/frontend && npm run test:e2e   # E2E (start servers first)
cd src/backend && .venv/Scripts/python.exe run_tests.py  # Backend tests
```

---

## Skills

This project uses structured skills with prioritized rules. Each skill has a SKILL.md and individual rule files.

### Frontend Skills
**Location:** `src/frontend/.claude/skills/`

| Skill | Priority | Description |
|-------|----------|-------------|
| [data-always-ready](src/frontend/.claude/skills/data-always-ready/SKILL.md) | CRITICAL | Parent guards data, children assume it exists |
| [mvc-pattern](src/frontend/.claude/skills/mvc-pattern/SKILL.md) | CRITICAL | Screen → Container → View separation |
| [state-management](src/frontend/.claude/skills/state-management/SKILL.md) | CRITICAL | Single store ownership, no duplicate state |
| [keyframe-data-model](src/frontend/.claude/skills/keyframe-data-model/SKILL.md) | HIGH | Frame-based keyframes, origins, interpolation |
| [ui-style-guide](src/frontend/.claude/skills/ui-style-guide/SKILL.md) | MEDIUM | Colors, buttons, spacing, components |

### Backend Skills
**Location:** `src/backend/.claude/skills/`

| Skill | Priority | Description |
|-------|----------|-------------|
| [api-guidelines](src/backend/.claude/skills/api-guidelines/SKILL.md) | CRITICAL | R2 storage, parameterized queries |
| [persistence-model](src/backend/.claude/skills/persistence-model/SKILL.md) | CRITICAL | SQLite + R2 sync, version tracking |
| [database-schema](src/backend/.claude/skills/database-schema/SKILL.md) | HIGH | Version identity, latest queries, FK cascades |
| [gesture-based-sync](src/backend/.claude/skills/gesture-based-sync/SKILL.md) | HIGH | Action-based API instead of full blobs |

---

## Core Principles

| Principle | Summary |
|-----------|---------|
| **Data Always Ready** | Frontend assumes data loaded before render |
| **MVC Pattern** | Screens own data, Containers logic, Views presentation |
| **Single Source of Truth** | All persistence via SQLite → R2, never localStorage |
| **No Band-Aid Fixes** | Understand root cause, don't mask symptoms |
| **Heavy Testing** | Unit tests co-located, E2E with Playwright |

---

## Git Workflow

| Rule | Description |
|------|-------------|
| **Never commit to master** | Only the user commits to master after testing |
| **Feature branches** | Create branches like `feature/progress-bar-improvements` |
| **Commit freely** | Commit often to feature branches |
| **Signal readiness** | Tell user when work is ready for testing and merge |

---

## Key Documentation
- [README.md](README.md) - Full architecture and API reference
- [src/frontend/CLAUDE.md](src/frontend/CLAUDE.md) - Frontend guidelines
- [src/backend/CLAUDE.md](src/backend/CLAUDE.md) - Backend guidelines
- [docs/plans/cloud_migration/PLAN.md](docs/plans/cloud_migration/PLAN.md) - Deployment plan
