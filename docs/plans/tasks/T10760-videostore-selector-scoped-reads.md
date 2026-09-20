# T10760: `useVideo` subscribes to the WHOLE videoStore and returns unmemoized actions

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Created:** 2026-09-20
**Updated:** 2026-09-20

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
