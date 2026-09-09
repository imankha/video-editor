# T9300: "Ready to Publish" clip card visually twitches/jitters

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-09

## Problem

Reported by the user on mobile staging 2026-09-09 while viewing the Home Clips tab's "Ready to
Publish" group: the second card in the row ("Good ball movement and pass") was visibly
twitching/jittering — not staying still — while the first card next to it ("dfsadf") was fine.
Not visible in a static screenshot (motion), but reproducible live per the user.

## Solution

Not yet diagnosed. Needs live reproduction on mobile staging first. Likely suspects to check, in
rough order of likelihood given this app's known landmines in this area:
- A hover/tap-preview mechanism (`useTilePreview`, T6420/T7170/T8990) re-triggering a
  warm/reveal cycle in a loop instead of settling
- A measurement effect (e.g. T8990's `fillerFits`/`CardCarousel` post-render measurement pass)
  re-running and flipping a layout decision back and forth — T8990 explicitly guarded against a
  "mount/unmount loop" for its filler slot, so check whether this card is hitting a similar
  self-triggering measurement cycle it wasn't guarded against
- A poster/thumbnail image swapping sources repeatedly (loading vs. loaded state flapping)
- A CSS animation/transition applied without a settled end state (e.g. re-triggered by a parent
  re-render on every store tick)

## Context

### Relevant Files (anticipated — confirm during investigation)
- `src/frontend/src/components/DraftTile.jsx` or equivalent clip-card component rendered in the
  "Ready to Publish" group
- `src/frontend/src/hooks/useTilePreview.js` (or current name) — hover/tap preview warm/reveal
  state machine, T6420/T7170/T8990 history
- `CardCarousel` and its `fillerSlot`/`fillerFits` measurement pass (T8990) if this card sits in
  a carousel rather than a static grid — check for a self-triggering re-measure loop

### Related Tasks
- [T8990](T8990-partial-row-guidance.md) — added `CardCarousel` measurement machinery in this
  same area with an explicit "no mount/unmount loop" guard; worth checking whether this card
  is escaping that guard rather than assuming it's unrelated
- [T7170](../preview-video-improvements/T7170-remove-preview-reveal-delay.md) /
  [T7160](../preview-video-improvements/T7160-mobile-tap-select-plays-preview.md) — tile preview
  timing mechanics on mobile

### Technical Notes
- Real-browser reproduction required (T5380 precedent) — this is exactly the class of bug that
  can be invisible in a static screenshot or a headless test but obvious live.
- Once the mechanism is found, check whether it's isolated to this one card (data-dependent —
  e.g. something specific to this clip's metadata/thumbnail state) or would affect any card in
  the same slot position, since only the second card twitched and the first didn't.

## Acceptance Criteria
- [ ] Reproduced live on mobile staging and root cause identified
- [ ] Card renders stable (no visible movement) once settled
- [ ] Regression test that would have caught the mechanism found (measurement-loop guard,
      preview-state test, or equivalent)
- [ ] Tests pass
