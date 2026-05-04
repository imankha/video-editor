# T2430 Kickoff Prompt: Brilliant Clips in My Reels

Implement T2430: Brilliant Clips in My Reels

Read CLAUDE.md for project rules, workflow stages, coding standards, and agent orchestration before starting.

Read the task file: `docs/plans/tasks/expired-game-experience/T2430-brilliant-clips-in-my-reels.md`

## Epic Context

This is task **3 of 3** in the Expired Game Experience epic.
Read: `docs/plans/tasks/expired-game-experience/EPIC.md`

## Prior Task Learnings

- **T2410 (Playback-Mode Recap Viewer)**: `RecapPlayerModal` was rewritten to a two-column layout with `RecapClipsSidebar` + `PlaybackControls`. Uses `useRecapPlayback` hook with RAF loop. The recap video is a single concatenated file.
- **T2420 (Annotations + Highlights Tabs)**: Added tab bar to RecapPlayerModal. New `GET /api/games/{game_id}/brilliant-clips` endpoint returns published brilliant clips for a game. New `useHighlightsPlayback` hook handles multi-file virtual timeline with cross-clip scrubbing. Expired game card redesigned with "Highlights" CTA and "Annotations" secondary action.
- **T2420**: `_export_brilliant_clip` was simplified to stream-copy extract only (no center-crop, no scale, no re-encode). Brilliant clips keep original video resolution and aspect ratio. The docstring still says "center-crop to 9:16" but the code now does `c="copy"`.
- **T2420**: Brilliant clips are stored as `final_videos` with `source_type='brilliant_clip'`, `game_id` set, `published_at` set at insert time, and `watched_at=NULL`.

## What Already Works (Audit Results)

This task is primarily an **audit and verification** task. Most infrastructure is already in place:

### Frontend -- Already Working

1. **Filter dropdown** -- `DownloadsPanel.jsx:16-21` has a hardcoded `FILTER_OPTIONS` array that already includes `{ value: SourceType.BRILLIANT_CLIP, label: 'Brilliant Clips' }` with a Star icon.

2. **Source type constants** -- `sourceTypes.js:8` defines `BRILLIANT_CLIP: 'brilliant_clip'` and line 16 has `'Brilliant Clip'` label. `getSourceTypeLabel()` at line 25 retrieves labels correctly.

3. **Unwatched "New" badge** -- `DownloadsPanel.jsx:249-269` checks `!download.watched_at` and renders a cyan dot badge for unwatched items. Cyan border applied at lines 256-259.

4. **Streaming playback** -- `useDownloads.js:146-148` `getStreamingUrl(id)` returns `/api/downloads/{id}/stream`. Works for any `final_videos` entry regardless of source type.

5. **Mark watched** -- `useDownloads.js:331-344` PATCHes `/api/downloads/{id}/watched` and optimistically updates local state.

6. **Gallery badge count** -- `galleryStore.js:37-56` fetches `/api/downloads/count` which returns `unwatched_count`. `GalleryButton.jsx:25-29` renders the badge.

### Backend -- Already Working

1. **list_downloads source_type filter** -- `downloads.py:241-247` applies `AND fv.source_type = ?` when the query param is present. Works for `brilliant_clip`.

2. **brilliant_clip special handling** -- `downloads.py:263-282` fetches raw_clip data via `auto_project_id` for correct clip name and game association.

3. **NULL project_id safety** -- `downloads.py:236` uses `LEFT JOIN projects p ON fv.project_id = p.id AND fv.project_id IS NOT NULL`. Safe for brilliant clips with NULL project_id.

4. **Duration fallback** -- `downloads.py:365-376` falls back to raw_clips for brilliant_clip duration calculation.

5. **Stream endpoint** -- `downloads.py:662-743` proxies R2 with range request support. Does a HEAD probe at line 684-687 to verify file exists before streaming.

6. **Count endpoint** -- `downloads.py:848-871` counts published final_videos with `watched_at IS NULL` for the unwatched count. Brilliant clips with `watched_at=NULL` are included.

7. **latest_final_videos_subquery** -- `queries.py:104-131` partitions by `COALESCE(project_id, 0), COALESCE(game_id, 0)`. Brilliant clips always have both `project_id` (from `auto_project_id`) AND `game_id`, so each gets a unique partition. No collision risk.

## What Needs Verification / Potential Fixes

### 1. End-to-End Verification with Real Data

The infrastructure exists but may not have been tested with actual brilliant clip data in My Reels. Verify by:

1. Ensure a game has been auto-exported (has `final_videos` rows with `source_type='brilliant_clip'`)
2. Open My Reels (Gallery panel)
3. Confirm brilliant clips appear in the "All" view
4. Select "Brilliant Clips" from the source type filter dropdown
5. Confirm only brilliant clips show, with correct names and game association
6. Click a brilliant clip -- verify it plays
7. Verify the "New" badge appears on unwatched brilliant clips
8. Verify the gallery button badge count includes unwatched brilliant clips

### 2. Display Name for Brilliant Clips in My Reels

Check how brilliant clips are displayed in the downloads list. The display name logic is at `downloads.py:468-475`:

```python
elif row['source_type'] == SourceType.BRILLIANT_CLIP.value:
    bc_data = brilliant_clip_data.get(row['project_id'])
    if bc_data and bc_data['name']:
        display_name = bc_data['name']
    elif row['project_name']:
        display_name = row['project_name']
```

This uses `row['project_id']` as the lookup key. If `project_id` is NULL, `brilliant_clip_data.get(None)` returns None, and it falls back to `row['project_name']`. But `project_name` may also be NULL if the project doesn't exist. Final fallback is `fv.name` via the SQL `COALESCE(fv.name, p.name)` -- this should work since `_export_brilliant_clip` always sets `fv.name`. **Verify the display name renders correctly.**

### 3. Game Grouping for Brilliant Clips

In My Reels, downloads are grouped by game. The grouping logic for brilliant clips is at `downloads.py:436-443`:

```python
elif row['source_type'] == SourceType.BRILLIANT_CLIP.value:
    bc_data = brilliant_clip_data.get(row['project_id'])
    if bc_data and bc_data['game_id']:
        game_info = games_info.get(bc_data['game_id'])
        if game_info:
            game_ids = [bc_data['game_id']]
```

This also uses `row['project_id']` as key. Same NULL concern as above -- if `project_id` is NULL, the clip won't be associated with a game in the UI. **Check if this matters for display.**

### 4. Source Type Label in UI

The filter dropdown uses `'Brilliant Clips'` (plural, `DownloadsPanel.jsx:19`). The `SOURCE_TYPE_LABELS` map uses `'Brilliant Clip'` (singular, `sourceTypes.js:16`). The label in the dropdown is hardcoded separately. **This is fine** -- the filter label and the per-item label can differ. Just verify both are acceptable for the user.

### 5. Docstring Update

`_export_brilliant_clip` docstring at `auto_export.py:126` still says "Export a single brilliant clip via FFmpeg center-crop to 9:16 at 1080x1920." The function now does stream-copy extract only. **Update the docstring.**

## Design is APPROVED -- Skip to Classification + Implementation

Create a branch: `feature/T2430-brilliant-clips-in-my-reels`

## Implementation Order

This is a small verification + fix task. No new endpoints or components needed.

### 1. Fix docstring in `auto_export.py:126`

Update from "FFmpeg center-crop to 9:16 at 1080x1920" to reflect stream-copy extract.

### 2. Verify end-to-end in browser

Use Playwright MCP or manual browser testing to verify all acceptance criteria. Use the e2e auth bypass pattern for browser testing (see frontend CLAUDE.md).

### 3. Fix any issues found during verification

Based on the audit, the most likely issues are:
- Display name rendering for clips with NULL `project_id`
- Game grouping for clips with NULL `project_id`
- Any UI polish needed for how brilliant clips appear in the list

### 4. Update task status

Commit, update PLAN.md status to TESTING.

## Code Paths (exact locations)

### Backend -- auto_export.py

- **Lines 123-157**: `_export_brilliant_clip` -- stream-copy extract, inserts into `final_videos` with `source_type='brilliant_clip'`, `game_id`, `name`, `published_at`, `duration`. Docstring needs update.
- **Lines 56-66**: Brilliant clip selection -- 5-star clips, or 4-star fallback if no 5-star exist.

### Backend -- downloads.py

- **Lines 206-542**: `list_downloads` endpoint. Key sections:
  - Lines 236-247: SQL query with source_type filter and latest_final_videos_subquery
  - Lines 263-282: brilliant_clip raw_clip lookup via `auto_project_id`
  - Lines 365-376: Duration fallback for brilliant_clips
  - Lines 436-443: Game grouping for brilliant_clips
  - Lines 468-475: Display name for brilliant_clips
- **Lines 662-743**: `/downloads/{id}/stream` -- proxy streaming endpoint
- **Lines 848-871**: `/downloads/count` -- unwatched count for gallery badge

### Backend -- queries.py

- **Lines 104-131**: `latest_final_videos_subquery()` -- partitions by `(COALESCE(project_id, 0), COALESCE(game_id, 0))`. Safe for brilliant clips since they always have both values set.

### Frontend -- DownloadsPanel.jsx

- **Lines 16-21**: `FILTER_OPTIONS` array -- already includes `SourceType.BRILLIANT_CLIP`
- **Lines 105-127**: Play handler -- marks watched, starts playback
- **Lines 249-269**: Unwatched "New" badge rendering
- **Line 597**: Video playback via `getStreamingUrl`

### Frontend -- sourceTypes.js

- **Line 8**: `BRILLIANT_CLIP: 'brilliant_clip'`
- **Line 16**: `'Brilliant Clip'` label
- **Lines 25-27**: `getSourceTypeLabel()` function

### Frontend -- useDownloads.js

- **Lines 39-85**: `fetchDownloads(sourceType)` -- passes filter to backend
- **Lines 146-148**: `getStreamingUrl(id)` -- builds stream URL
- **Lines 331-344**: `markWatched(id)` -- PATCH watched_at

### Frontend -- galleryStore.js

- **Lines 37-56**: `fetchCount()` -- GET `/api/downloads/count`

### Frontend -- GalleryButton.jsx

- **Lines 25-29**: Badge rendering with unwatched count

## Critical Gotchas

1. **Most of this already works** -- Don't rebuild existing infrastructure. The filter dropdown, streaming, watched tracking, and badge count are all implemented. This task is verification + minor fixes.

2. **NULL project_id edge case** -- `_export_brilliant_clip` sets `project_id = clip['auto_project_id']` which CAN be NULL if the raw_clip has no auto-project. The downloads endpoint uses `project_id` as a lookup key for brilliant_clip data. If NULL, display name falls back to `fv.name` (set at insert), which is correct. Game grouping falls back to no game association. Verify this is acceptable or if `game_id` should be used as the direct lookup key instead.

3. **Brilliant clips are permanent** -- They're in `final_videos`, not `game_storage_refs`. The sweep scheduler does NOT clean them up. No expiry logic needed.

4. **No reactive persistence** -- Same as T2410/T2420: this is read-only UI. No `useEffect` watchers writing to stores. Gallery panel only reads data.

5. **Dev state simulation** -- If you need test data with brilliant clips, local DB changes get overwritten by R2 sync on server hot-reload. Either change R2 directly, or use the `auto_export_status` fallback path.

6. **The 4-star fallback** -- If no 5-star clips exist, 4-star clips become `source_type='brilliant_clip'`. My Reels shows whatever the backend returns. Don't re-filter by rating on the frontend.

7. **Filter dropdown is static** -- `FILTER_OPTIONS` in DownloadsPanel is hardcoded, not derived from data. "Brilliant Clips" always shows even if the user has none. This matches the existing pattern for other source types and is acceptable.
