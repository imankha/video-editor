# T1670: Overlay Stuck "Loading working video..." After Framing Export

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-21

## Problem

After a framing export completes, switching to overlay mode shows "Loading working video..." spinner indefinitely. The video never loads and the user is stuck.

**Screenshot:** User is in Overlay mode, spinner shows "Loading working video...", quest panel confirms framing + export completed.

## Log Evidence

```
[WARN ] [useCrop] Restore: saved keyframes end at frame 438 but clip endFrame=301 (trimEnd=10.04 duration=undefined fps=30)
[ERROR] [framingActions] Action failed: Keyframe at frame 170 not found
[WARN ] [VIDEO] Waiting: currentTime=1001.7 bufferedEnd=1010.8 networkState=1 readyState=1
[WARN ] [FramingScreen] Selected clip not found: 4   (repeated 50+ times over 4 minutes)
[WARN ] [VIDEO] SLOW LOAD: 8986ms for 1649.5s video
[WARN ] PUT /api/clips/projects/4/clips/4 1772ms status=200
[WARN ] PUT /api/clips/projects/4/clips/4 1218ms status=200
```

### Key signals

| Signal | Meaning |
|--------|---------|
| `duration=undefined` on first useCrop restore | Metadata not available when crop hook initializes — clip data loaded before video metadata |
| `Selected clip not found: 4` (50+ times) | Clip ID 4 became stale — clips array was refreshed (new version created by export) but `selectedClipId` still references old ID |
| `1649.5s video` | A 27-minute video was loaded — this is the full game video, not a framing export (~10-14s) |
| `Keyframe at frame 170 not found` | Confirms T1660 fire-and-forget bug (delete keyframe silently failed) |
| Two PUT calls for clip 4 after "not found" spam | Clip 4 reappeared in the store (re-fetched?), causing duplicate save attempts |

## Root Cause Analysis

The "Loading working video..." spinner is controlled by this condition in [OverlayScreen.jsx:922](src/frontend/src/screens/OverlayScreen.jsx#L922):

```javascript
isLoading={!workingVideoLoadError && (isLoading || isLoadingWorkingVideo || shouldWaitForWorkingVideo)}
loadingMessage={isLoadingWorkingVideo || shouldWaitForWorkingVideo ? 'Loading working video...' : 'Loading video...'}
```

Where `shouldWaitForWorkingVideo = !workingVideo && (project?.working_video_url || isLoadingWorkingVideo)` ([line 143](src/frontend/src/screens/OverlayScreen.jsx#L143)).

For the spinner to be stuck, `workingVideo` must be null AND either `isLoadingWorkingVideo` or `project?.working_video_url` must be truthy, AND no error must have been set.

### Three interacting bugs create the stuck state

#### Bug 1: Race condition between `onProceedToOverlay` and `onExportComplete` (not awaited)

In the WebSocket `onComplete` callback ([ExportButtonContainer.jsx:315-334](src/frontend/src/containers/ExportButtonContainer.jsx#L315-L334)):

```javascript
onComplete: async (data) => {
  // ...
  if (onProceedToOverlay && editorMode === EDITOR_MODES.FRAMING) {
    onProceedToOverlay(null, clips, projectId);  // NOT awaited
  }
  if (onExportComplete) {
    onExportComplete();                           // Also NOT awaited
  }
}
```

Both fire concurrently:
- `onProceedToOverlay` -> `handleProceedToOverlayInternal` -> `await framingSaveCurrentClipState()` then `await refreshProject()` then `setEditorMode('overlay')`
- `onExportComplete` -> `handleExportComplete` -> `await fetchProjects({ force: true })`

The `fetchProjects` can finish BEFORE `framingSaveCurrentClipState`, refreshing the clips array with new version IDs. This causes:
1. Clip 4 disappears from the store (new version has different ID)
2. `framingSaveCurrentClipState` finds clip 4 gone, returns early (no-op)
3. `[FramingScreen] Selected clip not found: 4` fires repeatedly
4. The clip state save that was supposed to happen before mode switch is silently skipped

#### Bug 2: Retry/disconnect path skips `onProceedToOverlay` entirely

If the WebSocket disconnects and the user retries ([ExportButtonContainer.jsx:366-407](src/frontend/src/containers/ExportButtonContainer.jsx#L366-L407)):

```javascript
handleRetryConnection = async () => {
  if (status === 'complete') {
    completeExportInStore(exportId, working_video_id, filename);
    if (onExportComplete) onExportComplete();
    // onProceedToOverlay is NEVER CALLED
  }
}
```

In this path:
- No `setIsLoadingWorkingVideo(true)` is called
- No `setWorkingVideo(null)` is called
- No `refreshProject()` is called
- No `setEditorMode('overlay')` is called

The user stays in framing mode. If they manually switch to overlay, `ProjectContext` has stale data (never refreshed with the new `working_video_url`). OverlayScreen renders with `project.working_video_url` from the stale context — this might be the OLD working video URL or null.

#### Bug 3: OverlayScreen loading effect has a dead zone

The loading effect at [OverlayScreen.jsx:309-368](src/frontend/src/screens/OverlayScreen.jsx#L309-L368) has three branches:

```javascript
if (!workingVideo && project?.working_video_url && ref !== url) {
  // Branch 1: Load video from URL
} else if (!workingVideo && !project?.working_video_url && isLoadingWorkingVideo) {
  // Branch 2: Recovery - refresh project once
} else if (!workingVideo && !project?.working_video_url && !isLoadingWorkingVideo) {
  // Branch 3: Log warning
}
```

**Dead zone:** If `isLoadingWorkingVideo=true` AND `project.working_video_url` is set AND the ref guard matches (URL already attempted), NO branch fires. The state is:
- `workingVideo = null`
- `isLoadingWorkingVideo = true` (never cleared)
- `shouldWaitForWorkingVideo = true`
- Spinner shows forever

This happens when:
1. FramingScreen sets `isLoadingWorkingVideo=true` ([line 900](src/frontend/src/screens/FramingScreen.jsx#L900))
2. Branch 1 fires, sets the ref, starts `attemptLoad()`
3. A dependency change triggers effect re-run before `attemptLoad` completes
4. Ref guard blocks re-entry (`workingVideoFetchUrlRef.current === project.working_video_url`)
5. `project.working_video_url` is truthy -> branches 2 and 3 are skipped
6. `attemptLoad` might succeed and resolve, OR if the re-render unmounted/remounted state, the completion callback writes to stale state

## Working Video URL is a Stable Proxy

The `working_video_url` returned by the backend is always `/api/projects/{id}/working_video/stream` — a stable proxy URL, NOT a presigned URL with timestamps ([projects.py:40](src/backend/app/routers/projects.py#L40)). The proxy looks up the current `working_video_id` on each request. This means:

- The URL NEVER CHANGES between exports (same project = same proxy URL)
- The ref guard `workingVideoFetchUrlRef.current !== project.working_video_url` will be FALSE if any previous load attempt set the ref to this URL in the same mount cycle
- The only thing distinguishing old vs new working video is the `working_video_id` in the project data, but the effect only watches `working_video_url`

## Fix Plan

### Phase 1: Fix the race condition (most likely cause)

In `ExportButtonContainer.jsx` `onComplete` callback:
- `await onProceedToOverlay(...)` before calling `onExportComplete()`
- This ensures `framingSaveCurrentClipState` and `refreshProject` complete before `fetchProjects` runs

### Phase 2: Fix retry/disconnect path

In `handleRetryConnection`:
- Call `onProceedToOverlay(null, clips, projectId)` when status is complete (same as WebSocket path)
- Or at minimum: call `refreshProject()` and transition to overlay mode

### Phase 3: Fix the effect dead zone

In `OverlayScreen.jsx` loading effect:
- Add a fourth branch: `!workingVideo && project?.working_video_url && isLoadingWorkingVideo && ref === url`
- In this branch: clear `isLoadingWorkingVideo` since the URL was already attempted
- Or: use `working_video_id` in the ref guard instead of the URL (since the URL is stable but the ID changes between exports)

### Phase 4: Add timeout safety net

If `isLoadingWorkingVideo` remains true for more than 30 seconds, auto-clear it and show an error/retry button. This prevents any future stuck state regardless of root cause.

## Files

| File | Changes |
|------|---------|
| `src/frontend/src/containers/ExportButtonContainer.jsx` | Await onProceedToOverlay; add it to retry path |
| `src/frontend/src/screens/OverlayScreen.jsx` | Fix effect dead zone; add timeout safety net |
| `src/frontend/src/screens/FramingScreen.jsx` | No changes (handleProceedToOverlayInternal is fine) |

## Related

- T1660 (Framing Gesture Persistence) — confirmed by `Keyframe at frame 170 not found` in these logs
- T1520 (Export Disconnect/Retry UX) — retry path missing overlay transition

## Classification

**Stack Layers:** Frontend
**Files Affected:** ~2 files
**LOC Estimate:** ~40 lines
**Test Scope:** Frontend Unit (mock export completion, verify state transitions)
