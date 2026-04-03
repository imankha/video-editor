# T870: Export Progress Stuck at 0% During Game Video Download

**Status:** TESTING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

When exporting a multi-clip project with game video clips, the export progress UI stays at 0% for ~48 seconds while the backend downloads the full game video from R2. No WebSocket progress updates are sent during this download phase, so the user sees a frozen preloader with no feedback.

The backend IS working correctly (downloading, then extracting clips), but the frontend has no visibility into the download phase.

### Observed Behavior
- User clicks "Frame Video" → export starts
- Progress bar shows 0% for ~48 seconds (duration of game video download)
- After download completes and clip extraction begins, progress starts updating normally
- Backend logs show: `Downloading game video: games/...` followed by a ~48s gap before `Extracting clip 0 range: ...`

### Expected Behavior
- Progress bar should show download phase activity (e.g., "Downloading source video..." or a download progress percentage)
- At minimum, the UI should indicate that work is happening (not appear frozen)

## Context

### Relevant Files
- `src/backend/app/routers/export/multi_clip.py` — Game video download happens here, no progress updates sent during download
- `src/frontend/src/containers/ExportButtonContainer.jsx` — Export progress UI
- `src/frontend/src/services/ExportWebSocketManager.js` — WebSocket progress handling

### Related Tasks
- None

### Technical Notes
- The game video download is a blocking operation (~3GB video files)
- WebSocket connection is established before export starts, but no messages are sent until clip processing begins
- Could send periodic "downloading" status messages during the R2 download
- Alternative: stream the download and report byte progress

## Acceptance Criteria

- [ ] Export progress UI shows activity during game video download phase
- [ ] User never sees a frozen 0% for more than a few seconds
