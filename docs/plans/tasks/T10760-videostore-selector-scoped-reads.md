# T10760: `useVideo` subscribes to the WHOLE videoStore and returns unmemoized actions

**Status:** STAGING (PR #482 merged `e338274d`, 2026-09-21)

## Result (2026-09-20/21)

Implemented, tested, live-QA'd and reviewer-approved in a single container drive call
(`reel-task-t10760`). Selector-scoped every `useVideo.js` read (30 scalar selectors) and
`useCallback`-wrapped all 10 returned actions; API shape unchanged. New tests proven RED against
the pre-fix code (render-count + action-identity), GREEN after. Curated regression set (8
files/64 tests) green, including the `AnnotateContainer.pendingSelection` T10750 pin;
`vitest related` (7 files/29 tests) green across Focus/Overlay/Projects consumers.

Live QA: Annotate scrub/playback, Focus crop-drag during playback, and T10770's exact multi-video
regression check re-run on game 11 — both video sequences, no burst, no `matched no region`, no
`Refusing seek`. Overlay live-drive was skipped and DOCUMENTED (not silently) — neither fixture
account has a publishable reel; its `useVideo` path is covered by the existing
`overlayVideoSource.test.jsx`.

Fresh-context Reviewer: APPROVED, 0 blocking/major (1 pre-existing out-of-scope minor noted).
Branch CI green (frontend job; backend correctly skipped). Provably verified (red→green proof +
CI green) — merged without waiting per standing policy. PR #482, merge commit `e338274d`.
**Impact:** 4
**Complexity:** 4
**Created:** 2026-09-20
**Updated:** 2026-09-20

**Handoff context:** [HANDOFF-T10760-T10770.md](HANDOFF-T10760-T10770.md) — sequencing, environment facts, and the traps from the originating session.

## Problem

`src/frontend/src/hooks/useVideo.js:127` destructures the store selector-less:

```js
} = useVideoStore();
```

Every zustand write allocates a new state object, so `getSnapshot` always differs and
`forceStoreRerender` schedules a **SyncLane** re-render of every subscriber — even for a
value-identical write like `setCurrentTime(181.29)` when it already is 181.29. The RAF playback loop
writes `currentTime` ~60x/second, so whole screens re-render at that rate.

Compounding it, the hook returns **plain unmemoized functions** (`seek` at `useVideo.js:421`, plus
`play`/`pause`/`togglePlay`/`step*`). Their identity churns every render, so every consumer effect
that lists them as a dependency re-arms on every render.

This is the same antipattern T6190 fixed for `focusStore` ("prefer selector-scoped reads on this
screen"); it was never applied to `videoStore`.

## Why it matters (it is not theoretical)

This pairing is the AMPLIFIER that made T10750's bug possible. T10750's retry selector could not
observe its own success specifically because the SyncLane pressure from these writes starved its
DefaultLane update — see `.claude/knowledge/annotate.md` § "Annotate-entry clip selection fires
EXACTLY ONCE". T10750 removed the retry (the correct fix for that bug), but the pressure that made a
retry unobservable is still here, so the next passive-effect setState near a seek is exposed to the
same class of failure.

## Fix

1. Selector-scoped reads: `useVideoStore(s => s.currentTime)` etc., so a subscriber re-renders only
   when the slice it reads actually changes.
2. `useCallback`-wrap the returned actions so consumer dep lists stop churning every render.

Both are mechanical, but `useVideo` is the most widely consumed hook in the app (Annotate, Focus,
Overlay, the diag harnesses), so the blast radius is wide and this deserves its own branch, a real
relevant-test set, and live verification on all three editor screens rather than being tacked onto
another task.

## Acceptance Criteria

- [ ] No selector-less `useVideoStore()` subscription in `useVideo.js`
- [ ] Returned actions are referentially stable across renders when their inputs have not changed
- [ ] A value-identical `setCurrentTime` does not re-render subscribers (measurable: render count)
- [ ] Annotate, Focus and Overlay each verified live (playback, seek, scrub, mode switches)
- [ ] No regression in the T10750 seam: entering Annotate still selects the source clip once
