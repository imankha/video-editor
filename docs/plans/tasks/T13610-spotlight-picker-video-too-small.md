# T13610: The "tap your athlete" video is too small to tap a player on desktop

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M (frontend Overlay layout)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900 (report bugs 50, 52; screenshot `p2-spot1-1440.png`).

## Problem

In Add spotlight the portrait video is about 180x320 px on a 1440x900 screen; players are ~15 px tall, so tapping the right one is hard. The coach card's "Got it" wraps onto two lines. Title says "Click your athlete" while the body says "Tap your athlete".

## Repro steps

1. 1440x900, finish Frame > Generate on a portrait highlight, then Add spotlight.
2. Measure the video: `document.querySelector('video').getBoundingClientRect()`.

**Expected:** the video uses the available space (well over 320 px tall at 1440x900); "Got it" on one line; one verb.
**Actual (before fix):** ~180x320.

## Verify the fix (required, before and after)

1. **Before the fix:** record the measured size; a layout test asserting a minimum video height at 1440x900 fails.
2. **After the fix:** same highlight, same size: larger video, test passes.

## Acceptance Criteria

- [ ] Picking video clearly larger at 1440x900 (and still fits at 390)
- [ ] Copy uses one verb; Got it fits
- [ ] Test fails before, passes after
