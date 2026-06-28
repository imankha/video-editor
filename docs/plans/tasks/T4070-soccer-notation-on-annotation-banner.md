# T4070: Show soccer-notation time on the annotation banner

**Status:** DONE (deployed 2026-06-28 prod)
**Impact:** 4
**Complexity:** 1
**Created:** 2026-06-28

## Problem
The annotation overlay banner (NotesOverlay) shows the rating notation + clip name (e.g. "!! Brilliant
Pass") during annotation playback and while annotating, but not WHEN in the match it happened. Add the
clip's in-match time in soccer notation (e.g. `34'12"`) to the left of the notation/name.

## Solution
- `NotesOverlay.jsx`: new optional `gameClock` prop; render it left of the notation on the name line.
- `AnnotateModeView.jsx`: compute the clip's in-match start and pass `gameClock` to every NotesOverlay
  render site (playback `activePlaybackClip`, and the two annotate-mode `region` sites). Use the
  existing `formatGameClock(seconds)` (utils/timeFormat.js). In-match start =
  `clip.startTime + (videoSequence>=2 ? boundaryOffsets[videoSequence-2] : 0)` — `startTime` alone for
  single-video games (the common case); `boundaryOffsets` (per-half virtual starts) handles two-half
  games.

## Files
- `src/frontend/src/modes/annotate/components/NotesOverlay.jsx`
- `src/frontend/src/modes/AnnotateModeView.jsx`
- (reuse) `src/frontend/src/utils/timeFormat.js` `formatGameClock`

## Acceptance
- The annotation banner shows the soccer-notation time + notation + name during playback and editing.
- Correct for single-video games; correct half offset for two-half games.
