# T15370: Annotate landscape fullscreen side-strip layout (controls beside the video, not on it)

**Status:** WIP
**Impact:** 7
**Complexity:** 7
**Tier:** L (design gate required)
**Created:** 2026-11-08
**Updated:** 2026-11-08

The owner chose this on 2026-11-08 as the follow-up to T15380 (option C from the UX consult).

## Problem

In phone landscape fullscreen, the transport controls stack covers 88% of the video picture. That stack is the controls row, the "Video 1 of 2" source bar, the zoom pill, the two-lane timeline and the scrollbar. Edit play covers 76%. The user cannot watch the play while fast-forwarding or trimming. T15380 only reduces this: it collapses the editor while a handle is dragged and auto-hides when paused. It is not a layout fix. See T15380 for the measurements and the user's quote.

## Solution (to be confirmed in the design doc)

Reuse the Focus pattern from T10840 (`FocusCockpit.jsx`):
- The video fills the full height.
- Left strip (about 56px): play, skip back and forward, frame back and forward.
- Right strip (about 72px): Mark/Edit play, speed, and a source chip such as "1/2" that opens the source picker.
- A thin timeline (about 56px) along the bottom, with zoom built in.
- Edit play opens as a sheet from the right side, not the bottom, so the middle of the video stays visible while trimming.
- Safe areas on both sides use `env()`, as in Focus D7.

This is the user's "permanent bar" in a shape that fits a sideways phone: side strips use the empty width beside a 16:9 video instead of the scarce height. Copy the Focus strip and sheet components into an `annotate/cockpit` folder for now. Extract a shared version at the third use (refactoring rule 1).

## Acceptance criteria (draft)

1. [ ] At 812x334 and 852x393 the page does not scroll vertically, and the transport controls cover 0% of the picture.
2. [ ] With Edit play open, at least 60% of the picture is visible, including its middle.
3. [ ] Every strip button is at least 44px.
4. [ ] Double-tap skip still works on both halves of the video; the 3x timeline zoom still works; the source can still be switched.
5. [ ] Rotating back to portrait restores the T15380 portrait layout with no console error.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` (`mobileFs` landscape branch)
- `src/frontend/src/modes/FocusModeView.jsx` and the Focus cockpit components (precedent)
- `src/frontend/e2e/T10840-focus-landscape-cockpit.qa.spec.js` (spec template)

### Knowledge
`.claude/knowledge/annotate.md`, `.claude/knowledge/keyframes-framing.md` (Focus cockpit).

### Related Tasks
- Blocked by T15380
- T10840 (Focus landscape side-strip layout)
