# Stage 4: Implementation

## Agent

**Spawn the Implementor agent** to write code:
```
Task tool with subagent_type: general-purpose
See: .claude/agents/implementor.md
```

## Purpose

Execute the approved design. Focus on **implementation quality**: clean code, no state duplication, proper patterns.

---

## Subagent Delegation (Context Efficiency)

**Goal:** Keep the main orchestrator's context clean. The main agent coordinates; subagents do the file-level editing.

### When to Delegate

- **4+ source files** in the approved plan → use subagent fan-out
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

Spawn parallel `general-purpose` subagents for consumer files. Rules:

- **Group related files** — a Screen + its Container in one subagent, or 2-3 independent components
- **Max 3-4 subagents** — diminishing returns beyond that
- **Each subagent gets:**
  1. Task ID + title (context)
  2. The plan section for ITS files only (copy from design doc)
  3. API contracts from foundation files (signatures, NOT full source)
  4. Coding standards summary (inline — don't rely on file references)
  5. Instruction: "Read then edit ONLY your assigned files"
- **Use the per-file subagent template** from `.claude/agents/implementor.md`

### Step 4: Cleanup + Tests

After all consumer subagents complete:
- Main agent handles file deletions and index.js updates (small, mechanical)
- Spawn one subagent for test file updates (if needed)
- Main agent runs `npm test` + `npm run build`
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
  npm test && npm run build
```

Context saved: ~60% less file content in main agent.

---

## Core Pattern: MVC + Data Always Ready

All implementations must follow:

```
Screen (data fetching, guards data readiness)
  └── Container (state logic, event handlers)
        └── View (presentational only, assumes data exists)
```

**Data Always Ready**:
- Parent guards: `{data && <Child data={data} />}`
- Child assumes: `function Child({ data }) { /* data is never null */ }`
- Views never fetch, never check for null

**Reactive Updates**:
- State lives in Zustand stores or Screen-level hooks
- Views subscribe to state, re-render on changes
- No imperative "refresh" or "update" calls

## Primary Concerns

| Concern | What to Check |
|---------|---------------|
| **MVC Compliance** | Screen guards, Container handles logic, View renders |
| **Data Always Ready** | Parents guard, children assume data exists |
| **State Duplication** | One source of truth, derive everything else |
| **Type Safety** | No magic strings, use enums and constants |

---

## Derive, Don't Duplicate

When multiple variables represent the same underlying state, bugs happen when they get out of sync.

**Bad** - Multiple independent variables:
```python
def send_progress(phase, done, status, progress):  # 4 ways to say "complete"
    if done or phase == 'complete' or status == 'complete' or progress >= 100:
        ...  # Which one is right? They can disagree!
```

**Good** - One source of truth, derive the rest:
```python
def send_progress(phase):  # phase is the ONLY input
    status = phase_to_status(phase)  # Derived - can't be wrong
    done = phase in (Phase.COMPLETE, Phase.ERROR)  # Derived
```

**Rules:**
1. Pick ONE authoritative variable (usually the most granular)
2. Derive everything else via functions
3. Never pass derived values as parameters
4. Use enums, not strings

---

## Bug Smells: When Bugs Indicate Architecture Problems

Some bugs are simple mistakes. Others are **symptoms of deeper architectural issues**. Recognizing "bug smells" prevents wasted effort on bandaid fixes that don't address the root cause.

### What is a Bug Smell?

A bug smell is when the "obvious fix" requires:
- Adding sync/refresh logic between two data sources
- Checking if data is "stale" and reloading
- Comparing two things that "should" be the same
- Adding defensive code for "impossible" states

**If your fix involves keeping two things in sync, you have two sources of truth. That's the real bug.**

### Common Bug Smells

| Symptom | Bug Smell | Real Problem |
|---------|-----------|--------------|
| "Stale data" after navigation | Data copied between stores | Should have ONE store, derive the rest |
| "Out of sync" between components | Multiple sources of truth | Should subscribe to single source |
| "Race condition" on load | Imperative data fetching | Should use reactive data flow |
| "Wrong state" after mode switch | State not scoped to context | Should reset or scope state properly |
| "Cache invalidation" bugs | Caching derived data | Should compute on-the-fly |

### Correct Response to Bug Smells

**DON'T** implement a bandaid fix (sync checks, cache invalidation, refresh calls).

**DO** pause and present options to the user:

```markdown
## Architecture Issue Detected

The bug symptom is [X], but the root cause is [architectural problem].

**Bandaid fix:** Add sync check between Store A and Store B
- Pro: Quick, minimal changes
- Con: Treats symptom, not cause; will have similar bugs

**Proper fix:** Eliminate Store B, derive from Store A
- Pro: Single source of truth, no sync issues
- Con: Requires refactoring [list affected files]

**Middle ground:** Make Store B subscribe to Store A
- Pro: Auto-sync, moderate effort
- Con: Still two stores, but coupled

Which approach do you prefer?
```

### Example: Stale Data Bug

**Bug:** "After switching modes, component shows old data"

**Bandaid fix (WRONG):**
```javascript
// Check if data matches and reload if not
if (storeA.id !== storeB.id) {
  reloadFromStoreA();
}
```

**Proper fix (RIGHT):**
```javascript
// Eliminate storeB, derive from storeA
const derivedData = useMemo(() =>
  transformForUI(storeA.data),
  [storeA.data]
);
```

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
- [ ] Design document approved (Stage 2)
- [ ] Failing tests created (Stage 3)
- [ ] Understand the pseudo code from design doc
- [ ] **Check for bug smells** - is this a symptom of a deeper issue?

While writing code:
- [ ] Follow the approved design exactly
- [ ] No state duplication - derive values
- [ ] Use existing utilities (identified by Architect)
- [ ] Follow MVC pattern (Screen → Container → View)

---

## Frontend Standards

### Data Guards
```jsx
{selectedClip && <ClipEditor clip={selectedClip} />}
```

### MVC Structure
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

### State
- Zustand stores for global state
- Screen-owned hooks for local state
- No prop drilling from App.jsx

### Keyframes
```javascript
keyframe = {
  frame: number,  // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
}
```

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

- **Never commit to master** - Only user commits after testing
- **Commit when you add value** - Don't wait for manual testing
- **Never commit broken code** - Run relevant tests first

---

## Database Reference

- Location: `user_data/{user_id}/database.sqlite`
- Dev default: `user_data/a/database.sqlite`
- R2 sync: Download on startup if newer, upload on mutations

---

## After Implementation Complete

Proceed to [5-automated-testing.md](5-automated-testing.md) to run tests.
