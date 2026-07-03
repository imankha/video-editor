# T4600: regionTrack — One Interval Engine (Annotate / Overlay / Segments)

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-03
**Source:** Audit item C5 ([audit doc](../audit-2026-07-03-code-quality.md)) · **Architecture-gated (Stage 2 required)** · After keyframe-unification epic

## Problem

[DRY] The "sorted non-overlapping time intervals on a timeline" model — create with min-duration, boundary dragging with neighbor clamping, overlap detection, visual-percent layout — is implemented three times:

- `modes/overlay/hooks/useHighlightRegions.js:255-430` (`generateRegionId`, `wouldOverlap`, `addRegion` w/ min-duration back-extension, `moveRegionStart/End` w/ neighbor clamping, `regionsWithLayout` :61-76)
- `modes/annotate/hooks/useAnnotate.js:249-598` (`generateClipId` — same `Date.now()+random36` pattern :249-251, `addClipRegion` clamping :385-430, `moveRegionStart/End` :578-598, `regionsWithLayout` :344, overlap detection :601-616)
- `modes/framing/hooks/useSegments.js` (820 L; boundary/segment layout + trim)

Three editing surfaces, one model, three bug surfaces.

## Solution (incremental — the audit rates a big-bang high-risk)

Pure `utils/regionTrack.js`: `createRegion`, `moveBoundary(regions, id, edge, t, {minDuration, clampToNeighbors})`, `layoutRegions(regions, duration)`, `findOverlaps`. Consumed by all three hooks, migrated in strict risk order:

1. **Layout math first** (`regionsWithLayout` percent calc) — pure, lowest risk, all three hooks.
2. **Overlap detection + creation clamping** — annotate + overlay.
3. **Boundary dragging** — the risky one (per-mode clamping semantics differ subtly: characterize each mode's drag behavior with tests BEFORE unifying; genuine semantic differences become options, not casualties).
4. **useSegments last, maybe never fully:** segments are boundaries-between-cuts, not free regions — the design doc must decide whether segments share the engine or only the layout/overlap pieces. (Precedent: T3120 was DROPPED from the video-proxy epic for exactly this "different timeline model, risk > benefit" reason — the design phase should treat partial adoption as a first-class outcome.)

Also fix en route (overlay): `restoreRegions` stale-closure (:250 — deps `[framerate]` but uses `calculateDefaultHighlight`/`videoMetadata`); note client-side `Date.now()` region IDs conflict with the backend-IDs rule — check whether region ids ever reach the backend; if yes, flag in the design doc.

## Steps

1. [ ] Stage 2 design doc: API, per-mode drag-semantics comparison table, adoption depth per mode (incl. the segments partial-adoption question). **User approval required.**
2. [ ] Characterization tests per mode for drag/clamp/create.
3. [ ] Waves 1→3 (one wave per branch); wave 4 per the approved design.
4. [ ] E2E all three editing surfaces after each wave.

## Acceptance Criteria

- [ ] Layout + overlap + creation logic exists once
- [ ] Boundary-drag semantics per mode preserved (or intentionally unified with approval), test-pinned
- [ ] Segments adoption depth matches the approved design, with rationale recorded
- [ ] restoreRegions closure bug fixed
