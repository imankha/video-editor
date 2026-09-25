# T11270: Collapse clip selection to "the clip" (mechanical)

**Status:** TODO
**Impact:** 3
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

After T11240-T11260, `selectedClipId` / `selectedClipIndex` / `clips[]` plumbing in the Framing
store and hooks always refers to one clip, but still reads as a selection model.

## Solution

Move-only commit(s), no behavior change (CLAUDE.md refactoring rule 3): replace the selection
model in `projectDataStore`, `useClipManager` and consumers with an explicit "the project's clip"
accessor. `source_clips` metadata (`useProjectLoader.js:49-62`, `useHighlightRegions.js:887-899`,
`FocusScreen.jsx:1094`) may stay a 1-element list. Surgical `focusActions` calls stay keyed by
clip id.

Optional, separate and risky, NOT in this task: collapsing `latest_working_clips_subquery`
(`queries.py:69-94`) from `(project_id, rc.end_time)` to per-project.

## Related Tasks
- Depends on: T11240, T11250, T11260
- **Preserve (T10190, merged PR #492):** the `gameId`/`onBackToGame` backlink plumbing T11240/
  T11260 were told to keep in `FocusScreen.jsx`/`OverlayScreen.jsx` reads project/clip data but is
  not part of the selection model itself — a mechanical rename pass should leave it untouched, not
  fold it into the new "the project's clip" accessor.

## Acceptance Criteria

- [ ] Characterization: Framing + Spotlight targeted suites identical before/after
- [ ] Diff is renames/moves only (reviewer confirms)
