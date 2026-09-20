# T10680: CollectionPlayer transport: play/pause glyph, header Play/Pause + Fullscreen, on every finished-reel player

**Status:** WAITING ON USER
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Epic:** [Clip Ready Screen](EPIC.md) (2/2)

## Problem

`CollectionPlayer` (the story-style modal player used by the post-export preview, the library
Draft/Published reel player, the public share-link viewer, the ranking game and the intro
pre-roll) renders `<video autoPlay playsInline>` with no `controls`. Center-tap toggles play and
Space toggles play, but nothing on screen says so. `useStoryPlayback` already tracks `isPlaying`
and the player never reads it. When a browser blocks unmuted autoplay the user sees a frozen
frame and no cue. There is no fullscreen of any kind (`requestFullscreen` appears nowhere under
`src/`). User (2026-09-19): "I dont have a play/pause button or full screen. I am use to seeing
controls when i see a video", then "make sure the video player for published videos has the same
controls".

## Solution (APPROVED design: proposal section A, option 3)

Specified in [design-proposal.md](design-proposal.md) section A; the mockups the user approved
are the "Video controls" panes of https://claude.ai/artifact/9w4SKRvSbdNzMLpwFxNWKF.

1. **Center glyph** inside the tap/swipe container, `pointer-events-none`, `aria-hidden`,
   `data-testid="collection-player-play-glyph"`: 64px circle, `bg-black/55 backdrop-blur-sm
   ring-1 ring-white/20`, `Play` (32px, `ml-1`) while paused at full opacity; on the
   paused -> playing edge show `Pause` for one beat then fade (`transition-opacity duration-500`,
   hidden after 600ms via one `useState` + `setTimeout`, cleared on unmount / next edge). No rAF,
   no new loop. Tap zones and `CompositeScrubber` untouched.
2. **Header transport**, appended to the toolbar cluster immediately BEFORE the Close X, same
   `Button variant="ghost" size="sm" iconOnly` shape as Re-edit/Re-rank/Close, `coarse-pointer:min-h-11`:
   - `icon={isPlaying ? Pause : Play}`, `onClick={togglePlay}`, `aria-label`/`title` "Pause"/"Play"
   - `icon={expanded ? Minimize : Maximize}`, `onClick={toggleExpanded}`, `aria-label`/`title`
     "Exit fullscreen"/"Fullscreen"
   Icons are the ones `modes/annotate/components/PlaybackControls.jsx` already uses.
3. **Fullscreen = CSS expand + native where available**:
   - `expanded` local state. Panel `md:inset-12 md:rounded-xl md:overflow-hidden` becomes
     `inset-0 rounded-none`; the `actionBar` slot is NOT rendered while expanded
     (`{expanded ? null : actionBar}`); `statusBanner`, header and scrubber stay.
   - Enter: set `expanded`, then `panelRef.current.requestFullscreen?.()` (on the PANEL, not the
     video, so our scrubber/header/glyph stay visible). Listen to `document`
     `fullscreenchange`; when `document.fullscreenElement` becomes null, set `expanded=false`.
     Exit: `document.exitFullscreen?.()` if we are the fullscreen element, then clear `expanded`.
   - iPhone Safari (`!document.fullscreenEnabled && typeof video.webkitEnterFullscreen === 'function'`):
     call `videoRef.current.webkitEnterFullscreen()` and do NOT set `expanded`; native player
     returns on dismiss (`webkitendfullscreen`). `playsInline` stays.
   - **Escape guard** (landmine at `CollectionPlayer.jsx` keydown handler, Escape -> `onClose`):
     `if (expanded) { exit fullscreen; return; } onClose();`. Escape leaves fullscreen first and
     closes the player only on a second press.
   - Unmount while expanded: exit native fullscreen in the cleanup.
4. **Default ON, opt-out prop** `transport` (default `true`) so the controls reach every
   finished-reel player without touching any screen mount: the Focus/Overlay completion previews
   (`FocusScreen.jsx:1468`, `OverlayScreen.jsx:1815`, NOT edited by this task), the library
   Draft/Published player (`DraftReelPreview.jsx`), the public share viewer
   (`SharedCollectionView.jsx`), and the ranking game (`RankingGame.jsx`, keep ON unless it
   breaks its own flow; record the reason if turned off). **Explicit opt-out ONLY in
   `IntroStoryPlayer.jsx`** (`transport={false}`, next to its existing `renderScrubber={false}`;
   it is a composite pre-roll with its own bar). When `transport` is false the glyph, the two
   buttons, the expand state and the Escape guard are all absent, so that caller is byte-identical.
5. No time readout (the scrubber already carries progress).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` - glyph, header transport, `expanded` state, fullscreen effects, Escape guard, `transport` prop; update the header JSDoc
- `src/frontend/src/components/collections/useStoryPlayback.js` - already exposes `isPlaying` (line ~121); destructure it, no hook change expected
- `src/frontend/src/components/introcards/IntroStoryPlayer.jsx` - `transport={false}` opt-out
- `src/frontend/src/components/collections/CollectionPlayer.test.jsx` - new cases: glyph visible while paused / hidden after play; Play/Pause + Fullscreen buttons present by accessible name; expand hides `actionBar`; Escape while expanded does NOT call `onClose`, second Escape does; `transport={false}` renders none of it
- `src/frontend/src/components/collections/CollectionPlayer.characterization.test.jsx` - re-run; must stay green (behaviour of existing callers unchanged)
- `src/frontend/src/components/introcards/*.test.jsx`, `src/frontend/src/components/DraftReelPreview.test.jsx`, `src/frontend/src/components/ranking/*.test.jsx` - re-run (consumers)
- `src/frontend/e2e/T5860-collectionplayer-modal-backdrop.qa.spec.js`, `collection-share.spec.js`, `shared-viewer-affordance-gating.spec.js` - re-run; the shared-viewer gating spec asserts which header buttons the public viewer shows, so extend its expectations for Play/Pause + Fullscreen
- `.claude/knowledge/export-pipeline.md` - Stage 7: player controls line

### Related Tasks
- Epic sibling: T10670 (completion bars). File-disjoint; parallel OK.
- Must not touch `FocusScreen.jsx` / `OverlayScreen.jsx` (T10650/T10660 in flight) or the two
  `*PublishActionBar.jsx` files (T10670).

### Technical Notes
- Design gate satisfied by the user's approval of the decision artifact; no Architect. Reviewer
  on the diff is required (shared component with six callers, one of them public-facing).
- jsdom has no `requestFullscreen`; guard every native call with `?.` and test the CSS-expand
  path + the Escape guard in unit tests, the native path in a real browser (memory rule: real
  browser for pointer/fullscreen behaviour, jsdom gives false confidence).
- Focus trap: the two new buttons are ordinary `<button>`s inside the panel, so the existing
  trap picks them up. While expanded the `actionBar` is unmounted, so its tiles leave the tab
  order; that is intended.
- Real-device iOS Safari check is owed before STAGING is called good (native player open + return
  with playback state intact); record the result in the Progress Log.

## Implementation

### Steps
1. [ ] Branch `feature/T10680-collection-player-transport`
2. [ ] Red tests in `CollectionPlayer.test.jsx` for the six cases above
3. [ ] Implement glyph + header transport + expand + Escape guard + `transport` prop
4. [ ] `IntroStoryPlayer` opt-out; verify RankingGame still plays/advances with transport on
5. [ ] Real browser: Focus completion preview, library Published reel, public share link, at desktop and 390px; native fullscreen enter/exit; Escape twice; iPhone Safari if available
6. [ ] Reviewer on the diff; fix; curated relevant test set green; push; Branch CI green
7. [ ] Knowledge doc line; commit with `T10680:` subject prefix

### Progress Log

**2026-09-19**: Filed from the approved design. Not started.

## Acceptance Criteria

- [ ] Paused: the center play glyph is visible at rest; playing: it fades within ~600ms; it never intercepts a tap (center-tap still toggles, left/right thirds still prev/next)
- [ ] Header shows Play/Pause and Fullscreen icon buttons with accessible names, before Close, 44px touch floor on coarse pointers
- [ ] Fullscreen hides the `actionBar` footer and fills the panel; native fullscreen used where the browser has it; iPhone uses the native video player and returns cleanly
- [ ] Escape leaves fullscreen first; closes the player only on the next press; browser-initiated fullscreen exit resets the expanded state
- [ ] Controls appear on: Focus/Overlay completion preview, library Draft AND Published reel player, public share-link viewer. `IntroStoryPlayer` is byte-identical (`transport={false}`)
- [ ] Existing characterization tests green; no change to any other caller's behaviour
- [ ] Unit tests for the six cases + e2e re-runs green; Branch CI green
