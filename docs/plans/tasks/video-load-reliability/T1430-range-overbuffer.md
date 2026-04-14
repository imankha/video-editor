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

## New evidence (2026-04-13 via T1400 HAR capture)

Three sequential range requests for the same clip, captured in DevTools HAR:

| Range requested | Content-Range returned | Offered Content-Length |
|---|---|---|
| `bytes=1254326272-` | `bytes 1254326272-3141433332/3141433333` | 1.88 GB |
| `bytes=1255440384-` | `bytes 1255440384-3141433332/3141433333` | 1.88 GB |
| `bytes=1257078784-` | `bytes 1257078784-3141433332/3141433333` | 1.88 GB |

**Root cause confirmed:** the `<video>` element issues **open-ended** ranges
(`bytes=N-`, no upper bound). R2 correctly offers the remainder of the file
(1.88 GB from seek point to EOF). The browser pulls bytes until its internal
buffer target is satisfied and drops the connection — but by then it has
transferred far more than the 8s clip window. The `#t=` fragment tells the
element where to *display from*, not where to *stop fetching*. There is no
client-side API to bound this from the page.

Two runs observed (same clip, same profile, fresh reload):
- **Warm path** (clip-range warmer finished before click): TTFP 782ms,
  playable 1839ms, buffered 2152s. Fast enough that user doesn't notice —
  but still wasted bandwidth.
- **Cold path** (user clicked before warmer finished clip range): TTFP
  307ms, playable **20561ms**, buffered 2152s. Mid-file R2 origin fetch is
  slow on cold edge cache.

The cold path is what actually matters for user experience. The warm path
is just wasted bandwidth.

## Hypotheses

1. **`#t=` is only a playback hint, not a buffer bound.** Chrome/Firefox may use it to seek but still buffer from `0` to the hint point when `preload="metadata"` is set. If the browser seeks to `clipOffset` after parsing moov, the intervening bytes get buffered along the way.
2. **moov atom forces a head-to-seek read path.** T1380 confirmed faststart (moov at offset 20), so the moov itself is small. But some browsers issue a range-fetch from 0 to the seek target in a single 206 response instead of the two separate requests (moov + seek-window) we'd expect.
3. **Range request actually succeeded, but the browser tees the response into the buffer indefinitely.** Verify via DevTools Network tab: if we see a single 206 with `Content-Range: bytes 0-NN/total` where NN covers 0→2152s, that's the server happily serving whatever range the browser asked for.

## Proposed implementation (in priority order)

### Step 1 — Warmer observability (small, do first)

Before building a fix, make it obvious from the log whether the clip the
user is about to open has actually been pre-warmed. The HAR analysis
revealed the cold-path case was the slow one; without explicit logging
we're guessing from timing alone.

Add in `cacheWarming.js`:
- On every successful `warmClipRange` completion, log:
  `[CacheWarming] Warmed clip clipId=<id> url=<first 60> range=<startByte-endByte> elapsedMs=<n>`
- On `warmUrl`/`warmTail` completion, log the URL preview and whether tail
  was warmed.
- Add a module-level `Map<url, { clipRanges: [[startByte, endByte]...], warmedAt }>`
  and export `getWarmedState(url)` so `useVideo.loadVideoFromStreamingUrl`
  can log at start:
  `[VIDEO_LOAD] warm_status id=<id> clipWarmed=<bool> rangeCovered=<bool>`

This turns the cold-vs-warm path question into a single greppable line per
load. No behavior change, just visibility.

### Step 2 — Conditional proxy for unwarmed clips

If warm coverage of the exact clip-range bytes is confirmed `true`, serve
the R2 presigned URL directly (the current path). If coverage is `false`
— i.e., the user clicked before the warmer finished that range — fall back
to a **backend-proxied bounded range**:

```
Frontend <video src> → /api/clip-stream/{clip_id}  (same-origin)
Backend                → R2 range = bytes N-M (computed from clip times)
                       → streams to client with Content-Range bounded
```

Shape:
- Add `GET /api/clip-stream/{clip_id}` that accepts an incoming `Range`
  header, clamps the upper bound to `clipEndByte`, forwards to R2, and
  streams the response with a rewritten `Content-Range`.
- `VideoPlayer.jsx`: when `clipRange.warmed === false`, set `src` to the
  proxy URL; otherwise use the presigned R2 URL (faster, no hop).
- This gives the browser no choice — `Content-Length` is capped to the
  clip window, so there is nothing beyond it to speculatively fetch.
- Trade-off: adds a hop through Fly.io. Probably fine for cold-path
  (the user is already waiting); definitely not worth it for warm-path.

This is the minimum change that fixes the 20s cold-load case without
breaking the fast warm-path case.

### Step 3 — MSE refactor (only if Step 2 proves insufficient)

MediaSource Extensions give full control: fetch specific byte ranges,
`appendBuffer` them, set an append window `[clipStart, clipEnd]`. Big
engineering lift — replaces `<video src>` with an MSE-driven buffer
manager. Don't do this unless Step 2's proxy hop is measurably worse than
expected.

## Investigation checklist (before committing to Step 2)

1. ~~Network tab: confirm `Content-Range` pattern~~ — **done via HAR
   2026-04-13**. Browser sends `bytes=N-`, R2 offers `N-EOF`.
2. Measure what the browser actually *reads* from each open-ended range
   (bytes transferred, not offered). HAR time is small (~200ms) which
   suggests it aborts fast — but the question is whether any individual
   response transferred > clip-size bytes.
3. Confirm the proxy overhead. 1× cross-region Fly→R2 hop in the worst
   case; measure on staging with the same clip.
4. Decide whether to keep the warmer at all once the proxy exists, or
   only use it for projects/games the user hasn't opened yet.

## Acceptance criteria

- [ ] Step 1: `[CacheWarming] Warmed clip ...` and `[VIDEO_LOAD] warm_status clipWarmed=<bool>` lines appear on every load — one reload tells you the full story.
- [ ] Step 2 (cold path): Cold-load of an 8s clip from a ~3GB source on uncached R2 edge completes in ≤ 3s via the proxy.
- [ ] Step 2 (warm path): Warm path performance is not regressed — presigned-URL path still used when clip range is confirmed warm.
- [ ] `range_fallback_suspected` log from T1400 no longer fires on the proxy path (proxy bounds Content-Length to clip window).
- [ ] Network tab shows `Content-Length` ≤ clip-window size (e.g., ~20MB for an 8s HD clip) on the proxy path.

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
