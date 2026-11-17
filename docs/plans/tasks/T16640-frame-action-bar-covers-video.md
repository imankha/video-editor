# T16640: On a desktop the Frame action bar covers the video and the timeline

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

On the Frame screen at 1280x800, the bar at the bottom with Sharpen, Trim and Preview is about 230 pixels tall and sits over the lower part of the video and the timeline. To reach the play controls and the crop track the parent has to scroll. In Trim mode the third track (Normal speed) is half hidden under the bar.

## How we got here

Found on staging on 2026-11-16. 1280x800 is the common laptop size. The bar looks made for a taller screen or for the phone layout, which is why the phone is fine.

## Solution

Make the video, the play controls and the timeline usable at 1280x800 without scrolling: a shorter bar, a bar that only covers space reserved for it, or a layout that fits the screen height.

## Why

The Frame screen is where parents spend their time before paying to sharpen. If the controls are hidden, parents do not see what they are cropping.

## Relevant Files

- the Frame screen under src/frontend/src/screens/
- src/frontend/src/components/FocusPublishActionBar.jsx or the Frame action bar

## Acceptance Criteria

- [ ] C1: At 1280x800 the Frame screen shows the whole video, the play controls and the crop timeline without scrolling and without the bar covering any of them.
- [ ] C2: In Trim mode the Normal speed track is fully visible.
- [ ] C3: At 390x844 the layout is unchanged and nothing newly overlaps.
