# T447: Background Fetch for Uploads

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-13

## Problem

Game videos are 1-3GB. Parents upload at the field on cellular (5-20 Mbps), which takes 10-40 minutes. If they lock their phone, switch apps, or close the browser during upload, the upload dies. They have to start over on a stable connection later -- killing the "at the field" use case.

## Solution

Use the Background Fetch API to let uploads continue when the user locks their phone or switches to another app. The service worker handles the upload lifecycle independently of the page.

This is the single most differentiating PWA feature -- no competing mobile video editor handles multi-GB uploads gracefully in a browser.

## Architecture

```
User taps "Upload" -> register BackgroundFetchRegistration with service worker
                   -> SW manages chunked upload independently
                   -> Page can close/hide -- upload continues
                   -> backgroundfetchsuccess event fires on completion
                   -> Push notification: "Your game is ready to annotate"
```

### Constraints

- Background Fetch requires installed PWA (Chrome Android only currently)
- Safari does not support Background Fetch -- fallback to existing foreground upload with "keep app open" warning
- Maximum of one background fetch per registration
- Browser controls the progress UI in the notification shade

## Key Decisions

- Register one BackgroundFetch per game upload (not per chunk)
- Store upload metadata (game_id, file_name, total_size) in IndexedDB for recovery
- Fallback: existing multipart upload with "keep this tab open" toast on unsupported browsers
- Combine with T444 (Push Notifications) for completion notification

## Dependencies

- T441 (PWA Install) -- requires service worker registration
- T444 (Push Notifications) -- for completion notification when app is closed

## Implementation

1. [ ] Add Background Fetch handler to service worker (`backgroundfetchsuccess`, `backgroundfetchfail`, `backgroundfetchabort`)
2. [ ] Create `useBackgroundUpload` hook -- feature-detects, registers fetch, tracks progress
3. [ ] IndexedDB storage for pending upload metadata (game_id, progress, file reference)
4. [ ] Wire upload flow: if Background Fetch supported -> use it; else -> existing foreground upload
5. [ ] Service worker: on `backgroundfetchsuccess`, notify backend that upload is complete
6. [ ] Progress UI: show browser's native upload progress in notification shade
7. [ ] Recovery: on app reopen, reconcile IndexedDB state with backend upload status
8. [ ] Fallback toast: "Keep this tab open while uploading" on unsupported browsers

## Acceptance Criteria

- [ ] Upload continues when user locks phone on Android Chrome (installed PWA)
- [ ] Upload continues when user switches to another app
- [ ] Progress visible in Android notification shade
- [ ] On reopen, app shows upload completed / in progress correctly
- [ ] Graceful fallback on unsupported platforms (iOS Safari, desktop)
- [ ] No data loss: interrupted background fetch resumes or retries
