# T4590: Extract historyStack from useSegments (Undo Foundation)

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-03
**Source:** Audit item C12 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

[DRY-preventive] The app's only undo implementation is `useSegments`' bespoke `trimHistory` stack (:28, :183-241, including a "BUG FIX: Also clear history" patch at :296 and reconstruction-from-boundaries logic). Keyframe delete/move has NO undo — in an app whose worst incidents are destructive edits. When keyframe undo gets built (it will), it'll be written from scratch as a second divergent system unless the primitive exists first. This is the audit's "create the underlying system" directive applied preventively — extraction now, while there's one consumer, is cheap; after two consumers it's a reconciliation project.

## Solution

1. **`utils/historyStack.js`** — pure: `create(limit)`, `push(state)`, `undo() -> state|null`, `canUndo`, `clear()`, optional `serialize/deserialize`. No React, no domain knowledge; snapshots are opaque values the consumer provides.
2. `useSegments` migrates: `trimHistory` becomes a historyStack of segment-state snapshots; the reconstruction-from-boundaries logic stays in useSegments (domain), the stack mechanics leave. The :296 clear-history fix becomes a documented rule of the primitive (when consumers should clear — e.g., on restore).
3. **Undo semantics vs persistence — decide and document:** trim-undo today is in-memory only? Or does undoing fire a surgical action? Read the current behavior first; the extraction must not change it. Add the answer to the module JSDoc — the future keyframe-undo implementor inherits the decision.

## Non-Goals

Building keyframe undo (its own future task, on this foundation); redo (add only if trimHistory has it today).

## Steps

1. [ ] Read useSegments' history behavior end-to-end; document current semantics (what's snapshotted, when cleared, persistence interaction) in the Progress Log.
2. [ ] historyStack + exhaustive unit tests (limit, clear, undo-past-empty, serialize round-trip).
3. [ ] Migrate useSegments; its existing tests stay green unchanged (they pin the behavior).
4. [ ] Manual: trim → undo → re-trim flow on dev.

## Acceptance Criteria

- [ ] Pure historyStack module with tests; zero React/domain imports
- [ ] useSegments behavior byte-identical (its tests unchanged and green)
- [ ] Undo-vs-persistence semantics documented for the next consumer
