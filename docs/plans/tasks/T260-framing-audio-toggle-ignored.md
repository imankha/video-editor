# T260: Framing Audio Toggle Ignored

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

When the user sets audio to "off" in framing mode, the exported clip still contains audio. The toggle has no effect on the final output.

## Solution

Trace the `include_audio` parameter from the frontend toggle through the export request to the backend render pipeline (Modal GPU and local fallback). Find where it's being dropped or ignored and ensure it reaches FFmpeg's encoding step.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/ExportButtonContainer.jsx` - Sends `include_audio` in export request
- `src/backend/app/routers/export/framing.py` - Framing render endpoint
- `src/backend/app/services/modal_client.py` - `call_modal_framing_ai()` accepts `include_audio`
- `src/backend/app/modal_functions/video_processing.py` - Modal GPU processing (FFmpeg encoding)
- `src/backend/app/services/local_processors.py` - Local fallback processing

### Related Tasks
- None

### Technical Notes
- The `include_audio` parameter exists in the `call_modal_framing_ai` signature
- Need to verify it's passed through the full chain: frontend → API → Modal/local → FFmpeg
- FFmpeg strips audio with `-an` flag; check if this flag is conditionally applied

## Implementation

### Steps
1. [ ] Trace `include_audio` from frontend toggle to backend endpoint
2. [ ] Verify the parameter reaches Modal/local processor
3. [ ] Check FFmpeg command construction for `-an` flag usage
4. [ ] Fix wherever the parameter is dropped
5. [ ] Test: export with audio off → verify no audio in output

## Acceptance Criteria

- [ ] Exporting with audio toggle off produces a silent video
- [ ] Exporting with audio toggle on still includes audio
- [ ] Works for both single-clip and multi-clip framing exports
