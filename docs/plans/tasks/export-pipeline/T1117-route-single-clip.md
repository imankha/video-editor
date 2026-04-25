# T1117: Route Single-Clip Framing Through Shared Pipeline

**Status:** TODO
**Impact:** 4
**Complexity:** 5
**Created:** 2026-04-24
**Epic:** [Export Pipeline](EPIC.md) (task 2b of 3)
**Depends on:** T1116 (`_export_clips` must exist before framing.py can call it)

## Problem

`framing.py` `render_project` (lines 688-1248) is an 850-line parallel implementation of the same export pipeline that `_export_clips()` now encapsulates (after T1116). It duplicates credit reservation, Modal dispatch, player detection, DB save, and WebSocket progress — all of which are already handled by the shared pipeline.

## Solution

Make `render_project` a ~50-line thin adapter that:
1. Fetches the project and single clip from the database
2. Translates the clip data into a `ClipExportData`
3. Delegates to `_export_clips(clips=[single_clip])`
4. Deletes the 800+ lines of duplicated logic

### render_project after this task

```python
@router.post("/render")
async def render_project(request: RenderRequest, http_request: Request):
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    
    # Fetch project + single clip (existing validation logic)
    project, clip = _get_project_and_clip(request.project_id)
    
    # Translate to shared format
    clip_data = ClipExportData(
        clip_index=0,
        crop_keyframes=json.loads(clip['crop_data']),
        segments=json.loads(clip['segments_data']),
        working_clip_id=clip['id'],
        video_bytes=None,  # DB-resolved mode
        source_fps=None,   # pipeline will ffprobe
        raw_clip_id=clip['raw_clip_id'],
        game_id=clip['game_id'],
    )
    
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

### Response shape unification

Currently:
- `POST /render` → 202 with `{success, working_video_id, filename, project_id, export_id}` + WebSocket
- `POST /multi-clip` → 200 with `{status, export_id, presigned_url, filename, working_video_id, ...}` + WebSocket

After this task, both use `_export_clips` which returns a consistent shape. The frontend `ExportButtonContainer.jsx` may need updates:
- Line 670: checks `response.status === 202` for background processing
- Lines 684-685: reads `data.working_video_id`, `data.filename`

The WebSocket completion path is already shared (both use `connectWebSocket(exportId)`), so the primary change is the HTTP response shape.

### Modal function routing for N=1

Open question from T1116: does `call_modal_clips_ai` handle N=1 correctly?

- If yes: `_export_clips` can always use `call_modal_clips_ai`, simplifying the code
- If no: `_export_clips` routes N=1 → `call_modal_framing_ai`, N>1 → `call_modal_clips_ai`

Either way works. The routing decision lives inside `_export_clips` and is transparent to both endpoints.

### Local path

framing.py's local path currently uses `_run_local_framing_export` (background task, line 416). multi_clip.py's local path is inline. After unification, `_export_clips` handles the local path for both — the framing-specific `_run_local_framing_export` can be deleted.

## Relevant Files

| File | Role | Changes |
|------|------|---------|
| `src/backend/app/routers/export/framing.py` | Single-clip endpoint → thin adapter | Delete ~800 lines, add ~50 line adapter |
| `src/backend/app/routers/export/multi_clip.py` | Shared pipeline (from T1116) | May need minor adjustments for N=1 edge cases |
| `src/frontend/src/containers/ExportButtonContainer.jsx` | Export response handling | Update response shape parsing if needed |
| `src/frontend/src/hooks/useExportRecovery.js` | Recovery polling | Verify works with unified response (reads from export_jobs DB, likely no change) |

## Acceptance Criteria

- [ ] `render_project` is under 100 lines (thin adapter only)
- [ ] Single-clip framing export produces identical video output
- [ ] Single-clip export progress WebSocket messages unchanged (frontend shows same progress)
- [ ] `_run_local_framing_export` and all duplicated logic deleted from framing.py
- [ ] No duplicated credit/progress/detection/DB-save logic between the two endpoints
- [ ] Frontend handles both export types without path-specific branching
- [ ] Export recovery (`useExportRecovery.js`) works for both single and multi-clip
