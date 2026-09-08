# T9100: Player-detection boxes render offset from the video after "Add Spotlight Now"

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-08

## Problem

Reported live on staging (2026-09-08): clicking **Add Spotlight Now** on Focus's post-export
publish action bar (`FocusPublishActionBar` -> `FocusScreen.handleAddSpotlight` -> `setEditorMode('overlay')`)
lands on the Overlay screen with the player-detection boxes (`PlayerDetectionOverlay`) rendered
entirely disconnected from the actual players in the video — the green dashed boxes (and the
white highlight-selection ellipse) sit in a block of empty space to the LEFT of the visible video
content, not over any player. The "N players detected" badge and detection count are correct
(6 players, matching the visible frame), only the box *positions* are wrong. Confirmed at two
playback times (0:00 and 0:02) via user screenshots — not a one-frame flash, the offset persists.

User's own diagnostic note, from a second screenshot: **the dark canvas/container area visibly
stretches well past the actual displayed video** — the video occupies roughly the right half of a
much wider black panel, with the mis-positioned boxes sitting in the extra black space on the left.
This points at the container the video is measured against, not the detection coordinates
themselves, being the likely fault line (see Hypothesis below).

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — renders the boxes; maps
  `detection.bbox` (video-space) to screen coords via `videoToScreen` (line 136).
- `src/frontend/src/hooks/useVideoDisplayRect.js` — the single source of truth for the
  video->screen transform. Computes the letterbox/pillarbox rect from
  `video.closest('.video-container').getBoundingClientRect()` (line 117-120) crossed with
  `videoMetadata.width/height`.
- `src/frontend/src/modes/OverlayModeView.jsx`, `src/frontend/src/containers/OverlayContainer.jsx`
  — mount the video + `.video-container` + `PlayerDetectionOverlay` for this screen.
- `src/frontend/src/screens/FocusScreen.jsx:1066` `handleAddSpotlight` — the entry point that
  navigates Focus -> Overlay via `setEditorMode('overlay')` (T8390, merged 2026-09-04). This is a
  newly-added navigation path into Overlay mode; the misalignment may be specific to whatever
  layout/mount state Overlay is in when entered this way vs. its other entry points (e.g. the
  top-nav Overlay tab), which may not exhibit the bug.

### Hypothesis (not confirmed — needs investigation, do not assume)
`computeVideoDisplayRect` derives `offsetX`/`width` from the CONTAINER's bounding rect, not the
video element's own rendered rect. If the `.video-container` ancestor found by `closest()` in this
entry path is wider than the actual letterboxed video (e.g. an outer wrapper that hasn't shrunk to
fit, or a stale/duplicate container from the newly-added preview-player shell `FocusPublishActionBar`
sits inside), `computeVideoDisplayRect` would compute a valid-looking but wrong `offsetX`/`scaleX`,
placing every box at a fixed leftward offset — matching exactly what's screenshotted. This would
also explain the user's separate observation that the canvas itself "stretches past its area."

`PlayerDetectionOverlay.jsx` already has a `[Detection Alignment]` `console.debug` (line 71) that
logs `videoMetadata` vs `detectionSource` dimensions and the computed `displayRect` — checking that
log on repro would quickly confirm or rule out a dimension mismatch vs. a container-measurement bug.

### Related Tasks
- Likely introduced or exposed by [T8390](T8390-focus-publish-exit.md) (Focus's new preview-first
  publish exit, merged 2026-09-04) — this is the first task to route Focus -> Overlay through
  `handleAddSpotlight` from the new post-export preview shell. Worth checking whether the same
  misalignment reproduces from Overlay's OTHER entry points (top-nav tab) to isolate whether this
  is a T8390-specific mount/layout issue or a pre-existing `useVideoDisplayRect` bug this path
  happens to newly expose.

## Model Policy note
Per this project's Model Policy, root-causing a bug whose mechanism isn't obvious from a first
read (this one: async layout timing vs. container-measurement bug vs. entry-path-specific mount
state, all plausible) should go to the expert agent before an implementation attempt — don't grind
a guess-and-check fix.

## Acceptance Criteria
- [ ] Root cause identified and documented (why the container/box math is wrong specifically on
      the Focus -> Add Spotlight Now -> Overlay path)
- [ ] Detection boxes render aligned with actual player positions at both entry points into Overlay
      (top-nav tab AND Focus's Add Spotlight Now), at multiple playback times
- [ ] Verify the "canvas stretches past its area" symptom is fixed alongside the box offset (same
      root cause, per the hypothesis above) — or documented as a separate issue if it isn't
- [ ] Regression coverage added (existing `PlayerDetectionOverlay.test.jsx` / a new test) that
      would have caught this
