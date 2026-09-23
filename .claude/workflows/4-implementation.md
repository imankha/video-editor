# Stage 4: Implementation

## Agent

**Use the tier-selected implementation path.** S/M normally implement in the driver/worker; use the Implementor for an approved, scoped specification:
```
Agent tool with subagent_type: implementor
See: .claude/agents/implementor.md
```

## Purpose

Execute the approved design. Focus on **implementation quality**: clean code, no state duplication, proper patterns.

---

## Subagent Delegation (Context Efficiency)

**Goal:** Keep the main orchestrator's context clean. The main agent coordinates; subagents do the file-level editing.

### When to Delegate

- **L tier with 4+ independent source files** in the approved plan → use scoped fan-out when useful
- **1-3 files** → main agent can edit directly (not worth the overhead)

### Step 1: Dependency Analysis

Before writing any code, categorize every file from the approved plan:

| Category | Definition | Example |
|----------|------------|---------|
| **Foundation** | Files that other changed files import from (new utils, rewritten stores, new API endpoints) | `clipSelectors.js`, `projectDataStore.js` |
| **Consumer** | Files that import from foundation files but NOT from each other | `FramingScreen.jsx`, `App.jsx` |
| **Cleanup** | File deletions, index.js export updates, simple 1-line removals | `clipStore.js` (DELETE), `index.js` |
| **Tests** | Test files that need mock/assertion updates | `*.test.js`, `*.test.jsx` |

### Step 2: Foundation Phase (Sequential)

Build foundation files FIRST — either in main context (if <100 lines each) or via a single subagent.

After foundation files are written, extract the **API contract** (exports, function signatures, types) to pass to consumer subagents. Example:

```
API Contract — clipSelectors.js:
  export const isExtracted = (clip) => boolean
  export const isFailed = (clip) => boolean
  export const clipDisplayName = (clip) => string
  export const clipFileUrl = (clip, projectId) => string

API Contract — projectDataStore.js:
  state.rawClips: WorkingClipResponse[]
  state.clipMetadataCache: { [clipId]: { duration, width, height } }
  actions: fetchClips(projectId), setRawClips(clips), updateClip(id, updates)
  selectors: useProjectClips, useSelectedClipId
```

### Step 3: Fan-Out Phase (Parallel Subagents)

Spawn parallel `implementor` agents for file-disjoint consumer slices. Rules:

- **Group related files** — a Screen + its Container in one subagent, or 2-3 independent components
- **Max 3-4 subagents** — diminishing returns beyond that
- **Each subagent gets:**
  1. Task ID + title (context)
  2. The design document path and section names for ITS files only
  3. API contracts from foundation files (signatures, NOT full source)
  4. Pointer to `.claude/references/coding-standards.md` (single source of truth — instruct the subagent to read it before editing)
  5. Instruction: "Read then edit ONLY your assigned files"
- **Use the per-file subagent template** from `.claude/agents/implementor.md`

### Step 4: Cleanup + Tests

After all consumer subagents complete:
- Main agent handles file deletions and index.js updates (small, mechanical)
- Spawn one subagent for test file updates (if needed)
- Main agent names and runs the curated test files + `npm run build` (full suite is Branch CI's job)
- Main agent fixes any failures (or delegates targeted fixes)

### What Stays in Main Context

| Task | Why |
|------|-----|
| Dependency analysis + grouping | Requires understanding the full plan |
| Foundation files (if small) | Other subagents need these to exist first |
| Running tests + build | Need to see results and coordinate fixes |
| Interpreting failures | Requires cross-file understanding |
| Commit + PLAN.md update | Final coordination |

### Example: T250 (17 files) — Optimal Delegation

```
Foundation (main agent, ~150 lines):
  clipSelectors.js (NEW, 54 lines)
  projectDataStore.js (rewrite, 280 lines) → subagent

Fan-out (3 parallel subagents):
  Agent A: useProjectLoader.js + useClipManager.js
    (both hooks, closely related, share store imports)
  Agent B: FramingScreen.jsx + FramingContainer.jsx
    (screen + its container, tightly coupled)
  Agent C: ClipSelectorSidebar.jsx + ExportButtonContainer.jsx + App.jsx
    (remaining consumers, all independent)

Cleanup (main agent, ~5 lines):
  Delete: useProjectClips.js, clipStore.js, clipStore.test.js
  Edit: index.js (remove 2 export lines), profileStore.js (remove 1 line)

Tests (1 subagent):
  ClipSelectorSidebar.test.jsx + ExportButtonContainer.test.js

Verify (main agent):
  npx vitest run <named-test-files> && npm run build
```

This reduces duplicated context; measure actual savings rather than assuming a fixed percentage.

---

## Core Pattern: MVC + Data Always Ready

See [coding-standards.md](../references/coding-standards.md) § MVC + Data Always Ready — single source of truth. All implementations must follow it.

## Primary Concerns

| Concern | What to Check |
|---------|---------------|
| **MVC Compliance** | Screen guards, Container handles logic, View renders |
| **Data Always Ready** | Parents guard, children assume data exists |
| **State Duplication** | One source of truth, derive everything else |
| **Type Safety** | No magic strings, use enums and constants |

---

## Derive, Don't Duplicate

See [coding-standards.md](../references/coding-standards.md) § State Management > Derive, Don't Duplicate — single source of truth (includes the never-pass-derived-values-as-parameters rule and backend example).

---

## Bug Smells: When Bugs Indicate Architecture Problems

Some bugs are simple mistakes. Others are **symptoms of deeper architectural issues**. Recognizing "bug smells" prevents wasted effort on bandaid fixes that don't address the root cause.

### What is a Bug Smell?

A bug smell is when the "obvious fix" requires:
- Adding sync/refresh logic between two data sources
- Checking if data is "stale" and reloading
- Comparing two things that "should" be the same
- Adding defensive code for "impossible" states

A second writable copy of internal state is a warning sign. Legitimate persistence protocols (CAS, restore-if-newer) still require synchronization; trace ownership before diagnosing duplication.

### Common Bug Smells

| Symptom | Bug Smell | Real Problem |
|---------|-----------|--------------|
| "Stale data" after navigation | Data copied between stores | Should have ONE store, derive the rest |
| "Out of sync" between components | Multiple sources of truth | Should subscribe to single source |
| "Race condition" on load | Imperative data fetching | Should use reactive data flow |
| "Wrong state" after mode switch | State not scoped to context | Should reset or scope state properly |
| "Cache invalidation" bugs | Caching derived data | Should compute on-the-fly |

### Correct Response to Bug Smells

Ask the expert to establish the mechanism with code and a failing reproduction.
Trace which state owns the data, which operation produced the stale copy, and which
consumer observes it. Propose the smallest fix to that mechanism. Synchronization,
cache invalidation, and refresh operations are valid when the architecture requires
them; do not label them wrong merely by name. If duplicate writable state is proven,
remove or correctly scope it. Use the design gate for material architecture changes;
ask the user only when viable alternatives have unresolved product tradeoffs.

### When It's NOT a Bug Smell

Simple bugs that ARE appropriate to fix directly:
- Off-by-one errors
- Typos in field names
- Missing null checks at boundaries
- Incorrect boolean logic
- Wrong API endpoint

These don't indicate architectural problems—just fix them.

---

## Implementation Checklist

Before writing code, verify:
- [ ] Tier-selected plan ready; design document approved if required (Stage 2)
- [ ] Regression/test-first evidence ready where applicable (Stage 3 for L)
- [ ] Understand the pseudo code from design doc
- [ ] **Check for bug smells** - is this a symptom of a deeper issue?

While writing code:
- [ ] Preserve approved behavior and invariants; report substantive design errors
- [ ] No state duplication - derive values
- [ ] Use existing utilities (identified by Architect)
- [ ] Follow MVC pattern (Screen → Container → View)

---

## Frontend Standards

### Data Guards + MVC Structure
See [coding-standards.md](../references/coding-standards.md) § MVC + Data Always Ready and § Data Guards — single source of truth.

### State
- Zustand stores for global state
- Screen-owned hooks for local state
- No prop drilling from App.jsx

### Keyframes
Flat list, NO permanent boundary keyframes (model removed 2026-06-21): any keyframe may be deleted; empty list = default centered crop; trim is virtual. Frame-based (not time). See [.claude/knowledge/keyframes-framing.md](../knowledge/keyframes-framing.md) — single source of truth.

### Skills (load as needed)
| Skill | Path |
|-------|------|
| data-always-ready | `src/frontend/.claude/skills/data-always-ready/SKILL.md` |
| mvc-pattern | `src/frontend/.claude/skills/mvc-pattern/SKILL.md` |
| state-management | `src/frontend/.claude/skills/state-management/SKILL.md` |
| type-safety | `src/frontend/.claude/skills/type-safety/SKILL.md` |

### Don'ts
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render without data guards
- Don't use localStorage
- Don't use time in seconds for keyframes

---

## Backend Standards

### Virtual Environment
```bash
cd src/backend && .venv/Scripts/python.exe <script.py>
```

### After Code Changes (REQUIRED)
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```

### Common Patterns
```python
# File paths
from app.database import RAW_CLIPS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename

# R2 Storage
from app.services.r2_storage import upload_to_r2, generate_presigned_url

# Modal GPU (unified interface - routes internally)
from app.services.modal_client import call_modal_framing_ai

# Export helpers
from app.services.export_helpers import (
    create_export_job, complete_export_job, send_progress
)
```

### Skills (load as needed)
| Skill | Path |
|-------|------|
| api-guidelines | `src/backend/.claude/skills/api-guidelines/SKILL.md` |
| persistence-model | `src/backend/.claude/skills/persistence-model/SKILL.md` |
| type-safety | `src/backend/.claude/skills/type-safety/SKILL.md` |
| database-schema | `src/backend/.claude/skills/database-schema/SKILL.md` |

### Don'ts
- Don't use raw SQL without parameterization
- Don't store secrets in code
- Don't skip R2 upload for user files
- Don't send full state blobs (use gesture-based actions)

---

## Git Workflow

- **Implementation stays on the task branch** - The supervisor owns landing and any authorized status-only bookkeeping on master
- **Commit when you add value** - Don't wait for manual testing
- **Implementation commits require relevant verification** - Explicit test-first commits may contain intentional, documented failing tests; incomplete work is never represented as verified

---

## Database Reference

**Two database systems:**

| System | Data | Access | Params |
|--------|------|--------|--------|
| **Fly Postgres** | Auth, sessions, shares, admin, storage refs | `get_pg()` context manager | `%s` |
| **Per-user SQLite** | Clips, projects, credits, transactions | `get_user_db_connection()` | `?` |

- Per-user SQLite location: `user_data/{user_id}/profile.sqlite`
- Per-user SQLite syncs to R2: download on startup if newer, upload on mutations
- Postgres schema: `app/services/pg.py` (`_SCHEMA_DDL`)
- Auth/sharing queries: `app/services/auth_db.py`, `app/services/sharing_db.py`

---

## After Implementation Complete

Run initial targeted checks, then migration if needed and Stage 4.5 review. After review fixes, [5-automated-testing.md](5-automated-testing.md) verifies the final state. M follows its shorter test-then-review path.
