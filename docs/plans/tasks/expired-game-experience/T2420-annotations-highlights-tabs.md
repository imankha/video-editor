# T2420: Annotations + Highlights Tabs

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-05-03
**Updated:** 2026-05-03

## Problem

After T2410, the expired game viewer shows all annotated clips in a single playback mode. But users with 5-star clips want to quickly watch just their highlights without scrubbing through 3-star clips. They need two views.

## Solution

Add a tab bar to the expired game viewer with two modes:

### "Annotations" tab (default)
- Shows all annotated clips (the full recap video)
- Full playback-mode experience from T2410

### "Highlights" tab (only if at least one 5-star clip exists)
- Shows only 5-star clips
- Uses the individual brilliant clip exports (not the recap video)
- If multiple brilliant clips exist, plays them in sequence or shows a selector
- If no 5-star clips exist, this tab is hidden

### Video source per tab

- **Annotations tab**: Uses the recap video (`recaps/{game_id}.mp4`) — all annotated clips concatenated
- **Highlights tab**: Uses individual brilliant clip exports (`final_videos` with `source_type='brilliant_clip'`). Could either concatenate them client-side or play individually with a clip selector.

## Code Paths

### Backend — Querying brilliant clips for a game

**`src/backend/app/routers/downloads.py:207-267`** — `list_downloads(source_type)` already supports `?source_type=brilliant_clip` filtering. However, it returns ALL brilliant clips across all games. T2420 needs clips for a **specific game**. The `final_videos` table has a `game_id` column (set during auto-export at `auto_export.py:189`), so a new endpoint or query param is needed: `GET /api/downloads?source_type=brilliant_clip&game_id={id}` or a dedicated `GET /api/games/{id}/brilliant-clips`.

**`src/backend/app/services/auto_export.py:183-192`** — `_export_brilliant_clip` inserts into `final_videos` with `source_type='brilliant_clip'` and `game_id={game_id}`. The `name` is set to `clip['name'] or f"Clip {clip['id']}"`. The `filename` is `final_videos/auto_{game_id}_{clip_id}_{uuid}.mp4` — stored in R2 under the user's prefix.

**`src/backend/app/database.py:635-650`** — `final_videos` schema. Key columns for this task: `source_type TEXT` (filters brilliant clips), `game_id INTEGER` (scopes to specific game), `name TEXT` (clip display name), `duration REAL` (clip length), `published_at TIMESTAMP` (must be non-NULL to appear in downloads).

### Frontend — Fetching and filtering downloads

**`src/frontend/src/hooks/useDownloads.js:39-85`** — `fetchDownloads(sourceType)` calls `GET /api/downloads?source_type={sourceType}`. Currently filters globally, not per-game. Either extend with a `gameId` param, or add a separate fetch for brilliant clips by game.

**`src/frontend/src/constants/sourceTypes.js`** — `SourceType.BRILLIANT_CLIP = 'brilliant_clip'` and `SOURCE_TYPE_LABELS` with `'Brilliant Clip'` label already exist. No changes needed.

### Frontend — Tab component pattern

**`src/frontend/src/components/ProjectManager.jsx`** — The Games/Reel Drafts toggle at the top of ProjectManager uses a simple tab pattern with state and conditional rendering. Reference for the tab bar UI.

### Frontend — Streaming brilliant clip videos

**`src/frontend/src/hooks/useDownloads.js:146-148`** — `getStreamingUrl(downloadId)` returns `${API_BASE}/api/downloads/{id}/stream` — a same-origin proxy that streams from R2 to avoid CORS. Use this for playing brilliant clips in the Highlights tab (pass the `final_videos.id` of each brilliant clip).

**`src/backend/app/routers/downloads.py`** — The `/downloads/{id}/stream` endpoint already handles presigned URL generation and proxied streaming. No backend changes needed for playback.

### Frontend — Recap viewer (from T2410)

The RecapPlayerModal (modified in T2410) becomes the host for the tab bar. The Annotations tab renders the T2410 viewer (recap video + clip sidebar). The Highlights tab renders a separate video player with only brilliant clips.

## Gotchas

### Highlights tab has a different video source than Annotations tab
Annotations tab plays one video (`recaps/{game_id}.mp4`). Highlights tab plays individual `final_videos` entries. When switching tabs, the video element `src` changes entirely. Unmount the old `<video>` and mount a new one on tab switch to avoid stale buffer issues — don't just swap the `src` attribute.

### Brilliant clips may not exist even if 5-star clips were annotated
Auto-export can fail per-clip (`_export_brilliant_clip` errors are caught and logged at `auto_export.py:72`). A game may have 5-star annotations but 0 brilliant clip exports if all FFmpeg operations failed. Check `final_videos` count, not `raw_clips` rating count, to decide whether to show the Highlights tab.

### Brilliant clips use center-crop 9:16 (1080x1920) — different aspect ratio than recap
The recap is 854x480 (landscape). Brilliant clips are 1080x1920 (portrait/9:16). The Highlights tab video player needs a different aspect ratio container than the Annotations tab. Don't use the same fixed-aspect wrapper.

### The 4-star fallback in auto-export
If no 5-star clips exist, `auto_export_game` falls back to 4-star clips as "brilliant" (`auto_export.py:65-66`). The Highlights tab should show whatever was exported as `source_type='brilliant_clip'`, regardless of the original rating. Don't re-filter by rating on the frontend.

### Multi-brilliant-clip playback UX decision needed
With multiple brilliant clips, options: (a) auto-play in sequence with an `ended` event handler, (b) show a clip selector list like the Annotations sidebar, (c) concatenate client-side. Option (b) is simplest and consistent with the Annotations tab.

### Tab state should NOT trigger any backend writes
Switching tabs is purely a UI state change. No stores, no API calls for the switch itself — only the initial data fetch per tab. This is read-only UI.

## Context

### Relevant Files

**Frontend:**
- `src/frontend/src/components/RecapPlayerModal.jsx` — Modified in T2410, add tabs here
- `src/frontend/src/constants/sourceTypes.js` — `BRILLIANT_CLIP` source type already defined
- `src/frontend/src/hooks/useDownloads.js` — Fetching downloads with source_type filter

**Backend:**
- `src/backend/app/routers/downloads.py` — Downloads list endpoint, may need `game_id` filter
- `src/backend/app/routers/games.py` — May add `GET /{game_id}/brilliant-clips` endpoint
- `src/backend/app/services/auto_export.py` — How brilliant clips are created and stored

### Related Tasks

- Depends on: T2410 (playback-mode viewer must exist first)
- Related: T2430 (brilliant clips in My Reels)

## Acceptance Criteria

- [ ] Tab bar with "Annotations" and "Highlights" visible in expired game viewer
- [ ] "Annotations" tab plays full recap with all clips
- [ ] "Highlights" tab plays only 5-star brilliant clip exports
- [ ] "Highlights" tab hidden when game has no 5-star clips
- [ ] Tab state persists while modal is open (doesn't reset on video load)
