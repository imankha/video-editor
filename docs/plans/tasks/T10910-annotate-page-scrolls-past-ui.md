# T10910: Annotate page scrolls down past all the UI

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 6
**Complexity:** 1
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

User screenshot (prod, 2026-09-21): on Annotate the browser page itself scrolls, revealing a
large white area below the app. The app shell is `h-dvh overflow-hidden`, so nothing inside it
should be able to grow the document.

## Root cause (verified in a real browser, 2026-09-21)

Drove the dev fixture account's 29-play game via Playwright and listed every element whose box
reached past the shell: `document.scrollHeight` was 1239px against a 900px viewport, and the
only escapees were `RatingIcon`'s `<span class="sr-only">` labels at 39px steps (one per
clip-list row). Tailwind's `sr-only` is `position:absolute`; the icon wrapper was not
positioned, so each label's containing block was the viewport, and CSS overflow clipping only
applies to descendants whose containing-block chain passes through the clipper. Every
off-screen clip-list row's label therefore extended the DOCUMENT, not the scrolling list.

## Fix

`RatingIcon.jsx`: both wrappers (rated + unrated) are now `relative`, so the sr-only label is
contained by the icon and clipped with the list. Re-ran the same probe: `scrollHeight` 900 ==
viewport in both idle and clip-selected states.

## Context

### Relevant Files
- `src/frontend/src/components/shared/RatingIcon.jsx`

### Technical Notes
Any future `sr-only` inside a non-positioned wrapper can reproduce this. The systemic
alternative (making the `h-dvh overflow-hidden` shell `relative`) was considered and rejected
for blast radius: it would change the containing block of every unpositioned-absolute
descendant in the app.

## Acceptance Criteria

- [x] `document.scrollHeight === window.innerHeight` on Annotate with a long clip list (browser-verified)
- [x] `RatingIcon.test.jsx` + ClipListItem tests green
