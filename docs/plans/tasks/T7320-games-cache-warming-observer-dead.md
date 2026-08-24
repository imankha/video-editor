# T7320: Games-tab cache warming has been dead since T5681

**Status:** DONE (deployed 2026-08-24 prod)
**Impact:** 6
**Complexity:** 1
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

Viewport-aware cache warming on the Games tab never fires. Every game tile is skipped, so
`prioritizeUrls` is never called and no game video is ever promoted in the warm queue on
that screen.

`ProjectManager.jsx` (~L297-320) sets up an `IntersectionObserver` whose callback reads
`entry.target.dataset.gameId`, then registers targets with:

```js
for (const child of container.children) {
  observer.observe(child);
}
```

When that observer was written (**T2890**, 2026-05-15) the container's DIRECT children WERE
the `data-game-id` wrappers, so this was correct. **T5681** (2026-07-24, chronological poster
grid) inserted a per-month group wrapper between the container and the tiles:

```
gamesContainerRef
  └── <div key={monthKey}>          ← observed (no data-game-id)
        └── <div className="grid">
              └── <div data-game-id={id}>   ← should be observed
```

The observer now watches month blocks. `entry.target.dataset.gameId` is `undefined` on
every one, so the callback hits `continue` for all of them and `prioritizeUrls(urls)` is
never reached with a non-empty list.

Dead in production for ~4 weeks (T5681 shipped 2026-07-24). It fails silently and
symptom-free — warming is a perf optimization, so the only effect is that game videos on
the Games tab load slower than intended.

**NOT a T7290 regression.** T7290 (match-date grouping) changed the grouping KEY only and
left the DOM nesting exactly as T5681 built it — verified against `origin/master`, which
already contains the `<div key={monthKey}>` wrapper. The bug was found while reviewing this
component for the T7290 follow-up work and initially misattributed to T7290; the git history
(`git log -S "for (const child of container.children)"` vs `-S "Month header with game count"`)
settles it.

Why the diff review missed it: nothing in T5681's changed lines is wrong. The break is in an
untouched `useEffect` 700 lines away whose correctness silently depended on the DOM depth the
render produced. Related precedent already in the codebase: the T5820 reference-card
`scrollIntoView` at ~L758 uses `container.querySelector('[data-game-id]')` and was therefore
unaffected — the two call sites disagreed on how to find a tile, and only one survived.

## Solution

Query descendants instead of direct children, so the lookup is depth-independent and cannot
break again when the grouping DOM changes:

```js
for (const tile of container.querySelectorAll('[data-game-id]')) {
  observer.observe(tile);
}
```

This matches the T5820 call site's approach, making both tile lookups in the file consistent.

Deliberately NOT done here: any change to the warming policy, threshold, or queue behavior.
This restores the intended behavior, nothing more.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ProjectManager.jsx` — the observer effect (~L297-320); the
  `data-game-id` wrapper it must find (~L1129-1135); the T5820 `querySelector` precedent
  (~L758).
- New unit coverage asserting the observer registers every tile THROUGH the group nesting —
  the specific thing that regressed, and the guard that makes the next grouping change safe.

### Related Tasks

- Broken by: T5681 (chronological poster grid, 2026-07-24).
- Observer introduced by: T2890 (cache warming efficiency, 2026-05-15).
- Found during: the T7290 follow-up UX review. A larger Games-tab layout change (rail
  headers + derived column count + tournament grouping) is queued behind this and will add
  ANOTHER wrapper level, which is why this is fixed first and standalone — the fix must land
  before more nesting arrives, and the test must be depth-independent so the layout task
  cannot silently re-break it.

### Technical Notes

- `container.querySelectorAll` returns a static `NodeList`, which is directly iterable —
  no `Array.from` needed.
- The effect re-runs on `[games]`, and `observer.disconnect()` in cleanup drops all
  registrations, so no double-observe on re-render.
- `promotedGameIdsRef` dedupes across effect runs, so a tile already promoted stays promoted;
  the fix does not cause repeat `prioritizeUrls` calls for the same game.
- jsdom has NO `IntersectionObserver` — a test must stub it (the existing
  `ProjectManager.homeTabDefaults.test.jsx` stubs a no-op version; this test needs one that
  RECORDS observed elements).

## Implementation

### Steps

1. [ ] Branch `feature/T7320-games-cache-warming-observer` off master.
2. [ ] Replace the direct-children loop with a `[data-game-id]` descendant query.
3. [ ] Unit test: render the games grid across MULTIPLE month groups and assert `observe`
       was called once per `[data-game-id]` element, with the tile elements themselves (not
       the group wrappers) — i.e. the assertion fails on the old code.
4. [ ] Run the relevant set: the new test, `ProjectManager.homeTabDefaults.test.jsx`,
       `ProjectManager.gameGrouping.test.jsx`, `GamesListSkeleton.test.jsx`.
5. [ ] Commit; Branch CI green.

### Progress Log

**2026-08-19**: Filed from a UX-review pass over `ProjectManager` during T7290 follow-up
design. Attribution corrected from T7290 to T5681 via git history before filing.

## Acceptance Criteria

- [ ] The observer registers every `[data-game-id]` tile regardless of how many wrapper
      levels the grouping render introduces.
- [ ] The new test FAILS against the pre-fix code (verified, not assumed) and passes after.
- [ ] No change to warming policy, thresholds, dedupe behavior, or the callback body.
- [ ] Relevant test set passes; Branch CI green.
