# T1430: Browser Over-Buffers Clip Range (2151s buffered for 8s clip)

**Status:** TODO
**Epic:** [Video Load Reliability](EPIC.md)
**Created:** 2026-04-13

## Problem

Post-T1420 verification log shows the browser buffering ~2151 seconds of media for an 8-second clip:

```
[useVideo] loadVideoFromStreamingUrl (RANGE REQUESTS) called with: https://...r2.cloudflarestorage.com/...mp4
  Clip range: offset=2144.197181s, duration=8s
[FaststartCheck] on-load verdict=FASTSTART head=[ftyp@0 moov@20] probe=227ms
[VIDEO] Buffering: 99% (2151.2s / 5s target, 1s elapsed)
[VIDEO] Loaded in 1361ms (5390.1s video)
```

Load still completes in 1.4s (because R2 is fast and the browser uses range requests), so this is not urgent. But the intent of T1210 was to buffer only the ~8-second clip window via the `#t=start,end` media fragment in `VideoPlayer.jsx`. The fragment is being served but the browser is not honoring it — it's downloading from 0 to ~2152s.

## Hypotheses

1. **`#t=` is only a playback hint, not a buffer bound.** Chrome/Firefox may use it to seek but still buffer from `0` to the hint point when `preload="metadata"` is set. If the browser seeks to `clipOffset` after parsing moov, the intervening bytes get buffered along the way.
2. **moov atom forces a head-to-seek read path.** T1380 confirmed faststart (moov at offset 20), so the moov itself is small. But some browsers issue a range-fetch from 0 to the seek target in a single 206 response instead of the two separate requests (moov + seek-window) we'd expect.
3. **Range request actually succeeded, but the browser tees the response into the buffer indefinitely.** Verify via DevTools Network tab: if we see a single 206 with `Content-Range: bytes 0-NN/total` where NN covers 0→2152s, that's the server happily serving whatever range the browser asked for.

## Investigation plan

1. Open DevTools Network while reproducing — record the `Content-Range` and `Content-Length` of each mp4 request. Correlate with the `Buffering: 99%` log line.
2. Test with `preload="auto"` vs `preload="metadata"` on the same clip. T1210 already sets `metadata` when `clipRange` is present — try removing the fragment to confirm it's not actually helping.
3. Test on Firefox vs Chrome. Media-fragment spec compliance varies.
4. If (1) shows the browser asking for bytes 0 through the seek target, add explicit range-gated fetching — e.g., proxy through a Service Worker (T1262 was iced) or use MSE with an explicit append window.

## Acceptance criteria

- [ ] Buffering for an 8s clip stays under 50 seconds of media time (generous headroom for HTTP chunking).
- [ ] Cold load time does not regress beyond current ~1s.
- [ ] Network tab shows no single 206 response covering > 50s of media bytes.

## Files likely affected

- `src/frontend/src/components/VideoPlayer.jsx` — the `#t=` fragment insertion
- `src/frontend/src/hooks/useVideo.js` — possible MSE refactor target
- Follow-up may revive `T1262-service-worker-video-cache.md` from ice

## Out of scope

- mp4 faststart at upload (T1380 shipped)
- Warmer-vs-foreground contention (T1410 shipped)
- StrictMode double-load (T1420 shipped)

## Context

- Reproduced 2026-04-13 in verification of T1420 (post-T1410 fix, fresh profile).
- Browser: Chromium-based (specific build TBD — record on next repro).
- Video: 2996MB, 5390s source on R2 with faststart moov (ftyp@0, moov@20).
- Not urgent: load time acceptable; this is wasted bandwidth and memory.
