# T1117 Design: Route Single-Clip Through Shared Pipeline

## Current State

```
POST /export/render (framing.py)
  render_project()           ~560 lines
    ├── DB query for project + clips
    ├── Credit reservation
    ├── Validation (crop_data, source video)
    ├── Frame→time keyframe conversion (ffprobe fps)
    ├── Local path: _run_local_framing_export() ~280 lines
    │     ├── Crop/segment parsing
    │     ├── ffprobe for fps
    │     ├── call_modal_framing_ai
    │     ├── Download output + measure duration
    │     ├── Player detection
    │     ├── DB save (working_videos, export_jobs, working_clips)
    │     └── WebSocket complete/error
    └── Modal/test path: inline ~340 lines
          ├── Same pipeline as local but synchronous
          └── Returns 200 JSON

POST /export/multi-clip (multi_clip.py)
  export_multi_clip()        ~250 lines (adapter)
    ├── DB query for project + clips
    ├── Credit reservation
    ├── Clip extraction (ffmpeg stream ranges)
    ├── Frame→time conversion (default fps=30)
    └── Delegates to _export_clips()

  _export_clips()            ~590 lines (shared pipeline)
    ├── Modal or local GPU dispatch
    ├── Player detection
    ├── DB save (working_videos, export_jobs)
    ├── WebSocket progress
    └── Error handling + credit refund
```

## Target State

```
POST /export/render (framing.py)
  render_project()           ~80 lines (thin adapter)
    ├── DB query for project + single clip
    ├── Credit reservation
    ├── Validation
    ├── Clip extraction (ffmpeg for game clips, download for raw)
    ├── Frame→time conversion (ffprobe fps)
    ├── Build ClipExportData
    └── Delegates to _export_clips() → returns 202

POST /export/multi-clip (multi_clip.py)
  export_multi_clip()        ~250 lines (adapter, unchanged)
    └── Delegates to _export_clips()

  _export_clips()            ~620 lines (enhanced shared pipeline)
    ├── Modal or local GPU dispatch
    ├── Video duration measurement (Modal path -- NEW)
    ├── Context restoration after Modal (NEW)
    ├── Player detection
    ├── DB save: working_videos, export_jobs (gpu_seconds -- NEW),
    │           working_clips.exported_at (NEW)
    ├── WebSocket progress
    └── Error handling + credit refund
```

## Gaps Found in _export_clips (fix for both paths)

### Gap 1: working_clips.exported_at never updated
- **framing.py** updates `working_clips SET exported_at=datetime('now'), raw_clip_version=...`
- **_export_clips** skips this entirely
- **Fix**: Add UPDATE after working_videos INSERT, using project_id

### Gap 2: gpu_seconds + modal_function not stored
- **framing.py** stores `result.get("gpu_seconds")` and `result.get("modal_function")` in export_jobs
- **_export_clips** omits these fields
- **Fix**: Extract from Modal result, include in export_jobs UPDATE

### Gap 3: Video duration not measured in Modal path
- **framing.py** downloads output + ffprobe in both paths
- **_export_clips** sets `video_duration=None` in Modal path (only local path measures)
- **Fix**: After Modal upload completes, download output and measure duration

### Gap 4: Context not restored after Modal
- **framing.py** calls `set_current_user_id/set_current_profile_id` after long tasks
- **_export_clips** only restores in local path
- **Fix**: Restore context after Modal returns, before player detection

### Gap 5: is_test_mode not passed
- **framing.py** checks X-Test-Mode to skip player detection
- **_export_clips** has no test_mode parameter
- **Fix**: Add `is_test_mode` parameter, skip detection when True

## Adapter Design (render_project)

```python
@router.post("/render")
async def render_project(request: RenderRequest, http_request: Request):
    # 1. Capture context
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    export_id = request.export_id
    project_id = request.project_id

    # 2. Regress project + create export_jobs (atomic)
    # ... same as current lines 731-746

    # 3. DB query for project + clips
    # ... same query as current lines 751-791

    # 4. Validate single clip
    clip = working_clips[0]
    if not clip['crop_data']: raise 400
    if not clip['game_id'] and not clip['raw_filename']: raise 400

    # 5. Credit reservation
    # ... same as current lines 822-860

    # 6. Pre-extract clip (like export_multi_clip does)
    temp_dir = tempfile.mkdtemp()
    try:
        video_file = await _extract_clip_source(clip, user_id, temp_dir)

        # 7. Frame→time conversion with ffprobe
        crop_keyframes, source_fps = await _parse_crop_keyframes(clip, user_id)

        # 8. Build ClipExportData
        clip_export = ClipExportData(
            clip_index=0,
            crop_keyframes=crop_keyframes,
            segments=_parse_segments(clip),
            duration=clip['raw_duration'] or 0,
            video_file=video_file,
            source_fps=source_fps,
            raw_clip_id=clip['raw_clip_id'],
            game_id=clip['game_id'],
            clip_name=clip['clip_name'],
        )

        # 9. Delegate
        result = await _export_clips(
            export_id=export_id,
            clips=[clip_export],
            aspect_ratio=project['aspect_ratio'] or '9:16',
            transition={'type': 'cut', 'duration': 0},
            include_audio=request.include_audio,
            target_fps=request.target_fps,
            export_mode=request.export_mode,
            project_id=project_id,
            project_name=project_name,
            user_id=user_id,
            profile_id=profile_id,
            credits_deducted=credits_deducted,
            total_video_seconds=video_seconds,
            is_test_mode=is_test_mode,
        )
        return result
    except HTTPException:
        # Refund credits
        ...
        raise
    except Exception as e:
        # Refund credits, update export_jobs
        ...
        raise
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
```

## Deleted Code

- `_run_local_framing_export()` (lines 416-692) -- entire function
- Modal/test inline path in `render_project()` (lines 916-1258) -- replaced by _export_clips call
- `convert_segment_data_to_encoder_format` stays (used by adapter)
- `/crop` and `/upscale` endpoints stay (unrelated to render pipeline)

## Response Shape

Current framing returns 202 `{status: "accepted", export_id}` for local, 200 `{success, working_video_id, ...}` for Modal.

After: `_export_clips` returns a JSONResponse. The adapter returns whatever `_export_clips` returns. Frontend already handles both via WebSocket completion (`connectWebSocket(exportId)`), so the HTTP response shape is secondary -- the WebSocket `complete` message carries `workingVideoId` and `workingFilename`.

## Risks

1. **N=1 through call_modal_clips_ai**: Multi-clip uses `call_modal_clips_ai` which handles N=1. Framing uses `call_modal_framing_ai`. Both route to the same local processor. Modal path needs verification.
2. **Output dimensions**: Framing hardcodes 810x1440. Multi-clip calculates via `calculate_multi_clip_resolution`. For 9:16 aspect with standard clips, this should produce the same dimensions. Need to verify.
