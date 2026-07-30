# Epic Implementation Rules

Moved verbatim from CLAUDE.md (preamble diet). Linked from CLAUDE.md § Task Management.

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

