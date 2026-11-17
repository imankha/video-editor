# T16790: Spotlight tap label clipped

**Status:** WIP
**Impact:** 2
**Complexity:** 1
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

**Today.** In Spotlight, hovering a player box shows a small dark label, "Tap to add spotlight", centred on the box.

**The problem.** Found in the staging QA pass on 2026-11-16. For a player near the right edge of a portrait highlight, the label is cut off by the edge of the video and reads "Tap to add spotlig". The label is always 100 pixels wide and centred on the box, so it spills out of the video for any player near the left or right edge.

**What we will do.** Keep the label inside the video: shift it inward when the box is near an edge.

**Why this and not something else.** Shortening the copy would only move the problem to narrower boxes.

**How we will know it worked.** Hover a box at either edge of a portrait highlight: the full label is visible.

## Evidence (staging, build 94928afa1)

- Project 13, 1440x900, box at about x=597 of a video spanning 377 to 644. Screenshot (local, gitignored): `.playwright-mcp/qa-30-spot.png`.

## Implementer notes

- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx`, hover hint `<rect>`/`<text>` at `screenBox.x + screenBox.width / 2 - 50`.

## Acceptance Criteria

- [ ] Hover label fully inside the video for boxes at both edges (browser check on the label's bounding box).
