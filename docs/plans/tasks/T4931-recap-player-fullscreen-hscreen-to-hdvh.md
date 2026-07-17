# T4931: RecapPlayerModal fullscreen uses h-screen (should be h-dvh)

**Status:** DONE
**Impact:** 4
**Complexity:** 1
**Created:** 2026-07-15
**Updated:** 2026-07-15

## Problem

Found by the T4930 `h-screen`/`100vh` lint gate (`scripts/check-viewport-units.mjs`),
where it is currently catalogued as tracked KNOWN_DEBT. The fullscreen recap player
takes over the screen with `w-screen h-screen`
([RecapPlayerModal.jsx:253](../../src/frontend/src/components/RecapPlayerModal.jsx#L253)).
On iOS Safari `h-screen` (height:100vh) spills behind the dynamic browser toolbar — the
exact class of clipping that caused T4880 — so the bottom of the fullscreen player
(controls) can sit off-screen on a phone. This failure mode is invisible to Playwright
emulation, which is why the lint gate exists to block it at the source.

## Solution

Convert the fullscreen branch `w-screen h-screen` -> `w-screen h-dvh` (100dvh tracks the
true visible viewport). Then remove the `RecapPlayerModal.jsx` entry from `KNOWN_DEBT`
in `scripts/check-viewport-units.mjs` (the gate FAILS on a stale KNOWN_DEBT entry, so
the removal is enforced in the same change). Verify the recap player fullscreen controls
are reachable on a phone.

## Acceptance Criteria

- [ ] Fullscreen recap player uses `h-dvh`; controls reachable on iOS-sized viewport.
- [ ] `RecapPlayerModal` removed from `KNOWN_DEBT` in `check-viewport-units.mjs`; gate green.

## Context

### Relevant Files
- `src/frontend/src/components/RecapPlayerModal.jsx` (~253)
- `scripts/check-viewport-units.mjs` — remove the KNOWN_DEBT entry on fix

### Related Tasks
- Found by: T4930 (viewport-unit gate). Same class as: T4880.
