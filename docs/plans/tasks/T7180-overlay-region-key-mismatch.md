# T7180: Overlay highlight region key-format mismatch drops the spotlight silently

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-17
**Updated:** 2026-08-17

## Problem

Bug **44p** (arshia.kalantari@gmail.com, project 96): "I'm able to set keyframes and move the
orange section that denotes the amount of clip that has the spotlight. However, once I process
it to add the spotlight the spotlight doesn't appear. I've been able to do this in the past but
for some reason it is not working anymore."

Root-caused via the `expert` agent + a live read-only check of the reporter's prod profile DB
(`working_videos.id=60`, project 96). The stored highlight region carries **both** key formats
with genuinely different values:

| | `startTime`/`endTime` (camelCase) | `start_time`/`end_time` (snake_case) |
|---|---|---|
| Region "Clip 1" | `[2.45, 4.18]` — where the user dragged the lever | `[0.0, 2.0]` — the original auto-generated default |

`create_region`/the auto-region generator (`generate_default_highlight_regions`,
`multi_clip.py`) write **snake_case**. `update_region` (the lever-drag persistence endpoint,
`overlay.py`) writes **camelCase** and never removes the stale snake_case pair. Every reader —
`_region_bounds` in the render path (`overlay.py`) AND the frontend's `restoreRegions`
(`useHighlightRegions.js`) — **prefers snake_case when both keys are present**. So dragging the
lever visually moves the bar (camelCase updates) but the value the exporter and a fresh
page-load actually use never moves off the original `[0, 2]` auto-placement. All of the user's
manually-placed keyframes (clustered 2.45s-4.26s, where the corner-kick action happens) fall
outside that stale `[0, 2]` window and are silently dropped by `_keyframes_within_bounds` at
render time. The export completes 200/"complete" with no error — a spotlight-free video that
looks like a successful export.

Secondary/compounding issue: the lever-drag `pointermove` handler in `RegionLayer.jsx` fires a
real network POST (via `dispatchOverlayAction`) on **every** pointermove during a drag, unthrottled.
A single drag gesture can fire 150-250 individual writes to the same region (confirmed in the
bug's console logs: ~200 near-simultaneous `[SLOW FETCH]` POSTs to
`/api/export/projects/96/overlay/actions` in a 4-second window, 3.4s-6.7s each — a classic
too-many-concurrent-requests-per-host signature, not backend slowness). This inflated
`overlay_version` to 2545 on this single working_video and is wasteful/fragile, but is NOT the
primary cause of the missing spotlight — the key-format mismatch is.

## Solution

1. **Backend (root fix):** canonicalize on snake_case `start_time`/`end_time` at the two write
   sites in `src/backend/app/routers/export/overlay.py`:
   - `update_region` (~L713-717): write `region['start_time']`/`region['end_time']` and
     `region.pop('startTime', None)` / `region.pop('endTime', None)` instead of writing the
     camelCase pair.
   - `create_region` (~L681-682): write the same canonical snake_case keys so newly created
     regions never pick up the camelCase form in the first place.
   - Do NOT add a defensive read-side clamp/fallback for this — fix the write, since every
     reader already prefers snake_case (that preference is what made this bug possible: an old
     stale snake_case pair silently wins over a fresher camelCase write).
   - Existing rows with both key pairs self-heal on their next `update_region` call — no
     migration needed.

2. **Backend (loud-failure diagnostic, optional but recommended):** extend the existing
   empty-keyframes warning near `overlay.py:2900-2905` to also log (CRITICAL, region id + bounds)
   when an enabled region has `start >= end`, or when `_keyframes_within_bounds(region)` returns
   empty for a region that DOES have keyframes. Diagnostic only — never self-repair, never a 4xx;
   this must not start rejecting user data, it should just stop this failing silently next time.

3. **Frontend (drag-dispatch fix, addresses the compounding storm):**
   - `RegionLayer.jsx` lever drag (`handlePointerMove`, ~L101-116): keep updating local state on
     every `pointermove` (that's pure optimistic UI, unchanged) but stop firing the network POST
     there.
   - On `handlePointerUp`/`pointercancel` (~L118-121), if the lever actually moved, fire new
     `onCommitRegionStart(regionId)` / `onCommitRegionEnd(regionId)` callbacks — ONE commit per
     gesture, matching CLAUDE.md's gesture-based persistence rule.
   - `OverlayScreen.jsx` (~L825-844): the existing `wrappedMoveHighlightRegionStart`/`...End`
     become local-only (drop the `dispatchOverlayAction` call). Add
     `wrappedCommitHighlightRegionStart`/`...End` that look up the CURRENT region in
     `highlightRegions` state (which has already been clamped/frame-snapped by the hook) and POST
     that hook-applied value — not the raw pointer position that used to be forwarded directly.
     This also fixes a latent related bug the expert flagged: the old handlers forwarded the RAW
     `newStartTime`/`newEndTime` straight to `overlayActions.updateRegion`, bypassing the hook's
     own clamp (`maxStart = endTime - MIN_REGION_DURATION`) and frame-snap — so the persisted
     value could differ from what the hook actually applied even before this bug's key-mismatch
     was considered.

No schema or migration impact either way.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/overlay.py` - `create_region`/`update_region` (~L654-724),
  `_normalize_region_keys`/`_region_bounds` docstrings (~L534-583), `_keyframes_within_bounds`,
  the empty-keyframes/inverted-bounds diagnostic (~L2917-2944)
- `src/backend/app/routers/export/multi_clip.py` - `generate_default_highlight_regions`
  (~L676-690), confirms the snake_case write on auto-creation (unchanged by this fix)
- `src/frontend/src/components/timeline/RegionLayer.jsx` - lever drag pointer handlers
  (~L98-165), `leverMovedRef` (gesture-scoped ref, survives per-move effect resubscription)
- `src/frontend/src/screens/OverlayScreen.jsx` - `wrappedMoveHighlightRegionStart`/`...End`
  (local-only now) + `wrappedCommitHighlightRegionStart`/`...End` (the one surgical write per
  gesture) + `lastAppliedRegionEdgeRef` (~L824-871)
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js` - `moveRegionStart`/
  `moveRegionEnd` (~L462-556) now RETURN the applied (clamped+snapped) region instead of only
  updating state, so the commit handler never needs to re-read React state
- `src/frontend/src/containers/OverlayContainer.jsx`, `src/frontend/src/modes/overlay/OverlayMode.jsx`,
  `src/frontend/src/modes/OverlayModeView.jsx` (two render call sites) - prop threading for
  `onCommitHighlightRegionStart`/`onCommitHighlightRegionEnd`
- `src/frontend/src/stores/overlayActionStore.js` - existing fire-and-forget dispatch path
  (unchanged by this fix, referenced for context)
- Tests: `src/backend/tests/test_t7180_overlay_region_key_mismatch.py`,
  `src/backend/tests/test_t4900_overlay_keyframe_persistence.py` (stale-comment fixes only),
  `src/frontend/src/components/timeline/RegionLayer.commit.test.jsx`,
  `src/frontend/src/modes/overlay/hooks/useHighlightRegions.persistence.test.js` (new describe
  block)
- `.claude/knowledge/keyframes-framing.md` - "Overlay render read path (T4900)" section updated

### Related Tasks
- Same failure family as T4900 (prod bug 31p, overlay-action-failure-visibility) — that fix
  covers outright FAILED requests; this bug is a silent, deterministic *data* bug that never
  fails a request at all.

### Technical Notes
- Confirmed via live read-only inspection of prod profile DB (`scripts/edit-user-db.py` dry-run,
  profile `b95eb93b`, `working_videos.id=60`) — NOT a hypothetical, the dual-key divergence is
  present in the actual reported project's data right now.
- `.claude/knowledge/keyframes-framing.md` "Overlay render read path (T4900)" section documents
  `_region_bounds`'s dual-format tolerance; this bug is the flip side of that tolerance — it was
  built to accept EITHER format for read-compat, but nothing enforces that a write updates BOTH
  or replaces stale ones, so an old snake_case pair can outlive and shadow a newer camelCase
  write indefinitely.
- **Reviewer round 1 flagged a residual staleness risk**: the first cut of the commit handlers
  re-read `highlightRegions` React state (`.find(r => r.id === regionId)`) at `pointerup` time —
  the same class of bug T5644 already fixed once in this file for region creation (state from a
  `window` listener isn't guaranteed committed by the time a same-gesture later event fires).
  Fixed by having `moveRegionStart`/`moveRegionEnd` (`useHighlightRegions.js`) RETURN the applied
  region synchronously, stashed in `OverlayScreen.jsx`'s `lastAppliedRegionEdgeRef`, and the
  commit handlers read THAT instead of re-deriving from state — matches the established
  `addRegion`/`useTextOverlays` return-contract pattern exactly.
- **Follow-up filed by the reviewer, out of scope for this task**: region-edge lever drags move
  the region's first/last keyframe `frame` locally but the commit only sends the bound —
  `update_region` never touches keyframes. Pre-existing for user-created regions, but this fix
  widens its reach since auto-generated regions' bounds now actually move at render for the
  first time. Include in manual QA: drag a lever on an AUTO-GENERATED region, reload, export,
  confirm the rendered spotlight matches the editor's first/last keyframe position, not just its
  bounds.
- **Also noted, not required for this task**: `src/regiondiag/main.jsx` (the T5644 real-browser
  drag harness, driven by `e2e/T5644-region-lever-touch.qa.spec.js`) does not wire the new
  `onCommitRegionStart/End` props, so it can't yet assert "exactly one commit per drag" on real
  touch input. Would need updating for a real-browser version of acceptance criterion 3.

## Implementation

### Steps
1. [x] Backend: canonicalize `update_region` + `create_region` on snake_case in `overlay.py`
2. [x] Backend: add the loud CRITICAL-log diagnostic for inverted/empty-after-filter regions
3. [x] Frontend: `RegionLayer.jsx` — commit-on-release instead of POST-per-pointermove
4. [x] Frontend: `OverlayScreen.jsx` — wire commit handlers, send the hook-applied value (via
   `useHighlightRegions`'s new return-contract + a ref, not a same-tick React-state re-read)
5. [x] Tests: backend regression for dual-key write/read (including a DIRECTLY SEEDED mixed-key
   row reproducing the exact prod shape, verified red on pre-fix code); frontend test that a
   drag fires exactly one network call, plus a hook-level test pinning that the CLAMPED/snapped
   value is what gets returned/would be committed (not the raw pointer value)
6. [ ] Manual/real-browser verify: drag a region lever across a multi-second gesture, confirm ONE
   network call fires, confirm reload shows the same bounds that were dragged to, confirm export
   renders the spotlight in the dragged position — NOT YET DONE this session (static analysis +
   unit/integration tests only)

### Progress Log

**2026-08-17**: Task filed after expert-agent root cause + live prod DB confirmation.
Implemented backend key-canonicalization + diagnostic, frontend commit-on-release dispatch, and
the return-contract refactor a fresh-context reviewer's round 1 pass asked for (avoiding a
same-gesture stale-state re-read). Backend (63) + frontend (53) targeted tests green. Stale
comments claiming "actions write camelCase" fixed in `overlay.py` and the knowledge doc. Not yet
merged; step 6 (live browser verify) still open.

## Acceptance Criteria

- [ ] Prod project 96's region self-heals to consistent `start_time`==`startTime` on next drag
      (or via a one-off admin fix if the user wants it corrected sooner than their next edit)
- [x] A fresh `create_region`/`update_region` never leaves both key formats present with
      different values
- [x] A lever-drag gesture fires exactly one `updateRegion` POST, carrying the hook's
      clamped/snapped value
- [ ] Export of a region dragged away from its auto-generated default renders the spotlight in
      the dragged position, verified in a real browser (not yet done — see step 6)
- [x] Backend logs loudly (not silently) if an enabled region ever ends up with zero
      in-bounds keyframes at render time
- [x] Relevant backend + frontend tests pass
