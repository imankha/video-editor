# T17040: Coach names a missing Get link

**Status:** WIP
**Impact:** 4
**Complexity:** 1
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

With Guidance on, when a parent opens a finished highlight's edit sheet from the player (the pencil), the coach says "Done! Tap Get link to send it, or Download to save it." There is no "Get link" button on that screen; the button is called "Share link". A first-time parent is told to look for a button that does not exist. The coach should name the button that is on screen.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as imankh+qa-2026-11-17b@gmail.com, at phone 390x844 touch. The coach card shows once per guidance run, so it was seen once; the text is fixed in the app, so it will repeat for every new parent.

## Repro steps

1. New account (or Guidance reset), phone 390x844, Guidance on.
2. Make and sharpen a highlight, then open it from Home, Highlights (tap the tile, then its play button).
3. Tap the pencil ("Edit highlight") in the player header.

**Expected:** the coach names "Share link" (or the button is called "Get link").
**Actual:** coach reads "Done! Tap Get link to send it, or Download to save it."; the buttons are "Share link" and "Share video".
**Repeats:** seen once (the card shows once); the coach rule text contains "Tap Get link" (guide rules test `guideRules.namedControls.test.js` lists it).
**Also checked at:** not seen on desktop or iPad because the card had already been shown on this account.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B04-coach-get-link.png` (local, not in git)
- Console: no errors. Network: no failing requests. Server log: not relevant.

## Solution

The coach sentence on that sheet names a button that is on screen.

## Relevant Files

- `src/frontend/src/components/instructions/guideRules.namedControls.test.js` (maps "Tap Get link" to the GET_LINK pulse)
- `src/frontend/src/config/displayNames.js` (`PUBLISH_GET_LINK: 'Get link'`)

## Acceptance Criteria

- [ ] C1: At 390x844 with Guidance on, the coach sentence on the finished highlight's share sheet names only buttons that are visible on that sheet.
- [ ] C2: The same at 1440x900.
