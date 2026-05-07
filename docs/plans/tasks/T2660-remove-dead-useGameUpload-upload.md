# T2660: Remove Dead useGameUpload.upload() Method

**Status:** TODO
**Impact:** 2
**Complexity:** 1
**Created:** 2026-05-07
**Updated:** 2026-05-07

## Problem

`useGameUpload` hook has a dead `upload()` method that calls `uploadGame(file, callback)` without passing video metadata (duration, width, height). All real uploads go through `uploadStore.startUpload()` which correctly passes metadata. The dead code path was the root cause of game 6 missing `video_duration` — though activation now backfills metadata as a safety net (fixed in commit f71f160e).

## Solution

Remove the dead upload path from `useGameUpload` and clean up associated state/tests.

## Context

### Relevant Files
- `src/frontend/src/hooks/useGameUpload.js` — Remove `upload()`, `cancel()` methods and unused state (phase, percent, message, error, result)
- `src/frontend/src/hooks/useGameUpload.test.js` — Remove tests for the dead upload path
- `src/frontend/src/screens/ProjectsScreen.jsx` — Only uses `pendingUploads` and `fetchPendingUploads` from this hook; verify no breakage

### Related Tasks
- Follow-up from metadata backfill fix (commit f71f160e on T2640 branch)

### Technical Notes
- `useGameUpload` is still used in `ProjectsScreen.jsx` for `pendingUploads` and `fetchPendingUploads` — those must stay
- The hook's `upload()` method is only called in `useGameUpload.test.js` — nowhere in production code
- Consider whether the hook should be renamed or simplified to just `usePendingUploads`

## Acceptance Criteria

- [ ] `upload()` and `cancel()` removed from `useGameUpload`
- [ ] Unused state variables removed (phase, percent, message, error, result)
- [ ] Tests updated — dead upload tests removed, pending uploads tests kept
- [ ] `ProjectsScreen` still works (pending uploads list renders)
- [ ] Frontend builds clean
