# T11230: Remove Reels building surfaces (Reels tab, Create reel, from-clips)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

The home screen has a Reels tab and a "Create reel" flow that assembles raw clips into a
multi-clip project. The product is dropping that until Reels v2 (T11300) comes back as a
post-publish stitcher. None of this code fits v2 (it assembles RAW clips into an EDITABLE
project; v2 stitches PUBLISHED clips), so it is deleted, not hidden.

## Solution

Delete:
- Reels tab `inProgressReels` + route `/home/reels-in-progress` (`ProjectManager.jsx:406-412,
  1554-1572, 2206-2268`; `editorStore.js:52`). Route redirects to Clips (R6).
- "Create reel" CTA + `GameClipSelectorModal` (`ProjectManager.jsx:2240-2250, 2286-2294`;
  `GameClipSelectorModal.jsx`), `POST /api/projects/from-clips` (`projects.py:799-893`).
- `EmptyTabGuide` `reels` / `ReelsActions`, `REELS_PARTIAL_FILLER` (`EmptyTabGuide.jsx:76,187-198`;
  `emptyStates.js:65-76,109-112`; `ProjectManager.jsx:96`).
- displayNames `LIBRARY_ACTIONS.CREATE_REEL*`, `DELETE_REEL`, `RENAME_REEL`, `PUBLISH_REEL`,
  `SECTION_NAMES.REELS`, `SECTION_NAMES_SHORT.REELS` (`displayNames.js:210,230-238,252`).
- `DraftTile` `isReel` label branch (`DraftTile.jsx:368-372`), `FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP`
  + its routing (`displayNames.js:509-520`, `FocusScreen.jsx:1228-1230`, `OverlayScreen.jsx:1682-1684`).
- Reword: Clips copy "publish it alone or into a reel" (`emptyStates.js:107`); Clips-tab group
  "Other reels" -> "Other clips" (`ProjectManager.jsx:936,2145`, copy bug today).

Keep: Published tab, `PublishedReelsPanel`, `ReelTile`, `DraftReelPreview`, `reelPreviewStore`,
`finishedReelNav`, `useReEditReel`, `reelOrder` (single-clip preview/publish plumbing, internal
names), collections, ranking, shares, move-to-profile, quests (`move_to_my_reels` is a persisted
step key: do not rename).

## Context

### Tests
Unit: `ProjectManager.fourTabIA`, `.homeTabDefaults`, `.gameGrouping`, `GameClipSelectorModal*`,
`EmptyTabGuide`, `editorStore`, `DraftTile`, diag pages `t8520diag`, `t9110diag` (import MULTI_CLIP).
E2E: `cta-visibility`, `new-user-flow`, `regression-tests`, `T9530-library-vocabulary.qa`,
`T8555-four-tab-split.qa`, `T8360-clips-highlights-split.qa`, `T8350-multiclip-staleness-cue.qa`.

### Related Tasks
- Depends on: T11220 (no draft may vanish), R6
- Downstream: T7630 targets "Build New Reel" + the In Progress Reels tab (R12)

## Acceptance Criteria

- [ ] Red-then-green: home has no Reels tab; `/home/reels-in-progress` lands on Clips
- [ ] `from-clips` returns 404/405; no frontend reference remains
- [ ] Every pre-existing draft still reachable (T11220 fixture)
- [ ] Live-driven desktop + 393 px
