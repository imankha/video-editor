# Basic Overlay Modal Migration (B3)

## Overview

Migrate the `/export/overlay` endpoint to use Modal when `MODAL_ENABLED=true`, and replace OpenCV frame processing with FFmpeg.

**Priority**: BLOCKING - Required for staging/prod scalability
**Status**: `TODO`
**Complexity**: Medium (Modal integration + FFmpeg rewrite)

---

## Problem Statement

**The `/export/overlay` endpoint has two issues:**

1. **Always uses local processing** regardless of `MODAL_ENABLED` setting - staging/prod servers cannot handle heavy CPU tasks due to scalability constraints
2. **Uses OpenCV for frame processing** which has a bug that drops frames - should use FFmpeg instead

---

## Current State Analysis

### Endpoint Usage

**File**: `src/frontend/src/components/ExportButton.jsx`

```javascript
// Line 598 - PRIMARY path (Modal-enabled)
const renderResponse = await axios.post(`${API_BASE}/api/export/render-overlay`, {...});

// Line 647-649 - FALLBACK path (legacy, no Modal)
console.log('[ExportButton] Using legacy overlay export (no projectId)');
endpoint = `${API_BASE}/api/export/overlay`;
```

**Usage Pattern**:
- `/render-overlay` is used when `projectId` exists (backend-authoritative, files in R2)
- `/overlay` is a "legacy client-upload mode" fallback when no `projectId`

### Backend Implementation

**File**: `src/backend/app/routers/export/overlay.py`

| Endpoint | Line | Modal Check | GPU Usage |
|----------|------|-------------|-----------|
| `/overlay` | 176 | NO | CPU-only (OpenCV frame processing) |
| `/render-overlay` | 1108 | YES (line 1233) | Modal or local based on config |

### Processing Details

**`/overlay` endpoint (line 176-489)**:
- Uses `_process_frames_to_ffmpeg()` function (line 53)
- Frame-by-frame processing with OpenCV (CPU-based)
- Applies highlight overlays to each frame
- No AI upscaling (unlike multi-clip and framing)

**Processing is CPU-bound, not GPU-bound**:
```python
# Line 53-170 - _process_frames_to_ffmpeg()
# Uses OpenCV for frame manipulation
# No torch/CUDA operations
# No Real-ESRGAN upscaling
```

---

## Implementation Plan

### Step 1: Add Modal Branch to `/overlay` Endpoint

**File**: `src/backend/app/routers/export/overlay.py`

Modify the endpoint at line 176 to check `modal_enabled()`:

```python
@router.post("/overlay")
async def export_overlay(...):
    # ... existing validation code ...

    if modal_enabled():
        # Modal processing path
        # 1. Upload source video to R2 temp location
        temp_key = f"temp/overlay_{export_id}/source.mp4"
        # ... upload video_file to R2 ...

        # 2. Call Modal function (reuse existing render_overlay)
        result = await call_modal_overlay(
            job_id=export_id,
            user_id=user_id,
            input_key=temp_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
            video_duration=video_duration,
            progress_callback=progress_callback,
        )

        # 3. Cleanup temp file
        delete_from_r2(user_id, temp_key)

        if result.get("status") != "success":
            raise HTTPException(...)

        # 4. Return response (download URL or blob)
        return StreamingResponse(...)

    else:
        # Local processing path - REPLACE OpenCV with FFmpeg
        # See Step 2 below
        ...
```

### Step 2: Replace OpenCV with FFmpeg for Frame Processing

**Current problem**: `_process_frames_to_ffmpeg()` at line 53 uses OpenCV which drops frames.

**Solution**: Replace with pure FFmpeg filter graph for overlay rendering.

```python
def _process_overlay_ffmpeg(
    input_path: str,
    output_path: str,
    highlight_regions: list,
    effect_type: str,
) -> None:
    """
    Apply highlight overlay using FFmpeg filter graph.
    No frame dropping issues like OpenCV.
    """
    # Build FFmpeg filter for overlay effect
    # Example for dark_overlay with highlight regions:
    # ffmpeg -i input.mp4 -vf "drawbox=x=100:y=100:w=200:h=200:c=black@0.5:t=fill" output.mp4

    filter_parts = []
    for region in highlight_regions:
        # Create drawbox filter for each region
        # Or use overlay filter with mask
        ...

    ffmpeg_cmd = [
        'ffmpeg', '-i', input_path,
        '-vf', ','.join(filter_parts),
        '-c:a', 'copy',  # Preserve audio
        output_path
    ]
    subprocess.run(ffmpeg_cmd, check=True)
```

### Step 3: Update Modal Function (Required)

**The existing Modal function ALSO uses OpenCV** and has the same frame-drop issue.

**File**: `src/backend/app/modal_functions/video_processing.py`

**Current implementation** (`render_overlay` at line 164):
- Line 289: `cap = cv2.VideoCapture(input_path)` - OpenCV for frame reading
- Line 293: `cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)` - Frame seeking
- Lines 300-365: Pipes frames to FFmpeg for encoding

**Problem**: OpenCV frame reading drops frames. Need to replace with pure FFmpeg.

**Solution**: Use FFmpeg filter graph for overlay effects:

```python
@app.function(image=image, gpu="T4", timeout=900)
def render_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str,
) -> dict:
    """Apply overlay using pure FFmpeg filter graph - no OpenCV frame reading."""

    # Download from R2
    input_path = download_from_r2(user_id, input_key)

    # Build FFmpeg filter for overlay effect
    # For dark_overlay: darken everything except highlight regions
    # For spotlight: vignette effect around highlight regions

    filters = build_overlay_filter(highlight_regions, effect_type)

    ffmpeg_cmd = [
        'ffmpeg', '-i', input_path,
        '-vf', filters,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
        '-c:a', 'copy',
        output_path
    ]
    subprocess.run(ffmpeg_cmd, check=True)

    # Upload to R2
    upload_to_r2(user_id, output_key, output_path)

    return {"status": "success", "output_key": output_key}
```

**FFmpeg filter examples for overlay effects**:
```bash
# Dark overlay with rectangular highlight
ffmpeg -i input.mp4 -vf "
  split[a][b];
  [a]colorbalance=rs=-.3:gs=-.3:bs=-.3[dark];
  [b]crop=200:200:100:100[highlight];
  [dark][highlight]overlay=100:100
" output.mp4

# Spotlight/vignette effect
ffmpeg -i input.mp4 -vf "vignette=PI/4" output.mp4
```

---

## Why Modal is Required

1. **Staging/Prod Scalability**: Backend servers (Fly.io) cannot handle heavy CPU processing - they're designed for lightweight request handling
2. **Frame Drop Bug**: OpenCV frame processing drops frames - FFmpeg is more reliable
3. **Consistency**: All export endpoints should behave the same way based on `MODAL_ENABLED`

---

## Key Changes Summary

| Component | Current | Target |
|-----------|---------|--------|
| Modal check | None | `modal_enabled()` branch |
| Local processing | OpenCV frame-by-frame | FFmpeg filter graph |
| Modal processing | N/A | Reuse `render_overlay` function |
| Frame handling | Drops frames | Reliable FFmpeg |

---

## Files Reference

| File | Purpose | Modal Status |
|------|---------|--------------|
| `src/backend/app/routers/export/overlay.py:176` | `/overlay` endpoint | No Modal |
| `src/backend/app/routers/export/overlay.py:1108` | `/render-overlay` endpoint | Modal-enabled |
| `src/backend/app/routers/export/overlay.py:53` | `_process_frames_to_ffmpeg()` | Local OpenCV |
| `src/frontend/src/components/ExportButton.jsx:598` | Primary export path | Uses `/render-overlay` |
| `src/frontend/src/components/ExportButton.jsx:649` | Legacy fallback | Uses `/overlay` |

---

## Testing

1. Set `MODAL_ENABLED=true` in `.env`
2. Use the overlay export flow (legacy path without projectId)
3. Verify Modal logs show processing (not local)
4. Verify no frame drops in output video
5. Compare output quality with `/render-overlay` path

---

## Estimated Effort

- **Add Modal branch**: 1-2 hours (follow `/render-overlay` pattern)
- **Replace OpenCV with FFmpeg**: 2-3 hours (build filter graph for overlays)
- **Update Modal function if needed**: 1-2 hours
- **Testing**: 1-2 hours
- **Total**: ~6-9 hours
