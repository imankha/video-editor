# T6430: Touch — in-viewport autoplay of the most-visible tile

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-03

Epic child 2/3 — see [EPIC.md](EPIC.md) for the design authority and shared invariants.
Depends on T6420 (reuses `TilePreviewVideo` + the single-active registry).

## Problem

Touch devices have no hover. The industry answer (YouTube/Netflix/Instagram — user-directed
design authority) is in-viewport autoplay while scrolling, NOT long-press: hidden gestures
are the discoverability failure T6300 documented on these exact tiles. Choosing viewport
autoplay also leaves the existing long-press = reveal-actions gesture (T5910/T6300)
completely untouched.

## Solution

On coarse-pointer devices (`useIsCoarsePointer()`), the single MOST-VISIBLE eligible tile
auto-plays a muted looping preview once scrolling settles; scrolling it away (or another
tile becoming most-visible) tears it down.

### Selection + timing

- **Eligible:** tiles with a rendered video (DraftTile `final_video_id`; every ReelTile),
  visibility ratio above a threshold (~60%+). IntersectionObserver with a ratio-threshold
  array; the coordinator picks the highest-ratio eligible tile (ties: nearest viewport
  center).
- **Warm early, reveal late** (same two-stage shape as T6420's hover): warm the winner as
  soon as it becomes most-visible; REVEAL only after scroll settles (~300-500ms without a
  scroll event / `scrollend` where supported). A fast flick through the grid must not
  strobe previews or fire a stream per tile crossed — during continuous scrolling, only the
  current winner is warm, and losers are released immediately.
- **One at a time** app-wide via T6420's registry (a My Reels carousel inside a scrolling
  panel must not fight the Drafts grid).
- **Both scroll axes:** My Reels groups are horizontal carousels inside a vertically
  scrolling panel — most-visible selection must handle both (IntersectionObserver already
  does; verify with nested scrolling containers).
- Backgrounding/tab-hide (`visibilitychange`) and the full player opening tear down the
  preview.

### Coordinator ownership (MVC)

Selection is inherently cross-tile, so a per-tile hook cannot own it: a small coordinator
(context or module singleton, ephemeral state only — NOT a Zustand store, nothing
persists) owned by the panel that owns the grid/carousel. Tiles register their element +
eligibility; the coordinator drives each tile's `active` flag. Keep it dumb: observe, rank,
crown one winner.

### Cost honesty

Scrolling now costs streams (one at a time, released on scroll-away). Reels are short
highlight clips so each range-request is small, but this is the child where data use grows —
`navigator.connection.saveData` and the explicit off switch land in T6440; if T6440 is
deferred, at minimum honor `saveData` here.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/TilePreviewVideo.jsx` + 
  `src/frontend/src/hooks/useTilePreview.js` — from T6420 (extend, don't fork)
- NEW: preview coordinator (e.g. `src/frontend/src/hooks/useViewportPreviewCoordinator.js`)
- `src/frontend/src/components/DraftTile.jsx`, 
  `src/frontend/src/components/collections/ReelTile.jsx` — register with the coordinator
- `src/frontend/src/components/DownloadsPanel.jsx` — owns the grid/carousels; coordinator
  mounts here (and wherever the Drafts grid lives)
- `src/frontend/src/hooks/useIsMobile.js` — `useIsCoarsePointer()`

### Related Tasks
- T6420 (primitive — hard dependency), T6440 (setting/data-saver)
- T5910/T6300 (long-press action reveal must remain byte-identical), T6290 (no request
  storms), T5900 (no portal)

### Technical Notes
- IntersectionObserver fires during scroll — keep the callback cheap (rank + timers only);
  no layout reads in the callback.
- iOS Safari quirks: `playsInline` mandatory (already an epic invariant); verify autoplay
  of a muted element during scroll momentum on a real device or accurate emulation.
- StrictMode double-mount: observer setup/teardown idempotent.
- Tier: **M**. Reviewer yes.

## Implementation

### Steps
1. [ ] Coordinator: registration, IntersectionObserver ranking, scroll-settle gate,
       winner crowning via the T6420 registry
2. [ ] Wire both tiles' coarse-pointer path to the coordinator
3. [ ] Unit tests: winner selection (ratio + center tiebreak), settle gate, loser release,
       visibilitychange teardown, long-press reveal untouched
4. [ ] Real-browser verification with touch emulation + at least one real device pass:
       vertical grid, horizontal carousel, flick-through (no strobe, no request storm —
       network tab evidence)

## Acceptance Criteria

- [ ] On a touch device, the most-visible eligible tile auto-plays muted after scrolling
      settles; scrolling on stops it and releases the stream
- [ ] Fast flick through the grid: no preview strobe, no stream per tile crossed (network
      tab evidence)
- [ ] Horizontal carousels and the vertical grid both select correctly, including nested
- [ ] Exactly one preview app-wide at any moment
- [ ] Long-press action reveal, kebab, badges, full-player paths byte-identical
- [ ] Tab hide / full player opening tears the preview down
- [ ] `prefers-reduced-motion` disables it; `saveData` honored here if T6440 not yet landed
- [ ] Frontend unit tests pass; real-browser + real-device evidence captured
