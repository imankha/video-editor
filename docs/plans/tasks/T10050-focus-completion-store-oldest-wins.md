# T10050: focusCompletionStore shows the oldest unacknowledged job, not the newest

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Found as a byproduct of the T9780 expert investigation (not part of the evaluation batch itself).
When a user has 2+ unacknowledged completed framing jobs, the passive Focus-completion recovery
card ends up showing the **oldest** one instead of the newest — the wrong project's "your highlight
is ready" card.

`src/backend/app/routers/exports.py:734-743` returns the unacknowledged-jobs list
`ORDER BY e.completed_at DESC` (newest first). `src/frontend/src/hooks/useExportRecovery.js:135-145`
iterates that list in order and calls `reportRecoveredCompletion` for each job. But
`src/frontend/src/utils/recoveredExportCompletion.js:16-29` only guards against re-reporting the
*same* job id, and `src/frontend/src/stores/focusCompletionStore.js:34`'s `noteRecovered` does an
unconditional `set({ recovered })` — so the loop ends on the LAST list entry, which is the oldest
job. Last-write-wins = oldest-wins.

Post-T9790 (merged 2026-09-14, PR #429) this is low severity: the recovery card is purely passive
(View/Dismiss), no auto-navigate. But it still points a returning user at the wrong project.

## Solution

Make `noteRecovered` first-write-wins, or have `reportRecoveredCompletion` return early once
`useFocusCompletionStore.getState().recovered` is already set (mirrors the existing dedup-by-job-id
guard in `recoveredExportCompletion.js`, just widened to "any recovered job already set").

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/focusCompletionStore.js` - `noteRecovered` (line 34)
- `src/frontend/src/hooks/useExportRecovery.js` - iteration loop (lines 135-145)
- `src/frontend/src/utils/recoveredExportCompletion.js` - existing dedup guard (lines 16-29)
- `src/backend/app/routers/exports.py` - unacknowledged-jobs query (lines 734-743, read-only reference, no backend change expected)

### Related Tasks
- Found during: T9780 (docs/plans/tasks/evaluation-2026-09-13/T9780.md)
- Adjacent to: T9790 (removed the auto-navigate that made this higher severity)

### Technical Notes
No backend change expected — this is a frontend selection-order bug, not a data bug. Keep the fix
additive/minimal per the project's gesture-persistence and no-defensive-fixes rules: this is a
genuine internal bug (wrong selection order), not a workaround for external input.

## Implementation

### Steps
1. [ ] Write a failing test: feed `useExportRecovery`/`reportRecoveredCompletion` two unacknowledged
   jobs (newest first, per the real query order) and assert the store ends up with the NEWEST job's
   id, not the oldest.
2. [ ] Fix `noteRecovered` (or the call site) to first-write-wins.
3. [ ] Confirm the existing single-job recovery tests still pass.

## Acceptance Criteria

- [ ] With 2+ unacknowledged completed framing jobs, the recovery card shows the newest one.
- [ ] Existing single-job recovery behavior unchanged.
- [ ] Tests pass (targeted frontend unit set).
