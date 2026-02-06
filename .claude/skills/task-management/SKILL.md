---
name: task-management
description: "Task creation, prioritization, and tracking. Tasks live in individual files under docs/plans/tasks/ with full context. PLAN.md contains priority ordering and status. Use gap-based IDs (T10, T20) to allow insertions."
license: MIT
author: video-editor
version: 1.0.0
---

# Task Management

When the user requests a new task, create it as a standalone file AND add it to PLAN.md.

## When to Apply
- User asks to create/add a task
- User asks to update task priority
- User asks to record progress on a task
- Starting work on an existing task (update context)

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Task Creation | CRITICAL | `task-create-` |
| 2 | Prioritization | HIGH | `task-priority-` |
| 3 | Context Updates | HIGH | `task-context-` |

---

## File Structure

```
docs/plans/
├── PLAN.md                    # Central status dashboard (THE source of truth)
└── tasks/
    ├── T10-feature-name.md    # Standalone task
    ├── T20-another-task.md
    ├── T15-inserted-task.md   # Inserted between T10 and T20
    └── deployment/            # Epic folder
        ├── EPIC.md            # Epic overview
        ├── T30-flyio-backend.md
        ├── T40-cloudflare-pages.md
        └── T50-dns-ssl.md
```

## Task ID System

Use **gap-based IDs** to allow insertions:

| ID | Meaning |
|----|---------|
| T10, T20, T30... | Initial tasks (gaps of 10) |
| T15 | Inserted between T10 and T20 |
| T12 | Inserted between T10 and T15 |

When gaps run out, renumber during a cleanup session.

---

## Epics

An **epic** is a folder containing related tasks that form a larger initiative.

### When to Use Epics

- Infrastructure moves (deployment, auth, analytics)
- Large features with multiple sub-tasks
- Any group of tasks that should be completed together

### Epic Structure

```
docs/plans/tasks/{epic-name}/
├── EPIC.md           # Overview, goals, completion criteria
├── T30-subtask-1.md
├── T40-subtask-2.md
└── T50-subtask-3.md
```

### EPIC.md Template

```markdown
# {Epic Name}

**Status:** IN_PROGRESS | COMPLETE
**Started:** YYYY-MM-DD
**Completed:** YYYY-MM-DD (when done)

## Goal

What does completing this epic achieve?

## Tasks

| ID | Task | Status |
|----|------|--------|
| T30 | [Subtask 1](T30-subtask-1.md) | DONE |
| T40 | [Subtask 2](T40-subtask-2.md) | IN_PROGRESS |
| T50 | [Subtask 3](T50-subtask-3.md) | TODO |

## Completion Criteria

- [ ] All tasks complete
- [ ] Tested end-to-end
- [ ] Documentation updated
```

### Epic Rules

1. **Bundle tasks** - Don't context-switch out of an epic mid-way
2. **Epic in PLAN.md** - Reference the epic folder, not individual tasks
3. **Complete together** - Mark epic complete only when ALL tasks done

---

## Priority: Feedback Velocity

Prioritize tasks that maximize **feedback velocity** - the user needs to interact with the software to discover what to do next.

### Priority Formula

```
Priority = (User Impact × Simplicity) / Risk
```

### Quick Heuristics

| Priority | Characteristics |
|----------|-----------------|
| **HIGH** | Simple + High Impact + Low Risk |
| **MEDIUM** | Complex + High Impact, OR Simple + Medium Impact |
| **LOW** | Complex + Low Impact |
| **BLOCKED** | Depends on incomplete task/epic |

### Infrastructure Bundling

When taking an infrastructure step (deployment, auth, analytics, etc.):

1. **Create an epic** for the infrastructure move
2. **Bundle all related tasks** inside the epic
3. **Don't context-switch** until epic is complete
4. **Return to feedback velocity** once epic is done

---

## PLAN.md Structure

PLAN.md is the **central dashboard** - it references ALL tasks and epics.

```markdown
# Project Plan

## Current Focus
Brief description of current work.

## Active Tasks

| ID | Task | Status | Impact | Notes |
|----|------|--------|--------|-------|
| T10 | [Progress bar fix](tasks/T10-progress-bar-fix.md) | IN_PROGRESS | HIGH | - |
| T20 | [Gallery downloads](tasks/T20-gallery-downloads.md) | TODO | HIGH | - |

## Epics

### Deployment (IN_PROGRESS)
[tasks/deployment/EPIC.md](tasks/deployment/EPIC.md)

| ID | Task | Status |
|----|------|--------|
| T30 | Fly.io backend | DONE |
| T40 | Cloudflare Pages | IN_PROGRESS |
| T50 | DNS & SSL | TODO |

## Backlog

| ID | Task | Impact | Complexity |
|----|------|--------|------------|
| T100 | User management | MEDIUM | HIGH |

## Completed
- T05 R2 storage - 2026-01-15
- T06 Modal integration - 2026-01-20
```

### Status Values

| Status | Meaning |
|--------|---------|
| `TODO` | Not started |
| `IN_PROGRESS` | Currently being worked on |
| `BLOCKED` | Waiting on something |
| `TESTING` | Implementation done, testing |
| `DONE` | Complete |

---

## Task File Template

```markdown
# T{ID}: {Title}

**Status:** TODO | IN_PROGRESS | BLOCKED | TESTING | DONE
**Impact:** HIGH | MEDIUM | LOW
**Complexity:** HIGH | MEDIUM | LOW
**Created:** YYYY-MM-DD
**Updated:** YYYY-MM-DD

## Problem

What problem does this solve? Why does it matter to the user?

## Solution

High-level approach. What will we build?

## Context

### Relevant Files
- `src/backend/app/routers/exports.py` - Export endpoints
- `src/frontend/src/hooks/useExport.js` - Export hook

### Related Tasks
- Depends on: T20
- Blocks: T50

### Technical Notes
Architecture decisions, constraints, considerations.

## Implementation

### Steps
1. [ ] Step one
2. [ ] Step two
3. [ ] Step three

### Progress Log

**YYYY-MM-DD**: What was done, what's remaining, any blockers.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Tests pass
```

---

## Creating a Task

When user asks for a new task:

1. **Determine ID**: Find the right gap in PLAN.md
2. **Assess priority**: Use feedback velocity heuristics
3. **Check for epic**: Does this belong in an existing epic? Create new epic?
4. **Create task file**: `docs/plans/tasks/T{ID}-{slug}.md` (or in epic folder)
5. **Update PLAN.md**: Add to appropriate section with status

---

## Updating Task Context

**Critical**: Task files must contain ALL context for AI handoff.

Update the task file when:
- Starting work (add relevant file paths discovered)
- Making progress (update Progress Log)
- Hitting blockers (document in Progress Log)
- Completing steps (check off Implementation steps)
- Ending session (log current state and what's next)

---

## Complete Rules

See individual rule files in `rules/` directory.
