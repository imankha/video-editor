# T11830: No fake zeros or "Ready" while loading

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend only, ~5 files + tests, ~100 LOC)
**Created:** 2026-10-04
**Decision gate:** none (recommendation only). Runs after T11740 (same header files). **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 5 of 5 in [Epic C](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

1. **Annotate header shows "0" plays and locked steps while the game loads** (iPhone finding #10).
   T4000 sets the video `src` before `/load` resolves (`containers/AnnotateContainer.jsx:1155`), so
   the header renders with `clipCountDisplay = clipRegions.length = 0` (`screens/AnnotateScreen.jsx:694`,
   `useAnnotate.js:801`) and locked tabs, then jumps to "6". `isLoadingAnnotations`
   (`useAnnotate.js:293, 709`) is only true in a queued edge case, not during `/load`.
2. **The preloader says "Ready" while still covering the page** (desktop D9, tablet T-05).
   `dismissPreloader()` (`App.jsx:241-250`) sets the text to "Ready", waits 150ms, then fades over
   300ms. In background or throttled tabs the timers stretch, so "Ready" sits over a usable page.
   The overlay is `pointer-events:none` by then but looks blocking. (No screenshot shows it; it rests
   on the written reports.)

## Solution

1. Add a view-only `isGameDataLoading` flag: set `true` in `handleLoadGame` (a user gesture), set
   `false` after `applyGameData` + import finish **and on every `/load` error path**
   (`AnnotateContainer.jsx:1176-1198`). Never persist it.
   - Plays chip while loading: `<span className="inline-block w-5 h-3 rounded bg-white/15 animate-pulse" aria-label="Loading plays" />` instead of "0".
   - Locked tabs while loading: `Loader2` (spinning) instead of `Lock`, `aria-busy="true"`; the
     locked-tab toast says **Loading your plays...**. The lock look appears only after load resolves.
2. Preloader: never show "Ready". Keep the spinner and "Loading" until removal. Add the `fade-out`
   class immediately when dismissing, and remove the element on `transitionend` with a 500ms
   timeout fallback. Extract the logic to `utils/preloader.js` so it can be unit-tested.

## Relevant Files (under `src/frontend/src/`)

- `containers/AnnotateContainer.jsx:1155, 1176-1198, 1200-1224`
- `screens/AnnotateScreen.jsx:685-698, 792, 800-807, 822-826` (T7280 re-render comment)
- `components/shared/ModeSwitcher.jsx:97-104, 149` (lock reasons, lock icon)
- `App.jsx:241-257, 300, 434`; `src/frontend/index.html:33-45, 83-102` (static preloader markup/CSS)

## Implementation Steps

1. Add the flag to the container's view state, thread it to `AnnotateScreen` and the header chip,
   and pass `isLoading` into `ModeSwitcher`.
2. Write `utils/preloader.js` with `dismissPreloader(el)`; replace the inline function in `App.jsx`.
3. Delete the "Ready" text assignment.

## Acceptance Criteria

1. Opening a game with 6 plays never shows "0" in the header; it shows the placeholder, then 6.
2. While loading, steps show a spinner, not a lock; tapping says "Loading your plays...".
3. A failed `/load` clears the placeholder (no endless spinner).
4. The string "Ready" no longer appears in the preloader.

## Tests (red first)

- New `utils/preloader.test.js` (fade class added at once; element removed on `transitionend` or timeout).
- New `AnnotateScreen.loadingPlaceholder.test.jsx` (placeholder while loading, count after, cleared on error).
- Regression: `useAnnotate.import.test.jsx`, `AnnotateScreen.rateGate.test.jsx`,
  `AnnotateScreen.publishedBail.test.jsx`, `ModeSwitcher.test.jsx`.

## Landmines

- T7280: do not make `AnnotateScreen` re-render on per-tick state; keep the flag out of the
  redirect/restore effects.
- `functions/assets/[[path]].js:3`: a missing asset leaves the preloader up forever. Do not make
  dismissal depend on anything that can fail.
- No `useEffect` that writes anything.
