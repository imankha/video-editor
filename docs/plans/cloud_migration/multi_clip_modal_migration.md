# Multi-Clip Export Modal Migration

## Overview

Migrate the multi-clip export pipeline to use Modal cloud GPUs when `MODAL_ENABLED=true`, while preserving local GPU processing as a fallback when Modal is disabled.

**Priority**: Next task after Modal testing complete (Task 09)
**Status**: `TODO`
**Complexity**: High (multi-file coordination, multiple video handling, AI upscaling)

---

## Prerequisites - What's Already Done

Before starting this task, the following has been completed:

### Completed Modal Infrastructure

| Component | File | Status |
|-----------|------|--------|
| Modal functions deployed | `src/backend/app/modal_functions/video_processing.py` | ✓ |
| Modal client with progress | `src/backend/app/services/modal_client.py` | ✓ |
| Framing export (Modal) | `src/backend/app/routers/export/framing.py` | ✓ |
| Overlay export (Modal) | `src/backend/app/routers/export/overlay.py` | ✓ |
| Clip extraction (Modal) | `src/backend/app/routers/clips.py` | ✓ |
| Real-ESRGAN AI upscaling | `process_framing_ai` Modal function | ✓ |
| R2 always enabled | All routers (R2_ENABLED removed) | ✓ |

### Key Patterns Established (Reference These)

1. **Modal client pattern** (`modal_client.py`):
   - Function reference caching with `_get_xxx_fn()`
   - `modal.Function.from_name()` for deployed functions
   - Progress simulation with phases while waiting
   - `asyncio.get_running_loop().run_in_executor()` wrapper

2. **Progress callback pattern** (see `call_modal_framing_ai`):
   ```python
   async def call_modal_xxx(
       ...,
       video_duration: float = None,
       progress_callback = None,
   ) -> dict:
       # Estimate processing time based on video duration
       estimated_time = ...

       # Run Modal in background, simulate progress while waiting
       modal_future = loop.run_in_executor(None, lambda: fn.remote(...))

       while not modal_future.done():
           # Update progress with phase messages
           await progress_callback(progress, phase_msg)
           await asyncio.sleep(2)
   ```

3. **Router integration pattern** (see `framing.py /render`):
   ```python
   if modal_enabled():
       # Modal path with progress callback
       async def modal_progress_callback(progress: float, message: str):
           progress_data = {...}
           await manager.send_progress(export_id, progress_data)

       result = await call_modal_xxx(..., progress_callback=modal_progress_callback)
   else:
       # Local FFmpeg path
       ...
   ```

4. **R2 storage** - Always use R2, no conditional checks:
   - `upload_to_r2()`, `upload_bytes_to_r2()`, `download_from_r2()`
   - `generate_presigned_url()` for serving files

### Key Files to Reference

- **Modal client**: `src/backend/app/services/modal_client.py` - Pattern for calling Modal functions
- **Framing router**: `src/backend/app/routers/export/framing.py` - AI upscaling integration pattern
- **Overlay router**: `src/backend/app/routers/export/overlay.py` - Parallel processing pattern
- **Modal functions**: `src/backend/app/modal_functions/video_processing.py` - Existing Modal functions
- **Learnings doc**: `docs/plans/cloud_migration/MODAL_INTEGRATION_LEARNINGS.md` - Common pitfalls and solutions

---

## Current Architecture

### File Location
- **Router**: `src/backend/app/routers/export/multi_clip.py`
- **AI Upscaler**: `src/backend/app/ai_upscaler/` (Real-ESRGAN)
- **Clip Pipeline**: `src/backend/app/services/clip_pipeline.py`
- **Transitions**: `src/backend/app/services/transitions.py`

### Current Flow (Local GPU Only)
1. Frontend sends multiple video files via multipart form (`video_0`, `video_1`, etc.)
2. Backend receives videos and `multi_clip_data_json` with crop/trim/speed settings per clip
3. For each clip:
   - Load into temp file
   - Apply crop keyframe interpolation
   - Apply AI upscaling (Real-ESRGAN at 4x)
   - Apply trim and speed changes
   - Output processed clip
4. Concatenate all processed clips with transition (cut/fade/dissolve)
5. Add chapter markers
6. Upload final video to R2
7. Save working_video record to database

### Key Dependencies
```python
# multi_clip.py imports
from ...services.clip_cache import get_clip_cache
from ...services.transitions import apply_transition
from ...services.clip_pipeline import process_clip_with_pipeline
from ...storage import upload_to_r2
```

### Current Processing Function
```python
async def process_single_clip(
    clip_data: Dict[str, Any],
    video_file: UploadFile,
    temp_dir: str,
    target_fps: int,
    export_mode: str,
    include_audio: bool,
    progress_callback,
    loop: asyncio.AbstractEventLoop,
    upscaler=None  # AIVideoUpscaler instance
) -> str:
```

---

## Target Architecture

### When `MODAL_ENABLED=true`
1. Frontend sends videos to backend
2. Backend uploads each video to R2 temp folder
3. Backend calls Modal function for each clip (parallel or sequential)
4. Modal downloads from R2, processes with Real-ESRGAN, uploads result to R2
5. Backend downloads processed clips from R2 (or orchestrates in Modal)
6. Concatenation with transitions (can be done in Modal or locally)
7. Final upload and database update

### When `MODAL_ENABLED=false`
- Preserve current local GPU processing (no changes)
- Still use R2 for final output storage

---

## Implementation Plan

### Phase 1: Create Modal Multi-Clip Function

**File**: `src/backend/app/modal_functions/video_processing.py`

Add new function `process_multi_clip_item`:

```python
@app.function(
    image=upscale_image,  # Real-ESRGAN image (already exists)
    gpu="T4",
    timeout=900,  # 15 minutes per clip
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_multi_clip_item(
    job_id: str,
    clip_index: int,
    user_id: str,
    input_key: str,        # R2 key for source video
    output_key: str,       # R2 key for processed clip
    crop_keyframes: list,  # [{time, x, y, width, height}, ...]
    segments_data: dict,   # {trimRange, segments with speed}
    target_fps: int = 30,
    target_width: int = 1080,
    target_height: int = 1920,
) -> dict:
    """
    Process a single clip with:
    1. Crop keyframe interpolation
    2. Real-ESRGAN AI upscaling (4x)
    3. Trim and speed changes
    4. Output scaling to target resolution

    Returns:
        {"status": "success", "output_key": "...", "duration": float} or
        {"status": "error", "error": "..."}
    """
```

Key implementation details:
- Reuse `_get_realesrgan_model()` from existing `process_framing_ai`
- Reuse `_interpolate_crop()` for keyframe interpolation
- Handle segments_data for trim range and speed changes
- Output to specified R2 key

### Phase 2: Create Modal Concatenation Function

**File**: `src/backend/app/modal_functions/video_processing.py`

Add new function `concatenate_clips_modal`:

```python
@app.function(
    image=image,  # Standard FFmpeg image (no GPU needed)
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def concatenate_clips_modal(
    job_id: str,
    user_id: str,
    clip_keys: list,       # List of R2 keys for processed clips
    output_key: str,       # R2 key for final output
    transition_type: str,  # "cut" | "fade" | "dissolve"
    transition_duration: float,
    clip_info: list,       # For chapter markers
) -> dict:
    """
    Concatenate processed clips with transitions and chapter markers.

    Returns:
        {"status": "success", "output_key": "...", "duration": float}
    """
```

### Phase 3: Add Modal Client Functions

**File**: `src/backend/app/services/modal_client.py`

Add:
```python
_process_multi_clip_item_fn = None
_concatenate_clips_fn = None

def _get_process_multi_clip_item_fn():
    """Get reference to deployed process_multi_clip_item function."""
    ...

def _get_concatenate_clips_fn():
    """Get reference to deployed concatenate_clips_modal function."""
    ...

async def call_modal_process_clip(
    job_id: str,
    clip_index: int,
    user_id: str,
    input_key: str,
    output_key: str,
    crop_keyframes: list,
    segments_data: dict,
    target_fps: int = 30,
    target_width: int = 1080,
    target_height: int = 1920,
    video_duration: float = None,
    progress_callback = None,
) -> dict:
    """
    Call Modal for single clip processing with progress simulation.
    """
    ...

async def call_modal_concatenate(
    job_id: str,
    user_id: str,
    clip_keys: list,
    output_key: str,
    transition_type: str,
    transition_duration: float,
    clip_info: list,
    progress_callback = None,
) -> dict:
    """
    Call Modal for clip concatenation.
    """
    ...
```

### Phase 4: Update Multi-Clip Router

**File**: `src/backend/app/routers/export/multi_clip.py`

Modify `export_multi_clip` endpoint:

```python
@router.post("/multi-clip")
async def export_multi_clip(...):
    # ... existing validation ...

    if modal_enabled():
        # Modal processing path
        return await _process_multi_clip_modal(
            export_id=export_id,
            clips_data=clips_data,
            video_files=video_files,
            transition=transition,
            target_fps=target_fps,
            include_audio=include_audio_bool,
            project_id=project_id,
            project_name=project_name,
            user_id=captured_user_id,
        )
    else:
        # Local processing path (existing code)
        return await _process_multi_clip_local(...)
```

Create new helper function:

```python
async def _process_multi_clip_modal(
    export_id: str,
    clips_data: list,
    video_files: dict,
    transition: dict,
    target_fps: int,
    include_audio: bool,
    project_id: int,
    project_name: str,
    user_id: str,
) -> JSONResponse:
    """
    Process multi-clip export using Modal cloud GPUs.

    Steps:
    1. Upload source videos to R2 temp folder
    2. Process each clip in parallel on Modal
    3. Concatenate on Modal (or locally)
    4. Update database
    """
    temp_folder = f"temp/multi_clip_{export_id}"
    processed_keys = []

    try:
        # Step 1: Upload source videos to R2
        for clip_index, video_file in video_files.items():
            content = await video_file.read()
            source_key = f"{temp_folder}/source_{clip_index}.mp4"
            upload_bytes_to_r2(user_id, source_key, content)

        # Step 2: Process clips (can be parallel with Modal .map())
        for i, clip_data in enumerate(sorted_clips):
            clip_index = clip_data.get('clipIndex', i)
            source_key = f"{temp_folder}/source_{clip_index}.mp4"
            output_key = f"{temp_folder}/processed_{clip_index}.mp4"

            # Create progress callback
            async def clip_progress(progress, message):
                ...

            result = await call_modal_process_clip(
                job_id=f"{export_id}_clip_{clip_index}",
                clip_index=clip_index,
                user_id=user_id,
                input_key=source_key,
                output_key=output_key,
                crop_keyframes=clip_data.get('cropKeyframes', []),
                segments_data=clip_data.get('segmentsData', {}),
                target_fps=target_fps,
                progress_callback=clip_progress,
            )

            if result.get("status") != "success":
                raise RuntimeError(f"Clip {clip_index} processing failed")

            processed_keys.append(output_key)

        # Step 3: Concatenate
        working_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
        final_key = f"working_videos/{working_filename}"

        result = await call_modal_concatenate(
            job_id=export_id,
            user_id=user_id,
            clip_keys=processed_keys,
            output_key=final_key,
            transition_type=transition.get('type', 'cut'),
            transition_duration=transition.get('duration', 0.5),
            clip_info=sorted_clips,
        )

        # Step 4: Update database
        # ... existing database code ...

        # Step 5: Cleanup temp files in R2
        for key in [*source_keys, *processed_keys]:
            delete_from_r2(user_id, key)

        return JSONResponse({...})

    except Exception as e:
        # Cleanup on error
        ...
```

### Phase 5: Progress Handling

The Modal functions should use the progress simulation pattern already established:

```python
async def call_modal_process_clip(..., progress_callback=None):
    """
    Progress phases for AI upscaling:
    - 0-5%: Downloading source
    - 5-15%: Initializing AI model
    - 15-85%: Processing frames (based on estimated time)
    - 85-95%: Encoding output
    - 95-100%: Uploading result
    """
```

For multi-clip, overall progress should be:
- 5-10%: Uploading source videos
- 10-80%: Processing clips (divide evenly among clips)
- 80-90%: Concatenating
- 90-95%: Uploading final
- 95-100%: Database update

---

## Data Structures

### clip_data format (from frontend)
```javascript
{
  clipIndex: 0,
  fileName: "game_clip.mp4",
  cropKeyframes: [
    { time: 0, x: 200, y: 100, width: 600, height: 1066 },
    { time: 5.5, x: 250, y: 120, width: 600, height: 1066 }
  ],
  segmentsData: {
    trimRange: { start: 2.0, end: 10.0 },
    segments: [
      { start: 0, end: 4, speed: 1.0 },
      { start: 4, end: 8, speed: 0.5 }
    ],
    boundaries: [0, 4, 8]
  }
}
```

### transition format
```javascript
{
  type: "dissolve",  // "cut" | "fade" | "dissolve"
  duration: 0.5      // seconds
}
```

---

## Testing Considerations

1. **Unit Tests**
   - Modal function returns correct output structure
   - Crop keyframe interpolation matches local implementation
   - Speed changes produce correct output duration

2. **Integration Tests**
   - Single clip processing via Modal
   - Multi-clip with various transitions
   - Progress callbacks fire correctly
   - R2 temp file cleanup on success and failure

3. **Manual Testing**
   - Compare Modal output quality vs local
   - Verify chapter markers work
   - Test with 2, 4, 8 clips
   - Test with long clips (>30s each)

---

## Rollback Plan

If Modal processing fails:
1. The `modal_enabled()` check ensures local fallback is always available
2. No database schema changes required
3. Frontend doesn't need changes (same API response format)

---

## Files to Modify

| File | Changes |
|------|---------|
| `modal_functions/video_processing.py` | Add `process_multi_clip_item`, `concatenate_clips_modal` |
| `services/modal_client.py` | Add client functions with progress |
| `routers/export/multi_clip.py` | Add Modal path, keep local as fallback |
| `storage.py` | May need `delete_from_r2` helper if not exists |

---

## Estimated Effort

- **Modal Functions**: 2-3 hours (reuse existing Real-ESRGAN code)
- **Client Functions**: 1-2 hours (follow existing pattern)
- **Router Updates**: 2-3 hours (handle multiple files, progress)
- **Testing**: 2-3 hours
- **Total**: ~8-12 hours

---

## Dependencies

- Real-ESRGAN model loading (already in `upscale_image`)
- R2 credentials secret (already configured: `r2-credentials`)
- Modal deployment (run `modal deploy video_processing.py` after changes)

---

## Notes

1. **Parallel Processing Option**: Modal's `.map()` could process all clips in parallel, but this may be overkill since each clip already uses GPU heavily. Sequential with progress updates may provide better UX.

2. **Memory Management**: The current local implementation carefully manages GPU memory between clips. Modal containers are isolated, so this isn't a concern.

3. **Concatenation Location**: Could be done in Modal (saves download/upload) or locally (simpler, uses existing `apply_transition`). Recommend Modal for consistency.

4. **Cache Consideration**: The existing `clip_cache` won't work across Modal runs. For now, skip caching in Modal path. Future optimization could use R2-based cache keys.
