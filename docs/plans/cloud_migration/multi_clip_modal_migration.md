# Multi-Clip Export Modal Migration (B1)

## Overview

Create a **single-container** Modal function for multi-clip exports that processes all clips and concatenates them in one GPU container, avoiding the overhead of multiple cold starts and model loads.

**Priority**: BLOCKING - Must complete before Task 09 testing can pass
**Status**: `TESTING` (2026-01-29)
**Complexity**: Medium (~200 lines new Modal function + ~80 lines client/router code)

---

## Implementation Status (2026-01-29)

### Completed
- [x] `process_multi_clip_modal` function added to video_processing.py
- [x] `call_modal_multi_clip` added to modal_client.py
- [x] Modal branch added to multi_clip.py router
- [x] Modal function deployed successfully
- [x] Isolation test passed (137.5s for 2 clips × 3s each = 1.31 fps)

### Bugs Fixed During Testing
- [x] Fixed `await upload_bytes_to_r2()` - was sync function, removed await
- [x] Fixed extraction status query - manual projects showed 0 clips extracted (COALESCE bug)

### Currently Testing
- [ ] Full 8-clip export with AI upscaling (in progress, ~22% at last check)
- [ ] Progress updates via WebSocket
- [ ] Output quality verification
- [ ] Chapter markers

### Known Issues to Address
- [ ] Temp folder should be inside user folder (`{user_id}/temp/...` not `temp/...`) for multi-user isolation

---

## Why Single Container?

See [MODAL_COST_ANALYSIS.md](MODAL_COST_ANALYSIS.md) for detailed cost breakdown.

### Composition Approach (Previously Considered - REJECTED)

```
Clip 1: cold_start(7s) → model_load(4s) → process → upload to R2
Clip 2: cold_start(7s) → model_load(4s) → process → upload to R2
Clip 3: cold_start(7s) → model_load(4s) → process → upload to R2
Concat: cold_start(5s) → download 3 clips → concat → upload

Total overhead: 3×7s cold + 3×4s model + 5s concat cold = 38s wasted
R2 transfers: 3 source + 3 intermediate + 3 intermediate download + 1 final = 10
```

### Single Container Approach (ADOPTED)

```
cold_start(7s) → model_load(4s) → download 3 sources
  → process clip 1 (model warm) → save to /tmp
  → process clip 2 (model warm) → save to /tmp
  → process clip 3 (model warm) → save to /tmp
  → concat from /tmp → upload final

Total overhead: 7s cold + 4s model = 11s
R2 transfers: 3 source + 1 final = 4
```

**Savings**: 27s overhead eliminated, 6 fewer R2 transfers per export

---

## Implementation

### 1. New Modal Function: `process_multi_clip_modal`

**File**: `src/backend/app/modal_functions/video_processing.py`

```python
@app.function(
    image=upscale_image,
    gpu="T4",  # Single GPU for all clips
    timeout=3600,  # 1 hour for large compilations
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_multi_clip_modal(
    job_id: str,
    user_id: str,
    source_keys: list,       # R2 keys for all source clips
    output_key: str,         # R2 key for final output
    clips_data: list,        # Per-clip: [{cropKeyframes, segmentsData, clipIndex, fileName}, ...]
    transition: dict,        # {type: "cut"|"fade"|"dissolve", duration: float}
    target_width: int,
    target_height: int,
    fps: int = 30,
    include_audio: bool = True,
) -> dict:
    """
    Process multiple clips with AI upscaling in a SINGLE container.

    Architecture:
    1. Download all source clips
    2. Load Real-ESRGAN model ONCE
    3. Process each clip (model stays warm)
    4. Concatenate with transitions
    5. Upload final result

    Benefits:
    - Single cold start (7s vs N×7s)
    - Single model load (4s vs N×4s)
    - No intermediate R2 transfers
    - Local concat (no network latency)
    """
```

**Implementation** (~200 lines):
1. Download all source clips from R2
2. Load Real-ESRGAN model once (cached for all clips)
3. For each clip:
   - Apply crop keyframe interpolation
   - AI upscale each frame
   - Handle speed/trim from segment_data
   - Encode to temp file
4. Concatenate all temp files with FFmpeg (transitions + chapters)
5. Upload final result to R2

### 2. New Client Function: `call_modal_multi_clip`

**File**: `src/backend/app/services/modal_client.py`

```python
async def call_modal_multi_clip(
    job_id: str,
    user_id: str,
    source_keys: list,
    output_key: str,
    clips_data: list,
    transition: dict,
    target_width: int,
    target_height: int,
    fps: int = 30,
    include_audio: bool = True,
    progress_callback = None,
) -> dict:
    """
    Call Modal process_multi_clip_modal for multi-clip AI upscaling.

    Single container processes all clips sequentially.
    """
```

### 3. Update `/export/multi-clip` Endpoint

**File**: `src/backend/app/routers/export/multi_clip.py`

```python
if modal_enabled():
    # Upload all source videos to R2 temp
    source_keys = []
    for clip_data in sorted_clips:
        clip_index = clip_data.get('clipIndex')
        video_file = video_files[clip_index]
        content = await video_file.read()

        source_key = f"temp/multi_clip_{export_id}/source_{clip_index}.mp4"
        await upload_bytes_to_r2(user_id, source_key, content)
        source_keys.append(source_key)

    # Single Modal call processes everything
    result = await call_modal_multi_clip(
        job_id=export_id,
        user_id=user_id,
        source_keys=source_keys,
        output_key=output_key,
        clips_data=sorted_clips,
        transition=transition,
        target_width=target_resolution[0],
        target_height=target_resolution[1],
        fps=target_fps,
        include_audio=include_audio,
        progress_callback=progress_callback,
    )

    # Cleanup temp source files
    for key in source_keys:
        await delete_from_r2(user_id, key)
```

---

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `modal_functions/video_processing.py` | Add `process_multi_clip_modal` | ~200 |
| `services/modal_client.py` | Add `call_modal_multi_clip` | ~60 |
| `routers/export/multi_clip.py` | Add Modal branch | ~80 |

**Total**: ~340 lines

---

## Cost Comparison (3 clips × 10s each)

| Approach | Cold Starts | Model Loads | R2 Transfers | Total GPU Time | Cost |
|----------|-------------|-------------|--------------|----------------|------|
| Composition (N containers) | 3×7s = 21s | 3×4s = 12s | 10 | 783s | ~$0.128 |
| Single container | 1×7s = 7s | 1×4s = 4s | 4 | 761s | ~$0.125 |

**Savings**: ~2.5% cost + 27s faster + simpler architecture

For more clips, savings increase proportionally.

---

## GPU Selection

For multi-clip exports, consider total processing time:

```python
# In modal_client.py
def _select_gpu_for_multi_clip(clips_data: list, avg_duration_per_clip: float = 10) -> str:
    """Select GPU based on estimated total processing time."""
    total_duration = len(clips_data) * avg_duration_per_clip

    # L4 is faster but costs more per second
    # Break-even at ~15s per clip
    if total_duration > 45:  # More than ~4.5 clips at 10s each
        return "L4"  # Faster completion offsets higher rate
    return "T4"
```

---

## Testing

1. Set `MODAL_ENABLED=true`
2. Create multi-clip project with 2-3 clips
3. Set different crop keyframes per clip
4. Export from Framing mode
5. Verify:
   - Single Modal function call in logs
   - Progress shows clip-by-clip updates
   - Output has correct transitions
   - Chapter markers work in video player
6. Compare output quality with local processing

---

## Tradeoff: Sequential vs Parallel

This approach processes clips **sequentially** on one GPU. For very large exports (10+ clips), parallel processing across multiple GPUs could be faster.

**Recommendation**: Start with single-container. If users report slow exports for large compilations, add a parallel mode with threshold:
- ≤5 clips OR ≤3 minutes total: single container
- >5 clips AND >3 minutes: parallel (N containers)

---

## Dependencies

- `_get_realesrgan_model()` - Model loading (already exists)
- `_interpolate_crop()` - Keyframe interpolation (already exists)
- `_has_audio_stream()` - Audio detection (already exists)
- R2 upload/download utilities (already exist)

---

## Rollback

If Modal processing fails:
- `modal_enabled()` check ensures local fallback works
- No database schema changes
- Same API response format
