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
- **User asks "what's next"** → Show TODO tasks sorted by priority
- **User asks for a prompt/handoff for a task** → Generate task prompt (see below)

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

When showing task lists:

1. **Always include both scores** (Impact and Complexity as 1-10)
2. **Calculate Priority**: `Priority = Impact / Complexity` (rounded to 1 decimal)
3. **Sort by priority** (highest first)
4. **Show blockers** - tasks that can't start yet should show what blocks them

```
| ID | Task | Impact | Cmplx | Pri | Blocked By |
|----|------|--------|-------|-----|------------|
| T67 | Overlay Color Selection | 6 | 3 | 2.0 | - |
| T40 | Stale Session Detection | 8 | 5 | 1.6 | T100 |
| T66 | Database Split Analysis | 5 | 6 | 0.8 | - |
```

**Display order:**
1. Unblocked tasks first (sorted by priority descending)
2. Blocked tasks at bottom (with blocker shown)

**Blocking rule:** A blocked task can NEVER appear above its blocker in the queue, regardless of priority score. If T40 is blocked by T100, T40 must appear after T100 even if T40 has a higher priority score. This reflects the actual execution order.

Best opportunities (high impact, low complexity, unblocked) float to the top.

### Priority Formula

```
Priority = Impact / Complexity
```

Higher score = do first. Examples:
- Impact 8, Complexity 2 → Priority = **4.0** (excellent opportunity)
- Impact 6, Complexity 3 → Priority = **2.0** (good opportunity)
- Impact 5, Complexity 6 → Priority = **0.8** (lower priority)
- Impact 3, Complexity 9 → Priority = **0.3** (deprioritize)

### Quick Heuristics

| Priority | Characteristics |
|----------|-----------------|
| **> 2.0** | Excellent: High impact, low effort - do first |
| **1.0 - 2.0** | Good: Worth doing soon |
| **0.5 - 1.0** | Medium: Do when higher priority items are done |
| **< 0.5** | Low: Consider if it's worth doing at all |
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

### Relevant Files (REQUIRED)
List ALL files that will be touched. The Refactor Agent uses this to check for violations before implementation.
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

## Generating Task Prompts

When user asks for a prompt to hand off a task to another AI:

1. **Read the task doc** - Understand the task scope
2. **Fill in the classification** - Analyze and provide concrete values (stack layers, file count, LOC estimate, test scope, agent decisions with justifications)
3. **Do NOT give placeholders** - The prompt must be ready to use, not a template

**IMPORTANT:** Never return `{placeholders}` or `~{n}`. Always analyze the task and fill in real values.

### Prompt Structure (fill in all values, no placeholders)

```
Implement T{ID}: {Title}

## Task Documentation
Read: docs/plans/tasks/{task-file}.md

## Classification

**Stack Layers:** {actual layers from task analysis}
**Files Affected:** {estimated count}
**LOC Estimate:** {estimated range}
**Test Scope:** {which test suites apply}

### Agent Workflow
| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | {Yes/No} | {specific reason for this task} |
| Architect | {Yes/No} | {specific reason for this task} |
| Tester | {Yes/No} | {specific reason for this task} |
| Reviewer | {Yes/No} | {specific reason for this task} |

### Skipped Stages
{List specific stages being skipped with reasons, or "None - full workflow"}

## Workflow

{List only the stages that apply, with task-specific details for each step}

## Key Rules

{Any task-specific constraints, e.g., "Run only frontend tests"}
- See CLAUDE.md and .claude/workflows/0-task-classification.md for full details
```

### Example

User: "Give me a prompt for T70"

AI should:
1. Read `docs/plans/tasks/T70-multiclip-overlay-shows-single-clip.md`
2. Analyze the task scope from the Relevant Files and Problem sections
3. Fill in concrete values based on analysis

Response:
```
Implement T70: Multi-clip Overlay Shows Only Single Clip After Framing Edit

## Task Documentation
Read: docs/plans/tasks/T70-multiclip-overlay-shows-single-clip.md

## Classification

**Stack Layers:** Frontend (+ Backend for reference only)
**Files Affected:** ~3-4 files
**LOC Estimate:** ~30-50 lines
**Test Scope:** Frontend Unit + Frontend E2E

### Agent Workflow
| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | Yes | 3+ files affected, need to trace framing→overlay transition flow |
| Architect | No | Bug fix following existing patterns, no new architecture needed |
| Tester | Yes | Behavior change - must verify multi-clip scenarios work |
| Reviewer | No | Architect not included |

### Skipped Stages
- Architecture: Bug fix, not introducing new patterns
- Review: No architectural decisions to verify

## Workflow

1. **Branch** - `git checkout -b feature/T70-multiclip-overlay`
2. **Code Expert** - Trace the framing→overlay transition in App.jsx, OverlayScreen.jsx, and useOverlayState.js to find where clip filtering occurs
3. **Test First** - Write failing test for multi-clip overlay loading after framing edit
4. **Implement** - Fix the state/filtering logic so all project clips load
5. **Automated Testing** - Run frontend unit tests for useOverlayState + E2E for overlay workflow
6. **Manual Testing** - Provide steps to verify with a real multi-clip project
7. **Complete** - Update PLAN.md status to TESTING

## Key Rules

- Run only frontend tests (no backend tests needed)
- See CLAUDE.md and .claude/workflows/0-task-classification.md for full details
```

---

## Complete Rules

See individual rule files in `rules/` directory.
