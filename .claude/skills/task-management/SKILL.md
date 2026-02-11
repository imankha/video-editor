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

## Impact & Complexity Scores

Use numeric **1-10 scale** for both Impact and Complexity:

| Score | Impact Meaning | Complexity Meaning |
|-------|----------------|-------------------|
| 1-3 | Low: Nice to have, minor improvement | Simple: Few files, straightforward |
| 4-6 | Medium: Noticeable improvement | Medium: Multiple files, some coordination |
| 7-10 | High: Critical for user experience | Complex: Many files, architectural changes |

### Displaying Tasks

When showing task lists, **always include both scores**:

```
| ID | Task | Impact | Complexity |
|----|------|--------|------------|
| T67 | Overlay Color Selection | 6 | 3 |
| T66 | Database Split Analysis | 5 | 6 |
```

### Priority Formula

```
Priority Score = Impact - (Complexity / 2)
```

Higher score = do first. Example:
- T67: Impact 6, Complexity 3 → Priority = 6 - 1.5 = **4.5**
- T66: Impact 5, Complexity 6 → Priority = 5 - 3 = **2**

### Quick Heuristics

| Priority | Characteristics |
|----------|-----------------|
| **HIGH (7+)** | Impact 8+ and Complexity < 5 |
| **MEDIUM (4-6)** | Impact 5-7, OR High Impact + High Complexity |
| **LOW (1-3)** | Impact < 5 and Complexity > 5 |
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

| ID | Task | Status | Impact | Complexity |
|----|------|--------|--------|------------|
| T10 | [Progress bar fix](tasks/T10-progress-bar-fix.md) | IN_PROGRESS | 8 | 4 |
| T20 | [Gallery downloads](tasks/T20-gallery-downloads.md) | TODO | 7 | 3 |

## Epics

### Deployment (IN_PROGRESS)
[tasks/deployment/EPIC.md](tasks/deployment/EPIC.md)

| ID | Task | Status | Impact | Complexity |
|----|------|--------|--------|------------|
| T30 | Fly.io backend | DONE | 9 | 6 |
| T40 | Cloudflare Pages | IN_PROGRESS | 8 | 4 |
| T50 | DNS & SSL | TODO | 7 | 3 |

## Backlog

| ID | Task | Impact | Complexity |
|----|------|--------|------------|
| T100 | User management | 6 | 8 |

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
**Impact:** {1-10}
**Complexity:** {1-10}
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
