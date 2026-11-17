# T16630: Frame and Spotlight screens open already scrolled down

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

When a parent opens the Frame screen or the Spotlight screen, the page starts scrolled down about 250 pixels. The back arrow, the title, the credits, the mode tabs and the Portrait/Landscape chooser are above the visible area, so on a desktop the first thing seen is the bottom of the settings panel. It happens on desktop and on a phone.

## How we got here

Found on staging on 2026-11-16 by a full walk of the app. Opening a project from Annotate (Make new highlight) and opening the address directly both do it. The scrolling area that holds the screen (flex-1 overflow-auto) has a scroll position of about 255px on desktop and 247px on a phone right after load.

## Solution

Find what scrolls that area on load (a focus call, a scroll restore or a layout that grows after the first paint) and stop it, so the screen opens at the top.

## Why

A parent should see the screen's header and where the highlight will be shared before anything else, because the Portrait/Landscape choice is made there.

## Relevant Files

- the Frame and Overlay (Spotlight) screens under src/frontend/src/screens/
- the shared screen layout that holds the overflow-auto area

## Acceptance Criteria

- [ ] C1: Opening the Frame screen on a desktop (1280x800) and on a phone (390x844) shows the header, the mode tabs and the Portrait/Landscape chooser without scrolling.
- [ ] C2: Opening the Spotlight screen does the same at both sizes.
- [ ] C3: A screen the parent had scrolled still comes back to where they were elsewhere in the app (scroll restore is not broken).
