# T8900: Fix timing: nudge an angle into alignment

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

Phone and camera clocks disagree by seconds to minutes, so an angle's automatic placement
can be off. The user needs a rare-use correction: nudge the angle along the timeline and
verify alignment by ear, persisting ONLY on Done (single surgical write - the only
mutation `offset_seconds` ever gets after insert).

## Solution

A "Fix timing" mode: yellow mode-swap strip with nudge buttons + A/B play, drag enabled
on the bar ONLY in this mode, one PATCH on Done. Spec + microcopy: artifact section 08
"Fix timing" (link in [EPIC.md](EPIC.md), decision 7).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/FixTimingStrip.jsx` - NEW
- `src/frontend/src/modes/annotate/AngleLanes.jsx` - long-press/right-click entry +
  drag-in-mode styling (orange, like region levers)
- `src/frontend/src/modes/annotate/AngleSwitcherBadge.jsx` - popover menu row entry
- `src/backend/app/routers/games.py` - NEW endpoint
  `PATCH /api/games/{game_id}/videos/{sequence}/placement` body `{offset_seconds}`
- `src/frontend/src/containers/AnnotateContainer.jsx` - handler + timeline recompute

### Related Tasks
- Depends on: T8890 (bars, active-source machinery), T8870 (column + load payload)
- Blocks: nothing
- The unplaced-footage amber state (T8910's no-timestamp case) opens THIS mode on tap -
  keep the entry function exported/reusable.

### Technical Notes
- Entry: long-press (500ms, GameTile precedent) or right-click an angle bar -> context
  item "Fix timing"; same row in the badge popover. NEVER bare-drag outside the mode.
- Strip (replaces the primary-CTA block under the canvas, T8600 mode-swap pattern,
  yellow tint `bg-yellow-950/20 border-yellow-800/40`):
  title "Fix timing: {angle}", help "Line it up: find a moment you can hear in both,
  like a whistle or a big cheer, then nudge until they match.", buttons
  [-1s][-0.1s] "Moved {+/-}Ns" [+0.1s][+1s], [Play this angle][Play main camera],
  [Reset][Done], X to cancel. Controls row `flex-wrap`.
- The two play buttons each play ~3 seconds from the current playhead in that source
  (use T8890's `switchSource` + a stop timer). No waveforms, no split-screen (decided).
- While in the mode the bar drags horizontally (Pointer Events + setPointerCapture +
  touch-none, orange drag styling); drag and nudges mutate a LOCAL pending offset;
  the bar + angle mapping preview live from the pending value (recompute the T8880 model
  with an override map - do not mutate loaded data).
- Esc/X discards (standard two-layer Esc semantics). Reset restores the loaded value.
  Done -> one `PATCH .../placement` with the final `offset_seconds`, then update the
  loaded gameVideos in memory and recompute lanes; if the move changed lane assignment,
  pulse the bar (2x ring fade, T8910 shares this highlight helper).
- Backend endpoint: profile-scoped like sibling game mutations, validates the video row
  exists, writes offset_seconds only (NEVER recorded_at), returns the updated video row.
  Gesture-based persistence rule: this endpoint is called from the Done handler ONLY.
- Clips are file-relative + sequence, so moving an angle does NOT move its clips' stored
  times - but their VIRTUAL render positions shift with the new offset (they map through
  the model). State this in a code comment; it is correct and intended.

## Implementation

### Steps
1. [ ] Backend endpoint + curated tests (404 unknown sequence, happy path, rejects
   non-numeric).
2. [ ] Mode state + entry points (long-press, context, popover) + exported opener.
3. [ ] Build `FixTimingStrip` with pending-offset preview recompute.
4. [ ] Drag-in-mode on the bar; nudge buttons; A/B play; Reset/Done/cancel.
5. [ ] Tests: mode gating (no drag outside mode), pending preview does not persist,
   Done fires exactly one PATCH with the final value, Esc discards, moved-counter
   formatting; e2e smoke: open mode, +1s, Done, reload -> offset persisted.

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] Accidental drag impossible outside the mode
- [ ] Exactly one write, on Done; Esc/X writes nothing
- [ ] Reload shows the corrected placement (persisted offset)
- [ ] A/B play buttons audibly play the two sources from the same game moment
- [ ] Curated test set green
