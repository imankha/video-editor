# T1360: Blob URL Error Recovery

**Status:** TODO
**Epic:** [Video Load Reliability](EPIC.md)
**Priority:** 1 of 3 (user-blocking)
**Branch:** `feature/T1360-blob-url-error-recovery`
**Reported:** 2026-04-10 (sarkarati@gmail.com screenshot + logs, staging build `31dd34e`)

## User Value

A user whose blob URL becomes stale (revoked, GC'd, navigation) sees **no error** and the video continues playing from the streaming URL. Today they see "Video format not supported" and have to reload the page.

## Symptom (before)

```
[VIDEO] Error: Video format not supported.
blob:https://reel-ballers-staging.pages.dev/8a592566-… Failed to load resource: net::ERR_FILE_NOT_FOUND
[VIDEO] Error: Video format not supported.  (×3 retries)
```

Root cause: `<video>` element on a revoked blob URL fires `MEDIA_ERR_SRC_NOT_SUPPORTED`. The app surfaces the generic "Video format not supported" overlay. No recovery path exists.

## Target Behavior (after)

1. On `video.error` with `MEDIA_ERR_SRC_NOT_SUPPORTED` **and** `video.src.startsWith('blob:')`, classify as a stale-blob event (not a format error).
2. Swap `video.src` back to the original streaming URL (stored when the blob was created) and resume from the last `currentTime`.
3. Error overlay is only shown if the streaming URL also fails.

## Test Plan

### Before-test (must fail against current master)

Playwright E2E: `src/frontend/e2e/blob-url-recovery.spec.js`

```
1. Load a project with a small video (~46MB fixture).
2. Wait for blob preload to complete (`[VIDEO] Mode: BLOB` log).
3. Evaluate in page: URL.revokeObjectURL(video.src); video.load();
4. Assert: no "Video format not supported" overlay is shown.
5. Assert: video.readyState >= HAVE_CURRENT_DATA within 3s.
6. Assert: currentTime is within 0.5s of pre-revoke position.
```

Record `before.log` with the failing output.

### After-test (must pass on feature branch)

Same test. Also assert a single `[VIDEO] Recovered from stale blob URL` log line.

## Files

- `src/frontend/src/hooks/useVideo.js`
  - `handleError` (~line 571): classify stale blob vs real format error
  - `loadVideoFromUrl` (~line 120): remember original streaming URL when creating blob
- `src/frontend/src/components/VideoPlayer.jsx` (~line 242): skip overlay during recovery
- Optional: `src/frontend/src/utils/videoErrorClassifier.js` with unit tests for the classification matrix (MEDIA_ERR_* x URL-scheme)

## Out of Scope

- Preventing the stale blob in the first place → T1370.
- Fixing the CORS/fetch noise visible in the report → T1350.

## Result (filled after implementation)

| Metric | Before | After |
|---|---|---|
| Stale-blob → error overlay shown | Yes | — |
| Auto-resume from streaming URL | No | — |
| currentTime preserved | n/a | — |
| Recovery test passes | No | — |
