# T10570: Play progress badge discs made bigger, real touch targets added

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

User feedback after seeing the mobile bottom-sheet rating popup (T10560): "the actual
icons/badges for what the user has done need to be bigger" — the four small status
discs beside the play name (named/rated/noted/clip) were too small (22px on the
footer/`sm` placement, 28px on the desktop-strip/`md` placement) to read or tap
comfortably, especially compared to the roomier 44px rows the rating popup itself
now uses.

## Solution

`PlayProgressBadges.jsx`:
- `DISC_SIZE`: `sm` 22px -> 28px, `md` 28px -> 36px.
- `ICON_SIZE`: `sm` 11 -> 14, `md` 14 -> 18 (kept proportional to the disc).
- The green "done" checkmark corner overlay now scales with `size` too (new
  `CHECK_SIZE`/`CHECK_ICON_SIZE` maps) instead of a single fixed 13px badge that
  would have looked undersized against the bigger discs.
- Every badge button (the shared `Badge` component AND `RatingBadge`'s own button)
  gained `coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]` — a real touch
  target floor on actual touch devices, same convention already used by
  `LayerSegmentedControl` and the rating popup's own rows, layered on top of the
  bigger visual disc rather than instead of it.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx`

### Related Tasks
- Prompted by live-testing T10560 (mobile bottom sheet).

## Implementation

### Steps
1. [x] Bump `DISC_SIZE`/`ICON_SIZE` for both size tiers
2. [x] Scale the done-checkmark overlay with size instead of a fixed 13px
3. [x] Add `coarse-pointer:min-h/min-w-[44px]` to every badge button
4. [x] Live-drive verified (screenshot, desktop strip)

### Progress Log

**2026-09-19**: `AnnotateFullscreenOverlay.progressBadges.test.jsx` 23/23 still green
unchanged (tests target testids/roles/state, not disc pixel sizes). Lint clean.
Live-drive: desktop strip screenshot shows visibly larger discs with legible
checkmarks and glyphs.

## Acceptance Criteria

- [x] Badge discs are visibly bigger at both size tiers
- [x] The done-checkmark overlay scales with the disc, not fixed at the old size
- [x] Touch devices get a real >=44px tap target on every badge button
- [x] Tests pass
