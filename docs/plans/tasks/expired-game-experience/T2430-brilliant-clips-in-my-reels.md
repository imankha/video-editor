# T2430: Brilliant Clips in My Reels

**Status:** TESTING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-05-03
**Updated:** 2026-05-03

## Problem

Auto-exported brilliant clips are inserted into `final_videos` with `source_type='brilliant_clip'` and `published_at` set, so they appear in My Reels. But it's unclear whether the existing My Reels filtering (source type dropdown, "New Clips" indicator) properly surfaces them. Users should always be able to find and watch their 5-star auto-exports through normal My Reels navigation.

## Solution

Audit and ensure:

1. **My Reels list** — Brilliant clips appear in the main downloads list
2. **Source type filter** — "Brilliant Clips" or "Highlights" appears as a filter option in the source type dropdown
3. **New Clips indicator** — Auto-exported clips show as "new" if the user hasn't viewed them
4. **Playback** — Clicking a brilliant clip plays it in the My Reels player (presigned URL from R2)
5. **Permanent access** — Brilliant clips are never expired or deleted (they're final_videos, not game_videos)

### Source type label

The `SourceType.BRILLIANT_CLIP` constant already exists in `sourceTypes.js`. Need to verify it has a user-facing label in `getSourceTypeLabel()` and appears in the filter dropdown.

## Code Paths

### Backend — How brilliant clips are inserted

**`src/backend/app/services/auto_export.py:178-192`** — `_export_brilliant_clip` inserts into `final_videos`:
```python
INSERT INTO final_videos
  (project_id, filename, version, source_type, game_id, name, published_at, duration)
  VALUES (?, ?, 1, 'brilliant_clip', ?, ?, CURRENT_TIMESTAMP, ?)
```
- `project_id` = `clip['auto_project_id']` — **can be NULL** if the clip has no auto-project
- `filename` = `final_videos/auto_{game_id}_{clip_id}_{uuid}.mp4` — R2 key under user prefix
- `name` = `clip['name'] or f"Clip {clip['id']}"` — display name
- `published_at` = `CURRENT_TIMESTAMP` — auto-published, will appear in My Reels
- `game_id` = set to source game ID

### Backend — Downloads list endpoint

**`src/backend/app/routers/downloads.py:207-267`** — `list_downloads(source_type)` already filters by `source_type` when the query param is provided (line 241-244). The query uses `fv.published_at IS NOT NULL` (line 238) as a visibility gate — brilliant clips set this at insert time, so they pass.

**`src/backend/app/routers/downloads.py:260-267`** — Special handling for `brilliant_clip` source type already exists. It fetches `raw_clip` data via `brilliant_project_ids` to get the correct clip name (since `project.name` may differ). **Gotcha**: this lookup uses `project_id`, which is NULL for clips without auto-projects — verify the LEFT JOIN handles NULL `project_id` correctly.

**`src/backend/app/routers/downloads.py`** — The `/downloads/{id}/stream` endpoint handles playback proxying. Already works for any `final_videos` row regardless of `source_type`.

### Backend — Downloads count for badge

**`src/backend/app/routers/downloads.py`** — The `/downloads/count` endpoint counts unwatched final videos (`watched_at IS NULL`). Brilliant clips with `watched_at = NULL` should increment this count, triggering the "new" badge in the gallery button.

### Frontend — DownloadsPanel (My Reels UI)

**`src/frontend/src/components/DownloadsPanel.jsx`** — Main gallery panel. Lists final videos grouped by date. Has a source type filter dropdown. Needs to include `'brilliant_clip'` as a filter option in the dropdown. Currently the dropdown options may be hardcoded — verify it dynamically includes all source types present in the data, or add `brilliant_clip` explicitly.

### Frontend — Source type constants

**`src/frontend/src/constants/sourceTypes.js:7-18`** — Already defines:
```javascript
SourceType.BRILLIANT_CLIP = 'brilliant_clip'
SOURCE_TYPE_LABELS['brilliant_clip'] = 'Brilliant Clip'
```
The constant and label exist. Need to verify the filter dropdown in DownloadsPanel uses these constants.

### Frontend — useDownloads hook

**`src/frontend/src/hooks/useDownloads.js:39-85`** — `fetchDownloads(sourceType)` sends `?source_type={sourceType}` to the API. Works for any source type string. No changes needed.

### Frontend — Gallery badge (new indicator)

**`src/frontend/src/stores/galleryStore.js`** — `fetchCount()` calls `/api/downloads/count` to get unwatched count. The count is shown on `GalleryButton.jsx` as a badge. If brilliant clips are inserted with `watched_at = NULL` (which they are — auto_export doesn't set it), they'll automatically increment the unwatched count.

**`src/frontend/src/components/GalleryButton.jsx:25-28`** — Shows unwatched count badge. No changes needed if the count is correct.

### Frontend — Per-item "new" indicator

**`src/frontend/src/hooks/useDownloads.js:331-344`** — `markWatched(downloadId)` PATCHes `/api/downloads/{id}/watched`. The "new" state is derived from `watched_at === null` on each download item. Verify DownloadsPanel renders a "New" badge for items where `watched_at` is null.

### Frontend — Video playback in My Reels

**`src/frontend/src/hooks/useDownloads.js:146-148`** — `getStreamingUrl(downloadId)` returns the proxy URL for playback. Works for any `final_videos` entry. No changes needed.

## Gotchas

### Brilliant clips with NULL `project_id` may break the downloads query
`_export_brilliant_clip` sets `project_id = clip['auto_project_id']` which can be NULL. The downloads query at `downloads.py:236` does `LEFT JOIN projects p ON fv.project_id = p.id AND fv.project_id IS NOT NULL` — the `IS NOT NULL` guard should handle this. But the brilliant-clip-specific lookup at line 264-267 filters by `row['project_id']` — if NULL, it won't fetch raw_clip data, and the clip name falls back to `COALESCE(fv.name, p.name)` which uses `fv.name`. This should work since `fv.name` is set during insert. **Verify with a test case where `auto_project_id` is NULL.**

### `latest_final_videos_subquery()` may filter out brilliant clips
The downloads query uses `fv.id IN ({latest_final_videos_subquery()})` (line 237). This subquery returns only the latest version per `(project_id, filename)` group. For brilliant clips with NULL `project_id`, the grouping behavior may be unexpected. **Verify** that the subquery doesn't exclude brilliant clips — if it groups by `project_id` and multiple NULL-project clips exist, only one may survive.

### Brilliant clips are stored under user R2 prefix — no expiry
`upload_to_r2(user_id, r2_key, output_path)` at `auto_export.py:180` stores under the user's R2 prefix. These are `final_videos`, not `game_videos` — they're never referenced in `game_storage_refs` and never swept. They persist permanently. **No action needed**, but worth confirming there's no cleanup path that accidentally deletes them.

### The filter dropdown may not show "Brilliant Clip" if none exist yet
If the user has no brilliant clips, the dropdown shouldn't show a "Brilliant Clip" option (confusing empty state). Consider only showing filter options for source types that have at least one entry, or always show it with a "(0)" count.

### Gallery count refresh after auto-export happens in background
Auto-export runs in the sweep scheduler background task. The frontend doesn't know when it completes — there's no WebSocket event for auto-export. The user will only see the new brilliant clips after refreshing the page or reopening the gallery panel. Consider adding a sweep-complete notification in a future task, but for T2430 this is acceptable.

## Context

### Relevant Files

**Frontend:**
- `src/frontend/src/components/DownloadsPanel.jsx` — My Reels list, source type filter
- `src/frontend/src/hooks/useDownloads.js` — Downloads fetching with source_type filter
- `src/frontend/src/constants/sourceTypes.js` — Source type constants and labels
- `src/frontend/src/stores/galleryStore.js` — Gallery badge count
- `src/frontend/src/components/GalleryButton.jsx` — Badge display

**Backend:**
- `src/backend/app/routers/downloads.py` — Downloads list endpoint, brilliant_clip handling
- `src/backend/app/services/auto_export.py` — How brilliant clips are inserted
- `src/backend/app/database.py` — `final_videos` schema, `latest_final_videos_subquery`

### Related Tasks

- Depends on: T1583 (auto-export pipeline creates the brilliant clip rows)
- Related: T2420 (highlights tab also shows brilliant clips, but in a different context)

## Acceptance Criteria

- [ ] Brilliant clips appear in My Reels list
- [ ] Source type filter includes a "Brilliant Clips" or "Highlights" option
- [ ] Filtering by brilliant clips shows only auto-exported 5-star clips
- [ ] Clicking a brilliant clip plays it in the My Reels player
- [ ] Brilliant clips are never expired or cleaned up
