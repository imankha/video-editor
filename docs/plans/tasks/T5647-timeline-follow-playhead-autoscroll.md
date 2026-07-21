# T5647 — Timeline follow-playhead auto-scroll broken at zoom (playhead runs off-screen)

**Tier:** M · Frontend (timeline). **Model:** Sonnet.

## Symptom
On mobile with a zoomed timeline (e.g. "Zoom: 193%"), the playhead moves OFF-SCREEN during
playback and never comes back. It should auto-scroll to keep the playhead visible.

## Root cause (verified — an EXISTING effect is buggy; fix it, don't add a new one)
`src/frontend/src/components/timeline/TimelineBase.jsx` already has a follow-playhead auto-scroll
effect (~lines 227–272), but its math conflates "percent of content" with "percent of maxScroll":
```js
const idealScrollPercent = (progress/100) * 100;         // percent of CONTENT (scrollWidth)
const currentScrollPercent = (scrollLeft / maxScroll)*100; // percent of MAXSCROLL
const targetScroll = idealScrollPercent - viewportWidthPercent/2;
container.scrollLeft = (targetScroll/100) * maxScroll;    // mixes the two frames
```
`progress` is a fraction of `scrollWidth` but gets multiplied by `maxScroll` (= scrollWidth −
clientWidth). At scale 1.93, maxScroll ≈ 0.93·W while the playhead travels the full 1.93·W, so the
scroll target lags progressively — the playhead escapes the right edge. (Playhead pixel offset =
`EDGE_PADDING + (scrollWidth − 2·EDGE_PADDING)·(progress/100)`, `EDGE_PADDING=20`.)

## Fix (reuse values already in scope: scrollWidth, clientWidth, maxScroll, progress, EDGE_PADDING)
Compute the playhead pixel directly and scroll in PIXELS, keeping it inside a margin:
```js
const playheadPx = EDGE_PADDING + (container.scrollWidth - 2*EDGE_PADDING) * (progress/100);
const margin = container.clientWidth * 0.15;
let target = container.scrollLeft;
if (playheadPx < container.scrollLeft + margin) target = playheadPx - margin;
else if (playheadPx > container.scrollLeft + container.clientWidth - margin)
  target = playheadPx - container.clientWidth + margin;
container.scrollLeft = Math.max(0, Math.min(target, maxScroll));
```
**Also fix the self-suppression gotcha:** `handleScroll` (~L190–207) sets `userScrolledRef=true`
for 2s on EVERY scroll event — including the effect's own programmatic `scrollLeft` write, which
then disables auto-scroll for 2s and lets the playhead drift. Add an `isAutoScrollingRef` flag set
immediately before the programmatic write; have `handleScroll` early-return (skip the
`userScrolledRef` set) when it's set, clearing it on the next scroll/rAF.

**Preserve** the existing manual-scroll machinery (`userScrolledRef` + 2s `userScrollTimeoutRef`,
and the `playbackStartProgressRef` "wait for 2% movement before first auto-scroll" so Play doesn't
yank the view). Guard stays `timelineScale > 1` (correct). The `MobileScrollbar` thumb syncs off
the scroll event, so it follows for free.

## Acceptance criteria
- During playback at zoom > 100% (test ~193%), the playhead stays visible — auto-scroll follows it
  and it never leaves the viewport.
- Manual scroll still works and isn't fought by auto-scroll (2s pause after a user scroll).
- Hitting Play doesn't jump the view (the 2% guard holds).
- Covers both Overlay render sites (inline + mobile-fullscreen) — the fix is in TimelineBase so
  both are covered. No desktop regression.

## QA (mandatory, REAL BROWSER)
Drive a zoomed timeline in a real browser (Playwright, mobile viewport + touch): play, assert the
playhead element stays within the scroll container's visible bounds across playback; assert a
manual scroll pauses auto-scroll ~2s. Add a unit test for the pixel math (playheadPx/target given
scrollWidth/clientWidth/progress). Map every acceptance criterion to evidence.
Own ONLY `src/frontend/src/components/timeline/TimelineBase.jsx` (+ its test). Explicit `git add`.
