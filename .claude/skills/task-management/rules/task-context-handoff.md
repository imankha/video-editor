# task-context-handoff

**Priority:** HIGH
**Category:** Context Updates

## Rule

Task files must contain ALL context needed for a new AI to continue the work. Update the task file's **Progress Log** whenever you:
- Start working on a task
- Complete a step
- Discover a blocker
- Find relevant files
- Make a decision

## Rationale

AI sessions can end abruptly (context limits, user closes browser, errors). The task file is the handoff document. A new AI should be able to:

1. Read the task file
2. Understand current state
3. Continue from where the previous AI left off

## Progress Log Format

```markdown
## Progress Log

**2026-02-06 14:30**: Started work. Found relevant files:
- `src/backend/app/routers/exports.py:45-80` - retry logic goes here
- `src/frontend/src/components/ExportStatus.jsx:120` - button location

**2026-02-06 15:00**: Completed step 1 (backend endpoint).
Endpoint working: POST /api/exports/{id}/retry returns 200.
Next: Frontend button.

**2026-02-06 15:30**: Hit blocker - ExportStatus doesn't have access to job ID.
Need to pass jobId prop from parent. Checking ExportPanel.jsx...

**2026-02-06 16:00**: Resolved blocker. jobId now passed through.
Completed step 2 (frontend button). Testing retry flow next.
```

## What to Include

| Always Include | Include If Relevant |
|----------------|---------------------|
| Files discovered | Error messages encountered |
| Steps completed | Decisions made (and why) |
| Current blockers | Alternative approaches rejected |
| What's next | Test results |

## Correct Example

```markdown
## Progress Log

**2026-02-06**: Started T35 (retry failed exports).

Relevant files found:
- `src/backend/app/routers/exports.py` - has create_export, need retry
- `src/backend/app/services/export_worker.py` - actual processing
- `src/frontend/src/hooks/useExport.js:89` - startExport function

Decision: Retry will re-use existing export_jobs row (update status to 'pending')
rather than creating new row. Simpler, preserves history.

Completed:
- [x] POST /api/exports/{id}/retry endpoint
- [x] Export worker handles retry (same as new job)

Remaining:
- [ ] Frontend button
- [ ] Test full flow

No blockers.
```

## Incorrect Example

```markdown
## Progress Log

**2026-02-06**: Working on it.

**2026-02-06**: Made some progress.

**2026-02-06**: Almost done.
```

This is useless - a new AI has no idea what was done or what's left.

## When to Update

| Event | Action |
|-------|--------|
| Start task | Log "Started work", list discovered files |
| Complete step | Check off in Implementation, log what was done |
| Hit blocker | Log the blocker with details |
| Resolve blocker | Log how it was resolved |
| End session | Log current state and what's next |
