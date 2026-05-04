# T2410: Playback-Mode Recap Viewer

**Status:** IN_PROGRESS
**Impact:** 7
**Complexity:** 5
**Created:** 2026-05-03
**Updated:** 2026-05-03

## Problem

The current RecapPlayerModal is a bare HTML5 `<video>` tag playing a single concatenated recap file. No clip names, no ratings, no timestamps, no navigation. The user spent time annotating their game — the expired experience should reflect that effort and look like the playback mode they already know.

## Solution

Replace RecapPlayerModal with a read-only version of the Play Annotations mode:

- Video player with the recap video
- Clip list sidebar showing annotated clips with names, ratings, tags, timestamps
- Navigation: click a clip to seek to its position in the recap
- Current clip highlight synced to video playback position

This is essentially the Play Annotations mode from Annotate, but:
- **Read-only** — no editing, no rating changes, no adding clips
- **Uses the recap video** — not the original game video (which may be deleted)
- **Clip timestamps mapped** to recap positions (since clips are concatenated sequentially)

### Timestamp mapping

The recap video concatenates clips in order. We need a mapping from recap time position to original clip metadata. Options:

**Option A: Stored mapping** — When generating the recap (in `_generate_recap`), also save a JSON mapping of `[{clip_id, recap_start, recap_end, original_start, original_end}]` alongside the recap video. Backend serves this via a new endpoint.

**Option B: Computed from clip durations** — The recap concatenates clips in `start_time` order. Sum durations to compute each clip's start position in the recap. Frontend can compute this from the clips list + video duration validation.

Option A is more reliable (accounts for FFmpeg encoding differences).

## Code Paths

### Backend — Recap generation (where to add timestamp mapping)

**`src/backend/app/services/auto_export.py:195-254`** — `_generate_recap()` concatenates clips into `recaps/{game_id}.mp4`. Clips arrive from `_get_annotated_clips()` (lines 94-110) which returns `id, name, rating, tags, notes, start_time, end_time, auto_project_id, video_sequence, video_hash`. Clips are grouped by `video_hash` (line 200-202), then each clip is extracted at 854x480 to `clip_{id}.mp4` (lines 215-234). The extraction order matches the concat order. **Add timestamp mapping here**: after extracting each clip, record its duration (may differ slightly from `end_time - start_time` due to FFmpeg keyframe alignment) and accumulate virtual offsets. Save the mapping JSON to R2 alongside the recap at `recaps/{game_id}_clips.json`.

**`src/backend/app/services/auto_export.py:94-110`** — `_get_annotated_clips()` is the clip metadata query. It already returns all fields needed for the sidebar (name, rating, tags, notes, start_time, end_time). The `ORDER BY COALESCE(rc.video_sequence, 1), rc.start_time` determines concat order.

### Backend — Serving clip metadata

**`src/backend/app/routers/games.py:711-726`** — `GET /{game_id}/recap-url` currently returns just `{"url": presigned_url}`. Extend this endpoint (or add a sibling `GET /{game_id}/recap-clips`) to return the clip mapping JSON. The endpoint already has user context and game lookup.

**`src/backend/app/routers/games.py:629-704`** — `list_games()` already returns `auto_export_status` and `recap_video_url` per game. No change needed here — the frontend already knows which games have recaps.

### Frontend — Current RecapPlayerModal (to be replaced)

**`src/frontend/src/components/RecapPlayerModal.jsx:1-82`** — Current bare modal: fetches `recap-url`, plays `<video>` with autoplay, has "Extend Storage" and "Close" buttons. This becomes the starting point for the new viewer.

### Frontend — Play Annotations mode (reference implementation)

**`src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js:1-60`** — Dual-video ping-pong playback controller. Uses `buildVirtualTimeline()` to map virtual time to actual video time. Tracks `activeClipId`, `virtualTime`, `isPlaying`. **Cannot reuse directly** — this hook is designed for the original game video with seek-by-actual-time. The recap viewer needs a simpler version: single video element, seek by recap position.

**`src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js:1-50`** — `buildVirtualTimeline(clips)` builds segments with `virtualStart`, `virtualEnd`, `duration` per clip. Maps virtual time to actual time and back. **Can reuse the segment-building logic** for the recap timeline, but the mapping direction is inverted: in annotate mode, virtual → actual seeks into the game video. In recap mode, virtual time IS the recap video time (clips are already concatenated).

**`src/frontend/src/modes/annotate/components/ClipListItem.jsx`** — Sidebar clip row showing rating badge (color-coded), clip name, timestamp. Selected + playing states with highlight. **Reuse this component directly** (or extract a shared version) for the recap sidebar.

**`src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx`** — Sidebar container listing ClipListItem instances. Has import/export TSV and detail editing — **strip those features** for the read-only recap version.

**`src/frontend/src/modes/annotate/components/PlaybackControls.jsx`** — Play/pause, playback rate, progress bar. **May reuse** for recap playback controls.

### Frontend — Game card click flow

**`src/frontend/src/components/ProjectManager.jsx:~1194`** — GameCard renders ExpirationBadge. Click handler checks `isExpired && hasRecap` to open RecapPlayerModal. The `onPlayRecap` prop passes the game object. **No change needed** — just replace what RecapPlayerModal renders.

## Gotchas

### FFmpeg keyframe-aligned extraction changes clip durations
When `_generate_recap` extracts clips with `ffmpeg.input(ss=start_time, to=end_time)`, FFmpeg may round to the nearest keyframe. The extracted clip duration can differ from `end_time - start_time` by up to ~0.5s. The timestamp mapping must use the actual extracted duration (from `ffprobe` on each extracted clip), not the computed duration.

### Recap clip order matches `_get_annotated_clips` query order
Clips are concatenated in `ORDER BY COALESCE(rc.video_sequence, 1), rc.start_time`. The mapping JSON must preserve this exact order. If the query order ever changes, the mapping breaks.

### The recap video is a single file — no dual-video ping-pong needed
Unlike `useAnnotationPlayback` which alternates two `<video>` elements to hide seek latency across clips, the recap is already a single concatenated video. Standard `<video>` seek is sufficient. Don't over-engineer this with the ping-pong pattern.

### `auto_project_id` can be NULL
Not all annotated clips have auto-projects. The sidebar should handle clips where `auto_project_id` is NULL gracefully (no "Open Project" action).

### Clips without names get auto-generated names
`_export_brilliant_clip` uses `clip['name'] or f"Clip {clip['id']}"` as fallback (auto_export.py:182). The sidebar should use the same fallback pattern when displaying clip names.

### Read-only means no reactive persistence traps
Since this viewer is read-only (no state changes to persist), the gesture-based sync rules don't apply. But be careful not to add `useEffect` watchers that write to stores — the recap viewer should be fully ephemeral.

## Context

### Relevant Files

**Frontend:**
- `src/frontend/src/components/RecapPlayerModal.jsx` — Current modal (will be heavily modified or replaced)
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` — Play Annotations playback controller (reference)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` — Virtual timeline builder (reusable segment logic)
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` — Clip sidebar row (reusable component)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Clip sidebar container (reference for layout)
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — Playback controls (may reuse)

**Backend:**
- `src/backend/app/services/auto_export.py` — `_generate_recap()` — add timestamp mapping generation
- `src/backend/app/routers/games.py` — Add endpoint for recap clip mapping

### Related Tasks

- Depends on: T1583 (auto-export pipeline)
- Blocks: T2420 (annotations + highlights tabs build on this viewer)

## Acceptance Criteria

- [ ] Expired game opens a playback-mode-style viewer (not a plain video player)
- [ ] Clip list shows all annotated clips with name, rating, tags
- [ ] Clicking a clip seeks to its position in the recap video
- [ ] Current clip highlights in the sidebar as video plays
- [ ] Close button returns to game list
