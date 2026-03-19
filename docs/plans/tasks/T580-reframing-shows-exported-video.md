# T580: Can't Reframe — Framing Screen Shows Exported Video Instead of Source

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-03-18

## Problem

In multi-clip projects that have already been framed and exported, returning to the framing screen shows the **exported (framed/cropped) video** instead of the original source video. This makes it impossible to reframe — the user is cropping an already-cropped video.

## Solution

The framing screen should always load the original source video (`file_url`), not the exported version. Identify where the video URL is resolved when entering/returning to framing mode and ensure it always uses the raw clip source.

## Context

### Relevant Files
- `src/frontend/src/screens/FramingScreen.jsx` — loads video URL for selected clip
- `src/frontend/src/utils/clipSelectors.js` — `clipFileUrl` selector (likely the source of the wrong URL)
- `src/frontend/src/utils/storageUrls.js` — URL construction helpers
- `src/frontend/src/containers/FramingContainer.jsx` — clip switching logic

### Related Tasks
- Discovered during T570 testing
- Related to T250 (Clip Store Unification) — clips in store are raw backend data

### Technical Notes
The backend likely returns both a `file_url` (original source) and possibly an `export_url` or similar field for the processed output. The framing screen may be picking up the wrong URL — possibly from a `working_video_id` reference or an exported clip URL being stored back on the clip record after export.

Check what fields the backend returns on the clip object post-export and what URL the framing screen video loader uses.

## Acceptance Criteria

- [ ] Returning to framing on an already-exported multi-clip project loads the original source video
- [ ] Crop keyframes are still restored correctly from the previous framing session
- [ ] Re-exporting after reframing produces the newly framed output (not the old one)
