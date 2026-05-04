# T2410 Design: Playback-Mode Recap Viewer

**Status:** PENDING APPROVAL
**Author:** Architect Agent
**Date:** 2026-05-03

## Current State

```
GameCard (expired + hasRecap)
  → click → setRecapGame(game)
    → RecapPlayerModal({ game, onClose, onExtend })
      → GET /api/games/{id}/recap-url → presigned URL
      → <video src={url} controls autoPlay />  ← bare player, no clip info
```

The RecapPlayerModal is 81 lines: a modal with a `<video>` tag, "Extend Storage" button, and "Close" button. No clip names, ratings, tags, timestamps, or navigation.

Meanwhile, the annotate mode has a rich Play Annotations system with dual-video ping-pong (`useAnnotationPlayback`), virtual timeline (`buildVirtualTimeline`), clip sidebar (`ClipListItem` + `ClipsSidePanel`), and full playback controls (`PlaybackControls`).

## Target State

```
GameCard (expired + hasRecap)
  → click → setRecapGame(game)
    → RecapViewer({ game, onClose, onExtend })
      → GET /api/games/{id}/recap-data → { url, clips: [{id, name, rating, tags, notes, recapStart, recapEnd}] }
      → useRecapPlayback(videoRef, clips)  ← single video, segment tracking
      → Layout: [Sidebar: clip list] [Video + Controls]
```

```
┌─────────────────────────────────────────────────────┐
│  Game Name — Game Recap                         [X] │
├──────────────┬──────────────────────────────────────┤
│ Clip List    │                                      │
│              │          <video>                      │
│ ★★★★★ Goal  │         recap.mp4                     │
│ ★★★★  Save  │                                      │
│ ★★★   Pass ◄│─ active clip highlighted             │
│ ★★★★★ Assist│                                      │
│ ★★★   Run   │  [▶] [↺]  1:23 / 4:56  [🔊] [1x]   │
│              │  ▓▓▓▓▓▓▓░░░░░░░░░ progress bar      │
│              │  [clip scrub bar]                     │
├──────────────┴──────────────────────────────────────┤
│  [Extend Storage]                          [Close]  │
└─────────────────────────────────────────────────────┘
```

## Design Decisions

### 1. Timestamp mapping: Hybrid (stored + computed fallback)

**New recaps** (generated after this change): `_generate_recap()` runs `ffprobe` on each extracted clip to get its actual duration, accumulates offsets, and uploads `recaps/{game_id}_clips.json` to R2 alongside the recap video. This eliminates FFmpeg keyframe alignment drift.

**Existing recaps** (generated before this change): No stored mapping exists and source videos may be deleted (can't re-generate). Use computed timestamps: sum `(end_time - start_time)` from `_get_annotated_clips()` query order. Acceptable drift (~0.5s per clip) for a fallback.

The backend endpoint detects which mode to use: if `recaps/{game_id}_clips.json` exists in R2, use stored mapping; otherwise, compute from clip metadata.

### 2. Single endpoint: `GET /{game_id}/recap-data`

Replace `GET /{game_id}/recap-url` with `GET /{game_id}/recap-data` that returns everything the viewer needs in one request:

```json
{
  "url": "https://...presigned-recap-url...",
  "clips": [
    {
      "id": 42,
      "name": "Goal from corner",
      "rating": 5,
      "tags": ["goal", "corner-kick"],
      "notes": "",
      "recap_start": 0.0,
      "recap_end": 8.234
    },
    ...
  ]
}
```

Keep the old `GET /{game_id}/recap-url` endpoint working (returns just `{url}`) for backward compatibility — it's called by the current frontend.

### 3. Single-video `useRecapPlayback` hook (NOT dual ping-pong)

The recap is a single concatenated video — no seek latency between clips. A much simpler hook than `useAnnotationPlayback`:

- Single `videoRef` (not dual A/B)
- RAF loop tracks `video.currentTime` → finds active segment → updates `activeClipId` + `virtualTime`
- `seekToClip(clipId)` sets `video.currentTime = segment.recapStart`
- No preloading, no swap logic, no cross-video URL management
- Reuses `buildVirtualTimeline` segment structure (but segments use recap positions instead of game video positions)

### 4. Reuse `ClipListItem` directly, new read-only sidebar

`ClipListItem` already accepts `region`, `isSelected`, `isPlaybackActive`, `onClick` — perfect for the recap sidebar with zero modifications.

New `RecapClipsSidebar` is a simple list container (~40 lines):
- Maps clips to `ClipListItem` instances
- Passes `isPlaybackActive` based on `activeClipId`
- `onClick` calls `seekToClip(clip.id)`
- Auto-scrolls active clip into view
- No editing, no import/export

### 5. Reuse `PlaybackControls` with minor adaptation

`PlaybackControls` already handles: progress bar with segment markers, play/pause, restart, speed control, volume, clip scrub bar, fullscreen. The only Annotate-specific part is the "Back to Annotating" button — replace with "Close" for the recap viewer.

Rather than forking the component, pass the `onExitPlayback` handler pointing to `onClose`. The button text/icon already work generically.

### 6. Expand modal to near-fullscreen

Current modal: `max-w-lg` (512px). New viewer needs sidebar + video.

Change to `max-w-6xl` (1152px) with a two-column layout:
- Left: clip sidebar (w-64, scrollable)
- Right: video + controls (flex-1)
- Mobile: sidebar collapses to horizontal clip strip above video

### 7. Clip mapping JSON format (stored in R2)

```json
{
  "version": 1,
  "clips": [
    {
      "id": 42,
      "name": "Goal from corner",
      "rating": 5,
      "tags": ["goal", "corner-kick"],
      "notes": "",
      "recap_start": 0.0,
      "recap_end": 8.234,
      "original_start": 145.2,
      "original_end": 153.5
    }
  ]
}
```

`original_start`/`original_end` included for potential future use but not needed by the viewer.

## Implementation Plan

### Backend Changes

#### 1. `auto_export.py` — Add ffprobe + mapping JSON to `_generate_recap()`

**File:** `src/backend/app/services/auto_export.py:195-254`

After extracting each clip (line 234), run `ffprobe` to get actual duration:

```python
# After ffmpeg extraction, get actual duration
probe = ffmpeg.probe(str(out_path))
actual_duration = float(probe['format']['duration'])
clip_mapping.append({
    'id': clip['id'],
    'name': clip['name'] or f"Clip {clip['id']}",
    'rating': clip['rating'],
    'tags': json.loads(clip['tags']) if clip['tags'] else [],
    'notes': clip['notes'] or '',
    'recap_start': recap_offset,
    'recap_end': recap_offset + actual_duration,
    'original_start': clip['start_time'],
    'original_end': clip['end_time'],
})
recap_offset += actual_duration
```

After uploading recap video (line 252), upload mapping JSON:

```python
mapping_path = Path(temp_dir) / "clips.json"
mapping_path.write_text(json.dumps({"version": 1, "clips": clip_mapping}))
mapping_r2_key = f"recaps/{game_id}_clips.json"
upload_to_r2(user_id, mapping_r2_key, mapping_path)
```

#### 2. `games.py` — New `GET /{game_id}/recap-data` endpoint

**File:** `src/backend/app/routers/games.py` (after line 736)

```python
@router.get("/{game_id:int}/recap-data")
async def get_recap_data(game_id: int):
    """Get recap video URL + clip mapping for the playback viewer."""
    user_id = get_current_user_id()
    
    # Get recap URL
    with get_db_connection() as conn:
        game = conn.cursor().execute(
            "SELECT recap_video_url FROM games WHERE id = ?", (game_id,)
        ).fetchone()
    if not game or not game['recap_video_url']:
        raise HTTPException(status_code=404, detail="No recap video")
    
    url = generate_presigned_url(user_id, game['recap_video_url'], expires_in=14400)
    
    # Try stored mapping first
    mapping_key = f"recaps/{game_id}_clips.json"
    clips = _try_load_stored_mapping(user_id, mapping_key)
    
    if clips is None:
        # Fallback: compute from DB
        clips = _compute_clip_mapping(game_id)
    
    return {"url": url, "clips": clips}
```

`_try_load_stored_mapping`: Downloads JSON from R2, returns parsed clips or None.
`_compute_clip_mapping`: Calls `_get_annotated_clips()`, sums durations to build recap positions.

#### 3. Keep `GET /{game_id}/recap-url` unchanged

No modification. Ensures backward compatibility during rollout.

### Frontend Changes

#### 4. New `useRecapPlayback` hook

**File:** `src/frontend/src/components/recap/useRecapPlayback.js` (new)

~80 lines. Manages:
- `videoRef` — single video element ref
- `activeClipId` — which clip is currently playing
- `virtualTime` — current position in recap
- `isPlaying` — play/pause state
- `segments` — built from clips' `recap_start`/`recap_end`
- RAF loop: reads `video.currentTime`, finds matching segment, updates state
- `seekToClip(id)` — seeks video to segment start
- `togglePlay()`, `restart()`, `startScrub()`, `endScrub()`, `seekVirtual()`

#### 5. New `RecapClipsSidebar` component

**File:** `src/frontend/src/components/recap/RecapClipsSidebar.jsx` (new)

~50 lines. Maps clips to `ClipListItem`:
```jsx
{clips.map((clip, i) => (
  <ClipListItem
    key={clip.id}
    region={{ ...clip, startTime: clip.recap_start, endTime: clip.recap_end }}
    index={i}
    isSelected={clip.id === activeClipId}
    isPlaybackActive={clip.id === activeClipId && isPlaying}
    onClick={() => onSeekToClip(clip.id)}
  />
))}
```

Auto-scrolls active clip into view via `scrollIntoView({ block: 'nearest' })`.

#### 6. Rewrite `RecapPlayerModal` → `RecapViewer`

**File:** `src/frontend/src/components/RecapPlayerModal.jsx` (modify in-place)

Replace the bare modal with the full viewer layout:
- Fetch `GET /api/games/{id}/recap-data` instead of `recap-url`
- Initialize `useRecapPlayback` with fetched clips
- Two-column layout: `RecapClipsSidebar` | Video + `PlaybackControls`
- Keep "Extend Storage" and "Close" buttons in footer
- Expand modal to `max-w-6xl`

### File Summary

| File | Action | LOC |
|------|--------|-----|
| `src/backend/app/services/auto_export.py` | Modify `_generate_recap()` — add ffprobe + JSON upload | +30 |
| `src/backend/app/routers/games.py` | Add `GET /{game_id}/recap-data` endpoint + helpers | +60 |
| `src/frontend/src/components/recap/useRecapPlayback.js` | New hook | ~80 |
| `src/frontend/src/components/recap/RecapClipsSidebar.jsx` | New component | ~50 |
| `src/frontend/src/components/RecapPlayerModal.jsx` | Rewrite to use new hook + sidebar | ~120 |

**Total: ~340 lines changed/added across 5 files**

## Risks & Open Questions

### Risk: ffprobe adds latency to recap generation
`ffprobe` per clip adds ~0.1-0.3s per clip. For 30 clips, that's 3-9s additional time. Acceptable since recap generation already takes minutes (video encoding dominates).

### Risk: Existing recaps have no mapping — computed fallback drift
For games with 20+ clips, cumulative drift from Option B could be 5-10s. Mitigation: the clip scrub bar within each clip still works correctly (it's relative to the current segment). Only cross-clip navigation drifts. This is acceptable for a fallback path that only applies to pre-existing recaps.

### Open: Mobile layout
The sidebar needs to collapse on mobile. Proposed: horizontal strip of clip badges above the video on screens < 640px. Defer exact mobile layout to implementation — keep it functional, polish in T2420.

### Open: "Extend Storage" during playback
Currently the viewer footer has "Extend Storage". After extension succeeds, the game is no longer expired. Should the viewer stay open (now with a non-expired game) or close? Proposed: stay open — the viewer is useful regardless of expiry status.
