# T8060: Reel control tracks Focus -> Overlay -> Completed/Published

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-30 (follow-up to T8040 while live-testing)

## Problem

T8040 made the Reel control in ClipDetailsEditor show a "Focus" button once a
reel exists. But that's only the FIRST stage: once Focus has been exported
(there's a working video), the next useful action is Overlay, not Focus again
-- and once Overlay has also been exported (a final video exists), there's no
next action to open at all from Annotate; the control should just say the reel
is done, distinguishing "Completed" (exported, not yet published) from
"Published" (moved to My Reels).

## Solution

Reuse the SAME per-project stage fields `DraftTile`/Reel Drafts already read
(`has_working_video`, `has_final_video`, `is_published` -- no new backend
data needed, no schema change):

- No reel yet -> "Create Reel" (unchanged)
- Reel exists, `!has_working_video` -> "Focus" button (T8040, unchanged)
- Reel exists, `has_working_video && !has_final_video` -> "Overlay" button
  (NEW), opens Overlay mode for that project via a new
  `AnnotateScreen.openClipInOverlay` handler (generalized from T8040's
  `openClipInFocus` into `openClipInEditorMode(autoProjectId, mode)`)
- Reel exists, `has_final_video && !is_published` -> plain "Completed" label,
  no button
- Reel exists, `has_final_video && is_published` -> plain "Published" label,
  no button

`ClipDetailsEditor` looks up the linked project via `useProjectsList()`
(`region.autoProjectId` against the already-fetched `projectsStore.projects`
array) -- the same list Reel Drafts renders from, so there's no separate
fetch or stage computation to keep in sync.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` -- the
  Reel control's 5-way branch + `useProjectsList()` lookup
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` -- threads
  `onOpenClipInOverlay` alongside the existing `onOpenClipInFocus`
- `src/frontend/src/screens/AnnotateScreen.jsx` -- `openClipInEditorMode`
  (generalized), `openClipInFocus`/`openClipInOverlay`
- `src/frontend/src/components/DraftTile.jsx` -- source of truth for the
  stage fields' meaning (not modified, just read the same way)

### Explicitly out of scope (filed as T8070)
None of this accounts for the clip's start/end time changing AFTER the
linked reel was produced -- see T8070.

## Acceptance Criteria

- [x] Reel with Focus exported but not Overlay shows an enabled "Overlay"
  button that opens Overlay mode on that project.
- [x] Reel with both exported, not published, shows "Completed" (no button).
- [x] Reel with both exported and published shows "Published" (no button).
- [x] Existing "Create Reel" / "Focus" states unchanged.
- [x] Unit tests + live browser verification.

## Progress Log

**2026-08-30**: Implemented and live-verified against real reels in 3 of the
4 post-creation states (Overlay button -> navigated correctly and landed on
the right clip; Completed status rendered correctly with no button). The
4th (Published) is covered by unit test with the identical code path (just
one more boolean) -- no real published-and-still-linked example was readily
available in the local dev account to click through live. 9/9 targeted unit
tests green, build clean.
