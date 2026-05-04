# T2410 Kickoff Prompt: Playback-Mode Recap Viewer

Implement T2410: Playback-Mode Recap Viewer

Read CLAUDE.md for project rules, workflow stages, coding standards, and agent orchestration before starting.

Read the task file: `docs/plans/tasks/expired-game-experience/T2410-playback-mode-recap-viewer.md`

## Epic Context

This is task **1 of 3** in the Expired Game Experience epic.
Read: `docs/plans/tasks/expired-game-experience/EPIC.md`

## Prior Task Learnings

- **T1583 (Auto-Export Pipeline)**: `_generate_recap()` concatenates clips in `ORDER BY COALESCE(rc.video_sequence, 1), rc.start_time` order. No timestamp mapping is saved. Source videos may already be deleted for expired games — can't re-generate existing recaps.
- **T1583**: `raw_clips` rows survive after expiry (sweep deletes R2 object + storage ref, NOT the game row). `GET /clips/raw?game_id={id}` already returns clip metadata for expired games.
- **T1583**: `storage_expires_at` removed from games table — auth_db is single source of truth.
- **T2400 (Grace Period)**: `r2_grace_deletions` table added. Games in grace period still have R2 video available. Independent from this task.

## Design is APPROVED — Skip to Classification + Implementation

Read the approved design: `docs/plans/tasks/T2410-design.md`

Branch already created: `feature/T2410-playback-mode-recap-viewer`

```
git checkout feature/T2410-playback-mode-recap-viewer
```

## Design Decisions (Summary)

1. **Hybrid timestamp mapping** — New recaps: `_generate_recap()` runs `ffprobe` per extracted clip, saves `recaps/{game_id}_clips.json` to R2. Existing recaps: compute from DB by summing `(end_time - start_time)` per clip in query order.

2. **New endpoint `GET /{game_id}/recap-data`** — Returns `{url, clips}` in one request. Tries stored R2 mapping first, falls back to computed. Keep old `GET /{game_id}/recap-url` for backward compat.

3. **Single-video `useRecapPlayback` hook** — NOT dual ping-pong. Single `<video>` element, RAF loop tracking `currentTime` → active segment. Exposes `seekToClip`, `togglePlay`, `restart`, `seekVirtual`, `startScrub`, `endScrub`.

4. **Reuse `ClipListItem` directly** from annotate mode. New `RecapClipsSidebar` (~50 lines) wraps it in a read-only scrollable list with auto-scroll.

5. **Reuse `PlaybackControls`** from annotate mode. Pass `onExitPlayback → onClose`.

6. **Rewrite `RecapPlayerModal`** in-place — expand from `max-w-lg` bare video to `max-w-6xl` two-column layout: sidebar + video + controls.

## Implementation Order

### Backend

1. **`src/backend/app/services/auto_export.py`** — Modify `_generate_recap()` (line 195-254):
   - After extracting each clip at line 234, run `ffprobe` to get actual duration
   - Accumulate `recap_offset` and build clip mapping list
   - After uploading recap video at line 252, upload `recaps/{game_id}_clips.json` to R2

2. **`src/backend/app/routers/games.py`** — Add `GET /{game_id}/recap-data` endpoint after line 736:
   - Generate presigned URL for recap video
   - Try downloading `recaps/{game_id}_clips.json` from R2 (stored mapping)
   - Fallback: call `_get_annotated_clips()` and compute recap positions by summing durations
   - Return `{url, clips: [{id, name, rating, tags, notes, recap_start, recap_end}]}`

### Frontend

3. **`src/frontend/src/components/recap/useRecapPlayback.js`** (new, ~80 lines):
   - Accept `videoRef` and `clips` array with `recap_start`/`recap_end`
   - Build segments from clips (recap_start = virtualStart, recap_end = virtualEnd)
   - RAF loop: `video.currentTime` → find matching segment → update `activeClipId`, `virtualTime`
   - Expose: `seekToClip`, `togglePlay`, `restart`, `seekVirtual`, `seekWithinSegment`, `startScrub`, `endScrub`, `changePlaybackRate`

4. **`src/frontend/src/components/recap/RecapClipsSidebar.jsx`** (new, ~50 lines):
   - Map clips to `ClipListItem` from `modes/annotate/components/ClipListItem.jsx`
   - Pass `isPlaybackActive` based on `activeClipId`
   - `onClick` → `seekToClip(clip.id)`
   - Auto-scroll active clip into view via `scrollIntoView({ block: 'nearest' })`

5. **`src/frontend/src/components/RecapPlayerModal.jsx`** (rewrite, ~120 lines):
   - Fetch `GET /api/games/{id}/recap-data` instead of `recap-url`
   - Initialize `useRecapPlayback` with fetched clips
   - Two-column layout: `RecapClipsSidebar` | Video + `PlaybackControls`
   - Keep "Extend Storage" and "Close" buttons in footer
   - Expand modal to `max-w-6xl`

## Code Paths (exact locations)

### Backend — `auto_export.py`
- **Lines 94-110**: `_get_annotated_clips()` — query returns `id, name, rating, tags, notes, start_time, end_time, auto_project_id, video_sequence, video_hash`. Ordered by `video_sequence, start_time`.
- **Lines 195-254**: `_generate_recap()` — clips grouped by `video_hash` into `defaultdict(list)`. Each clip extracted at 854x480 with `libx264 fast crf=28`. Concat via ffmpeg concat demuxer. Upload to `recaps/{game_id}.mp4`.
- **Line 234**: `extracted_paths.append(out_path)` — insert ffprobe + mapping accumulation here.
- **Line 252**: `upload_to_r2(user_id, recap_r2_key, recap_path)` — add JSON upload after this.

### Backend — `games.py`
- **Lines 721-736**: Existing `GET /{game_id}/recap-url` endpoint. Keep unchanged.
- **After line 736**: Add new `GET /{game_id}/recap-data` endpoint.

### Frontend — Components to reuse
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` — accepts `{region, index, isSelected, isPlaybackActive, onClick}`. Region needs `{rating, name, tags, notes, startTime, endTime}`.
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — accepts `{isPlaying, virtualTime, totalVirtualDuration, segments, activeClipId, activeClipName, currentSegment, onTogglePlay, onRestart, onSeek, onSeekWithinSegment, onStartScrub, onEndScrub, onExitPlayback, playbackRate, onPlaybackRateChange}`. Video refs needed for volume control — recap viewer has single ref, pass as both `videoARef` and `videoBRef`.
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` — `buildVirtualTimeline(clips)` builds segments. Could reuse the segment structure concept but recap clips use `recap_start`/`recap_end` directly.

### Frontend — Game card click flow
- `src/frontend/src/components/ProjectManager.jsx:~728`: `onPlayRecap={() => setRecapGame(game)}` — passes full game object to `RecapPlayerModal`. No change needed.

## Critical Gotchas

1. **Existing recaps have no stored mapping** — `_try_load_stored_mapping` must handle 404/missing gracefully and fall back to computed. Don't fail the whole endpoint.

2. **ffprobe duration vs computed duration** — For new recaps, always use ffprobe actual duration (accounts for keyframe alignment). Cumulative drift with computed can be 5-10s for 30+ clips.

3. **`ClipListItem` expects `region.startTime`/`region.endTime`** — Map `recap_start`/`recap_end` to `startTime`/`endTime` when passing to ClipListItem.

4. **`PlaybackControls` expects `videoARef`/`videoBRef`** for volume — Pass the single recap videoRef as both props.

5. **Clip name fallback** — Use `clip.name || generateClipName(clip.rating, clip.tags, clip.notes) || \`Clip ${i + 1}\`` matching the pattern in `_export_brilliant_clip` (auto_export.py:182).

6. **Read-only means no reactive persistence traps** — No `useEffect` watchers writing to stores. The recap viewer is fully ephemeral.

7. **`_generate_recap` uses `defaultdict(list)`** — Python 3.7+ preserves insertion order. Clip mapping must follow the same iteration order as `extracted_paths` to match concat order.

8. **`download_from_r2_global` vs `download_from_r2`** — The stored mapping JSON is uploaded per-user (`upload_to_r2(user_id, ...)`). The recap-data endpoint must use user-scoped R2 access to download it.
