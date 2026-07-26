# T5900: Playing a reel breaks the layout — video renders outside the player panel, artifacts left behind

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-25

## Problem

User report 2026-07-25: *"playing a my reel makes things go crazy"* — with a screen recording
(`C:\Users\imank\Videos\Captures\Recording 2026-07-25 173321.mp4`, 27s, 1012x758 desktop window).

Frames extracted and reviewed. Two distinct defects:

### A. The video renders OUTSIDE the player panel

Opening a reel preview from a draft tile shows the modal chrome correctly (film icon + reel title
"Brilliant Control" in the header bar), but the content area is a **large empty black region on the
left**, while the **actual video frame is painted in a strip on the right, extending past the panel
edge and off-screen**. The transport bar renders at the bottom of the black region (`5.3 / 5.3`),
so the *player* thinks it is laid out correctly while the *video surface* is somewhere else.

At the recorded window width (1012px) the panel is `md:inset-12` = 48px inset, so it should span
roughly x=48..964. Observed: black from ~x=40, video starting ~x=735 and continuing past 960.

This is the same family as the *"it's slow to open, i see a slice of video, then it opens
completely"* symptom from bug 38p / T5860 — but **T5860 does NOT fix it**: T5860 added a backdrop to
`CollectionPlayer`, whereas this modal is **`DraftTile`'s preview overlay** (`isPreviewing`,
`DraftTile.jsx:462-480`, rendering `MediaPlayer`), which *already* had a correct backdrop. Different
component, different defect: **sizing/containment of the video element**, not modality.

### B. Artifacts remain on the tile after closing

After the player closes, the originating draft tile is left with a stray **vertical magenta/purple
bar** burned into its poster area (visible bottom-left in the post-close frame) — leftover player
chrome (progress/scrub indicator) that was never unmounted or is positioned against the wrong
container.

## Investigation direction

- **Where does the video element get its box?** Suspect the video/`MediaPlayer` is sized from a
  stale or wrong container rect (natural video dimensions, an un-updated `useVideoDisplayRect`, or
  a measurement taken before the modal finished laying out), so it paints outside the panel.
  Compare against the aspect-box work in T5676 (aspect-aware video stage) and T5590 (ResizeObserver
  on `.video-container` — a container that resizes without a window resize event is exactly this
  class of bug).
- **Portrait vs landscape:** the reel is 9:16 portrait; the panel is landscape. Check whether the
  overflow is an aspect/letterbox miscalculation for portrait content in a landscape panel.
- **Artifact (B):** find what renders the magenta bar (progress/scrub element) and why it survives
  or escapes the modal — likely a portal/fixed-position element not cleaned up on unmount, or
  positioned relative to the wrong ancestor.
- Check whether this also affects `CollectionPlayer` (published reels) or only the `DraftTile`
  preview path — the user said "my reel", so verify BOTH the draft-preview and the published-reel
  player.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx:462-480` — the preview overlay (backdrop already correct)
- `src/frontend/src/components/MediaPlayer.jsx` — the player rendered inside it
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — the published-reel player; check
  for the same defect (T5860 just added its backdrop — do not regress that)
- `src/frontend/src/hooks/useVideoDisplayRect.js` (or equivalent) — display-rect math
- Prior art: T5676 (aspect-aware video stage), T5590 (ResizeObserver container resize), T5440

### Related
- Bug 38p / T5860 — the "slice of video" symptom; T5860 fixed modality only, NOT this
- Evidence: screen recording above; extracted frames show the overflow and the post-close artifact

## Acceptance Criteria

- [ ] Playing a reel renders the video fully INSIDE the player panel at desktop and mobile widths —
      no black dead-space, no content painted outside the panel
- [ ] Portrait (9:16) reels letterbox correctly inside the landscape panel
- [ ] No artifacts remain on the originating tile after the player closes
- [ ] Both the draft-preview player and the published-reel player verified (state explicitly if only
      one was affected)
- [ ] T5860's backdrop/modality behavior not regressed
- [ ] Real-browser evidence at the reported window size (~1012px wide) plus 390px and 1280px;
      before/after screenshots of the same reel
