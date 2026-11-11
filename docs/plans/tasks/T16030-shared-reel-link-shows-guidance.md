# T16030: A shared reel link shows guidance: the overlay's own tip, and for a signed-in viewer the Home screen's tip and shade

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Reported by the owner on 2026-11-10 after opening a shared reel link on staging (`/shared/<token>`) while signed in. Someone who clicks a link only to watch a video should see the video and nothing else. Instead the screen showed guidance: a dimmed, blurred shade over the whole page, a card at the top reading "Someone shared this highlight with you. It plays right here." with a Got it button, and a second card in the middle reading "Pick up where you left off. Tap a play to make its highlight." with another Got it.

Two different things are happening:

1. The shared-video overlay carries its own guide. `SharedVideoOverlay.jsx` builds `resolveGuide({ screen: 'modal', local: { modal: 'shared-video', ... } })` and renders it in a `GuideScope`; its sentence is `GUIDE.modal.sharedVideo` ("Someone shared this highlight with you. It plays right here.").
2. For a signed-in viewer the whole app is mounted underneath the overlay (`App.jsx` renders `<SharedVideoOverlay>` on top of it at about lines 960 and 1099), so the Home screen's own guide for that viewer ("Pick up where you left off...", the `clipsUnfinished` rule) and its shade show over a reel that has nothing to do with it. A signed-out viewer only has problem 1.

This is the top-of-funnel page for people who may never have used the app (`pageClass: 'share'` in `App.jsx`), so a coach tip and a shade there is the first thing a new parent sees.

Screenshot (local only, not in git): `C:\Users\imank\AppData\Local\Temp\claude\1ca763295c075470\3ef69819-917b-4320-a8b1-6c8a026b5bfb\images\1.png`.

**Steps:** Signed in on staging, open `https://reel-ballers-staging.pages.dev/shared/46b9dcde-d626-4bc5-8454-732d4e531f57`. Then open the same link signed out (a private window).

**Expected:** The reel plays with no guidance card, no shade, no pulsing control and no Guidance switch pulse, signed in or out. Error states (link expired, no access, sign in required) still say what happened in plain screen copy, not as a coach tip.

**Actual:** Guidance cards and a shade, as above.

## Acceptance Criteria

- [ ] Opening a shared reel link, signed in or signed out, shows no guidance card, no shade and no pulsing control; the reel plays.
- [ ] The shared viewer's error and sign-in states still tell the viewer what to do.
- [ ] Leaving the shared viewer for the app (Close) shows the app's normal guidance again.

## Context

### Related Tasks
T14840, T15760

### Relevant Files (REQUIRED)
- `src/frontend/src/components/SharedVideoOverlay.jsx`
- `src/frontend/src/App.jsx`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/components/instructions/GuideScope.jsx`
- `src/frontend/src/config/displayNames.js` (`GUIDE.modal.sharedVideo`)
- `.claude/knowledge/guidance.md`
