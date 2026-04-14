# T1400: Video Load Contention — Pause Warmer, Diagnose Fallbacks, Fix Double-Mount

**Status:** TESTING (awaiting before/after measurement)
**Epic:** [Video Load Reliability](EPIC.md)
**Priority:** 1 of 1 (new entry)
**Branch:** `feature/T1400-video-load-contention` (not created)
**Created:** 2026-04-13

## Problem

On a fresh login with existing projects, loading an 8-second clip from a 90-minute (2996MB) source mp4 takes **~56 seconds** before the video is ready. Three concurrent contributors stack up:

1. **Cache warmer competes for R2 bandwidth.** `warmAllUserVideos` launches 5 parallel workers that range-fetch the tails of every game (3 videos × ~3GB each in the observed session). These reads contend with the foreground `<video>` range request on the same R2 connection:
   ```
   [CacheWarming] Warmed tail of large video (3063MB)
   [CacheWarming] Warmed tail of large video (3043MB)
   [VIDEO] SLOW LOAD: 55827ms for 5390.1s video
   ```
   The warmer wins the race because it starts first; the user waits for the video they explicitly asked for.

2. **Range-load falls back silently.** The browser reports `Buffering: 99% (2152.7s / 5s target, 56s elapsed)` — instead of pulling just the 8-second clip window at offset 2144s, it buffered ~2152s of media-time. This means the range-fetch path didn't behave as intended (likely an unfragmented `moov` atom forcing a full seek-fetch, or the browser abandoning range mode for opaque reasons). Today this degrades silently — the user just experiences a slow load with no signal in the log about *why*.

3. **React StrictMode double-mount fires two parallel loads.** The session log shows:
   ```
   [FramingScreen] Initializing video for first clip: 2       ← first
   [useSegments] Restoring state: {...} videoDuration: 0
   [FramingScreen] Initializing video for first clip: 2       ← duplicate
   [useSegments] Restoring state: {...} videoDuration: 0
   [useVideo] loadVideoFromStreamingUrl (RANGE REQUESTS) called with: ...
   [useVideo] loadVideoFromStreamingUrl (RANGE REQUESTS) called with: ...
   ```
   Two range-load calls for the same clip, neither aborted, both competing with each other *and* with the warmer on the same R2 origin.

None of this is caused by T1330 — these are pre-existing issues that T1330's cleaner post-login fetch timing made visible by clustering them into a single burst.

## Target Behavior

### 1. Pause the warmer during active foreground video load

- Introduce a lock in `cacheWarming.js`: `setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_ACTIVE)` suspends in-flight warmup workers (abort their `fetch`es via `AbortController`) and blocks new warms from starting.
- `useVideo.loadVideoFromStreamingUrl` calls this on load start and clears it (`WARMUP_PRIORITY.NORMAL`) once the video fires `loadeddata` or errors.
- Workers resume from the head of the queue on priority clear — no dropped videos.

Non-goals: rewriting the warmer's queueing/priority model. The existing `WARMUP_PRIORITY` enum already exists; we just add one state and honor it.

### 2. Log a warning when range-load doesn't behave as a range-load

`useVideo` already tracks `networkState`, `readyState`, buffered ranges, and elapsed time. Add a watchdog:

- If after 5 seconds the `<video>` element has buffered more than **3× the clip duration** (e.g., >24s buffered for an 8s clip), emit:
  ```
  [VIDEO] WARN: range-load fallback detected — buffered 2152s for 8s clip
                (networkState=LOADING, readyState=HAVE_METADATA, url=...)
  ```
- Include the response `Content-Range` / `Accept-Ranges` / `Content-Length` headers from the initial fetch so we can tell post-hoc whether R2 served the range or 200'd the full file.
- One warning per load — not per buffered-update tick.

This gives us the observability to decide the next fix (fragment the mp4, use ffprobe on upload, byte-range hint the player, etc.) based on data instead of guesses.

### 3. Fix the double-mount

`FramingScreen` fires `loadVideoFromStreamingUrl` twice in StrictMode. Options:

- Add a `useRef` latch so the initial-load effect runs at most once per `{clipId, videoUrl}` pair.
- Or: return an `AbortController.abort()` from the effect cleanup and have `loadVideoFromStreamingUrl` honor it, so StrictMode's synthetic unmount cancels the first request before the second begins.

Prefer the latter — it's the correct pattern for any effect that triggers a network request, and it also protects against real unmount (clip switch mid-load).

## Test Plan

### Before-tests (must fail on current master)

Unit test `useVideo.rangeLoad.test.jsx`:
- Mount a component that triggers `loadVideoFromStreamingUrl` with a mocked `<video>` element.
- Simulate StrictMode: double-invoke the effect.
- Assert: only one `fetch` call survives (the second abort-cancels the first).

Integration (JSDOM):
- Start a warmup, then call `loadVideoFromStreamingUrl`.
- Assert: warmup's `AbortController.abort` was called; the warmup worker is idle until the foreground load resolves.

Unit test `videoRangeWatchdog.test.jsx`:
- Feed a mock `<video>` buffered = 2152s, clip duration = 8s, elapsed = 5s.
- Assert: a single warning is logged with the shape above.

### After-tests

Same suite passes. Manual measurement on the 90-min source clip:
- Before: ~55s cold load.
- After: target <10s cold load (no warmer contention, no duplicate fetch). Record exact numbers in Result table.

## Files

- `src/frontend/src/utils/cacheWarming.js` — add priority state, abort in-flight warms on `FOREGROUND_ACTIVE`
- `src/frontend/src/hooks/useVideo.js` — set/clear priority; add buffered watchdog; honor abort on cleanup
- `src/frontend/src/screens/FramingScreen.jsx:458` — latch or abort-based deduplication of the init effect
- `src/frontend/src/utils/videoMetadata.js` — capture `Content-Range` / `Accept-Ranges` for the warning

## Out of Scope

- Fragmenting source mp4s at upload (front-loaded moov). Separate task — solves the *underlying* cause of (2) but is a backend + reupload effort. File as follow-up once (2)'s warnings confirm the moov hypothesis.
- Changing warmer priorities for background scenarios (idle tab, etc.). Only the foreground-active case is in scope here.

## Context

### How it was found
T1330 post-login smoke test. User logged in, opened a project, clip took 56s to appear. Console log showed three overlapping issues (warmer, range fallback, double-mount).

### Relevant log excerpt
```
[CacheWarming] Queued: 1 project clips (tier 1), 3 games (3 large with tail warm), 1 gallery
[CacheWarming] Starting 5 workers for 5 videos
[FramingScreen] Initializing video for first clip: 2            ← mount 1
[FramingScreen] Initializing video for first clip: 2            ← mount 2 (StrictMode)
[useVideo] loadVideoFromStreamingUrl called ...                 ← load 1
[useVideo] loadVideoFromStreamingUrl called ...                 ← load 2 (duplicate)
[CacheWarming] Warmed tail of large video (3063MB)
[CacheWarming] Warmed tail of large video (3043MB)
[VIDEO] Buffering: 99% (2152.7s / 5s target, 56s elapsed)
[VIDEO] SLOW LOAD: 55827ms for 5390.1s video
```

## Scope correction (2026-04-13)

T1410 already shipped §1 (warmer abort on foreground load) and §3 (StrictMode
double-mount dedup via AbortController cleanup). Branch cold-load in T1410
verification: 400–950ms. The speedup goal is banked.

This branch (`feature/T1400-video-load-contention`) therefore narrows to
**observability + measurement**:

1. `[VIDEO_LOAD]` structured log channel with monotonic `loadId` correlating
   `start` → `warmer_abort` → `first_frame` → `playable`; `error` and
   `range_fallback_suspected` on failure paths.
2. Range-fallback watchdog: 5s after load start, if `buffered > 3 × clipDur`
   and not yet playable, emit one warning with bufferedSec / clipDurSec /
   ratio / elapsedMs / networkState / readyState.
3. Response-header capture (`Content-Range`, `Accept-Ranges`,
   `Content-Length`, `status`) piggybacked on the existing moov-position
   probe so we can tell post-hoc whether R2 served 206 or degraded to 200.
4. `setWarmupPriority(FOREGROUND_ACTIVE)` now returns `{abortedCount}` so the
   foreground caller can log how many warm fetches were killed.

## Files changed

- `src/frontend/src/utils/videoLoadWatchdog.js` (new) — pure
  `checkRangeFallback({bufferedSec, clipDurationSec, readyState})` helper.
- `src/frontend/src/utils/videoLoadWatchdog.test.js` (new) — 5 unit tests
  covering threshold, unknown clip duration, already-playable,
  no-buffer-yet.
- `src/frontend/src/utils/cacheWarming.js` — `setWarmupPriority` returns
  `{abortedCount}`; `abortInFlightWarms` returns the count.
- `src/frontend/src/utils/probeVideoUrl.js` — reads/returns
  `contentRange` / `acceptRanges` / `contentLength` / `status`; logs
  `[VIDEO_LOAD] headers`.
- `src/frontend/src/hooks/useVideo.js` — `loadIdRef`, watchdog setTimeout,
  structured `[VIDEO_LOAD]` events on start / warmer_abort / first_frame
  (loadedmetadata) / playable (loadeddata) / error, cleared on every exit
  path including unmount.
- `src/frontend/src/utils/cacheWarming.test.js` — asserts `abortedCount: 1`
  returned when a single in-flight warm is aborted.

Test status: full frontend suite 443/443 passing.

## Result

| Metric | Master median | Master p95 | Branch median | Branch p95 |
|---|---|---|---|---|
| TTFP (ms) | n/a | n/a | 307–782 (n=2) | 782 |
| Load-to-playable (ms) | n/a | n/a | 1839–20561 (n=2) | 20561 |
| `range_fallback_suspected` fires on slow source | n/a | n/a | ✓ (fired at `playable` trigger on 20.5s run) | ✓ |
| `warmer_abort` count per load | n/a | n/a | 2–6 | 6 |
| StrictMode double-mount dedup (already landed in T1410) | ✓ | ✓ | ✓ | ✓ |
| Warmer aborts on foreground (already landed in T1410) | ✓ | ✓ | ✓ | ✓ |

Two captured runs, same 8s clip @ 2144s offset, 3GB source:
- Fast run (warm R2 edge): TTFP 782ms → playable 1839ms; 2 warms aborted.
- Slow run (cold R2 edge): TTFP 307ms → playable 20561ms; 6 warms aborted;
  `range_fallback_suspected` fired at `playable` trigger (ratio ≈ 2151s / 8s).
  HAR: 3 open-ended `bytes=N-` range requests, R2 returned 206 with remainder
  of file (~1.88GB Content-Length). Browser could not bound the range from
  `#t=start,end` alone. Follow-up: T1430.

**Measurement protocol:** see `[VIDEO_LOAD] start` / `first_frame` / `playable`
deltas in devtools console. 5 iterations per side, fresh profile, "Disable
cache" on, same 8s clip from 3GB source, no throttling. Fill above table
before merge.

**Merge justification:** speedup is already banked (T1410). Branch-vs-master
is expected near-parity. Value delivered here is (a) greppable
`[VIDEO_LOAD]` channel for prod measurement, (b) range-fallback watchdog to
surface the next moov-at-end / opaque-fetch regression, (c) captured response
headers to support that diagnosis.

## Legacy Result table (superseded by scope correction above)

| Metric | Before | After |
|---|---|---|
| Cold-load 8s clip from 3GB source | 55.8s | 400–950ms (T1410) |
| Warmer aborts on foreground load | No | Yes (T1410) |
| Double-mount deduplicated | No | Yes (T1410) |
| Range-fallback warning emitted | No | Yes (this branch) |
| Unit tests pass | — | 443/443 (8 new) |
