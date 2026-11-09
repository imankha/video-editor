# T15380: Mobile fullscreen Annotate stops covering the video (portrait layout + peek while dragging)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M (frontend only, no schema change)
**Created:** 2026-11-08
**Updated:** 2026-11-08

Owner chose options B + D on 2026-11-08 from a UX consult. The landscape side-strip layout (option C) is the follow-up T15370.

## Problem

User feedback (iPhone, 2026-11-08): "When trying to mark a play on the app on my phone ... the options overlay the video so I can't see the play to trim properly. Actually same with if I'm trying to use the fast forward function in full screen landscape mode."

This happens only in phone fullscreen (`mobileFs = annotateFullscreen && isMobile`, `AnnotateModeView.jsx` ~L1127-1230). Windowed portrait already puts the editor below the video (T10620). Measured with Playwright on the seeded `full` dev account, as the share of the visible video picture covered:

| State | Viewport | Covered |
|---|---|---|
| Edit play open | portrait 393x852 | 92% (the video is centred, leaving about 315px of empty black above it) |
| Edit play open | landscape 852x393 | 76% |
| Transport controls showing | landscape 852x393 | 88% |
| Transport controls showing | portrait 393x852 | 35% |

Causes:
1. The editor and the controls are `absolute bottom-0` layers (70dvh in portrait, 76dvh in landscape) on top of a full-screen `object-contain` video.
2. `isDraggingScrub` hides the controls layer during a drag but not the editor sheet, so the user trims without seeing the picture.
3. `useFullscreenControls` only starts the auto-hide timer while the video plays (`handleInteraction`, `if (isPlaying) startTimer()`). When paused, which is when the user trims and scrubs, the controls stay up.

## Solution

**B: portrait fullscreen.** Pin the video to the top, inside `env(safe-area-inset-top)`. Render the editor below it in normal page flow with `layout="portrait-strip"` (the T10620 branch), and the transport controls and timeline the same way. Nothing is drawn over the picture. Keep the exit-fullscreen button clear of the notch.

**D: both orientations, mainly landscape until T15370.**
- While a trim handle or the scrub bar is dragged, collapse the edit sheet to just the `ClipScrubRegion` row on a light background and hide the rest of the form. Restore it on release. Keep the scrub row mounted in the same place so the drag does not lose its touch.
- After any control interaction, start the auto-hide timer when paused as well as when playing.
- In landscape, hide the source bar and the zoom pill until the user taps the video.

## Acceptance criteria

1. Portrait fullscreen with Edit play open: 0% of the video picture is covered (picture rect vs editor rect).
2. Portrait fullscreen with controls showing: 0% of the picture is covered.
3. Landscape fullscreen while dragging a trim handle: at least 75% of the picture is visible. After release the full editor is back and the drag has not lost its touch.
4. Landscape fullscreen, paused: after a control tap, the controls hide within the auto-hide delay (3 s).
5. These keep working: double-tap skip, long-press drag mode, the soft keyboard over the name input in portrait, and the multi-video source bar.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` (`mobileFs` branch)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (`portrait-strip`, `landscape-inline`, `onScrubDragChange`)
- `src/frontend/src/hooks/useFullscreenControls.js`
- Tests: `AnnotateFullscreenOverlay.portraitStrip.test.jsx`, `AnnotateModeView.portraitStrip.test.jsx`, the render-site inventory test

### Repro
The measurement harness (picture rect from `object-contain` vs overlay rect, for portrait 393x852 and landscape 852x393, `loginAsDevPreset(context, 'full')`) is in the uncommitted local file `src/frontend/e2e/zz-repro-mobile-overlay.tmp.spec.js`. Turn it into the acceptance e2e spec for this task.

### Knowledge
`.claude/knowledge/annotate.md`: T10620, T9500, T10800, T10780, T14350 (double-tap skip).

### Related Tasks
- T15370 (landscape side-strip layout, the follow-up)
- T10620 (portrait in-flow strip, windowed)
- T10840 (Focus landscape side-strip layout)
