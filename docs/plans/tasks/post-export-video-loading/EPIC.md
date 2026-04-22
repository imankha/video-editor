# Epic: Post-Export Video Loading

**Status:** TODO
**Created:** 2026-04-21

## Goal

Fix the two bugs that cause "video not loading" after a framing export completes. Both bugs are in the same pipeline: export finishes → frontend transitions to overlay → video stream proxy serves the working video / clip. The bugs compound — T1690's broken 206 responses make T1670's race condition harder to diagnose because error signals are masked.

## Sequencing

Fix backend first (make errors visible), then frontend (fix the orchestration).

| # | ID | Task | Why This Order |
|---|----|------|----------------|
| 1 | T1690 | [Video Stream Proxy Error Masking](T1690-video-stream-proxy-error-masking.md) | Backend: stream proxies return proper HTTP errors instead of broken 206. Makes all video load failures diagnosable. |
| 2 | T1670 | [Overlay Stuck Loading After Export](T1670-overlay-stuck-loading-after-framing-export.md) | Frontend: fix race condition in export completion, retry path missing overlay transition, and OverlayScreen loading effect dead zone. |

## Shared Code Path

```
ExportButtonContainer.jsx (onComplete / handleRetryConnection)
  → FramingScreen.jsx (handleProceedToOverlayInternal)
    → OverlayScreen.jsx (loading effect, shouldWaitForWorkingVideo)
      → GET /api/projects/{id}/working_video/stream  (projects.py)
      → GET /api/clips/projects/{id}/clips/{id}/stream  (clips.py)
        → R2 presigned URL → StreamingResponse
```

Both tasks fix different parts of this pipeline. T1690 fixes the bottom (proxy → R2), T1670 fixes the top (export completion → overlay transition → loading state).

## Shared Context

### Key architectural facts
- **Working video URL is a stable proxy**: `/api/projects/{id}/working_video/stream` never changes between exports. The only thing that changes is `working_video_id` in the project data. The OverlayScreen ref guard watches the URL (which doesn't change), creating a dead zone.
- **StreamingResponse commits headers before R2 responds**: Both proxy generators create `StreamingResponse(status_code=206, media_type="video/mp4")` before the async generator connects to R2. Any R2 error inside the generator can't produce a proper HTTP error response.
- **Browser code=4 is misleading**: `MEDIA_ERR_SRC_NOT_SUPPORTED` fires for ANY non-video response (404, 500, aborted stream), not just unsupported codecs. The frontend classifier maps this to "format-error" which shows "Video format not supported" — hiding the real cause.

### Files affected
| File | T1690 | T1670 |
|------|-------|-------|
| `src/backend/app/routers/clips.py` | R2 probe + error logging | - |
| `src/backend/app/routers/projects.py` | Error logging | - |
| `src/frontend/src/containers/ExportButtonContainer.jsx` | - | Await onProceedToOverlay; add to retry path |
| `src/frontend/src/screens/OverlayScreen.jsx` | - | Fix effect dead zone; timeout safety net |

## Completion Criteria

- After framing export, overlay mode loads the working video without getting stuck on "Loading working video..."
- If R2 is unavailable or the video doesn't exist, the user sees a clear error (not "Video format not supported")
- Backend logs capture R2 failure details (status, content-type, body snippet) for all stream proxy errors
