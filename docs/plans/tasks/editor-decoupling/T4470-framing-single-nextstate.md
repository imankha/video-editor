# T4470: Trim keeps the Frame screen consistent

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

In Frame, cutting the ends off a clip updates two copies of the cut list: the timeline's, and the one the header badge, the Sharpen button and the credit price read. The second copy is written from values captured before the save finished, and it is written even when the save failed. A split or speed change made in that moment is lost from the second copy, so the price and badge disagree with the timeline until reload. Twelve places rebuild this copy by hand; work out the new list once per action and write both copies from it, undoing both when the save fails. Worked when a failed trim leaves both copies unchanged in a test. Runs after T11270.

## Implementer details

- `handleTrimSegment` in `src/frontend/src/containers/FocusContainer.jsx` writes the store copy after `await setTrimRange`, using `segmentBoundaries` and `segmentSpeeds` captured before the await; it writes the new trim range on a failed save (toast only, no rollback) and the old `trimRange` on untrim.
- Twelve inline `segments_data: {boundaries, segmentSpeeds, trimRange}` rebuilds in that file (it was eight in July), with the 'won't have the new value yet' batching comments still present. `syncSegmentsToStore` exists and is unused.
- Crop mirrors already go through one path (`persistKeyframeEdit`); only segments are hand-mirrored.
- Scope: one pure `nextSegments(current, gesture)` per segment gesture (trim, detrim start and end, split, unsplit, speed) and one mirror helper with rollback. About 150 lines removed. Surgical payloads to the server stay byte-identical.
- T11270 renames `selectedClipId` plumbing throughout this file; start after it merges.
- Knowledge doc: `.claude/knowledge/keyframes-framing.md`.

## Acceptance Criteria

- [ ] When the trim save fails, the timeline and the store copy both show the cut list from before the trim.
- [ ] A split made while a trim save is in flight is present in both copies after the save returns.
- [ ] No inline rebuild of the segments payload remains in the container outside the one helper.
- [ ] The requests sent for each segment gesture are unchanged (payload parity test).
