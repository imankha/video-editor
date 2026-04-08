# T1100: Remove Dead Debounced saveOverlayData

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

`saveOverlayData` in OverlayContainer.jsx:437-464 is dead code — defined and returned from the container but never called by any consumer. It also has a 2-second debounce which violates the gesture-based persistence rule (CLAUDE.md).

## Solution

1. Remove `saveOverlayData` and its `pendingOverlaySaveRef`
2. Audit how overlay data is actually persisted — verify it follows the gesture-based pattern (no reactive `useEffect` saves)
3. If overlay persistence uses a reactive pattern, refactor to gesture-based

## Context

### Relevant Files
- `src/frontend/src/containers/OverlayContainer.jsx` - Dead function at lines 437-464
- `src/frontend/src/screens/OverlayScreen.jsx` - May have the actual persistence logic

### Technical Notes
- The function uses a 2-second `setTimeout` debounce wrapping a `PUT /api/export/projects/{id}/overlay-data`
- `pendingOverlaySaveRef` is used for the debounce timer
- Line 466 comment says "Effects for highlight region initialization and persistence are in OverlayScreen.jsx" — that's where the real persistence lives and should be audited

## Acceptance Criteria

- [ ] `saveOverlayData` and `pendingOverlaySaveRef` removed from OverlayContainer
- [ ] Overlay data persistence confirmed to follow gesture-based pattern
