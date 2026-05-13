# T448: Share Target API (Inbound Sharing)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-13

## Problem

Parents record game footage with their phone's camera app. To upload to Reel Ballers, they must: open app -> navigate to upload -> browse file picker -> find the video -> select it. The file picker on mobile is clunky and parents may not remember which folder holds the video.

## Solution

Register Reel Ballers as a Web Share Target so parents can share a video FROM their camera roll (or any app) directly to Reel Ballers. The video opens directly in the upload flow.

## Architecture

```json
// In manifest.json
{
  "share_target": {
    "action": "/upload-shared",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "name",
      "files": [{
        "name": "video",
        "accept": ["video/mp4", "video/quicktime", "video/*"]
      }]
    }
  }
}
```

```
User in Photos app -> tap "Share" -> picks "Reel Ballers"
  -> PWA opens at /upload-shared with the video file
  -> Service worker intercepts POST, stashes file
  -> App reads file from SW, opens upload flow pre-filled
```

### Constraints

- Requires installed PWA (not available in browser tab)
- Chrome Android 71+, Edge -- iOS Safari does NOT support Share Target
- iOS fallback: standard file picker (already works)
- Service worker must intercept the POST and stash the file (can't rely on page being loaded)

## Key Decisions

- Accept `video/*` broadly (mp4, mov, webm) -- backend already validates on upload
- Service worker stashes shared file in Cache API, page reads it on load
- Route `/upload-shared` renders the normal upload flow with the file pre-attached
- Single-file share only (multi-file game uploads still use the in-app flow)

## Dependencies

- T441 (PWA Install) -- requires manifest + service worker

## Implementation

1. [ ] Add `share_target` to manifest.json
2. [ ] Service worker: intercept POST to `/upload-shared`, cache the file
3. [ ] Create `/upload-shared` route that reads cached file and opens upload flow
4. [ ] Pre-fill game upload form with shared video
5. [ ] Clear cached file after upload starts
6. [ ] Test: share from Photos, Camera, Files, WhatsApp on Android

## Acceptance Criteria

- [ ] Reel Ballers appears in Android share sheet for video files
- [ ] Shared video opens directly in upload flow
- [ ] Works when app was not previously open
- [ ] File picker still works as fallback on all platforms
