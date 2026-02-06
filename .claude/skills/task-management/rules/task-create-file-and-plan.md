# task-create-file-and-plan

**Priority:** CRITICAL
**Category:** Task Creation

## Rule

When creating a new task, ALWAYS create BOTH:
1. A task file at `docs/plans/tasks/T{ID}-{slug}.md`
2. An entry in `docs/plans/PLAN.md`

Never create just one without the other.

## Rationale

- PLAN.md is the priority/status dashboard - it must reflect all tasks
- Task files contain full context - needed for AI handoff
- Without both, tasks get lost or lack context

## Correct Example

```python
# User: "Create a task for adding retry button to failed exports"

# Step 1: Check PLAN.md for ID gaps
# Found: T30 exists, T40 exists, use T35

# Step 2: Create task file
# docs/plans/tasks/T35-retry-failed-exports.md

# Step 3: Add to PLAN.md
| T35 | [Retry failed exports](tasks/T35-retry-failed-exports.md) | TODO | HIGH | Button + endpoint |
```

## Incorrect Example

```python
# BAD: Only updating PLAN.md
"I've added the task to PLAN.md"
# Missing: No task file created - context will be lost

# BAD: Only creating task file
"I've created docs/plans/tasks/T35-retry.md"
# Missing: Not in PLAN.md - won't be tracked/prioritized
```

## Task File Minimum Content

```markdown
# T35: Retry Failed Exports

**Status:** TODO
**Impact:** HIGH
**Complexity:** LOW
**Created:** 2026-02-06

## Problem
Users cannot recover from failed exports without re-doing all their work.

## Solution
Add retry button that re-queues the export job with same parameters.

## Context
### Relevant Files
- `src/backend/app/routers/exports.py`
- `src/frontend/src/components/ExportStatus.jsx`

## Implementation
1. [ ] Add POST /api/exports/{id}/retry endpoint
2. [ ] Add retry button to failed export UI
3. [ ] Test retry flow

## Acceptance Criteria
- [ ] Retry button appears on failed exports
- [ ] Clicking retry re-queues the job
- [ ] Progress shows for retried export
```
