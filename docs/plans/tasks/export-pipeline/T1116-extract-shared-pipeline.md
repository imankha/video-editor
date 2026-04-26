# T1116: Extract Shared Export Pipeline from multi_clip.py

**Status:** TESTING
**Impact:** 4
**Complexity:** 4
**Created:** 2026-04-24
**Epic:** [Export Pipeline](EPIC.md) (task 2a of 3)
**Depends on:** T1110 (non-blocking I/O must be in place)

## Problem

`export_multi_clip()` in multi_clip.py is a ~900-line monolith that mixes request parsing (form data, uploaded files) with the core export pipeline (credit reservation, clip resolution, Modal dispatch, player detection, DB save, WebSocket progress). This makes it impossible for framing.py to reuse the pipeline without duplicating it.

## Solution

Extract the core pipeline into `_export_clips()` and define a shared `ClipExportData` dataclass. After this refactor, `export_multi_clip()` becomes a thin adapter that parses form data and delegates to `_export_clips()`.

### ClipExportData

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
    source_fps: float | None        # From ffprobe or target_fps
    raw_clip_id: int | None
    game_id: int | None
```

### _export_clips()

Extracted from current `export_multi_clip` lines 1176-1985:

```python
async def _export_clips(
    export_id: str,
    clips: list[ClipExportData],
    aspect_ratio: str,
    transition: str,
    include_audio: bool,
    target_fps: int,
    export_mode: str,
    project_id: int | None,
    project_name: str | None,
    user_id: str,
    profile_id: int,
) -> JSONResponse:
    """Core export pipeline. Handles 1-N clips."""
    # 1. Reserve credits
    # 2. Create export_jobs record
    # 3. Resolve clip sources (DB or uploaded)
    # 4. Dispatch to Modal or local GPU
    # 5. Concatenate (if N>1) or copy (if N=1)
    # 6. Run player detection
    # 7. Save working_video to DB
    # 8. Report progress via WebSocket
```

### What export_multi_clip becomes

```python
@router.post("/multi-clip")
async def export_multi_clip(request: Request, ...):
    # Parse form data + uploaded files (~50 lines)
    clips = [ClipExportData(...) for cd in clips_data]
    
    # Delegate
    return await _export_clips(export_id, clips, ...)
```

## Key decisions to make during implementation

1. **Where does `_export_clips` live?** Options:
   - In `multi_clip.py` (least churn — framing.py already imports from it)
   - In a new `export_core.py` (cleaner separation)
   
   Recommendation: keep in `multi_clip.py` for now. Cross-file import already established (framing.py imports `run_player_detection_for_highlights` from multi_clip).

2. **Modal function routing:** `_export_clips` needs to decide between `call_modal_framing_ai` (single-clip, parallel GPU) and `call_modal_clips_ai` (multi-clip, unified processor). For this task, keep the existing logic: N=1 → `call_modal_framing_ai`, N>1 → `call_modal_clips_ai`. T1117 may revisit if `call_modal_clips_ai` handles N=1 well.

3. **DB-resolved mode vs upload mode:** `_export_clips` must support both. The ClipExportData discriminator is `working_clip_id` (DB) vs `video_bytes` (upload). Current DB-resolved logic is at multi_clip.py lines 1277-1441.

## Relevant Files

| File | Role | Key lines |
|------|------|-----------|
| `src/backend/app/routers/export/multi_clip.py` | Source of extraction | 1153-2064 |
| `src/backend/app/services/modal_client.py` | Modal dispatch (reference only) | 419-911 |

## Acceptance Criteria

- [ ] `ClipExportData` dataclass defined with both DB-resolved and upload modes
- [ ] `_export_clips()` contains ALL shared pipeline logic (credits, resolution, dispatch, detection, DB save, progress)
- [ ] `export_multi_clip()` is a thin adapter (~80 lines): parse form data → build `ClipExportData` list → call `_export_clips()`
- [ ] Multi-clip export produces identical output (test with 2+ clip project)
- [ ] Single-clip multi-clip export (N=1) still works
- [ ] No behavior change — same response shapes, same WebSocket messages, same DB writes
