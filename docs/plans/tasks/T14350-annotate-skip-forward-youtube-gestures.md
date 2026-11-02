# T14350: Annotate: forward skip button, YouTube double-tap skip, and matching keys

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-01
**Updated:** 2026-11-01

## Problem

User feedback 2026-11-01 (a parent marking plays at 2x): "double click on the video and skip
forwards (and backwards) YouTube style, or a skip 5 seconds button. I see the backwards button
but forwards would be nice. There are times I know the ball didn't come near one of the kids for
a little while but I don't want to drag the slider and accidentally miss something."

What the Annotate transport bar does today (`AnnotateControls.jsx`, left group, in order):

| Button | Action |
|---|---|
| Rewind icon | Back 5 seconds |
| SkipBack icon | Step back one frame |
| Play | Play / pause |
| RotateCcw icon | Restart |
| SkipForward icon | Step forward ONE FRAME |

So the "forward" button the user sees is a frame step. There is no forward skip by seconds in
the UI. The only forward skip is Right Arrow in `AnnotateScreen.jsx` (`handleKeyDown`, playhead
layer only): Left = back 4 s, Right = forward 8 s, asymmetric, undocumented, and dead when the
Plays layer is selected (the default), where the arrows jump between marked plays instead. The
video surface has no double-click or double-tap handler at all (desktop non-fullscreen has no
click handler; mobile fullscreen single-tap toggles play via `useFullscreenControls`).

## Solution (YouTube model, user decision 2026-11-01: "as much like YouTube as possible")

1. **Symmetric transport bar.** Play in the center, frame steps directly beside it, 5 s skips
   outside them, Restart at the far left:
   `Restart | Back 5 s | Frame back | Play | Frame fwd | Forward 5 s`.
   Forward 5 s uses the `FastForward` lucide icon, mirrors the existing Rewind button
   (`onSeekForward?.(5)`, title "Forward 5 seconds"), and is hidden under the same
   `editorOpen` gate (T8960 item 9) as the other skips. Skip amount stays 5 s: it matches the
   existing Back button and the user's ask; YouTube's default is 10 s but at 2x playback 5 s of
   video is already 2.5 s of attention.
2. **Double-tap / double-click skip on the video.** Left half = back 5 s, right half =
   forward 5 s, on desktop (dblclick) and phone (two taps within ~300 ms), in and out of
   fullscreen. Show YouTube's feedback: a brief circular ripple on that half with a
   "5 seconds" label and chevrons; further taps within ~700 ms accumulate (10, 15 ...) and the
   label shows the running total. Single tap keeps its current meaning everywhere it has one
   (mobile fullscreen: play/pause + controls); do not delay the single tap to disambiguate. On
   desktop outside fullscreen, add YouTube's single-click play/pause on the video (none today);
   a double-click then re-toggles so the playing state is unchanged after the skip, as on
   YouTube. Disabled while the play editor is open (same gate as the buttons).
3. **Keys match YouTube and the buttons.** Playhead layer: Left/Right = 5 s (replace the
   4 / 8 split); J / L = 10 s back / forward, K = play/pause, on every layer. Plays-layer
   Left/Right keep jumping between marked plays (no YouTube equivalent; existing users rely
   on it). Button tooltips name the key, e.g. "Forward 5 seconds (Right arrow)".
4. Use the existing `seekForward(seconds)` / `seekBackward(seconds)` from
   `useMultiVideoScrub` (already destructured in `AnnotateScreen.jsx`; they handle the
   multi-video virtual timeline) so a skip near a source boundary crosses it correctly.

Out of scope: the Review plays (playback mode) controls in `PlaybackControls.jsx`, and the
Frame / Spotlight editors' controls in `Controls.jsx` (if the same symmetric layout is wanted
there, file a follow-up).

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` - transport bar (left group ~line 148-205)
- `src/frontend/src/modes/annotate/components/AnnotateControls.test.jsx` - existing button tests
- `src/frontend/src/modes/AnnotateModeView.jsx` - video surface wrapper (~line 777-790, click/touch handlers), passes `onSeekBackward` (~984, ~1153)
- `src/frontend/src/screens/AnnotateScreen.jsx` - `handleKeyDown` arrow / Space / A keys (~655-726)
- `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.js` - `seekForward` / `seekBackward` (~176-190)
- `src/frontend/src/hooks/useFullscreenControls.js` - mobile fullscreen tap / long-press state
- `src/frontend/src/hooks/useKeyboardShortcuts.js` - `ARROW_SEEK_SECONDS` (Frame/Spotlight only; not used by Annotate)

### Knowledge Docs
- `.claude/knowledge/annotate.md` (T8960 item 9 editor gate; arrow-key clip nav)
- `.claude/knowledge/guidance.md` (reduced motion: the ripple must respect it)
- `.claude/references/ui-style-guide.md`

### Notes
- UX-expert pass before the user tests (ui-designer mock of the bar and the ripple; verify on
  phone and desktop) per the standing rule.
- Live-drive in a real browser for the double-tap (pointer fixes rule): Playwright `dblclick`
  on desktop, two `tap`s on a touch context.
- Tooltips, labels and task copy use no em dashes.

## Acceptance Criteria

- [ ] Transport bar order is `Restart | Back 5 s | Frame back | Play | Frame fwd | Forward 5 s`;
      Forward 5 s moves the playhead +5 s (unit test on `AnnotateControls`)
- [ ] Forward 5 s is hidden while the play editor is open, like the other skips
- [ ] Double-click the right half of the video on desktop: +5 s, ripple with "5 seconds";
      left half: -5 s; three quick clicks on one half: 10 s total and the label shows "10 seconds"
- [ ] Two taps on a touch viewport (390x844) do the same, in and out of fullscreen
- [ ] Playing state is unchanged after a double-click skip on desktop
- [ ] Playhead layer: Right/Left arrows = +5 / -5 s; J / L = -10 / +10 s; K toggles play;
      Plays layer arrows still jump between marked plays; none fire while the play editor is open
- [ ] Skipping across a multi-video source boundary lands in the next video at the right offset
- [ ] Ripple is skipped under `prefers-reduced-motion`; label still shows
