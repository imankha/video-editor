# T5670: Show game name + game timestamp in the Overlay screen

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-22
**Type:** Small feature (Overlay UI)

## Problem

The Overlay screen's clip-info card shows the clip name, tags, dimensions, duration, and fps —
but not **which game** the clip came from or **when in the game** it occurred. The user wants the
**game name** and the **game timestamp** (the clip's in-match clock) visible somewhere in Overlay,
the same way the Annotate clip lists already show the in-match game clock.

## Solution

Add the game name + game timestamp to the Overlay clip-info card, next to the existing
dims/duration/fps line. Reuse the existing shared game-clock formatter — do NOT invent a new one.

## Relevant files / pointers
- **Render site:** `src/frontend/src/modes/OverlayModeView.jsx` ~L388-410 — the clip-info card
  (tags at 388-391, `{width}x{height}` at 399, `{fps}` at 409). Add the game name + game clock here.
- **Game clock formatter (reuse):** `clipGameClock(clip, boundaryOffsets)` in
  `src/frontend/src/utils/timeFormat.js:103` (shared T4080 helper → formats like `12'34"`). See how
  Annotate uses it: `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx:253` and
  `src/frontend/src/modes/AnnotateModeView.jsx:116-120` (with `boundaryOffsets`).
- **Data source:** the game name + the clip's game-relative start time (+ `videoSequence` and
  `boundaryOffsets` for multi-part games). Discover where the Overlay screen already has (or can get)
  this: `effectiveOverlayMetadata` / `overlayClipMetadata` in `OverlayScreen.jsx`, the project clip
  data, or `gamesDataStore`. If the game name / game-start time is NOT already in the overlay
  metadata, surface it (prefer reading from existing project/clip data the screen already loads;
  if it must come from the backend, add it to the `GET /overlay-data` response minimally).

## Implementation notes
- Match the visual style of the existing info line (same muted text, `·` separators). Suggested:
  `{gameName} · {clipGameClock(...)}` shown near the dims/duration/fps row.
- Use the SAME `clipGameClock` + `boundaryOffsets` inputs Annotate uses so the clock matches what the
  user sees in Annotate for the same clip (consistency — a clip should show the same in-match time
  in Annotate and Overlay).
- Handle missing data gracefully by simply NOT rendering the game line (no placeholder/N/A), per the
  no-silent-fallback style — but log a console.warn if the clip has a game_id yet no game name/time
  (indicates a data gap worth seeing).

## Acceptance criteria
- [ ] Overlay screen shows the game name AND the in-match game timestamp for the current clip.
- [ ] The timestamp matches what Annotate shows for the same clip (same `clipGameClock`/offsets).
- [ ] Styled consistently with the existing dims/duration/fps info line; responsive (no overflow at 375px).
- [ ] Clips with no game reference render cleanly (game line omitted, no error).
- [ ] Real-browser verification on a clip that has a game (e.g. "Brilliant Dribble and Interception").
