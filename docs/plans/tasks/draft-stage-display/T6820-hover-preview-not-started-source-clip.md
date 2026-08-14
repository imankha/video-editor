# T6820: Hover preview for Not Started drafts (source clip window)

**Status:** STAGING
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-11
**Updated:** 2026-08-11

Epic: [Draft Stage Display](EPIC.md) — child 3/3. NOT code-freeze material (backend payload
addition + preview-player changes); lands after the freeze. Functionally an extension of the
[Tile Video Preview epic](../tile-video-preview/EPIC.md) — coordinate primitive changes there.

## Problem

T6420's hover preview chain is final video → (T6441) working video → nothing. A Not Started
draft has neither, so hovering does nothing — yet its source clip is streamable today via the
bounded clip-window proxy `GET /api/projects/{project_id}/clips/{clip_id}/stream`
(`clips.py::stream_working_clip_bounded`, T1430/T1440 three-window strategy).

The catch: that endpoint proxies the WHOLE source game video (Content-Range reports true
source size; only the moov windows + clip window are servable). A naive `<video src>` starts
at t=0 — outside the clip window — so the preview must seek to the clip's start offset and
loop within [start, end]. The projects payload doesn't carry those offsets (`ClipSummary` =
id/name/tags/rating only).

## Solution

1. **Backend (additive, read-only):** extend `ClipSummary` in `routers/projects.py` with the
   first clip's source-window offsets — `source_start_time` / `source_end_time` — resolved
   the same way `stream_working_clip_bounded` resolves the clip window (multi-video games:
   offsets are relative to the clip's game_video sequence, per T1440; reuse that resolution,
   don't re-derive). Only needed for the first clip if payload size is a concern.
2. **Frontend:** `TilePreviewVideo` gains optional `startTime`/`endTime` props: on
   `loadedmetadata` seek to `startTime`; on `timeupdate` past `endTime`, loop back to
   `startTime`. Absent props = current behavior (play from 0), so DraftTile/ReelTile
   existing uses are untouched.
3. **DraftTile:** extend the `previewStreamUrl` chain with a third fallback: no final, no
   working video, but `project.clips[0]` exists → clip-stream URL + offsets.

All T6420 semantics inherited for free via `useTilePreview`: fine-pointer only, muted,
single-active registry, `prefers-reduced-motion` off-switch, warm/reveal delays, teardown
when the full player opens.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/projects.py` — `ClipSummary` + list-projects query (offsets)
- `src/backend/app/routers/clips.py` — reference only (window resolution to mirror)
- `src/frontend/src/components/collections/TilePreviewVideo.jsx` — start/end window props
- `src/frontend/src/components/DraftTile.jsx` — previewStreamUrl fallback chain
- `src/frontend/src/hooks/useTilePreview.js` — likely untouched (verify)
- Tests: `DraftTile.preview.test.jsx`, TilePreviewVideo unit test, backend
  `test_projects` payload test

### Related Tasks
- Depends on: T6800 (landscape Not-Started shell — the source video fills it)
- Sibling of T6441 (In-Overlay fallback) in spirit; child of this epic by placement

### Technical Notes
- **Expired/reclaimed sources:** posters already 404 → branded fallback for these. The clip
  stream endpoint errors similarly; the preview primitive already tolerates stream errors
  (no error UI on tiles — verify T6420's error path swallows it).
- **Bandwidth:** the bounded proxy exists precisely to stop over-buffering (T1430) — the
  browser can only fetch moov windows + clip window, so hover cost ≈ clip size, acceptable.
- **Seek latency:** first frame needs moov + a mid-file range; expect a slightly slower
  reveal than final-video previews. The T6420 reveal delay (~450ms) already hides most
  of it; do not add spinners.
- No persistence anywhere; payload change is additive and read-only.

## Implementation

### Steps
1. [ ] Backend: offsets on `ClipSummary`; payload test
2. [ ] `TilePreviewVideo`: window props + loop; unit test
3. [ ] DraftTile: third fallback in `previewStreamUrl` + offsets pass-through; test
4. [ ] Real-browser QA: hover an un-started draft on a real account (multi-video game
       included), verify seek lands inside the clip and loops

## Acceptance Criteria

- [ ] Hovering a Not Started draft plays its source clip window, muted, looping
- [ ] Multi-video-game clips seek into the correct sequence offsets
- [ ] Final/working-video previews byte-identical in behavior
- [ ] Expired-source drafts: no error UI, poster/fallback stays
- [ ] Frontend + backend tests pass
