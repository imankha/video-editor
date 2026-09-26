# T11260: Remove multi-clip highlight carry, clip boundaries, Spotlight gates

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

Spotlight and the highlight-carry service contain offset math that only exists to map highlights
across concatenated clips. It is also subtly wrong on the Modal path (dissolve overlap subtracted
but Modal never renders dissolve).

## Solution

Only after T11220 is done (the carry code keeps legacy multi-clip highlights alive on re-export;
under option A re-framing a multi-clip draft is refused, so no re-export happens and it is dead).

- `services/highlight_carry.py:53,128-146,221-300`: `_attribute_clip_index`,
  `_transform_multi_clip`, `_dissolve_offsets_unavailable`, `NOTE_MULTICLIP_RESET`; the
  `clip_count` branch collapses to `_transform_single_clip`. `utils/highlightCarryNote.js:12,27`.
- `poster._accumulate_clip_boundary_offsets` / `clip_boundary_offsets` (`poster.py:367-415`),
  `overlay.py:2097,2147`. Keep `poster.read_clip_segments_for_project` (poster backfill reads it).
- Overlay `hasMultipleClips` gates: `OverlayScreen.jsx:1369,1385`, `OverlayContainer.jsx:120-133`,
  `OverlayModeView.jsx:275,1198`.
- Text snapping to clip boundaries: keep snapping to 0 and end only (`OverlayScreen.jsx:429,770,865,1839`;
  `TextLayer.jsx:43,91`; `utils/textSnapping.js`).

## Context

### Tests
Delete `test_t4355_multiclip_carry.py`, most of `test_t5225_clip_boundaries.py`; rewrite
`highlightCarryNote.test.js`, `OverlayModeView.exportRequiredRace.test.jsx`.

### Related Tasks
- Depends on: T11220, T11250
- **Preserve (T10190, merged PR #492, do not delete):** `OverlayScreen.jsx`'s completion-preview
  payload shaper (currently ~177-179 comment + ~1874-1882, feeds already-derived `gameName` and
  RAW `gameStartTime`/`gameId` to `CollectionPlayer`, gating the "Back to game plays" backlink).
  Distinct from the `hasMultipleClips` gates this task removes, but in the same file — grep
  `T10190` in `OverlayScreen.jsx` before finishing to confirm it still compiles and fires.

## Acceptance Criteria

- [ ] Single-clip re-export carries highlights identically (characterization test before/after)
- [ ] Legacy multi-clip draft still opens in Spotlight and publishes
- [ ] Zero references to removed symbols
