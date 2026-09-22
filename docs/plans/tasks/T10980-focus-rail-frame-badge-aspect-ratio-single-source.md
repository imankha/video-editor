# T10980: Focus clip rail "Frame clip" badge; aspect-ratio selector reads the project, not a stale copy

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Reports (user, prod screenshot 2026-09-21, clip "Great Moves and Pass")

1. The Focus clip rail should show a yellow "Frame clip" badge for an unframed clip, not a
   done-looking mark. (The green disc in the screenshot is the play's RATING icon, rating 4 =
   green "Good"; the unframed state was only a faded gray crop icon on the right. User ruling:
   keep the rating disc, replace the crop icon with the progress badge.)
2. Entering Framing showed "Landscape (16:9)" selected while the crop box on the video was
   portrait.

## Root cause of (2)

The selector read `projectDataStore.aspectRatio`, a second in-memory copy of
`projects.aspect_ratio`. That copy was written ONLY by `useProjectLoader.loadProject` (the Drafts
open path) and after a successful ratio POST. Every other Focus entry (Annotate save -> Framing,
auth/payment return) selects the project without `loadProject`, so the copy kept the previous
project's value while the crop box (clip keyframes) and the reticule constraint (`useCrop`, fed
from `project.aspect_ratio`) showed the real one. Clicking the correct button was then a silent
no-op because `handleAspectRatioChange` compared against the real value.

## Fix

- `useClipManager.globalAspectRatio` is derived from `projectsStore.selectedProject.aspect_ratio`.
  `projectDataStore.aspectRatio`, `setAspectRatio`, `useProjectAspectRatio`, the `aspectRatio`
  parameter of `setProjectClips`, and the never-called local `setGlobalAspectRatio` re-fit in
  `useClipManager` are deleted. One source; nothing to reconcile.
- `ClipSelectorSidebar`: the framing indicator is the shared `Disc` from `PlayProgressBadges`
  (amber dashed "Frame clip" when undone, green check "Framed" when the clip has crop keyframes
  or user segment edits). `data-testid="clip-framing-badge"`, `data-state` undone|done.

## Verification

- `npx vitest run src/hooks/__tests__/useClipManager.aspectRatio.test.js src/stores/projectDataStore.changeAspectRatio.test.js src/stores/projectDataStore.invalidateClips.test.js src/containers/ExportButtonContainer.test.js src/components/ClipSelectorSidebar.test.jsx src/screens/__tests__/focusCompletionPlayerProps.test.jsx src/screens/__tests__/focusScreenStaleClipGuard.test.jsx src/modes/annotate/components/AnnotateFullscreenOverlay.progressBadges.test.jsx src/modes/FocusModeView.advancedEditing.test.jsx` -> 9 files, 80 passed.
- Live (dev, fixture account, clip "dfsadf"): rail shows the green Framed disc; selector shows
  Portrait matching the portrait crop; Landscape/Portrait switches re-fit the box and the
  selector follows (3 sequential calls, ~100 ms total in dev).

## Not in this task

The "big lag on the first Portrait/Landscape switch of a session" report is T10990.
