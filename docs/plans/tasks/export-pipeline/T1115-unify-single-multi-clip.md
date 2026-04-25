# T1115: Unify Single-Clip into Multi-Clip Export

**Status:** TODO
**Impact:** 4
**Complexity:** 6
**Created:** 2026-04-24
**Updated:** 2026-04-24
**Epic:** [Export Pipeline](EPIC.md) (task 2 of 2)
**Depends on:** T1110 (both paths must be non-blocking before merging)

## Problem

`framing.py` `render_project` (line 688) and `multi_clip.py` `export_multi_clip` (line 1153) are parallel implementations of the same pipeline with ~70% duplicated logic. Single-clip framing is just the N=1 case of multi-clip, but `framing.py:801` artificially rejects >1 clip instead of delegating.

### Duplicated logic

| Concern | framing.py | multi_clip.py |
|---|---|---|
| Credit reservation | Lines 817-854 | Lines 1238-1273 |
| Export job creation | Lines 726-733 | Lines 1187-1196 |
| Context capture/restore | Lines 712-713, 1043-1045 | Lines 1235-1236, 1844-1847 |
| Modal GPU dispatch | Line 1002 (`call_modal_framing_ai`) | Line 1545 (`call_modal_clips_ai`) |
| Player detection | Line 1080 (`run_player_detection_for_highlights`) | Line 1605 (same function) |
| DB save (working_videos) | Lines 1106-1144 | Lines 1616-1648 |
| WebSocket progress | Lines 718-1159 (11 progress points) | Lines 1176-1971 (11 progress points) |
| Error handling + credit refund | Lines 1169-1236 | Lines 1987-2063 |
| ffprobe for framerate | Line 932 | N/A (uses `target_fps` param) |
| Background task (local path) | `_run_local_framing_export` (line 416) | Inline (no background task) |

### Different Modal functions

The two paths call different Modal functions:
- `framing.py` → `call_modal_framing_ai()` — single-clip crop+upscale
- `multi_clip.py` → `call_modal_clips_ai()` — multi-clip crop+upscale+concat

**Key question:** Does `call_modal_clips_ai` handle N=1 correctly? If yes, `framing.py` can delegate directly. If not, a thin adapter or Modal-side fix is needed.

## Solution

Make `framing.py` `render_project` a thin adapter that translates its request format into a multi-clip call, then delegates to the multi_clip pipeline.

### Architecture

```
BEFORE:
  POST /render       → render_project()      → [850 lines of single-clip logic]
  POST /multi-clip   → export_multi_clip()    → [900 lines of multi-clip logic]

AFTER:
  POST /render       → render_project()       → translate request → _export_clips(clips=[single_clip])
  POST /multi-clip   → export_multi_clip()    → parse form data   → _export_clips(clips=[...])
                                                                      ↑ shared pipeline
```

### Step 1: Extract shared pipeline from multi_clip.py

Create `_export_clips()` that contains the shared logic:

```python
# In multi_clip.py (or a new shared module)

async def _export_clips(
    export_id: str,
    clips: list[ClipExportData],   # Normalized clip format
    aspect_ratio: str,
    transition: str,
    include_audio: bool,
    target_fps: int,
    export_mode: str,
    project_id: int | None,
    project_name: str | None,
    user_id: str,
    profile_id: int,
) -> ExportResult:
    """
    Core export pipeline. Handles 1-N clips.
    
    1. Reserve credits
    2. Create export_jobs record
    3. Resolve clip sources (DB or uploaded)
    4. Dispatch to Modal or local GPU
    5. Run player detection
    6. Save working_video to DB
    7. Report progress via WebSocket
    """
    # ... extracted from current export_multi_clip lines 1176-1985
```

### Step 2: Define normalized clip format

Both endpoints currently receive clip data in different shapes. Define a shared internal format:

```python
@dataclass
class ClipExportData:
    clip_index: int
    crop_keyframes: list[dict]      # [{frame, x, y, w, h}, ...]
    segments: list[dict]            # [{start, end}, ...]
    
    # Source resolution (one of these):
    working_clip_id: int | None     # DB-resolved mode
    video_bytes: bytes | None       # Upload mode
    
    # Metadata
    source_fps: float               # From ffprobe or target_fps
    raw_clip_id: int | None
    game_id: int | None
```

### Step 3: Make render_project a thin adapter

```python
# framing.py — render_project becomes ~50 lines

@router.post("/render")
async def render_project(request: RenderRequest, http_request: Request):
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    
    # Fetch project + single clip (existing lines 745-814)
    project, clip = _get_project_and_clip(request.project_id)
    
    # Translate to shared format
    clip_data = ClipExportData(
        clip_index=0,
        crop_keyframes=json.loads(clip['crop_data']),
        segments=json.loads(clip['segments_data']),
        working_clip_id=clip['id'],
        video_bytes=None,
        source_fps=None,  # pipeline will ffprobe
        raw_clip_id=clip['raw_clip_id'],
        game_id=clip['game_id'],
    )
    
    # Delegate to shared pipeline
    return await _export_clips(
        export_id=request.export_id,
        clips=[clip_data],
        aspect_ratio=project['aspect_ratio'],
        transition="none",
        include_audio=True,
        target_fps=30,
        export_mode="quality",
        project_id=request.project_id,
        project_name=project['name'],
        user_id=user_id,
        profile_id=profile_id,
    )
```

### Step 4: Simplify export_multi_clip

```python
# multi_clip.py — export_multi_clip parses form data then delegates

@router.post("/multi-clip")
async def export_multi_clip(
    export_id: str = Form(...),
    multi_clip_data_json: str = Form(...),
    # ... other form params
):
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    
    parsed = json.loads(multi_clip_data_json)
    clips_data = parsed.get("clips", [])
    
    # Parse uploaded video files (existing lines 1208-1230)
    video_files = _parse_uploaded_videos(request)
    
    # Translate to shared format
    clips = [
        ClipExportData(
            clip_index=cd.get('clipIndex', i),
            crop_keyframes=cd.get('cropKeyframes', []),
            segments=cd.get('segments', []),
            working_clip_id=cd.get('workingClipId'),
            video_bytes=video_files.get(cd.get('clipIndex', i)),
            source_fps=None,
            raw_clip_id=cd.get('rawClipId'),
            game_id=cd.get('gameId'),
        )
        for i, cd in enumerate(clips_data)
    ]
    
    # Delegate to shared pipeline
    return await _export_clips(
        export_id=export_id,
        clips=clips,
        aspect_ratio=parsed.get("aspectRatio", "9:16"),
        transition=parsed.get("transition", "none"),
        include_audio=include_audio == "true",
        target_fps=target_fps,
        export_mode=export_mode,
        project_id=project_id,
        project_name=project_name,
        user_id=user_id,
        profile_id=profile_id,
    )
```

### N=1 behavior already handled in multi_clip.py

The multi_clip pipeline already handles single clips gracefully:
- `concatenate_clips_with_transition()` at line 1083-1086: when `len(clip_paths) == 1`, does `shutil.copy()` and returns — skips all transition logic, chapter markers, and audio mixing.
- `calculate_multi_clip_resolution()` at line 884-927: pure CPU math, works for any N.
- Chapter metadata (`create_chapter_metadata_file`, line 997-1033): only created when `len(clip_info) > 1`. Skipped for single clips.

### Existing cross-file import precedent

`framing.py` already imports from `multi_clip.py` (line 35-38):
```python
from .multi_clip import run_player_detection_for_highlights, generate_default_highlight_regions
```
This means `framing.py` → `multi_clip.py` import direction is established. Adding `_export_clips` to multi_clip and importing it from framing follows the existing pattern.

### Overlay is NOT part of this unification

`overlay.py` `render_overlay` is a different pipeline (applies highlight effects to an already-framed working video). It doesn't share the clip-resolution/crop/upscale/concat pipeline and should remain separate.

### Frontend response shape audit

All export callers live in `ExportButtonContainer.jsx`. The response shapes diverge:

**POST /render response** (framing.py lines 1161-1167, read at ExportButtonContainer.jsx:684-685):
```json
{
  "success": true,
  "working_video_id": 42,
  "filename": "working_1_abc123.mp4",
  "project_id": 7,
  "export_id": "abc-123"
}
```
Frontend reads: `data.working_video_id`, `data.filename`
Also checks: `response.status === 202` for background processing (ExportButtonContainer.jsx:670)

**POST /multi-clip response** (multi_clip.py lines 1667-1676, consumed via WebSocket):
```json
{
  "status": "success",
  "export_id": "abc-123",
  "presigned_url": "https://...",
  "filename": "multi_7_abc123.mp4",
  "working_video_id": 42,
  "clips_processed": 3,
  "modal_used": true,
  "video_duration": 24.5
}
```
Multi-clip primarily uses **WebSocket completion** (not HTTP response parsing). The frontend calls `connectWebSocket(exportId)` and listens for `status: "complete"` messages with `workingVideoId` and `workingFilename` fields.

**Unification strategy:** The shared pipeline should:
- Always return 202 + use WebSocket for completion (consistent contract)
- Include `working_video_id` and `filename` in the WebSocket completion message (both paths already do this)
- The HTTP 200 response with full payload can be removed since WebSocket handles it

**Export recovery** also reads response shapes via `GET /api/exports/{jobId}/modal-status` (useExportRecovery.js:201-265). Fields read: `data.status`, `data.working_video_id`, `data.output_filename`. This endpoint reads from the `export_jobs` DB table, so it's unaffected by which code path created the job.

### Open questions for implementation

1. **Modal function unification:** Can `call_modal_clips_ai` handle N=1? Or does `call_modal_framing_ai` do something different for single clips (e.g., different upscale quality, different crop interpolation)? Check the Modal-side code.

2. **Background task pattern:** Currently `framing.py` local path uses `asyncio.create_task` + 202, but `multi_clip.py` blocks inline. After T1110, sync I/O is wrapped. The unified path should always use `create_task` + 202 for a consistent API contract. This means multi_clip's response shape changes from 200-with-payload to 202-with-export-id (frontend already handles 202 via WebSocket).

3. **DB-resolved mode:** `multi_clip.py` has a DB-resolved mode (lines 1277-1430) where clips are fetched from the database instead of uploaded via form data. This supports the case where `project_id` is provided but no video files are uploaded — clips are resolved from `working_clips` joined with `raw_clips`/`game_videos`, then downloaded from R2 or extracted via ffmpeg. The `framing.py` adapter must use this mode since `POST /render` sends a `project_id`, not video file uploads. The shared `_export_clips` must accept both input modes (DB-resolved and upload).

4. **Where does `_export_clips` live?** Options:
   - In `multi_clip.py` (least churn — framing already imports from it)
   - In a new `export_core.py` module (cleaner separation, but new file)

## Relevant files

| File | Role | Key lines |
|---|---|---|
| `src/backend/app/routers/export/framing.py` | Single-clip endpoint (becomes adapter) | 688-1248 |
| `src/backend/app/routers/export/multi_clip.py` | Multi-clip endpoint (owns shared pipeline) | 1153-2064 |
| `src/backend/app/services/modal_client.py` | Modal RPC — check if clips_ai handles N=1 | 419-1283 |
| `src/frontend/src/containers/ExportButtonContainer.jsx` | All export API calls + response handling | 590-785 |
| `src/frontend/src/hooks/useExportRecovery.js` | Export status polling + recovery | 201-265 |

## Acceptance Criteria

- [ ] `POST /render` delegates to the same code path as `POST /multi-clip`
- [ ] Single-clip exports produce identical output (visual diff test or manual comparison)
- [ ] `framing.py` `render_project` is under 100 lines (adapter only)
- [ ] No duplicated credit/progress/detection/DB-save logic between the two endpoints
- [ ] Both endpoints return consistent response shapes
- [ ] All existing E2E tests pass without modification (or with minimal response-shape updates)
