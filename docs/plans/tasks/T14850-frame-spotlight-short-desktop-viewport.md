# T14850: Frame and Spotlight on short desktop viewports: the video is a thumbnail or hidden under the action bar

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Measured on master, 2026-11-03, desktop 1280x800 (a common laptop size at 100% zoom; inner
height ~730 px with browser chrome):

- **Frame:** the player renders at 280x155 px and the portrait box at 54x96 px. The preview
  (step 4 of the coach, "see exactly what you'll share") renders at **75x135 px**, too small
  to judge framing. The three action cards and the two-row timeline take the vertical room.
- **Spotlight:** the portrait video (270x480 px) overflows under the sticky bottom action bar
  (`sticky bottom-0 z-30`): video rect y 208-688 vs CTA card y 507-651. The detected player
  boxes sit half under the bar; the first click on a box did not register until the page was
  scrolled. On a phone (390x844) the same screen is the best in the app (full 291x518 video,
  boxes clear), so this is a desktop-only layout problem.

Journey impact is small on its own (Opened Frame 7 lost, Opened Spotlight 3 lost), but every
desktop parent passes through both screens on the way to the two larger losses (Moved framing
window 42, Finished 8), and "I can't see what I'm framing" is a direct cause of giving up
before Generate.

## Solution

At viewport heights under ~850 px on `lg`+ widths:
- Frame: cap the action band to one row of three compact cards (icon + label), collapse the
  Settings rail by default, and give the player the remaining height (min 320 px). The
  preview uses the same player box.
- Spotlight: the video column must never extend under the action bar; size the player to the
  available height (same rule), and make the action bar non-sticky when the content fits.

T12630 already caps the Focus stage height "by action band at lg" for the Frame screen; this
task extends that rule to the preview state and to Spotlight, and lowers the floor so the
player is never under 320 px tall.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FocusModeView.jsx` - stage/action-band layout (T12630 cap)
- `src/frontend/src/modes/OverlayModeView.jsx` (or the Spotlight mode view) - sticky action bar, video column
- `src/frontend/src/components/editor/` shared stage/player components (grep the `sticky bottom-0 z-30` container)
- Playwright: `src/frontend/e2e/` a viewport-matrix spec at 1280x800 and 1366x768 asserting the video rect does not intersect the action bar and is at least 320 px tall

### Related Tasks
- Related: T12630 (Focus stage height cap), T10830-T10850 (Focus on a landscape phone, same "size to the viewport" approach), T14770 (Frame asks "Where will you share it?", touches the same rail).

### Technical Notes
- Reuse the landscape-phone cockpit's measurement approach rather than new breakpoints.
- No persisted view state.

## Implementation

### Steps
1. [ ] Screenshot matrix on master at 1280x800, 1366x768, 1440x900: Frame (box, preview) and Spotlight; record the video rects.
2. [ ] Implement the height rule for both screens; keep phone layouts byte-identical.
3. [ ] Playwright viewport spec; re-run the matrix.

### Progress Log

**2026-11-03**: Filed from the funnel walk with measured rects. Not started.

## Acceptance Criteria

- [ ] At 1280x800 the Frame player and preview are at least 320 px tall and the box is draggable without zoom.
- [ ] At 1280x800 the Spotlight video never sits under the action bar; player boxes are clickable without scrolling.
- [ ] Phone layouts unchanged; tests pass.
