# T14860: Export progress: never say "Less than a minute remaining" before the render has started

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Measured on master, 2026-11-03, an 8-second portrait highlight on Modal: the progress toast
read "Getting your video ready · 5% · **Less than a minute remaining**" at the start, then
"Sharpening the picture · 61% · Time remaining varies" at 90 s, and finished at **131 s**
(initializing 0.3 s, loading model 6.4 s, upscaling 83.5 s, encoding 2.5 s, uploading 4.1 s,
detecting players 19.7 s). The first estimate is wrong by 2x for the shortest possible clip;
for a 30 s clip it is wrong by far more. A parent who was told "under a minute" and is still
waiting at two minutes assumes it is stuck. The coach does say they can leave and come back,
but the estimate undercuts it. Prod Journey: Pressed Export is not recorded (T14710), so the
"waited and left" share of the Moved framing window loss (42) cannot be measured yet; this
task removes one known cause.

## Solution

- Before the `upscaling` phase reports its first frame, show no time estimate (just the phase
  label and percent).
- Once frames are flowing, estimate from the measured per-frame rate of this job
  (`frame i/N` events are already streamed, ~3 fps on the T4) plus fixed tails for encode,
  upload and detection taken from the last N completed jobs (server-side rolling median is
  fine; no new table, memory only). Round up to the next 30 s and say "about N minutes".
- Keep "Time remaining varies" only when no frame has arrived for 20 s.

Copy follows the glossary and T14540 (no "Export/Generation" wording).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/exportStore.js` - progress state, remaining-time text
- the export progress toast component (grep "Less than a minute remaining")
- `src/backend/app/services/modal_client.py` - progress events (`Clip 1: frame 30/254`) if the rate needs to be forwarded explicitly
- `src/frontend/src/stores/exportStore.*.test.js`

### Related Tasks
- Related: T14710 (record Pressed Export), T14540 (server progress wording), T11340 (parallel export, ICE), Modal Export Safety epic.

## Implementation

### Steps
1. [ ] Failing unit test: no estimate text before the first frame event; estimate derived from frame rate after.
2. [ ] Implement; verify on a real Modal export in dev (8 s and 30 s clips) that the first estimate is within 1.5x of actual.

### Progress Log

**2026-11-03**: Filed from the funnel walk timing log. Not started.

## Acceptance Criteria

- [ ] No time estimate is shown until frames are flowing.
- [ ] Estimates on two real exports land within 1.5x of the actual total.
- [ ] Tests pass.
