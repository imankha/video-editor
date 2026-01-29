# Framing Upscale Modal Migration (B2)

## Overview

Migrate the `/export/upscale` endpoint to use Modal cloud GPUs when `MODAL_ENABLED=true`, while preserving local GPU processing as a fallback.

**Priority**: BLOCKING - Must complete before Task 09 testing can pass
**Status**: `TODO`
**Complexity**: Medium (single endpoint, pattern already established in same file)

---

## Problem Statement

**The `/export/upscale` endpoint always uses local CUDA** regardless of `MODAL_ENABLED` setting.

### Root Cause

**File**: `src/backend/app/routers/export/framing.py`

**Lines 164-479**: The `/upscale` endpoint never checks `modal_enabled()`:

```python
# Line 164
@router.post("/upscale")
async def upscale_video(...):
    ...
    # Line 275-282 - PROBLEM: Always creates local upscaler
    if AIVideoUpscaler is None:
        raise HTTPException(...)

    upscaler = AIVideoUpscaler(
        device='cuda',
        model_name=model_name,
        export_mode=export_mode.upper() if export_mode else "FAST",
    )
```

**Compare to `/export/render` (same file, line 897)** which DOES check Modal:
```python
# Line 897 - CORRECT: Checks modal_enabled()
if modal_enabled():
    result = await call_modal_framing_ai(...)
else:
    # Local processing
    upscaler = AIVideoUpscaler(...)
```

---

## Files to Modify

| File | Line | Change |
|------|------|--------|
| `src/backend/app/routers/export/framing.py` | 164-479 | Add `modal_enabled()` check, call `call_modal_framing_ai()` |

---

## Implementation Plan

### Step 1: Add Modal Branch to `/upscale` Endpoint

Modify the endpoint at line 164 to check `modal_enabled()`:

```python
@router.post("/upscale")
async def upscale_video(...):
    # ... existing validation code ...

    if modal_enabled():
        # Modal processing path
        # Upload source video to R2 temp location
        temp_key = f"temp/upscale_{export_id}/source.mp4"
        # ... upload video_file to R2 ...

        # Call Modal function (reuse existing call_modal_framing_ai)
        result = await call_modal_framing_ai(
            job_id=export_id,
            user_id=user_id,
            input_key=temp_key,
            output_key=output_key,
            crop_keyframes=keyframes,
            target_fps=target_fps,
            target_width=target_width,
            target_height=target_height,
            video_duration=video_duration,
            progress_callback=progress_callback,
        )

        # Cleanup temp file
        delete_from_r2(user_id, temp_key)

        if result.get("status") != "success":
            raise HTTPException(...)

        return JSONResponse({...})

    else:
        # Existing local processing path (lines 275-479)
        if AIVideoUpscaler is None:
            raise HTTPException(...)

        upscaler = AIVideoUpscaler(...)
        # ... rest of existing code ...
```

### Step 2: Extract Input Data for Modal

The `/upscale` endpoint receives a multipart form with:
- `video` - The video file to upscale
- `keyframes_json` - Crop keyframes
- `export_mode` - Quality mode (FAST/QUALITY)
- `target_fps`, `target_width`, `target_height`

For Modal, we need to:
1. Upload the video to R2 temp location
2. Pass R2 key to Modal function
3. Clean up temp file after processing

### Step 3: Reuse Existing Modal Function

The `call_modal_framing_ai()` function in `modal_client.py` already handles Real-ESRGAN upscaling. The `/upscale` endpoint can reuse this function.

---

## Key Differences from `/render` Endpoint

| Aspect | `/upscale` | `/render` |
|--------|------------|-----------|
| Input source | Multipart form file | R2 key (video already in R2) |
| Progress updates | WebSocket | WebSocket |
| Output location | R2 working_videos | R2 working_videos |

The main difference is that `/upscale` receives a file upload, while `/render` works with files already in R2. The Modal path for `/upscale` needs to handle the file upload → R2 → Modal flow.

---

## Testing

1. Set `MODAL_ENABLED=true` in `.env`
2. Navigate to Framing screen
3. Upload a video and set crop keyframes
4. Click export
5. Verify Modal logs show processing (not local GPU)
6. Verify output video quality matches local processing

---

## Rollback

If Modal processing fails:
- `modal_enabled()` check ensures local fallback is always available
- No database schema changes
- Same API response format

---

## Dependencies

- `call_modal_framing_ai()` already exists in `modal_client.py`
- `process_framing_ai` Modal function already deployed
- R2 upload/download utilities already exist in `storage.py`

---

## Estimated Effort

- Add Modal branch: 1-2 hours
- Handle file upload → R2: 30 min
- Testing: 1 hour
- **Total**: ~3-4 hours
