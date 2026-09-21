# T10820: Mobile Spotlight / Focus settings drawer opens where the user cannot see it

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Problem

From the user's staging phone screenshot (Overlay, 2026-09-20; same in Focus): the
"Spotlight settings" entry row (`data-testid="mobile-settings-row"`) sits BELOW the timeline,
so on a phone the user has scrolled down to reach it. Tapping it opens the T9270 drawer, but
the drawer is `position:absolute` inside the STAGE ROW at the top of the page
(`SettingsRail.jsx` mobile branch: `absolute top-0 right-0 bottom-0 w-[316px]`, translateX
slide-in, scrim `absolute inset-0` on the stage row). Scrolled down, the user sees nothing
happen, or a sliver of something at the top of the screen they cannot place. There is no
feedback connection between the tap and the panel.

User ruling: the button being low is CORRECT (visual hierarchy: settings sit under the
timeline, above the export band). Do not move the button up. Build the panel FROM THAT POINT
UP so the user understands how to interact with settings. Same fix for Focus (Framing).

## Direction (design gate: propose 2-3 options as a decision artifact before implementing)

Candidates, all keeping the entry row where it is:

- **A. Bottom sheet anchored to the row.** On tap, the row's own box expands upward into a
  sheet (row becomes the sheet header with the close/collapse chevron), covering the timeline
  and video with the same tabs/body the rail shows. Position `fixed` at the bottom of the
  viewport above the action band, height ~70vh, slides up. The row is visibly the thing that
  grew, so the connection is obvious. Preferred starting point.
- **B. Keep the side drawer but make it `fixed` to the viewport** (full height, right edge)
  with the scrim over the whole page, and scroll the page so the row is visible when it
  closes. Cheapest; weaker feedback (nothing at the tap point moves).
- **C. Inline accordion**: the row expands in place, pushing the action band down. Rejected
  unless A proves heavy: it changes page height and the band must stay pinned (T9270).

Whichever wins must: keep `SettingsRail` as the single settings component (desktop rail
unchanged; the mobile variant changes its geometry only); animate from the row (translateY
from the row's position, not from off-screen top); keep the entry row's live summary line;
close via the header control (never backdrop close, per project rule); work in Overlay AND
Focus; not alter the stage box (T9270 invariant).

## Context

### Relevant files
- `src/frontend/src/components/settings/SettingsRail.jsx`: mobile branch (lines ~89-130)
- `src/frontend/src/modes/OverlayModeView.jsx`: drawer mount (~960-980), entry row (~1194-1215)
- `src/frontend/src/modes/FocusModeView.jsx`: drawer mount (~895-911), entry row (~921)
- `.claude/knowledge/keyframes-framing.md` (Focus stage / T9270 rail), T9270 design doc
- Tests: `SettingsRail` unit tests; new e2e at 393x852 for Overlay and Focus: scroll to the
  row, tap, assert the sheet's bounding box is inside the viewport and overlaps the row's
  former position; close returns to the row.

### Related
- T9270 (unified settings rail + mobile drawer), T10500 (mobile UI audit), T10810 (same
  phone-screenshot sweep). File-disjoint from T10800.

## Acceptance
- [ ] Overlay and Focus at 393x852 / 360x740: after scrolling so the entry row is at the
      bottom, tapping it produces a panel fully inside the viewport, visibly growing from the row
- [ ] Desktop rail byte-identical
- [ ] Stage box size unchanged while the panel is open (T9270)
- [ ] Panel closes only from its own header control
