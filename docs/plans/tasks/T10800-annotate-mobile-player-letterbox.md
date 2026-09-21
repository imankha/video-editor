# T10800: Annotate video player wastes vertical space on phones (fixed-vh letterbox)

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

Reported by the user during the T10780 phone test (screenshot 2026-09-21, red brackets): on a
portrait phone the Annotate video sits inside a tall black box with large empty bands above and
below the 16:9 picture (~60% of the box is black at the tested viewport). The screen is short on
vertical room (video + controls + timeline + Mark play + the three CTAs), yet the single largest
element on it is mostly dead space. User ruling: **"I don't want a vertical scroll... We should
better utilize this space if we lack for vertical space."**

Pre-existing on master, NOT caused by T10780 (verified: the T10780 diff touches no player file).

## Root cause

Annotate's non-fullscreen player is a FIXED-VIEWPORT-HEIGHT box, `h-[40vh] sm:h-[60vh]`, with the
video `object-contain`-ed inside it. Any box whose aspect is taller than the video's leaves
letterbox bands. At 393x852 that is a 341px-tall box holding a 221px-tall 16:9 video (120px of
black); wider "phone" viewports past the `sm` breakpoint get 60vh and it is worse.

Three Annotate surfaces carry the fixed box:

1. `src/frontend/src/components/VideoPlayer.jsx:201-219` - the single-video editing path.
   Default classes `max-h-[40vh] sm:max-h-none sm:min-h-[60vh]` / `h-[40vh] sm:h-[60vh]` unless
   `fitToAspect` is passed. Annotate (`AnnotateModeView.jsx` ~line 727) does NOT pass it.
2. `src/frontend/src/modes/AnnotateModeView.jsx:408` - the playback (recap) container's inner
   box, `h-[40vh] sm:h-[60vh]` when not fullscreen (the fullscreen branch already uses
   `aspectRatio` from `annotateVideoMetadata`).
3. `VideoPlayer.jsx:339/355/363` - the error / loading / empty states use the same fixed height
   (acceptable for states with no picture, but they should not be TALLER than the aspect box that
   replaces them, or the layout jumps on load).

The multi-video editing branch (`AnnotateModeView.jsx:622`) already sizes its container with
`style={{ aspectRatio: W / H }}` and has no letterbox. So this is Annotate's single-video path
never receiving the treatment the rest of the app got.

## The pattern already exists: T5676 `fitToAspect` (Overlay), reused by Focus

`.claude/knowledge/keyframes-framing.md` section "Overlay stage is aspect-fit, not fixed-height
(T5676)": `VideoPlayer` has an opt-in `fitToAspect` prop; when true the player fills its parent,
and the parent is a stage box with inline `style={{ aspectRatio: 'W / H' }}`. Overlay
(`OverlayModeView.jsx:383-400`, `useAspectStage`) and Focus (`FocusModeView.jsx:395-545`,
`previewStageAspect`) both do this. **Leverage it; do not build a parallel mechanism.**

## Solution

Annotate's non-fullscreen, non-`mobileFs` single-video stage becomes an aspect-sized box (same
construction as Overlay's `useAspectStage`), with `fitToAspect` passed to `VideoPlayer`:

- Stage box: `relative bg-gray-900 rounded-lg overflow-hidden mx-auto w-full max-w-full` +
  `style={{ aspectRatio: 'W / H' }}`. On desktop `lg+` cap height (`lg:h-[60vh] lg:max-h-[60vh]`
  + `lg:w-fit`, as Overlay does with 70vh) so a landscape source does not grow past today's
  desktop size; **desktop must stay visually equivalent** (same or smaller video box, no
  reflow of the sidebar).
- W / H come from DATA, not a guess: `annotateVideoMetadata.width/height` once the element has
  loaded, and BEFORE that from the game row's `video_width` / `video_height` (already returned by
  `GET /api/games/{id}`, `routers/games.py:478-494`; check what `AnnotateContainer` already holds
  in `gameData`). **No `|| 16 / || 9` silent fallback** (CLAUDE.md: no silent fallbacks for
  internal data). If neither is known (legacy row with NULL dimensions), keep TODAY's fixed
  `h-[40vh] sm:h-[60vh]` box explicitly as the documented "dimensions unknown" state and log a
  warning, so the fallback is a named branch, not a coerced number. The existing `|| 16 / || 9`
  in the multi-video branch (line 622) and the fullscreen branch (line 411) are the same smell;
  route them through the same resolved-aspect value in the same change (small, same file).
- The playback (recap) container (line 408) gets the same aspect box.
- Loading / error / empty states inside `VideoPlayer` when `fitToAspect`: fill the parent
  (`h-full`) instead of their own vh height so the stage does not jump when the picture arrives.
- Fullscreen and `mobileFs` branches: byte-identical (they already own their sizing).

Net effect on the user's screenshot: the black bands disappear, the video box shrinks to the
picture, and ~120-360px of vertical room returns to the controls/timeline/CTAs below it. That is
the "better utilize this space" ruling: reclaim, don't shrink the timeline.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` - stage box for the single-video editing path
  (~727) and the playback container (~405-415); unify the three `annotateVideoMetadata` aspect
  reads (411, 622, new) behind one resolved value
- `src/frontend/src/components/VideoPlayer.jsx` - `fitToAspect` already exists; make the
  loading/error/empty states honor it (`h-full` instead of `h-[40vh] sm:h-[60vh]`)
- `src/frontend/src/containers/AnnotateContainer.jsx` - expose the game row's
  `video_width`/`video_height` (pre-metadata aspect) if not already in `gameData`
- Reference only: `src/frontend/src/modes/OverlayModeView.jsx:383-400` (the pattern),
  `src/frontend/src/modes/FocusModeView.jsx:395-545`, `.claude/knowledge/keyframes-framing.md`
  section T5676, `e2e/T5676-aspect-stage-alignment.qa.spec.js` (assertion style: video fills container)
- Tests: new `AnnotateModeView.aspectStage.test.jsx` (stage carries `aspectRatio` from metadata;
  from game dims before metadata; the explicit unknown-dims branch; fullscreen/mobileFs
  untouched), extend `VideoPlayer` tests for `fitToAspect` states, new
  `e2e/T10800-annotate-aspect-stage.qa.spec.js` at 393x852 / 360x740 / desktop 1280

### Related Tasks
- Found during: T10780 (mobile timeline zoom). File-disjoint from it (T10780 touches
  `TimelineBase.jsx` / `AnnotateTimeline.jsx` / `index.css` only), so it can run in parallel.
- Pattern origin: T5676 (Overlay), reused by Focus. T9270 (settings rail beside the stage).
- Same screen: T10620 (portrait editor strip under the video), T10500 (mobile UI audit).

### Technical Notes
- `.video-container` is the ResizeObserver target (T5590) - keep the class; resizing it is safe
  because of that RO (see T5676 notes). `useVideoDisplayRect` consumers (NotesOverlay,
  AngleSwitcherBadge) map through the display rect, so a box that equals the video aspect makes
  the display rect fill the container - no letterbox math to drift.
- Portrait (9:16) game sources exist (phone uploads). An aspect box for a 9:16 source on a
  portrait phone would be very tall; cap the box at `max-h-[60vh]` on ALL widths (Overlay only
  caps at lg) and let `object-contain` pillarbox that case - it is the rare one, and a 60vh cap
  keeps the timeline reachable without scrolling.
- Measure, don't eyeball: acceptance is video-box height == rendered video height (no bands)
  for a 16:9 source at both phone viewports, and the timeline's top edge moving UP by the
  reclaimed amount.

## Implementation

### Steps
1. [ ] Resolve one `stageAspect` value in `AnnotateModeView` (metadata -> game dims -> explicit
   unknown branch + warning); route lines 411 and 622 through it
2. [ ] Wrap the single-video `VideoPlayer` (~727) in the aspect stage box; pass `fitToAspect`
3. [ ] Playback container (~408): same box
4. [ ] `VideoPlayer` loading/error/empty states honor `fitToAspect` (`h-full`)
5. [ ] Unit tests (stage aspect sources, unknown-dims branch, fullscreen/mobileFs byte-identical)
6. [ ] e2e at 393x852 / 360x740 / 1280x800 on the dev fixture account: assert the video fills
   the box (no bands), timeline top edge is higher than on master by the reclaimed height,
   desktop box height <= today's; `responsiveSweep`; `saveEvidence` per criterion
7. [ ] Update `.claude/knowledge/annotate.md` (player sizing model now aspect-fit, T5676 lineage)
8. [ ] Reviewer; commit `T10800: ...

### Progress Log

**2026-09-21**: Filed from the T10780 phone-test screenshot. Root cause + pattern identified.

## Acceptance Criteria

- [ ] 16:9 source at 393x852 and 360x740: the video box height equals the rendered video height
      (no black band above or below, measured via `getBoundingClientRect`)
- [ ] The timeline's top edge sits higher than on master by the reclaimed band height; no
      page-level vertical scroll is needed to reach Mark play at 393x852
- [ ] Before video metadata loads, the box already has the game's aspect (from `video_width` /
      `video_height`), so there is no layout jump when the picture arrives
- [ ] A game with NULL dimensions renders today's fixed box via an explicit, warned branch
      (no `|| 16 / || 9`)
- [ ] 9:16 source: box capped at 60vh, pillarboxed, timeline still reachable
- [ ] Desktop (1280x800): video box height <= today's, sidebar layout unchanged
- [ ] Fullscreen and `mobileFs` Annotate byte-identical
- [ ] Focus / Overlay untouched (they already use the pattern)
- [ ] Curated relevant tests green; Branch CI green
