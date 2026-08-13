# T6970: Edge share page intro card fills the viewport instead of the video canvas

**Status:** WAITING ON USER (implemented on feature/T6960-intro-image-preload, awaiting staging verify + merge approval)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-13
**Updated:** 2026-08-13
**Epic:** [intro bug fixes](EPIC.md)

## Problem

Staging report (2026-08-13, screenshot of
`reel-ballers-staging.pages.dev/shared/{token}` in incognito): the intro card covers the
ENTIRE area between header and footer, while the video it precedes renders as a centered,
aspect-fitted box. The card should occupy exactly the video's canvas.

Mechanism: `renderIntroCard` emits `#intro-card{position:absolute;inset:0}`
(`functions/shared/[token].js:107`) as a sibling of the `<video>` inside `<main>`
(`position:relative`, full remaining viewport, `:194`). The React surfaces don't have
this bug — `IntroPreRoll` computes an aspect-fitted box (`boxFor`, `IntroPreRoll.jsx:48`).

## Solution

Match the card to the video's rendered box with a small sizing function in the page's
inline JS (the page is hand-rolled DOM; measuring beats re-deriving aspect math):

```js
function sizeIntro(){
  var r=v.getBoundingClientRect(), m=v.parentElement.getBoundingClientRect();
  ic.style.left=(r.left-m.left)+"px"; ic.style.top=(r.top-m.top)+"px";
  ic.style.width=r.width+"px"; ic.style.height=r.height+"px";
}
```
- Drop `inset:0` from `#intro-card` CSS (keep `position:absolute`).
- Call on: initial script run, `v` `loadedmetadata`, window `resize` (and orientation
  change via the same resize listener).
- Before metadata, the `poster` attr gives the video its real box; a share with no poster
  falls back to whatever box the bare element has, then snaps on `loadedmetadata` —
  acceptable for a static page (do not add layout-shift machinery).
- Guard: no intro → no-op (the sizing lives inside `renderIntroCard`'s `js` block).

Also scale the card's text with the box: the fixed `28px/15px` name/fact sizes were tuned
for full-viewport; inside a possibly-narrow portrait canvas use
`clamp()`/`font-size:min(28px, 6cqw...)` — simplest: set font sizes in `sizeIntro` from
`r.width` (e.g. name `Math.round(r.width*0.06)`px capped 28, facts 0.034 capped 15).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/functions/shared/[token].js` — `renderIntroCard` css (~106-118) + js
  (~120-126), `renderSharePage` main/video css (~194-195)
- Edge-page tests: grep `renderSharePage`/`renderIntroCard` under `src/frontend`
  (module is exported pure — extend string-assertions for the new css/js)

### Related Tasks
- [T6960](T6960-intro-image-ready-before-play.md) touches the same `js` block (photo
  preload gate) — implement on the same branch to avoid conflicts; keep commits separate.

## Acceptance Criteria
- [ ] Incognito share link: the card overlays exactly the video box (portrait 9:16 reel
      on a wide desktop window = pillarboxed card, not full-bleed), across resize
- [ ] Landscape reel unaffected visually beyond correct fit
- [ ] No-intro share byte-identical
- [ ] Page render tests green; eslint clean

## Progress Log

**2026-08-13**: Implemented + reviewer pass (3 MAJOR + 5 MINOR found, all addressed): decode()-rejection now warns + resolves 'error' (was silently 'loaded'); IntroStoryPlayer gate re-arms on previewUrl change (mirrors IntroPreRoll); IntroPreRoll skips the preload on the externally-driven path (no double fetch/warn); edge page re-measures via ResizeObserver on the video (poster-load/controls layout shifts) + icSize() inside icStart(); inline JS kept ES5 (indexed loops) with the 2500ms cap cross-referenced to INTRO_IMAGE_PRELOAD_TIMEOUT_MS; added a BEHAVIORAL jsdom test executing the emitted inline JS against stubbed geometry (left/top/width/height, type scaling, play->hide->v.play() sequence). 72/72 tests green across the 4 relevant files.
