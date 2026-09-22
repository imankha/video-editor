# T10960: Trimming one handle in the clip editor threw the other handle off the track

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 6
**Complexity:** 1
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

Reported live on prod by imankh@gmail.com (2025-2026 profile, first uploaded game, clip
"2. Great Goal"): in the Annotate clip editor the user dragged the START lever inward and, the
moment the trim saved, the END lever disappeared off the right edge of the trim track. Readout
showed 24:01.1 -> 24:03.2 (2.1s), start lever at ~82%, no end lever.

## Root cause (code-confirmed + reproduced in a unit test)

`ClipScrubRegion` (edit mode, `clipEditorActive && existingClip`) zooms the track to
`anchor +/- editHalfWindow` (T8760). The two inputs came from DIFFERENT snapshots:

- `editHalfWindow` was re-derived on every render from the LIVE `existingClip` (a new object after
  every committed trim, T10410), so after the start drag saved it shrank to the 2.1s clip's
  `1.05 + max(2, 1.05) = 3.05s`.
- `anchor` was frozen in a ref per clip ID at the OLD clip's midpoint.

Old-center +/- new-half-width no longer contained the untouched end: it rendered at 117% `left`.
Any trim that moves the clip's midpoint by more than the shrink in half-window reproduces it.

## Fix

`ClipScrubRegion.jsx`: in edit mode the anchor is the live `existingClip` midpoint (same snapshot
as the half-window), so the window always frames the SAVED clip; create mode keeps the frozen ref
(its anchor is `currentTime`, which `onSeek` moves during a drag). Added `data-testid` on the two
handles. Regression test `ClipScrubRegion.test.jsx` "edit window follows the saved clip (T10960)"
replays the prod trim (8.2s -> 2.1s by moving start) and asserts both handles stay within 0..100%
(red at 117% without the fix), plus a create-mode guard that the window does NOT re-anchor on seek.

## Verification

- `npx vitest run src/modes/annotate/components/ClipScrubRegion src/modes/annotate/components/ClipDetailsEditor.trimPersist.test.jsx src/modes/annotate/components/AnnotateFullscreenOverlay` -> 20 files, 173 passed.
- Staging: open any existing clip in the editor, drag start in by several seconds, release; the end
  lever must stay visible and the window re-frame the shortened clip.
