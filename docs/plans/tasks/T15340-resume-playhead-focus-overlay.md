# T15340: Resume point restores the playhead on Focus and Overlay

**Status:** STAGING
**Impact:** 3
**Complexity:** 3
**Tier:** M (frontend only, no schema change)
**Created:** 2026-11-08
**Updated:** 2026-11-08

Split out of T14980 by owner ruling 2026-11-08.

## Problem

T14980 records the playhead `t` for every screen, but only Annotate can seek on open (`setPendingGame`'s
seekTime via `?t=`). Focus and Overlay have no URL-driven seek, so a restored play there opens at the start.

## Solution

Extend `?t=` to `/focus/p/{id}` and `/overlay/p/{id}`: the mode view seeks its player once the working
video has loaded, one shot, then drops the param. The resume restore passes `t` on those paths.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FocusModeView.jsx`, `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/utils/resumePointRestore.js`
- `src/frontend/src/stores/editorStore.js`

### Related Tasks
- T14980 (the resume point), T14970 (URL grammar).

## Acceptance Criteria

- [ ] `/focus/p/{id}?t=37` and `/overlay/p/{id}?t=37` open with the player at 0:37.
- [ ] A restored Focus or Overlay point opens at its recorded playhead.
- [ ] A `t` past the clip end clamps to the end; the param is consumed once, not on later navigation.
