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

## Data Safety Rules

- Always confirm the exact scope of deletion with the user before executing
- Use `scripts/reset_all_accounts.py` for full account resets on dev/staging (preserves games)
- Use `scripts/reset-test-user.py` for single account resets on any env (including prod):
  ```bash
  cd src/backend && .venv/Scripts/python.exe ../../scripts/reset-test-user.py <email> --env <dev|staging|prod>
  ```
  For prod: downloads DBs from R2, clears data, re-uploads, restarts Fly.io machines, warms server. Add `--no-restart` to skip the restart.

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

## Task Rules

### Never Skip (ALL tasks, including bug fixes)

| Step | When | Action |
|------|------|--------|
| Classify | Before starting | Determine stack layers, files, LOC, test scope, agent inclusion |
| Branch | Before first change | `git checkout -b feature/T{id}-{description}` (skip for <10 LOC single-file) |
| Commit | After implementation | Commit with co-author line |
| PLAN.md | After commit | Update task status to TESTING |

### Task Completion Rule

**AI cannot mark tasks as DONE.** AI sets status to TESTING after implementation and tests pass. DONE is only set after the task is deployed to production — the user will say "complete" or "done" at that point. TESTING is the correct status to proceed to the next task in an epic.

### Classification Output (Required)

Before starting any task, produce:

```
**Stack Layers:** [Frontend | Backend | Modal | Database]
**Files Affected:** ~{n} files
**LOC Estimate:** ~{n} lines
**Test Scope:** [Frontend Unit | Frontend E2E | Backend | None]

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | Yes/No | {reason} |
| Architect | Yes/No | {reason} |
| Tester | Yes/No | {reason} |
| Reviewer | Yes/No | {reason} |
```

See [0-task-classification.md](.claude/workflows/0-task-classification.md) for full classification criteria and agent inclusion rules.

---

## Workflow Stages

**Detect the current stage and load the appropriate workflow file:**

| # | Stage | Workflow | Agent | User Gate |
|---|-------|----------|-------|-----------|
| 0 | Task Classification | [0-task-classification.md](.claude/workflows/0-task-classification.md) | - | - |
| 1 | Task Start | [1-task-start.md](.claude/workflows/1-task-start.md) | Code Expert | - |
| 1.5 | Refactor | - | Refactor | - |
| 2 | Architecture | [2-architecture.md](.claude/workflows/2-architecture.md) | Architect | **Approval Required** |
| 3 | Test First | [3-test-first.md](.claude/workflows/3-test-first.md) | Tester (Phase 1) | - |
| 4 | Implementation | [4-implementation.md](.claude/workflows/4-implementation.md) | Implementor | - |
| 4.5 | Review | [reviewer.md](.claude/agents/reviewer.md) | Reviewer | Conversation* |
| 5 | Automated Testing | [5-automated-testing.md](.claude/workflows/5-automated-testing.md) | Tester (Phase 2) | - |
| 6 | Manual Testing | [6-manual-testing.md](.claude/workflows/6-manual-testing.md) | - | **Approval Required** |
| 7 | Task Complete | [7-task-complete.md](.claude/workflows/7-task-complete.md) | - | - |

**Note**: Classification determines which agents to include based on scope (stack layers, files, LOC). Default to full workflow; skip stages only with explicit justification. See [0-task-classification.md](.claude/workflows/0-task-classification.md).

*\*Conversation: Reviewer conducts solo review, then engages in structured conversation with implementor on MAJOR findings. Implementor can push back; reviewer evaluates on merit. Unresolved disagreements escalate to user. Max 2 rounds. See [ORCHESTRATION.md](.claude/ORCHESTRATION.md).*

## Stage Detection Rules

| User Says | Action |
|-----------|--------|
| "Implement T{id}..." / assigns task | → Stage 1 (task start) → Stage 2 (architecture) |
| Reviews design doc | → Wait for "approved" or feedback |
| "Approved" / "looks good" (design) | → Stage 3 (test-first) → Stage 4 (implement) |
| "I think this works" / code complete | → Stage 5 (automated testing) |
| All tests pass | → Stage 6 (manual testing instructions) |
| "Approved" / "that worked" (testing) | → Stage 7 (task complete) |
| "Ready to merge?" / "can I push?" / "ready for PR?" | → Spawn Merge Reviewer agent |

## Agents

| Agent | Purpose | Definition |
|-------|---------|------------|
| **Code Expert** | Audit codebase: entry points, data flow, similar patterns | [code-expert.md](.claude/agents/code-expert.md) |
| **Refactor** | Clean up affected files before implementation; runs after Code Expert | [refactor.md](.claude/agents/refactor.md) |
| **Architect** | Design with DRY, patterns, code smells; requires approval | [architect.md](.claude/agents/architect.md) |
| **Tester** | Phase 1: create failing tests. Phase 2: run tests until pass | [tester.md](.claude/agents/tester.md) |
| **Implementor** | Execute approved design with MVC, no state duplication | [implementor.md](.claude/agents/implementor.md) |
| **Reviewer** | High-scrutiny review: rules-educated, conversation with implementor | [reviewer.md](.claude/agents/reviewer.md) |
| **Project Manager** | Roadmap, prioritization, development cycles | [project-manager.md](.claude/agents/project-manager.md) |
| **UI Designer** | Define UI details, maintain style guide; requires approval | [ui-designer.md](.claude/agents/ui-designer.md) |
| **Merge Reviewer** | Pre-merge audit: sync strategy, state, architecture | [merge-reviewer.md](.claude/agents/merge-reviewer.md) |

**Orchestration**: See [ORCHESTRATION.md](.claude/ORCHESTRATION.md) for agent spawning, handoffs, and skill access.

## References

| Reference | Content |
|-----------|---------|
| [Coding Standards](.claude/references/coding-standards.md) | **All implementation rules** - MVC, state, types, coupling (single source of truth) |
| [Code Smells](.claude/references/code-smells.md) | Fowler's refactoring catalog |
| [Design Patterns](.claude/references/design-patterns.md) | GoF patterns relevant to React + FastAPI |
| [Testing Matrix](.claude/references/testing-matrix.md) | Coverage guidance by change type |
| [UI Style Guide](.claude/references/ui-style-guide.md) | Colors, typography, components, patterns |
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

## Epic Implementation Rules

Epics are groups of related tasks that must be implemented together in sequence. Each epic has an `EPIC.md` file with shared context, goals, and completion criteria.

### Sequencing

Epic tasks are **implemented in order** (top to bottom in PLAN.md). Do not start task N+1 until task N is complete. The ordering reflects dependencies between tasks within the epic.

### Agent Handoff

Each epic task **must be handed off to its own agent** (via the standard workflow: classify, branch, implement, test). When handing off the next task in an epic:

1. **Include all relevant learnings** from the previous task(s) in the handoff context
2. Reference files that were created or modified in prior tasks
3. Note any gotchas, edge cases, or architectural decisions discovered during prior tasks
4. Include the EPIC.md shared context so the agent understands the broader goal

**Handoff template for epic tasks:**
```
Implement T{id}: {name}

## Epic Context
This is task {N} of {total} in the {epic name} epic.
Read: {path to EPIC.md}

## Prior Task Learnings
- T{prev_id} ({prev_name}): {key decisions, files changed, gotchas discovered}
- {any other relevant prior task learnings}

## Task Details
{task file content or link}
```

### PLAN.md Format

Epics appear inside milestone tables as:
- **Epic header row**: Empty ID column, bold name linking to EPIC.md, description in last column
- **Child task rows**: Task column prefixed with `↳` (e.g., `| T1610 | ↳ [Profile Fields](...) | ...`), immediately follow the header row
- Epic tasks are moved together as a unit when reordering in the task board
- The task-board uses `↳` in the Task column to detect epic children and render them as a collapsible group

## Coding Principles

### No Silent Fallbacks for Internal Data

**Don't use fallbacks to hide missing data from our own code.** Fallbacks are appropriate for external dependencies (network, third-party services), but for internal data flow, missing data indicates a bug that should be visible.

**Bad:**
```javascript
const fps = region.fps || 30;  // Silently uses default, hides the bug
```

**Good:**
```javascript
if (!region.fps) {
  console.warn(`[Component] Region ${region.id} missing fps - re-export to fix.`);
}
const fps = region.fps;  // May be null, caller handles appropriately
```

This keeps failures visible and debuggable rather than silently producing wrong results.

### No Defensive Fixes for Internal Bugs

**Don't add defensive code to work around bugs in code we control.** Defensive fixes mask underlying issues and make bugs harder to find. Reserve defensive strategies for code/behavior outside our control (external APIs, user input, third-party libraries).

**Bad:**
```python
# "Defensive" fix that hides a bug in delete_project
if auto_project_id:
    cursor.execute("SELECT id FROM projects WHERE id = ?", (auto_project_id,))
    if not cursor.fetchone():
        # Silently clean up stale reference - masks the real bug
        cursor.execute("UPDATE raw_clips SET auto_project_id = NULL WHERE id = ?", (clip_id,))
        auto_project_id = None
```

**Good:**
```python
# Fix the root cause in delete_project instead
cursor.execute("UPDATE raw_clips SET auto_project_id = NULL WHERE auto_project_id = ?", (project_id,))
cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
```

When the system encounters an invalid state, it should log appropriately and fail visibly - not silently "fix" itself. If you find yourself writing code to handle "impossible" states from your own codebase, fix the source of those states instead.

### Persistence: Gesture-Based, Never Reactive

**The app NEVER writes to the backend as a side effect of state changing.** Only explicit user actions trigger persistence. This is not a preference — reactive persistence creates feedback loops that corrupt data.

**The rule:** Every DB write must trace back to a specific user gesture (click, drag, keypress). If you can't name the gesture, the write shouldn't exist.

**Why reactive persistence corrupts data:**

React hooks hold ephemeral editing state that includes runtime fixups (e.g., `ensurePermanentKeyframes` adds boundary keyframes, origin corrections normalize loaded data). These fixups are correct for rendering but were never part of the user's saved data. A reactive `useEffect` that watches hook state and writes it back to a store or backend will:

1. Detect the fixup as a "change"
2. Persist the fixup data (overwriting what was in the DB)
3. On next load, the fixup runs again on already-fixed data
4. Each load cycle compounds the corruption

This is not hypothetical — it caused keyframe origin corruption in Framing (T350).

**Persistence architecture:**

```
SURGICAL (gesture actions):
  User gesture → handler → POST /actions with ONLY the changed field
  Backend: reads current DB state → applies single change → writes back
  Example: addCropKeyframe sends {frame, x, y, w, h} → backend appends to array

FULL-STATE (explicit save):
  Export button → saveCurrentClipState → PUT /clips/{id} with all current state
  Only called on deliberate user action (export, not on every state change)

NEVER (reactive):
  useEffect watching state → write to store/backend    ← THIS IS BANNED
```

**Rules:**
1. **Gesture → surgical API call**: Each user action fires a backend call from its handler, sending ONLY the data that gesture changed
2. **No reactive persistence**: Never `useEffect` to watch state and write to DB/store. No exceptions.
3. **Runtime fixups are memory-only**: Internal corrections (`ensurePermanentKeyframes`, origin normalization) happen in hooks for rendering — they MUST NOT trigger persistence
4. **Restore is read-only**: Loading data from DB into hooks must not trigger a write-back
5. **Single write path per data**: Each piece of persistent data has exactly ONE code path that writes it
6. **Full-state saves require explicit gesture**: `saveCurrentClipState` only runs on export button click, never reactively

**How to check if you're about to violate this:**
- Am I writing a `useEffect` that calls an API or updates a store? → Probably wrong. Move the persistence call into the gesture handler instead.
- Am I watching hook state for changes? → Ask: what user gesture caused this change? If "none" or "internal fixup", don't persist it.
- Am I sending ALL keyframes/segments when only one changed? → Use a surgical action instead.

See [coding-standards.md](.claude/references/coding-standards.md) for implementation patterns and anti-patterns.

## Log handling

**NEVER ingest raw logs.** A 2000-line log burns 20,000+ tokens of context and drowns out
everything else. `reduce_log` reads the file server-side — only the reduced output enters
your context. This is the single most important rule for effective log debugging.

Use `reduce_log` instead of Read/cat/head/tail for any log file. Always include `tail`
(200-2000) to cap input size. Use `grep` or `level` to filter — don't load the whole log
when you only need errors.

reduce_log({ file: "app.log", tail: 2000 })                                     // just call it — auto-summary if large
reduce_log({ file: "app.log", tail: 200, level: "error" })                      // errors only
reduce_log({ file: "app.log", tail: 200, level: "error", before: 30, context_level: "warning" })  // errors + relevant context
reduce_log({ file: "app.log", tail: 200, grep: "timeout|connection" })           // regex search
reduce_log({ file: "app.log", tail: 2000, summary: true })                      // force structural overview

**How the threshold gate works:**
- **No filters + over threshold** → you get an enhanced summary: unique errors/warnings with
  counts, timestamps, and components. Use this to plan your next call.
- **Filters + over threshold** → you get the actual output with a TIP on how to narrow further.
- **Under threshold** → you get the full reduced output directly.

**Always redirect commands that might produce more than ~20 lines.** When in doubt, redirect.
The cost of an unnecessary redirect is ~2 seconds. The cost of raw output in context is
permanent token loss with no recovery. These commands MUST always be redirected:

    npm test 2>&1 > /tmp/test-output.log; echo "exit: $?"
    pytest 2>&1 > /tmp/test-output.log; echo "exit: $?"
    npx playwright test 2>&1 > /tmp/test-output.log; echo "exit: $?"
    pip install 2>&1 > /tmp/pip-output.log; echo "exit: $?"
    docker build 2>&1 > /tmp/docker-output.log; echo "exit: $?"

The `echo "exit: $?"` gives you pass/fail immediately. Then `reduce_log` the file only if
you need details. Short commands (`git status`, `ls`, `node -v`) can run directly.

**When the user needs to provide logs:** never ask them to paste logs. Tell them to type
`/logdump` (dumps clipboard to file + auto-reduces) or give a file path. If YOU need a log
from the user, say: *"Copy the log to your clipboard and type `/logdump`"*.

## Resources
- [src/frontend/CLAUDE.md](src/frontend/CLAUDE.md) - Frontend skills and patterns
- [src/backend/CLAUDE.md](src/backend/CLAUDE.md) - Backend skills and patterns
- [README.md](README.md) - Full architecture reference
