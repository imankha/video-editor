# T7170: Remove preview reveal delay

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-17

**Filed as T7150, renumbered to T7170 same day** — a concurrent session claimed T7150 for an
unrelated bug fix (43p, collection share intro sequencing) in this shared checkout before this
file was committed. No content change, ID only.

Epic child 1/3 — see [EPIC.md](EPIC.md) for the design authority and shared invariants.
Builds on T6420 (`useTilePreview`) + T6820 (content-ready race). No dependency on T7160, but
land this one first so T7160 inherits the zero-delay behavior instead of migrating the timing
twice.

## Problem

`useTilePreview.js` gates REVEAL on `max(PREVIEW_REVEAL_DELAY_MS, real content-load-ready
time)` — a deliberate ~450ms floor added 2026-08-03 as flicker-avoidance ("mousing across a
grid must not strobe") and preserved by T6820 (2026-08-14) even after generalizing the
floor-vs-real-latency race so slow tiers don't pay floor-plus-load-time back to back. User
feedback 2026-08-17: any perceptible delay before the preview plays reads as sluggish, on both
tile types (ReelTile, DraftTile) — remove it.

## Solution

Set `PREVIEW_REVEAL_DELAY_MS` (`src/frontend/src/hooks/useTilePreview.js`) to 0 — reveal fires
purely on the real content-ready signal. Two things stay untouched:

- **`PREVIEW_WARM_DELAY_MS`** (100ms hover dwell before attaching `src` and buffering) — this is
  invisible to the user (nothing shows yet) and exists to stop a fleeting mouse pass across the
  grid from firing a request per tile crossed (T6290's lesson: "grid at rest fires ZERO video
  requests"). Removing it would reopen that request-storm risk. Keep as-is.
- The `tryReveal()` two-condition race itself (floor-reached AND content-ready) — make the
  floor trivially satisfied (0ms) rather than deleting the structure, so T6820's real-load-
  latency behavior (a slow tier reveals exactly when its content is ready, never earlier) is
  preserved unchanged.

Real-browser verification is required (not jsdom — T5380): confirm a fast mouse pass across a
grid of hover-eligible tiles does not visibly flicker/strobe now that the floor is gone (the
100ms WARM dwell should still absorb most of that). If a flicker IS visible, report it back as
a real finding — don't silently reintroduce a floor to paper over it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useTilePreview.js` — `PREVIEW_REVEAL_DELAY_MS`, `tryReveal()`,
  `onPointerEnter`'s `revealFloorTimerRef` timer
- `src/frontend/src/hooks/useTilePreview.test.jsx` — existing timing tests assume the floor;
  update assertions for the new value
- `src/frontend/src/components/collections/ReelTile.preview.test.jsx`,
  `src/frontend/src/components/DraftTile.preview.test.jsx` — consumer-level timing assertions

### Related Tasks
- T6420 (introduced the floor), T6820 (generalized the floor-vs-real-latency race — that race
  structure survives here, only the floor constant changes)
- T7160 (mobile tap-to-play) reuses this same reveal race for its touch trigger

### Technical Notes
- Tier: **S/M**. No schema, no backend, one constant change + its tests + a real-browser flicker
  check. Reviewer recommended (shared primitive both tile types depend on) but no Architect gate
  — this is not a new pattern.

## Acceptance Criteria
- [ ] Desktop hover: preview reveals as soon as content is ready, with no artificial wait beyond
      real load time
- [ ] `PREVIEW_WARM_DELAY_MS` (request-storm guard) unchanged
- [ ] Real-browser check: fast mouse pass across a tile grid does not visibly strobe/flicker
      (evidence captured; a real flicker gets reported back, not silently patched with a new floor)
- [ ] Existing T6420/T6820 unit tests updated for the new floor value and still pass
- [ ] Frontend unit tests pass
