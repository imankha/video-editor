# T7170: Remove preview reveal delay

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-17
**Updated:** 2026-09-17

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

## Implementation

### Steps
1. [x] `PREVIEW_REVEAL_DELAY_MS` zeroed in `useTilePreview.js`, doc comments updated to match
   the new behavior. `PREVIEW_WARM_DELAY_MS` (100ms request-storm guard) untouched.
2. [x] Updated the three existing test files that assumed a positive floor
   (`useTilePreview.test.jsx`, `ReelTile.preview.test.jsx`, `DraftTile.preview.test.jsx`) —
   several assertions did `advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS)`,
   which is now negative and throws; others silently weakened to a 0ms no-op advance. Fixed by
   advancing off `PREVIEW_WARM_DELAY_MS` instead, with a small positive tick (empirically
   confirmed vitest's fake timers do not retroactively fire a same-instant 0ms timer scheduled
   during an already-completed `advanceTimersByTime` call — needs its own subsequent tick).
3. [ ] Real-browser flicker check NOT performed in-container (no live dev stack / Playwright
   session run for this task). Given the change is a pure constant + the WARM 100ms dwell guard
   is untouched, risk is judged low, but this is a stated acceptance criterion and staying
   honest about it: **this is the pending staging-verification step**, not a silent gap.

### Progress Log

**2026-09-17**: Implemented inline (S/M-tier, no container, matches the container-gate rule).
Red/green independently proven: reverted the source constant alone (kept the new/updated
tests) → 10/28 relevant tests fail with either a thrown "Negative ticks" error or a
phase-mismatch, all against the OLD 450ms-floor assumption; restored → 28/28 pass. Pushed
directly to master (T10100 precedent for small direct fixes).

## Acceptance Criteria
- [x] Desktop hover: preview reveals as soon as content is ready, with no artificial wait beyond
      real load time
- [x] `PREVIEW_WARM_DELAY_MS` (request-storm guard) unchanged
- [ ] Real-browser check: fast mouse pass across a tile grid does not visibly strobe/flicker —
      **NOT YET DONE**, owed as staging verification (see Progress Log)
- [x] Existing T6420/T6820 unit tests updated for the new floor value and still pass (28/28)
- [x] Frontend unit tests pass (relevant set; full suite not run per Test Scope Policy)
