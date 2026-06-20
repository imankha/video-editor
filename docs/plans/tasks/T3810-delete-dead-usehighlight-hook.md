# T3810: Delete Dead useHighlight Hook

**Status:** TODO
**Impact:** 2
**Complexity:** 1
**Created:** 2026-06-20
**Updated:** 2026-06-20

## Problem

`src/frontend/src/modes/overlay/hooks/useHighlight.js` is **dead code**. It is re-exported
from [overlay/index.js](../../../src/frontend/src/modes/overlay/index.js) but never
instantiated anywhere — the live overlay highlight system is `useHighlightRegions`
(region-based). `useHighlight` is the *old* single-track highlight hook built on
`useKeyframeController` (the same reducer crop uses).

It is actively harmful to keep: it presents a **third** keyframe implementation alongside
crop's reducer and `useHighlightRegions`, which is exactly the confusion that hid the
keyframe-identity divergence bug. Per the "keep code clean / no legacy in runtime" rule,
delete it.

## Solution

Confirm there are no live callers, then delete the hook, its `index.js` re-export, and any
test that only exercises it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/hooks/useHighlight.js` — delete
- `src/frontend/src/modes/overlay/index.js` — remove the `export { default as useHighlight }` line
- Any `useHighlight.test.js` / `__tests__` referencing it — delete if it tests only this hook

### Related Tasks
- Surfaced by the keyframe-identity divergence investigation (branch `fix/crop-keyframe-dup-snap`)
- Related: T3820 (reconcile snap directions), T3800 (shared persist wrapper)

### Technical Notes
- Verify with a repo-wide search that nothing imports `useHighlight` (the symbol, not
  `useHighlightRegions`): grep for `useHighlight(` invocation and `from .*useHighlight'`
  imports. The only hits should be the definition and the `index.js` re-export.
- `useKeyframeController` must NOT be deleted — crop and `useHighlight`'s test infra share
  it; only `useHighlight.js` (the unused overlay wrapper) goes.

## Implementation

### Steps
1. [ ] Grep to confirm zero live instantiations of `useHighlight`.
2. [ ] Delete `useHighlight.js`.
3. [ ] Remove the re-export from `overlay/index.js`.
4. [ ] Delete/trim any test that only covered `useHighlight`.
5. [ ] Run frontend unit tests + a build to confirm no dangling import.

## Acceptance Criteria
- [ ] `useHighlight.js` removed; no remaining references.
- [ ] Frontend build + unit tests pass.
