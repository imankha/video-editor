# T4490 design: one owner for the Spotlight video

**Status:** awaiting owner approval (the task file's design gate). Nothing is implemented yet.
**Base:** branch `feature/T4480-T4490-T4570-T13720-one-loader-spotlight-data` after T4480 (42f98d9fc).

## Today: five writers, four places

| Place | Who writes it | Who reads it |
|-------|---------------|--------------|
| `projectDataStore.workingVideo` `{file,url,metadata}` | `FocusScreen.handleProceedToOverlayInternal` (blob branch, and `null` on the server branch), `OverlayScreen` load effect, `useProjectLoader` (loads its own copy through the `/working_video/stream` proxy, which T5642 found fails cross-origin on staging/prod) | `OverlayScreen` (`deriveOverlayVideoSource`), `App.jsx` (`hasOverlayVideo`) |
| `overlayStore.isLoadingWorkingVideo` | `FocusScreen` (`true` before navigating), `OverlayScreen` load effect | `App.jsx` -> `UnifiedHeader` -> `ModeSwitcher`, `OverlayContainer`, `utils/editorContext.js` |
| `project.working_video_url` / `working_video_id` | backend (refreshed by `refreshProject`) | `OverlayScreen` (`shouldWait`, the fetch guard) |
| `OverlayScreen` locals: `workingVideoFetchIdRef`, `workingVideoRecoveryAttemptedRef`, `workingVideoAttemptsRef`, `useState` `workingVideoLoadError`, `workingVideoMissing` | load effect, Retry button | the error / "video unavailable" UI |

The load effect (`OverlayScreen.jsx` ~570-678) stitches these together. One of its branches handles
"FocusScreen set the flag but the project has no URL yet": it refreshes the project once, then clears the flag.
The stuck loading screens came from this branch.

## Target

### State: one slice in `projectDataStore`

```js
workingVideo: {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error',
  videoId: number | null,   // project.working_video_id this record belongs to (dedup key)
  video: { file, url, metadata } | null,   // set only when status === 'ready', always url+metadata together
  error: string | null,     // user copy, for 'missing' | 'error'
}
```

`missing` is the T5440 hard 404 ("Re-generate to rebuild", no Retry button). `error` means retries ran out
(Retry button). `missing` stays separate from `error` because the two show different UI.

### One action: `loadWorkingVideo(projectId, workingVideoId, { force })`

- Dedup: if `videoId === workingVideoId` and status is `loading | ready | missing | error`, do nothing unless
  `force` (Retry passes `force: true`). This replaces `workingVideoFetchIdRef` and the recovery ref.
- Otherwise set `{status:'loading', videoId, video:null, error:null}`, then GET `/working_video/playback-url`
  (T5642 presigned URL) -> `extractVideoMetadataFromUrl` (moved from the effect as is).
  Retry is bounded at 2 attempts inside the action, replacing `workingVideoAttemptsRef`.
  A 404 is final and sets `missing`.
- Stale guard: after each await, drop the result if `get().workingVideo.videoId` changed (a project switch or
  a new render). This replaces the refs' job of ignoring late results.
- `setWorkingVideoReady(videoId, video)` exists only for a caller that already holds a blob (see below).
- `reset()` sets the slice back to `idle`.

### Who calls it

- **OverlayScreen**: one small effect, `if (project?.working_video_id) loadWorkingVideo(projectId, project.working_video_id)`.
  It is a read (a GET plus metadata), not persistence, so the gesture rule allows it, and dedup makes it idempotent.
  The recovery branch, the three refs and the two `useState`s are deleted.
- **Frame -> Spotlight after a render (`FocusScreen`)**: stop writing Spotlight state. `FocusScreen` already
  awaits `loadAndOfferFocusCompletion`, which runs `refreshProject()`. After that the project carries the
  new `working_video_id`, so OverlayScreen's effect sees a new id and loads. No flag needs handing over.
  - The `renderedVideoBlob` branch has no caller today: the MVC export passes no blob. **Proposal:** delete
    it and the blob argument. If the owner wants it kept, it calls `setWorkingVideoReady` in `projectDataStore`,
    and C3 ("writes nothing to the Spotlight store") still holds because the slice is not in `overlayStore`.
  - `setOverlayClipMetadata(clipMetadata)` (the T4480 fresh-export marker, in `projectDataStore.clipMetadata`)
    stays. It lives in `projectDataStore`, not the Spotlight store. Moving it is out of scope here.
  - `resetOverlayStore` is declared in FocusScreen but never called. Delete the declaration.
- **`useProjectLoader`**: delete its working-video load (the proxy URL plus a second metadata probe).
  OverlayScreen's effect owns the load. `onWorkingVideoLoaded` callers need checking during implementation;
  the guess is that they lose nothing because OverlayScreen loads on mount.
- **Readers** read the slice through selectors:
  `App.jsx` `hasOverlayVideo = status === 'ready'`; `ModeSwitcher`/`UnifiedHeader`/`OverlayContainer`/`editorContext`
  get `isLoadingWorkingVideo = status === 'loading'` (keep the prop name to keep the diff small).
- `overlayStore.isLoadingWorkingVideo`, `setIsLoadingWorkingVideo` and `useOverlayIsLoading` are deleted.

### `deriveOverlayVideoSource` stays as the selector

New input: `{ workingVideo /* slice */, projectWorkingVideoId, framingVideoUrl, framingMetadata }`.
`shouldWait = status === 'loading' || (projectWorkingVideoId && status === 'idle')` (the frame before the
effect fires). The "usable" check becomes `status === 'ready'`; the action makes a half-populated record
impossible to create, so the T9100 log effect is deleted. Its regression test (`overlayVideoSource`) is updated to the new input.

## Tests (red first)

New `screens/__tests__/overlayWorkingVideoOwner.test.jsx`, plus store tests for the action:
1. **From Frame after a render:** the store is idle, the project gains a new `working_video_id`, and the screen
   reaches the player with the loaded URL. FocusScreen's completion path calls no `overlayStore` setter (source/mock assertion).
2. **From Home on an existing draft:** mount with a project that has `working_video_id` -> player.
3. **After a failed load:** playback-url fails twice -> the error screen plus Retry; Retry -> player. 404 -> "unavailable", no Retry.
4. Action: dedup (two calls make one fetch), stale result dropped after the id changes, bounded at 2 attempts.
C1 code check: `isLoadingWorkingVideo` does not appear in `stores/overlayStore.js`, and there is no
`useRef`/`useState` for the working video in `OverlayScreen.jsx`.
C3 code check: `FocusScreen.jsx` contains no `useOverlayStore`.

## Risks

- `OverlayContainer` and the "no video source" diagnostics depend on the timing of `isLoadingWorkingVideo`;
  covered by test 1/2 plus the existing `overlayScreenFailedLoad`/`overlayVideoSource` tests.
- Dropping `useProjectLoader`'s early load means a direct-to-Spotlight open starts loading on mount instead of
  during project load. This is probably a few hundred ms slower, but today's early load uses the proxy URL, which T5642 says fails off-localhost.
- ~10 test mocks stub `projectDataStore.workingVideo`/`overlayStore.isLoadingWorkingVideo`; they change to the slice shape.

## Size

About 7 production files (projectDataStore, overlayStore, OverlayScreen, FocusScreen, useProjectLoader, App,
editorContext; ModeSwitcher/UnifiedHeader keep their prop name) and about 8 test files. This is tier L (a state-shape
change across screens), hence the gate.

## Questions for the owner

1. Approve the slice + action above?
2. Delete the dead `renderedVideoBlob` branch in `FocusScreen` (proposal: yes)?
3. Drop `useProjectLoader`'s early working-video load (proposal: yes; OverlayScreen owns the load)?
