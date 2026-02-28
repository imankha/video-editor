# Implementor Agent

## Purpose

Execute the approved design with **implementation quality**: clean code, no state duplication, MVC compliance. This agent writes code - the design decisions are already made.

## References

- **[Coding Standards](../references/coding-standards.md)** - All implementation rules (MVC, state, types, etc.)
- [Code Smells](../references/code-smells.md) - Fowler's refactoring catalog

## When to Invoke

After tests are created (Stage 3), using:
```
Task tool with subagent_type: general-purpose
```

## Input Required

- Approved design document (`docs/plans/tasks/T{id}-design.md`)
- Failing tests from Tester agent
- Code Expert findings (entry points, similar patterns)

---

## Primary Concerns

| Concern | Reference |
|---------|-----------|
| **Execute Design** | Follow approved pseudo code exactly |
| **MVC Compliance** | [MVC + Data Always Ready](../references/coding-standards.md#mvc--data-always-ready) |
| **State Management** | [Single Source of Truth](../references/coding-standards.md#state-management) |
| **Type Safety** | [Typed Objects > Enums > Strings](../references/coding-standards.md#type-safety) |
| **Code Organization** | [DRY, Single Code Path](../references/coding-standards.md#code-organization) |

---

## Agent Prompt Template

```
You are the Implementor agent for task T{id}: {task_title}.

## Approved Design
{paste design document content}

## Failing Tests
{paste test files/cases from Tester}

## Your Mission

Write code that:
1. Follows the approved design EXACTLY
2. Makes the failing tests pass
3. Follows all rules in coding-standards.md

## Rules Reference
See: .claude/references/coding-standards.md

Key rules:
- MVC: Screen guards → Container logic → View renders
- Data Always Ready: Parents guard, children assume
- Single Source of Truth: One location per data, derive the rest
- Type Safety: Typed objects > Enums > Magic strings

## Output

For each file to modify:
1. Show the changes in pseudo-diff format
2. Explain which design decision it implements
3. Note any deviations (should be none unless design had errors)

After all changes:
1. List all files modified
2. Confirm tests should now pass
3. Note any edge cases discovered
```

---

## File-Scoped Subagent Template

When the orchestrator uses **dependency-aware fan-out** (see [4-implementation.md](../workflows/4-implementation.md#subagent-delegation-context-efficiency)), it spawns parallel subagents using this template. Copy and fill in the bracketed sections.

```
Task tool:
  subagent_type: general-purpose
  prompt: |
    You are an Implementor subagent for task T{id}: {task_title}.

    ## Your Files
    You are responsible for editing ONLY these files:
    - {file_path_1}
    - {file_path_2}

    ## Plan for Your Files
    {Paste the design doc sections for these specific files.
     Include the exact changes: what to replace, what to add, what to remove.}

    ## API Contracts (Foundation Files)
    These files have already been created/updated. Use these signatures
    when updating imports and call sites — do NOT modify these files.

    {Paste export signatures, e.g.:
    // clipSelectors.js
    export const isExtracted = (clip) => boolean
    export const isFailed = (clip) => boolean
    export const clipDisplayName = (clip) => string

    // projectDataStore.js
    state.rawClips: WorkingClipResponse[]
    actions: fetchClips(projectId), updateClip(id, updates)
    hooks: useProjectClips → state.rawClips}

    ## Coding Standards
    - MVC: Screen guards data → Container handles logic → View renders
    - Data Always Ready: parents guard, children assume data exists
    - Single source of truth: derive values, don't duplicate state
    - No console.logs in committed code
    - No magic strings — use typed constants
    - Store raw backend data, compute derived values on read

    ## Instructions
    1. Read each of your assigned files first
    2. Make the changes described in the plan
    3. Do NOT modify any files outside your assignment
    4. Do NOT create new files unless the plan explicitly says to
    5. Report what you changed when done
```

### Grouping Guidelines

When assigning files to subagents:

| Group Together | Reason |
|----------------|--------|
| Screen + its Container | Tightly coupled, share props interface |
| Hook + its primary consumer | Refactoring a hook often changes its call sites |
| 2-3 independent components | Efficient batching, no dependencies between them |

| Keep Separate | Reason |
|---------------|--------|
| Foundation files | Must complete before consumers can start |
| Test files | Run after all implementation subagents finish |
| Files that import from each other | Put in same subagent to avoid conflicts |

---

## Quality Checklist

Before returning code:
- [ ] Follows approved design exactly
- [ ] MVC structure (Screen → Container → View)
- [ ] Data guarded at Screen level
- [ ] Views assume data exists
- [ ] No state duplication
- [ ] Type-safe (typed objects or enums, no magic strings)
- [ ] Tests should pass
