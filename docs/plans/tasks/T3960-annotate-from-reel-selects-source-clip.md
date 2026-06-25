# T3960: Annotate From a Draft Reel Selects Its Source Clip

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

When the user opens a draft reel and clicks **Annotate** to go back to the original annotation
(the Annotate screen for that reel's game), the clip the reel was created from is **not selected**
in the Clips sidebar — nothing is highlighted. The user expects to land on the Annotate screen with
the reel's source clip already selected, so they can see/continue from where the reel came from.

## Solution

Thread the reel's **source clip** (`raw_clip_id`) through the existing Annotate-navigation breadcrumb
and auto-select that clip once the clips have loaded on the Annotate screen. UI selection only — no
persistence, no new backend.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/pendingNavigation.js` — `setPendingGame()` / `consumePendingGame()`
  sessionStorage breadcrumb. **Extend** to also carry `sourceClipId`.
- `src/frontend/src/App.jsx` — `handleEditInAnnotate()` (~L459-474) currently calls
  `setPendingGame(gameId, selectedClipForAnnotate?.start_time)`. **Pass** `selectedClipForAnnotate?.raw_clip_id`.
- `src/frontend/src/screens/AnnotateScreen.jsx` — consumes the pending game (~L356-384) and owns the
  clip regions. **Add** a select-on-load effect: once `clipRegions` are populated, find the region whose
  `rawClipId === sourceClipId` and select it.
- `src/frontend/src/containers/AnnotateContainer.jsx` — exposes `selectAnnotateRegion(regionId)` (the
  selection handler to call).
- `src/frontend/src/modes/annotate/hooks/useClipSelection.js` — selection state (`selectClip` /
  `selectedRegionId`); the sidebar (`ClipsSidePanel`) renders the highlight from `selectedRegionId`.

### Reel -> source clip mapping
- Backend `final_videos.source_clip_id` -> `raw_clips.id`. Frontend clip regions carry `rawClipId`
  (and clips have `raw_clip_id`). Match the reel's source clip to a clip region by `rawClipId`.

### Related Tasks
- Related to T3940 (re-edit reel -> restore-project -> onOpenProject), but DIFFERENT: T3940 opens the
  project EDITOR; this selects the source clip on the ANNOTATE screen. Reuse the breadcrumb pattern,
  not the restore flow.

### Technical Notes
- **Async clip load:** clips populate after the game video loads — select only AFTER `clipRegions.length > 0`.
- **`consumePendingGame()` clears sessionStorage and is called once** (the existing load effect already
  consumes it). Do NOT call it twice — capture the consumed result (incl. `sourceClipId`) and reuse it
  in the select-on-load effect.
- **Two-half unified video:** `virtualClipRegions` keep the original `rawClipId`, so matching still works.
- **UI state only** — selecting a clip is `useClipSelection` state, not a data mutation. No backend write,
  no reactive persistence (CLAUDE.md).
- **Graceful miss:** if the source clip was deleted, no region matches — leave nothing selected, no error.

## Implementation

### Steps
1. [ ] Extend `pendingNavigation.js`: `setPendingGame(gameId, seekTime, sourceClipId)` + `consumePendingGame()` returns `sourceClipId`.
2. [ ] `App.jsx` `handleEditInAnnotate()`: pass `selectedClipForAnnotate?.raw_clip_id` as `sourceClipId`.
3. [ ] `AnnotateScreen.jsx`: store the consumed pending result; add an effect that, once `clipRegions` are loaded, finds `clipRegions.find(r => r.rawClipId === sourceClipId)` and calls `selectAnnotateRegion(region.id)`.
4. [ ] Verify single-clip + two-half video; verify graceful no-op when the source clip is gone.

## Acceptance Criteria
- [ ] Opening a draft reel and clicking Annotate lands on the Annotate screen with the reel's source clip selected/highlighted in the sidebar.
- [ ] Works for two-half unified videos (matches by `rawClipId`).
- [ ] No clip selected (no error) if the source clip no longer exists.
- [ ] No persistence writes — selection is UI state only.
- [ ] `pendingNavigation` round-trip is unit-tested (sourceClipId carried + cleared); existing annotate tests pass.
