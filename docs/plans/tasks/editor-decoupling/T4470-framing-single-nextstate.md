# T4470: FramingContainer — One Next-State Computation per Gesture

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit item D1

## Problem

[SYNC][DEP] Segments/crops live in `useSegments`/`useCrop` hook state AND mirrored into `projectDataStore.clips[].segments_data/crop_data` (the sidebar progress indicator + export reads). Every gesture handler in `FramingContainer.jsx` hand-rebuilds `{boundaries, segmentSpeeds, trimRange}` for the mirror — 8 sites (:352-355, :438-447, :504-513, :570-579, :616-619, :683-686, :718-727, :762-771, :826-835) — with comments literally fighting React batch timing: *"segmentBoundaries won't have the new value yet... build manually"* (:717, :825). `handleTrimSegment` (:438-447) mirrors a stale pre-toggle value. `syncSegmentsToStore` (:796-804) exists and is unused by the handlers.

This is the definitional fix-the-same-bug-in-N-places pattern: forget the mirror (or mirror a stale batch value) → sidebar/export state disagrees with the editor.

## Solution

Per gesture, compute the next state ONCE, then fan out:

```
const next = computeNextSegments(current, gesture)   // pure function
applyToHook(next)          // reducer/setter
mirrorToStore(next)        // one shared helper (fix + use syncSegmentsToStore)
persistSurgical(gesture)   // unchanged T3800-wrapper call
```

- `computeNext*` are pure and unit-testable — no reliance on post-setState reads, which deletes every batching workaround.
- One `mirrorToStore` helper for segments and one for crops; handlers never build mirror payloads inline.
- The surgical API payloads DO NOT CHANGE (persistence semantics stay; this is in-memory/store flow only).

## Context

- Files: `containers/FramingContainer.jsx`, `modes/framing/hooks/useSegments.js`, `useCrop.js`, `stores/projectDataStore.js` (`updateClipData`)
- Longer-term the mirror should die entirely (store-as-single-owner), but that's a bigger design; this task makes the mirror single-path and stale-proof. Note the follow-up idea in the PR, don't do it.
- If T4220 landed, its frontend split-removal semantics live in `useSegments` — your `computeNext` for split-removal must match it.

## Steps

1. [ ] Table the 8 sites (gesture → what it mirrors → staleness hazards) in the Progress Log.
2. [ ] Unit tests for each `computeNext*` (incl. the trim case that's stale today — test pins the CORRECT value).
3. [ ] Migrate handler-by-handler; assert store mirror === hook state after every gesture (add a dev-mode invariant check helper used by tests).
4. [ ] E2E framing flow + sidebar indicator manual check.

## Acceptance Criteria

- [ ] Zero inline mirror-payload construction in handlers; no batching-workaround comments remain
- [ ] Store mirror provably equals hook state after every gesture (test-asserted)
- [ ] Trim-gesture staleness bug fixed (test would fail on old code)
- [ ] Surgical API payloads byte-identical to before (spot-check via network assertions in tests)
