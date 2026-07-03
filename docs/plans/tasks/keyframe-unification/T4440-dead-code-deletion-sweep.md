# T4440: Dead Keyframe/Timeline Code Deletion Sweep

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-03
**Epic:** [keyframe-unification](EPIC.md) · Audit items C3 + frontend-sync #14/#15 · Absorbs **T3810**

## Problem

A dead parallel timeline/keyframe stack still absorbs bug fixes and misleads greps. Verified dead (re-prove each with the grep before deleting — paste results in the Progress Log):

| Target | Evidence |
|--------|----------|
| `modes/overlay/OverlayTimeline.jsx` (159 L) | No live importer; live path is OverlayContainer → OverlayMode → shared RegionLayer |
| `modes/overlay/layers/HighlightLayer.jsx` (314 L) | Dead copy-paste sibling of CropLayer; still carries the stale pre-flat-list comment ("permanent keyframe at frame 0") |
| `components/Timeline.jsx` | Imported by nothing |
| `modes/overlay/hooks/useHighlight.js` + re-export + test | T3810: exported from overlay/index.js, never instantiated (live system is useHighlightRegions) |
| Container wrappers `FramingTimeline`/`OverlayTimeline` (`FramingContainer.jsx:995-1065`, `OverlayContainer.jsx:644-718`) | Pure ~30-prop pass-throughs that **name-collide** with the (different!) mode-level components — grep-and-fix lands in the wrong file |
| `OverlayVideoOverlays` (`OverlayContainer.jsx:629`) | References `regionDetectionData` not in scope — ReferenceError if ever rendered; zero call sites |
| framingStore corpses: `clipStates` (setClipState zero callers; `utils/editorContext.js:74` reads it and always gets null), `videoFile` (never set), `hasExported`/`exportedStateHash`/`markExported` (markExported never called) + dead selector `OverlayScreen.jsx:95` | frontend-sync audit #14 |
| `editorStore.annotateHasSelectedClip` + its reactive writer (`AnnotateContainer.jsx:241-243`) | Stored derived flag, zero readers |

## Solution

Delete everything above. For the container wrappers: inline the direct `FramingMode`/`OverlayMode` usage at their single render sites; then rename-or-delete the dead mode-level `OverlayTimeline` so no name collision remains. For `editorContext.js:74`: it consumes permanently-null data — fix its logic or remove the branch (read what it's for first).

## Steps

1. [ ] Per target: grep-prove, delete, note in Progress Log.
2. [ ] Frontend build check (lint skill) after each group — dangling imports surface immediately.
3. [ ] Full frontend unit tests + a manual smoke of all three editor modes (drive-app-as-user or dev click-through).
4. [ ] Mark T3810 absorbed (PLAN.md row → DONE-via-T4440 note when this ships).

## Acceptance Criteria

- [ ] All listed targets gone; ~800+ lines removed
- [ ] No component name collisions between containers/ and modes/
- [ ] Build + tests green; three modes smoke-tested
- [ ] Each deletion's caller-grep recorded

## Non-Goals

Extracting shared components (T4450), touching live keyframe logic (T4460). Delete only.
