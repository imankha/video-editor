# Video Editor - AI Guidelines

## Project Overview
Browser-based video editor: **Annotate** (clip extraction) → **Framing** (crop/upscale) → **Overlay** (highlights) → **Gallery** (downloads).

## Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Zustand + Tailwind (port 5173) |
| Backend | FastAPI + Python 3.11 (port 8000) |
| Database | Fly Postgres (auth/sharing/sessions) + SQLite per-user (clips/projects, synced to R2) |
| Storage | Cloudflare R2 (user media + per-user SQLite) |
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

### Task Status Rule

Task statuses split into two kinds, with different owners:

**Factual statuses (AI auto-updates as part of the workflow).** These are objectively true from what the workflow did, so AI sets them in PLAN.md:
- `IN PROGRESS` — set when work begins (feature branch created, Stage 1). See [1-task-start.md](.claude/workflows/1-task-start.md).
- `STAGING` — set when the task branch lands on master (pushing to master auto-deploys staging). See [7-task-complete.md](.claude/workflows/7-task-complete.md).

**DONE — the user's call, expressed by an explicit gesture.** STAGING is the test phase — being on staging *is* testing, so there is no separate TESTING step. `DONE`/`Resolved` is set only by a deliberate user gesture, of which there are exactly two:
1. The user clicks **Resolve** on the task board (per-task, once satisfied on staging), OR
2. The user runs **`/deploy`** — a prod deploy auto-promotes every task whose *implementation* shipped in that deploy to DONE (the deploy command is the user's "ship it, it's done" gesture). See [deploy skill](.claude/skills/deploy/SKILL.md) reconciliation. AI never marks DONE outside these two gestures.

Lifecycle: `TODO -> IN PROGRESS (AI) -> STAGING (AI) -> DONE (user gesture: Resolve button or /deploy)`.

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
| Migration | Yes/No | {reason} |
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
| 4.75 | Migration | - | Migration | - |
| 4.5 | Review | [reviewer.md](.claude/agents/reviewer.md) | Reviewer | Conversation* |
| 5 | Automated Testing + Coverage | [5-automated-testing.md](.claude/workflows/5-automated-testing.md) | Tester (Phase 2) | - |
| 6 | Test & Fix Agent Handoff | [6-manual-testing.md](.claude/workflows/6-manual-testing.md) | - | **New Conversation** |
| 7 | Task Complete | [7-task-complete.md](.claude/workflows/7-task-complete.md) | - | - |

**Note**: Classification determines which agents to include based on scope (stack layers, files, LOC). Default to full workflow; skip stages only with explicit justification. See [0-task-classification.md](.claude/workflows/0-task-classification.md).

*\*Conversation: Reviewer conducts solo review, then engages in structured conversation with implementor on MAJOR findings. Implementor can push back; reviewer evaluates on merit. Unresolved disagreements escalate to user. Max 2 rounds. See [ORCHESTRATION.md](.claude/ORCHESTRATION.md).*

## Stage Detection Rules

| User Says | Action |
|-----------|--------|
| "Implement T{id}..." / assigns task | → Stage 1 (task start) → Stage 2 (architecture) |
| Reviews design doc | → Wait for "approved" or feedback |
| "Approved" / "looks good" (design) | → Stage 3 (test-first) → Stage 4 (implement) |
| "I think this works" / code complete | → Stage 5 (automated testing + coverage) |
| All tests pass | → Stage 6 (generate Test & Fix Agent handoff) |
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
| **Migration** | Write versioned migration files for schema changes | [migration.md](.claude/agents/migration.md) |
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

### Task File Self-Containment

Each epic task file **must be self-contained for agent handoff**. An agent should be able to implement the task by reading only the task file (plus referenced central docs like EPIC.md), without needing to read other task files in the epic.

**Rules:**

1. **Reference EPIC.md for design decisions, don't duplicate.** Say `See [EPIC.md](EPIC.md) for design decisions: no inbox, per-player filtering, overlap merging.` Don't copy those decisions into every task file.

2. **Reference sibling tasks for shared code by ID + what to reuse.** When a task reuses logic from a prior task, name the specific function/helper: `Reuse T2830's game reference helper (games + game_videos + game_storage_refs insertion).` Don't copy the implementation details.

3. **Schema/data changes must include full column mappings.** When a task creates or modifies DB tables, include exact columns, types, and where values come from. For cross-profile/cross-DB data copying, specify column-by-column what gets copied, what gets set to a default, and what gets omitted.

4. **Wire dependencies to specific artifacts.** When a task depends on another task's schema, API, or component, name the specific table/endpoint/component: `Depends on T2825's shares + share_games tables` not just `Depends on T2825`.

5. **When tasks overlap, include a comparison table.** If two tasks do similar things (e.g., both materialize games), add a table showing what's shared vs different so the implementing agent doesn't rebuild what already exists.

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

### Correct Data, Not Workarounds

**Data should have one canonical location. Code should work when data is correct. Migrations should make data correct.** Don't add fallback queries, "if exists" guards, or alternative data sources for data that should always be there. If data is missing, fix the source -- don't work around it.

- If a query depends on a table populated by a prior migration, call that migration first -- don't add a fallback that reads from the raw source
- If a column should always have a value, ensure the code that creates the row sets it -- don't add a default/guard at read time
- Migrations must be self-sufficient: if they depend on another migration's data, run that migration as a prerequisite

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

## Migration System

AI never manually migrates accounts. AI writes migration code. Admin hits the endpoint.

| Track | DB Type | Version Mechanism | Schema Location |
|-------|---------|-------------------|-----------------|
| `user_db` | `user.sqlite` (per-user) | `PRAGMA user_version` | `src/backend/app/services/user_db.py` (`_USER_DB_SCHEMA`) |
| `profile_db` | Profile SQLite (per-user-per-profile) | `PRAGMA user_version` | `src/backend/app/database.py` (`ensure_database()`) |
| `postgres` | Fly Postgres (shared) | `schema_migrations` table | `src/backend/app/services/pg.py` (`_SCHEMA_DDL`) |

**Migration files:** `src/backend/app/migrations/{track}/v{NNN}_{description}.py`

**Migrations do NOT auto-run on deploy or startup.** `init_pg_schema()` only runs `_SCHEMA_DDL` (`CREATE TABLE IF NOT EXISTS`) for fresh DBs. Versioned migrations (`ALTER TABLE`, new tables on existing schemas) must be explicitly triggered after deploy:
- **Admin endpoint:** `POST /api/admin/migrate` (requires admin session)
- **SSH fallback:** `fly ssh console -a <app> -C "python -c 'from app.migrations import run_all_migrations; from app.services.pg import init_pg_pool; init_pg_pool(); print(run_all_migrations())'"`

**When implementing schema changes:** Include the Migration agent in classification. It creates the versioned migration file after the Implementor changes the schema. See [migration.md](.claude/agents/migration.md). Update `_SCHEMA_DDL` in `pg.py` too (for fresh deployments).

**Key rule:** `PRAGMA user_version` tracks schema version. `db_version` table / R2 `x-amz-meta-db-version` tracks sync version. They are independent.

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
