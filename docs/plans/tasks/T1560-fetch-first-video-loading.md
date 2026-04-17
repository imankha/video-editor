# T1560: Fetch-First Video Loading for Cross-Origin R2 Videos

## Problem

Chrome's `<video>` element classifies cross-origin media requests as Low priority and defers them via its internal media scheduler. HAR evidence shows **15 seconds of `_blocked_queueing`** on Annotate's game video load from R2, with zero competing network requests. The `fetchpriority="high"` attribute helps but doesn't fully eliminate Chrome's media scheduler overhead for cross-origin sources.

Meanwhile, `fetch()` calls to the same R2 origin complete in ~150ms. The codebase already uses this pattern successfully in `videoMetadata.js` to bypass Chrome's video-element defer for metadata extraction.

## Proposed Solution

Use `fetch()` to download the initial video chunk, create a blob URL, and start playback immediately. Then swap to the streaming R2 URL once playback has started.

### Approach

1. **Fetch first chunk via JS** — `fetch(r2Url, { headers: { Range: 'bytes=0-10485760' } })` (10MB)
   - Gets High/Normal priority (not subject to media scheduler)
   - Downloads moov atom + first few seconds of video data
2. **Create blob URL** — `URL.createObjectURL(new Blob([chunk]))`
3. **Set video.src = blobUrl** — `<video>` plays from same-origin blob immediately
4. **Swap to streaming URL** — Once playback starts, set `video.src = r2Url` with `#t=currentTime`
   - By this point Chrome has an active connection to R2, so the swap should be fast
   - Alternatively: keep playing from blob while `fetch()` downloads more chunks in background

### Considerations

- Game files are ~3GB — cannot blob the entire file
- Must preserve seek capability (user scrubs through full game)
- Annotate mode uses dual `<video>` elements (A/B ping-pong for segment playback)
- Both video elements need this treatment
- The swap from blob to streaming URL may cause a brief stutter — needs testing
- Alternative: use `MediaSource` API for seamless chunk feeding (more complex but no swap stutter)

## Files

- `src/frontend/src/modes/AnnotateModeView.jsx` — dual video elements
- `src/frontend/src/containers/AnnotateContainer.jsx` — handleLoadGame sets video URL
- `src/frontend/src/hooks/useVideo.js` — loadVideoFromStreamingUrl
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` — manages A/B video ping-pong

## Context

- T1533 fixed this for Framing/Overlay via `fetchpriority="high"` + fetch-based metadata
- T55 added cache warming to pre-warm R2 edge cache (reduces TTFB once request is sent)
- Cache warming confirmed effective (R2 TTFB = 80ms when warmed) — the delay is purely Chrome scheduling
