# T1370: Blob Preload Size Gate + Unmount Safety

**Status:** TODO
**Epic:** [Video Load Reliability](EPIC.md)
**Priority:** 2 of 3
**Branch:** `feature/T1370-blob-preload-size-gate`
**Depends on:** T1262 (merged)

## User Value

Two wins in one:
1. Users with real game videos (~3GB) no longer waste minutes of bandwidth and GBs of memory on a blob preload they can't benefit from. Mobile users stop OOM-crashing.
2. Users who navigate away mid-preload don't leave behind stale blob URLs that surface as T1360 errors. This task **reduces the recurrence** of T1360.

## Symptom (before)

- 3GB video loads → T1262 preload starts full download → competes with streaming playback, bloats memory.
- Component unmounts mid-preload → `URL.createObjectURL` result is either never revoked (leak) or races with `<video>` element still referencing it (stale-blob error).

Benchmarks (existing):
| Video | Size | Blob Preload | Streaming |
|-------|------|-------------|-----------|
| Fixture | 46MB | 38ms avg | 207ms avg |
| VEO game 1 | 3.07GB | impractical | 244ms avg |
| VEO game 2 | 2.93GB | impractical | 369ms avg |

## Target Behavior (after)

1. `preloadVideoAsBlob` is gated by `MAX_BLOB_PRELOAD_SIZE = 200 * 1024 * 1024` against `videoMetadata.size`. Above threshold → no preload, streaming only.
2. Preload uses an `AbortController` tied to the component's lifetime. Unmount aborts the fetch and revokes any already-created blob URL.
3. `blobPreloadRef.current` is checked before the `setSrc(blobUrl)` swap; if the ref has been cleared (unmount), the blob is revoked immediately and not handed to the `<video>` element.

## Test Plan

### Before-tests (must fail against current master)

Unit test `AnnotateContainer.preload.test.jsx`:
- Case A: `videoMetadata.size = 50 * 1024 * 1024` → `fetch` is called.
- Case B: `videoMetadata.size = 500 * 1024 * 1024` → `fetch` is NOT called. **Currently fails**.

Integration test (JSDOM or Playwright):
- Mount AnnotateContainer with a fixture URL, start preload, unmount before completion.
- Assert: `AbortController.abort` was called. **Currently fails**.
- Assert: no blob URL remains attached to any `<video>` element.

### After-tests

Same suite passes. Record byte savings and preload-skip log:
- `[Preload] Skipping blob preload: video size 3.07GB exceeds 200MB gate`

## Files

- `src/frontend/src/containers/AnnotateContainer.jsx`
  - `preloadVideoAsBlob` call site (~line 420) — add size gate + AbortController
  - `useEffect` cleanup — abort + revoke
- Constants near the top of the container (or a shared `videoConstants.js` if one exists).

## Out of Scope

- Reclassifying the error when a stale blob still slips through → T1360 owns that.
- Changing streaming path, moov handling, or CORS → unrelated.

## Result (filled after implementation)

| Metric | Before | After |
|---|---|---|
| 3GB preload starts | Yes | — |
| Unmount aborts in-flight fetch | No | — |
| Unmount revokes blob URL | No | — |
| Size-gate unit test passes | No | — |
| Unmount safety test passes | No | — |
