# Orchestrator Carry-Forward Notes

Running notes for the Video Load Reliability epic. Each task's subagent
appends terse findings about the shared code path (useVideo.js,
AnnotateContainer.jsx, cacheWarming.js) for the next subagent to read
before starting.

---

## T1360 — Blob URL Error Recovery

Findings about `useVideo.js` that T1370 (blob preload size gate) should know:

- **Blob URL creation paths (2):** `loadVideo(file)` around L70 (local file upload) and `loadVideoFromUrl(url, filename)` around L113 (fetches URL as full blob, then `createVideoURL(file)` → blob: URL). `loadVideoFromStreamingUrl(url, ...)` around L170 uses the streaming URL directly — no blob created there.
- **Blob URL revocation paths (3):** (1) at the top of `loadVideo` for the previous `videoUrl`; (2) inside `loadVideoFromUrl` for the previous blob; (3) inside `loadVideoFromStreamingUrl` for any previous blob; (4) the unmount cleanup `useEffect` at the bottom of the hook revokes `videoUrl` on teardown. T1370 unmount-safety work touches AnnotateContainer's preload — it should reuse the hook's existing revoke helpers (`revokeVideoURL` from `videoUtils`), not invent its own.
- **videoUrl source of truth:** `useVideoStore` owns `videoUrl`. Any blob URL created outside the hook (e.g. `AnnotateContainer.preloadVideoAsBlob` from T1262) still goes through `setVideoUrl` / `setVideoLoaded` to reach the `<video>` element via VideoPlayer props.
- **Error flow:** `<video>` `onError` → `handlers.onError` → `handleError` in `useVideo.js` (L580-ish, now augmented). Error reads `video.error.code` + `video.src`, runs through `classifyVideoError` (new — `src/utils/videoErrorClassifier.js`), and on `STALE_BLOB` swaps `videoUrl` to `streamingFallbackUrlRef.current` (set by `loadVideoFromUrl` when it wrapped a streaming URL). Swap restores `currentTime` via a one-shot `loadeddata` listener. No `setError` is called on the STALE_BLOB path.
- **New recovery ref `streamingFallbackUrlRef`:** Only populated by `loadVideoFromUrl`. Cleared on `loadVideoFromStreamingUrl` and when the stash is consumed (one-shot). If T1370's preload creates blobs via a different path, it MUST also stash the original streaming URL — otherwise recovery silently does nothing. Suggest: thread the source URL through to the hook when preload completes, or make the preload call `loadVideoFromUrl` directly so the stash is automatic.
- **New classifier module:** `src/utils/videoErrorClassifier.js` — pure function; reuse in T1370's tests if needed.
- **What I did NOT touch (deferred to T1370):** `preloadVideoAsBlob` in `AnnotateContainer.jsx` (size gate + unmount abort), `cacheWarming.js` (T1350 CORS). Kept diff tight.
- **Gesture-persistence rule OK:** recovery is purely in-memory (`useRef` + `setVideoUrl`). No `useEffect` watching state → store/backend writes.
- **Note for VideoPlayer overlay suppression:** Task originally suggested adding an `isRecovering` flag surfaced to VideoPlayer. Found unnecessary because the recovery path returns early before any `setError` call — `error` state stays `null` throughout the swap, so the overlay already doesn't render. Kept VideoPlayer.jsx untouched.
- **Test harness pattern:** The Playwright spec runs against the vite dev server (requires :5173 up) and `page.evaluate`s with a dynamic import of the classifier module. T1370 can reuse this pattern for lightweight unit-ish checks; full-project E2E via file upload is too slow for a per-task loop.
