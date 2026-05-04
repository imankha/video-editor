# T2420 Kickoff Prompt: Annotations + Highlights Tabs

Implement T2420: Annotations + Highlights Tabs

Read CLAUDE.md for project rules, workflow stages, coding standards, and agent orchestration before starting.

Read the task file: `docs/plans/tasks/expired-game-experience/T2420-annotations-highlights-tabs.md`

## Epic Context

This is task **2 of 3** in the Expired Game Experience epic.
Read: `docs/plans/tasks/expired-game-experience/EPIC.md`

## Prior Task Learnings

- **T2410 (Playback-Mode Recap Viewer)**: `RecapPlayerModal` was rewritten from a bare `<video>` tag to a two-column layout with `RecapClipsSidebar` + `PlaybackControls` from annotate mode. Uses `useRecapPlayback` hook with RAF loop. The recap video is a single concatenated file at 854x480.
- **T2410**: `GET /api/games/{game_id}/recap-data` returns `{url, clips: [{id, name, rating, tags, notes, recap_start, recap_end}]}`. Tries stored R2 mapping first, falls back to computed durations from DB.
- **T2410**: The modal already has fullscreen support (Fullscreen API, Space bar handler, sidebar hidden in fullscreen), tags/notes panel at sidebar bottom, and no backdrop-close behavior.
- **T2410**: `useRecapPlayback` hook takes `(videoRef, clips)` where clips have `recap_start`/`recap_end`. It builds segments, tracks `activeClipId`, and exposes `seekToClip`, `togglePlay`, `restart`, scrub controls. The hook depends on `totalVirtualDuration` changing to re-attach video event listeners.
- **T2410**: Play/pause event listeners in `useRecapPlayback` depend on `totalVirtualDuration` in the effect deps array — this was a bug fix because the video element mounts after data loads.

## Design is APPROVED — Skip to Classification + Implementation

Create a branch: `feature/T2420-annotations-highlights-tabs`

## Design Decisions (Summary)

1. **Tab bar inside RecapPlayerModal** — Two tabs: "Annotations" (default, all clips via recap video) and "Highlights" (5-star brilliant clip exports). Highlights tab only shows when `final_videos` with `source_type='brilliant_clip'` exist for the game.

2. **New endpoint `GET /api/games/{game_id}/brilliant-clips`** — Returns `{clips: [{id, name, rating, duration, stream_url}]}`. Preferred over extending `GET /api/downloads` because it scopes to a single game, returns stream URLs directly, and avoids coupling to the downloads page's grouping logic.

3. **Separate video elements per tab** — Annotations tab uses the recap video (854x480 landscape). Highlights tab uses individual brilliant clips (1080x1920 portrait 9:16). Unmount the old `<video>` and mount a new one on tab switch — don't swap `src` to avoid stale buffer issues.

4. **Highlights tab reuses sidebar + playback controls** — Same two-column layout as Annotations. Sidebar shows brilliant clips list. Single-clip playback with `onEnded` advancing to next clip, or click to select.

5. **Aspect ratio handling** — Recap video is landscape (16:9-ish). Brilliant clips are portrait (9:16). The video container already uses `object-contain` / `max-w-full max-h-full` which handles both aspect ratios without changes.

6. **Tab state is UI-only** — No API calls on tab switch, no stores. Just local `useState` for active tab. Both datasets fetched in parallel on modal mount.

## Implementation Order

### Backend

1. **`src/backend/app/routers/games.py`** — Add `GET /{game_id}/brilliant-clips` endpoint after the `recap-data` endpoint:
   - Query `final_videos` for `source_type='brilliant_clip' AND game_id=? AND published_at IS NOT NULL`
   - Use `latest_final_videos_subquery()` to get latest versions
   - For each clip, include the download `id` (frontend uses `getStreamingUrl(id)` to play)
   - Return `{clips: [{id, name, duration}]}`
   - Empty array if no brilliant clips exist

### Frontend

2. **`src/frontend/src/components/recap/useHighlightsPlayback.js`** (new, ~100 lines):
   - Accept `videoRef`, `clips` array (from brilliant-clips endpoint), and `getStreamUrl` function
   - Track `activeClipIndex` and `activeClip`
   - On `video.ended` → advance to next clip by changing `activeClip` (which remounts video via key)
   - Expose: `seekToClip`, `togglePlay`, `restart`, `playbackRate`, `changePlaybackRate`, `isPlaying`, `virtualTime`, `totalVirtualDuration`, `segments`, `currentSegment`, `activeClipId`, `activeClipName`
   - Build a virtual timeline across all clips: each clip is a segment with `virtualStart` = cumulative duration, `duration` = clip duration
   - Track `currentTime` + cumulative offset of preceding clips = `virtualTime`

3. **`src/frontend/src/components/RecapPlayerModal.jsx`** (modify):
   - Add second `useEffect` to fetch `GET /api/games/{game_id}/brilliant-clips` in parallel with recap-data
   - Add `activeTab` state: `'annotations' | 'highlights'`
   - Add tab bar between header and content area
   - Conditionally render Annotations view (existing) or Highlights view based on active tab
   - Highlights tab uses `useHighlightsPlayback` hook + `RecapClipsSidebar` + `PlaybackControls`
   - Hide Highlights tab when `brilliantClips.length === 0`

## Code Paths (exact locations)

### Backend — `games.py`

- **Lines 738-790**: Existing `GET /{game_id}/recap-data` endpoint (from T2410). Place new endpoint after this.
- **Line 27**: Existing import of `generate_presigned_url` — already available for URL generation.
- **Line 30**: Existing import of `get_current_user_id`.

### Backend — `downloads.py` (reference only, no changes)

- **Lines 662-743**: `GET /downloads/{download_id}/stream` endpoint. This is how the frontend streams brilliant clip videos. The brilliant-clips endpoint returns `id` values; the frontend builds stream URLs via `/api/downloads/{id}/stream`.
- **Lines 206-247**: `list_downloads` endpoint — NOT modified. Using a dedicated game-scoped endpoint instead.

### Backend — `auto_export.py` (reference only, no changes)

- **Lines 64-66**: 4-star fallback — if no 5-star clips, 4-star clips become brilliant clips. Both use `source_type='brilliant_clip'` in `final_videos`.
- **Lines 123-192**: `_export_brilliant_clip` — creates 1080x1920 9:16 center-crop, stores in `final_videos` with `game_id`, `name`, `duration`, `source_type='brilliant_clip'`.
- **Line 178**: Filename format `auto_{game_id}_{clip_id}_{uuid}.mp4` — stored in R2 under user prefix.

### Backend — `database.py` (reference only, no changes)

- **Lines 634-650**: `final_videos` schema. Key columns: `source_type TEXT`, `game_id INTEGER`, `name TEXT`, `duration REAL`, `published_at TIMESTAMP`.

### Frontend — Components to reuse

- `src/frontend/src/components/recap/RecapClipsSidebar.jsx` — Accepts `{clips, activeClipId, onSeekToClip}`. Each clip needs `{id, rating, tags, notes, name, recap_end}`. Reusable for Highlights sidebar by mapping brilliant clips to this shape.
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — Full props interface documented in T2410. Pass `videoARef` and `videoBRef` as the same ref.
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` — Used inside RecapClipsSidebar. Expects `region` with `{rating, tags, notes, name, endTime}`.

### Frontend — Streaming brilliant clips

- `src/frontend/src/hooks/useDownloads.js:146-148` — `getStreamingUrl(downloadId)` returns `/api/downloads/{downloadId}/stream`. This is how to build the video `src` for each brilliant clip. The stream endpoint proxies R2 to avoid CORS.

### Frontend — RecapPlayerModal current structure

```
RecapPlayerModal (lines 1-231)
├── State: recapData, error, isFullscreen
├── Fetch: GET /api/games/{id}/recap-data (lines 16-30)
├── Fullscreen: Fullscreen API + Space bar handler (lines 32-59)
├── useRecapPlayback hook (lines 61-78)
├── Error/Loading early returns (lines 80-103)
├── Layout:
│   ├── Header (hidden in fullscreen) (lines 119-138)
│   ├── Content flex row (line 141)
│   │   ├── Sidebar w-64 (hidden in fullscreen) (lines 143-180)
│   │   │   ├── Clip count header (lines 150-154)
│   │   │   ├── RecapClipsSidebar (lines 156-160)
│   │   │   └── Tags/Notes panel for active clip (lines 162-177)
│   │   └── Video + PlaybackControls (lines 183-226)
│   │       ├── <video> element (lines 189-197)
│   │       └── PlaybackControls (lines 200-224)
```

**Tab bar insertion point**: Between the Header (line 138) and the Content flex row (line 141). The tab bar should be a `flex-shrink-0` row with two tabs.

**Tab content**: The entire `Content flex row` (lines 141-227) becomes conditional on `activeTab`. Annotations renders the current content. Highlights renders a parallel structure with different video source and hook.

## Critical Gotchas

1. **Different video sources per tab** — Annotations plays one concatenated recap video (`recaps/{game_id}.mp4`). Highlights plays individual `final_videos` entries via `/api/downloads/{id}/stream`. When switching tabs, unmount the old `<video>` by using a React `key` prop or conditional rendering — don't just swap `src`.

2. **Brilliant clips are 9:16 portrait (1080x1920), recap is 854x480 landscape** — The video container uses `object-contain` / `max-w-full max-h-full` which auto-handles both. No separate aspect ratio container needed, but the visual appearance will be very different (tall narrow video vs wide).

3. **Brilliant clips may not exist even if 5-star raw_clips exist** — Auto-export can fail per clip (errors caught at `auto_export.py:72`). Check `final_videos` count from the API, NOT `raw_clips` rating. If API returns 0 brilliant clips, hide the Highlights tab entirely.

4. **The 4-star fallback in auto-export** — If no 5-star clips exist, 4-star clips get exported as `source_type='brilliant_clip'`. The Highlights tab should show whatever the API returns. Don't re-filter by rating on the frontend.

5. **`latest_final_videos_subquery()` for version filtering** — Use this in the brilliant-clips query to get the latest version of each final video (same pattern as `list_downloads`). Import from `app.queries`.

6. **Multi-clip highlights playback** — When multiple brilliant clips exist, the simplest approach: play one at a time, auto-advance on `ended` event. Use the sidebar as a clip selector. Don't try to concatenate client-side.

7. **useRecapPlayback hook is NOT reusable for Highlights** — It expects `recap_start`/`recap_end` positions within a single video. Highlights clips are separate video files. Need a new `useHighlightsPlayback` hook (or adapt the approach).

8. **Virtual timeline for highlights** — To reuse `PlaybackControls`, the highlights hook must build segments with `virtualStart`/`virtualEnd` spanning all clips' cumulative durations. `virtualTime` = current clip's elapsed time + sum of all preceding clips' durations.

9. **Scrubbing across clip boundaries in highlights** — When the user scrubs the main timeline past a clip boundary, the hook must switch to the next clip and seek to the right position. The `onSeek(virtualTime)` handler must: find the target segment, switch `activeClip` if different from current, seek the video to `virtualTime - segment.virtualStart`.

10. **Tab state should NOT trigger any backend writes** — Switching tabs is purely UI. No stores, no API calls for the switch. Only the initial parallel data fetches on mount.

11. **Fetch brilliant clips in parallel with recap data** — Don't wait for recap data to decide whether to fetch brilliant clips. Fetch both on mount. If brilliant clips returns empty, hide the tab.

12. **`getStreamingUrl` pattern** — Build it inline: `` `${API_BASE}/api/downloads/${clip.id}/stream` ``. No need to import the `useDownloads` hook — it manages global downloads state which is overkill for this modal.

13. **Read-only means no reactive persistence traps** — Same as T2410: no `useEffect` watchers writing to stores. All state is ephemeral within the modal.
