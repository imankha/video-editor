# T13190: Finished tab player: Guidance switch over Share and Download, Close off-screen at 390, title truncated at 768

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S (frontend)
**Created:** 2026-10-25
**Updated:** 2026-10-25
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-25 ([RESULTS.md section 11](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only (`r3-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk).

## Problem

T13050 (STAGING) added an opt-in `clearGuidanceToggle` prop to `CollectionPlayer` and set it only in `DraftReelPreview` (the viewer opened right after a finish). The Finished tab's highlight tile Watch button (the play icon) opens a `CollectionPlayer` without the prop, and it still has the original bug on staging 2026-10-25:

- 390: the Guidance switch (x 92 to 203, y 16 to 60) sits over Share and Download (y 8 to 52), and the header row runs past the right edge: Fullscreen (x 384 to 428) and Close (x 436 to 480) are off a 390 px screen, so the player shows no close button.
- 768: the title truncates to "wcfc-carlsbad-trimmed 0...".

Evidence: r3-finished-viewer-{390,768}.

## Solution

Apply the same header layout to every `CollectionPlayer` mount that can sit under the Guidance switch (or make it the default), and let the header buttons wrap so Close is always on-screen.

## Context

### Relevant Files
- `src/frontend/src/components/collections/CollectionPlayer.jsx` (`clearGuidanceToggle`)
- The Finished tab tile Watch path (`src/frontend/src/components/collections/ReelTile.jsx` and the player it opens)

### Related Tasks
- Residual of T13050

## Acceptance Criteria

- [ ] At 390, no overlap between the Guidance switch and any header button, and Close is fully on-screen (geometry test)
- [ ] At 768 the title shows its first words
- [ ] Both Finished viewer paths (after a finish, and the tile Watch button) pass
